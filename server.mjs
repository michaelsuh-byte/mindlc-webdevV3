import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTriChannelPacket,
  sanitizeForSpeech,
  splitSpokenTextIntoClauses
} from './svs-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4173;
const DEFAULT_API_KEY = process.env.GEMINI_API_KEY || '';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

/**
 * In-memory TTS WAV cache, in-flight deduplication map, and 2-slot concurrency limiter.
 * Allows Clause 1 and Clause 2 of a turn to synthesize in parallel while preventing HTTP 429 burst errors.
 */
const ttsWavCache = new Map();
const inFlightTtsMap = new Map();
const MAX_CONCURRENT_TTS = 2;
let activeTtsCount = 0;
const ttsWaiters = [];

function acquireTtsSlot() {
  if (activeTtsCount < MAX_CONCURRENT_TTS) {
    activeTtsCount++;
    return Promise.resolve();
  }
  return new Promise(resolve => {
    ttsWaiters.push(resolve);
  });
}

function releaseTtsSlot() {
  if (ttsWaiters.length > 0) {
    const next = ttsWaiters.shift();
    next();
  } else {
    activeTtsCount = Math.max(0, activeTtsCount - 1);
  }
}

function normalizeTtsText(text = '') {
  const audit = sanitizeForSpeech(String(text || ''), 60);
  if (audit && audit.cleanText) {
    return audit.cleanText;
  }
  return String(text || '')
    .replace(/<hud>[\s\S]*?<\/hud>/gi, ' ')
    .replace(/<graph>[\s\S]*?<\/graph>/gi, ' ')
    .replace(/<table_data>[\s\S]*?<\/table_data>/gi, ' ')
    .replace(/<telemetry>[\s\S]*?<\/telemetry>/gi, ' ')
    .replace(/\$\$([\s\S]*?)\$\$/g, ' ')
    .replace(/\$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCacheKey(voiceName, text) {
  return `${voiceName || 'Aoede'}::${normalizeTtsText(text)}`;
}

/**
 * Extracts plain spoken text from a tri-channel LLM response on the server for immediate TTS pre-warming
 */
function extractServerSpokenText(rawReply = '') {
  return normalizeTtsText(rawReply);
}

/**
 * Normalizes 16-bit signed mono PCM audio to a consistent active-speech RMS loudness (-15 dBFS, targetRms = 0.18)
 * with a soft-knee peak limiter at 0.92 so every step in the solution video and chat sounds uniform in volume.
 */
export function normalizePcm16Buffer(pcmBuffer, targetRms = 0.18) {
  if (!pcmBuffer || pcmBuffer.length < 4) return pcmBuffer;

  const sampleCount = Math.floor(pcmBuffer.length / 2);
  let activeSumSq = 0;
  let activeCount = 0;
  let peakAbs = 0;
  // Ignore near-silent frames below ~ -45 dBFS (180 / 32768) when computing active speech loudness
  const silenceGate = 180 / 32768;

  for (let i = 0; i < sampleCount; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2) / 32768;
    const abs = Math.abs(sample);
    if (abs > peakAbs) peakAbs = abs;
    if (abs >= silenceGate) {
      activeSumSq += sample * sample;
      activeCount++;
    }
  }

  if (peakAbs < 0.001) return pcmBuffer;

  const activeRms = activeCount > 0 ? Math.sqrt(activeSumSq / activeCount) : peakAbs * 0.5;
  // Clamp gain to [0.55, 3.0] so quiet generations are boosted and loud ones are leveled
  const desiredGain = Math.max(0.55, Math.min(3.0, targetRms / Math.max(0.01, activeRms)));

  const outBuffer = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    let val = (pcmBuffer.readInt16LE(i * 2) / 32768) * desiredGain;
    // Smooth soft-knee limiter above 0.78 up to ceiling 0.94 so peaks never clip harshly
    const absVal = Math.abs(val);
    if (absVal > 0.78) {
      const sign = val < 0 ? -1 : 1;
      const excess = absVal - 0.78;
      val = sign * (0.78 + 0.16 * Math.tanh(excess / 0.16));
    }
    const intSample = Math.max(-32767, Math.min(32767, Math.round(val * 32767)));
    outBuffer.writeInt16LE(intSample, i * 2);
  }

  return outBuffer;
}

/**
 * Wraps raw 16-bit mono PCM (24000 Hz) in a standard RIFF WAV header
 */
function pcm16ToWavBuffer(pcmBuffer, sampleRate = 24000, numChannels = 1) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = pcmBuffer.length;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Synthesizes or retrieves cached/in-flight WAV audio buffer for `(text, voiceName)`
 * Uses `gemini-2.5-flash-preview-tts` directly with serialized queue + automatic retry backoff
 * so concurrent requests never trigger HTTP 429 or drop Aoede's neural voice.
 */
async function getOrSynthesizeTtsWav(text, voiceName = 'Aoede', apiKey = DEFAULT_API_KEY) {
  const cleanText = normalizeTtsText(text);
  if (!cleanText || !apiKey) {
    throw new Error('Missing text or API key for TTS');
  }

  const resolvedVoice = voiceName || 'Aoede';
  const key = getCacheKey(resolvedVoice, cleanText);
  if (ttsWavCache.has(key)) {
    return ttsWavCache.get(key);
  }
  if (inFlightTtsMap.has(key)) {
    return inFlightTtsMap.get(key);
  }

  const synthPromise = (async () => {
    await acquireTtsSlot();
    try {
      const modelName = 'gemini-2.5-flash-preview-tts';
      let audioPart = null;
      let lastErr = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: cleanText }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: resolvedVoice
                    }
                  }
                }
              }
            })
          });

          const data = await response.json();
          const candidatePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
          if (response.ok && candidatePart) {
            audioPart = candidatePart.inlineData;
            break;
          } else {
            lastErr = new Error(data.error?.message || `TTS HTTP ${response.status}`);
          }
        } catch (e) {
          lastErr = e;
        }

        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 350 * attempt));
        }
      }

      if (!audioPart) {
        throw lastErr || new Error('Neural TTS generation failed');
      }

      const rawBuffer = Buffer.from(audioPart.data, 'base64');
      const mime = (audioPart.mimeType || '').toLowerCase();
      const hasRiffHeader =
        (mime.includes('wav') || rawBuffer.slice(0, 4).toString('ascii') === 'RIFF') &&
        rawBuffer.length > 44;
      const rawPcm = hasRiffHeader ? rawBuffer.subarray(44) : rawBuffer;
      const normalizedPcm = normalizePcm16Buffer(rawPcm, 0.18);
      const wavBuffer = pcm16ToWavBuffer(normalizedPcm, 24000, 1);

      // Keep cache bounded to 80 recent clips
      if (ttsWavCache.size >= 80) {
        const oldestKey = ttsWavCache.keys().next().value;
        ttsWavCache.delete(oldestKey);
      }
      ttsWavCache.set(key, wavBuffer);
      return wavBuffer;
    } finally {
      releaseTtsSlot();
    }
  })();

  inFlightTtsMap.set(key, synthPromise);
  try {
    return await synthPromise;
  } finally {
    inFlightTtsMap.delete(key);
  }
}

/**
 * Pre-warms the exact spoken response on the server so `/api/tts` returns immediately from cache/in-flight
 */
function prewarmSpokenTextTts(rawSpokenText, voiceName = 'Aoede', apiKey = DEFAULT_API_KEY) {
  const clean = extractServerSpokenText(rawSpokenText);
  if (!clean || !apiKey) return;
  getOrSynthesizeTtsWav(clean, voiceName || 'Aoede', apiKey).catch(() => {});
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * POST /api/chat
 * Multi-turn Ontario Secondary STEM Tutor powered by Gemini 2.5 Flash
 * Immediately pre-warms neural TTS audio in parallel before returning so voice starts near-instantly.
 */
async function handleChatApi(req, res) {
  try {
    const body = await readJsonBody(req);
    const apiKey = (body.apiKey || DEFAULT_API_KEY).trim();
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No Gemini API key configured.' }));
      return;
    }

    const { systemInstruction, history = [], message, voiceName = 'Aoede', maxWords = 30 } = body;
    const contents = [];

    for (const turn of history.slice(-14)) {
      if (turn && turn.text) {
        contents.push({
          role: turn.role === 'svs' ? 'model' : 'user',
          parts: [{ text: turn.text }]
        });
      }
    }

    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        contents,
        generationConfig: {
          thinkingConfig: { thinkingBudget: 0 },
          temperature: 0.45,
          maxOutputTokens: 320
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
    }

    const replyText = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(' ').trim() || '';

    // Option 4: Split into [shortFirstClause, remainder] using exact `sanitizeForSpeech` rules,
    // bundle `firstChunkWavBase64` directly inside `/api/chat` (so voice starts at 0.0s when text appears),
    // and synthesize `audioChunks[1]` in parallel in the background!
    const parsed = parseTriChannelPacket(replyText, Number(maxWords) || 30);
    const audioChunks = splitSpokenTextIntoClauses(parsed.spokenText, Number(maxWords) || 30);
    let firstChunkWavBase64 = null;

    if (audioChunks.length > 0) {
      const chunk0Promise = getOrSynthesizeTtsWav(audioChunks[0], voiceName, apiKey);
      if (audioChunks.length > 1) {
        getOrSynthesizeTtsWav(audioChunks[1], voiceName, apiKey).catch(() => {});
      }

      try {
        const wavBuf = await Promise.race([
          chunk0Promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('PREWARM_TIMEOUT')), 1750))
        ]);
        if (wavBuf) {
          firstChunkWavBase64 = wavBuf.toString('base64');
        }
      } catch (_) {
        // If chunk 0 takes slightly longer than 1.75s, it remains in `inFlightTtsMap` so `/api/tts` awaits the rest of it
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        reply: replyText,
        audioChunks,
        firstChunkWavBase64
      })
    );
  } catch (err) {
    console.error('/api/chat error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * POST /api/analyze-gap
 * Runs behind the scenes while the tutor's previous script is being read aloud!
 * Diagnoses the exact hidden learning gap / missing prerequisite concept at the current step
 * so it is ready if the Stage 2 timer runs out OR when the student responds next.
 */
async function handleAnalyzeGapApi(req, res) {
  try {
    const body = await readJsonBody(req);
    const apiKey = (body.apiKey || DEFAULT_API_KEY).trim();
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No Gemini API key configured.' }));
      return;
    }

    const {
      history = [],
      lastHudLatex = '',
      lastTutorQuestion = '',
      lastStudentUtterance = '',
      modeName = 'Socratic Hints',
      voiceName = 'Aoede'
    } = body;

    const recentTurns = history
      .slice(-6)
      .map(t => `${t.role === 'svs' ? 'Tutor' : 'Student'}: ${t.text}`)
      .join('\n');

    const prompt = `You are a cognitive STEM learning-gap diagnostic engine operating behind the scenes while the tutor speaks.
Analyze the current tutoring step below and identify the underlying learning gap (the missing prerequisite concept behind the scenes that would cause the student to get stuck at this exact step).

Active Mode: ${modeName}
Current Math HUD: ${lastHudLatex || 'None'}
Last Student Input: ${lastStudentUtterance || 'None'}
Tutor Question Just Asked: ${lastTutorQuestion}
Recent Conversation:
${recentTurns}

Return ONLY valid JSON with these exact keys (no markdown fences, no $ signs):
{
  "missingConcept": "Concise 1-line name of the hidden prerequisite concept needed for this step",
  "whyStuck": "1-sentence diagnosis of why a student might stall at this specific step",
  "bridgingStrategy": "1-sentence instruction on how to relate this missing concept to the student's response in the next turn",
  "stage2OfferSpoken": "A warm, natural 1-2 sentence spoken check-in (< 26 words, plain English, no $ signs) offering to explain this specific concept because 30 seconds have passed (e.g. 'It looks like finding the factor pair might feel tricky right now. Would you like me to explain the concept behind how product-sum decomposition works?')",
  "conceptExplanationHud": "Pure LaTeX formula (no $ signs) illustrating the missing concept clearly",
  "conceptExplanationSpoken": "A clear, encouraging 2-sentence spoken explanation (< 30 words, plain English, no $ signs) that explains the missing concept and connects it back to the step, ending with an easy check-in question."
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          temperature: 0.3,
          maxOutputTokens: 500
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
    }

    const rawText = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(' ').trim() || '{}';
    const gapAnalysis = JSON.parse(rawText.replace(/```json|```/gi, '').trim());

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ gapAnalysis }));
  } catch (err) {
    console.error('/api/analyze-gap error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * POST /api/manim-script
 * Generates a Multi-Screen Step-by-Step Formal Solution Storyboard with Concise Visual Cues & Tables
 */
async function handleManimScriptApi(req, res) {
  try {
    const body = await readJsonBody(req);
    const apiKey = (body.apiKey || DEFAULT_API_KEY).trim();
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No Gemini API key configured.' }));
      return;
    }

    const { history = [], topicHint = '', voiceName = 'Aoede' } = body;
    const transcriptSummary = history
      .slice(-12)
      .map(t => `${t.role === 'svs' ? 'Tutor' : 'Student'}: ${t.text}`)
      .join('\n');

    const prompt = `You are a Master Ontario Secondary STEM Instructor (MCR3U, MHF4U, MCV4U, SPH4U, SCH4U) authoring a multi-screen step-by-step formal solution video.

Identify the exact math or science problem from the session below:
${transcriptSummary || topicHint || 'Solve and graph the quadratic equation 2x^2 + 5x + 2 = 0'}

CRITICAL UX & PEDAGOGICAL REQUIREMENTS:
1. NEVER refer to "Manim" or any underlying video technology.
2. DO NOT write a casual summary of the chat conversation. Present a FORMAL, COMPLETE, STEP-BY-STEP SOLUTION from start to finish.
3. Structure the video into 4 or 5 distinct step screens in the "scenes" array (Step 1, Step 2, Step 3, Step 4, ...).
4. Keep on-screen text strictly CONCISE so each step fits on a single slide with ZERO scrolling:
   - "heading": Short 3-to-6 word step title (e.g. "Step 1: Standard Form & Coefficients")
   - "conceptTag": Short 1-line mathematical rule or principle (under 10 words)
   - "latex": Single clean LaTeX equation for this step WITHOUT any $ signs
   - "table": When helpful to organize coefficients, factor pairs, intervals, sign charts, or roots/intercepts, provide a compact table object: {"headers": ["Col 1", "Col 2", "Col 3"], "rows": [["...", "...", "..."]]} with at most 3 rows and short cell values. Otherwise set "table": null.
   - "annotation": Short 1-line visual takeaway (under 12 words) if no table is used.
5. "narration": Clear, naturally paced spoken explanation (2 concise sentences, 18 to 28 words, matching the calm conversational cadence of the chat tutor) explaining the concept and step in plain spoken English (no $ signs or raw LaTeX).
6. "graphExpr": Set to "" (empty string) by default! Do NOT include a graph on every step or for every problem. ONLY provide a valid JS math expression in x (e.g. "2*x^2 + 5*x + 2") on a specific step when a graph is strictly needed or directly benefits the student's visual understanding of that step (such as visually verifying roots/intercepts on the final step, or when the problem is explicitly about graphing). For algebraic manipulations, coefficient identification, factoring steps, kinematics formulas, or stoichiometry, leave "graphExpr": "" so the step screen focuses cleanly on the equation and table.
7. "highlightPoint": Stationary key point [x, y] to highlight on the graph ONLY when "graphExpr" is non-empty for that step (e.g. [-0.5, 0]); otherwise set to null.

Return ONLY valid JSON matching this schema:
{
  "title": "Step-by-Step Solution: ...",
  "course": "Ontario STEM",
  "xDomain": [-6, 6],
  "yDomain": [-6, 10],
  "scenes": [
    {
      "heading": "Step 1: ...",
      "conceptTag": "...",
      "latex": "...",
      "table": {"headers": ["Parameter", "Value", "Meaning"], "rows": [["a", "2", "Leading coeff"]]},
      "annotation": "...",
      "narration": "...",
      "graphExpr": "...",
      "highlightPoint": [0, 2]
    }
  ]
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          temperature: 0.3,
          maxOutputTokens: 2048
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
    }

    const rawText = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(' ').trim() || '{}';
    const cleanedJson = rawText.replace(/```json|```/gi, '').trim();
    const storyboard = JSON.parse(cleanedJson);

    // Pre-warm Scene 1 and Scene 2 TTS immediately on the server so video playback starts without delay!
    if (Array.isArray(storyboard.scenes)) {
      if (storyboard.scenes[0]?.narration) {
        getOrSynthesizeTtsWav(storyboard.scenes[0].narration, voiceName, apiKey).catch(() => {});
      }
      if (storyboard.scenes[1]?.narration) {
        getOrSynthesizeTtsWav(storyboard.scenes[1].narration, voiceName, apiKey).catch(() => {});
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ storyboard }));
  } catch (err) {
    console.error('/api/manim-script error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * POST /api/tts
 * Studio-quality Natural Human Voice synthesis via Gemini Neural TTS models (with in-flight deduplication & cache)
 */
async function handleTtsApi(req, res) {
  try {
    const body = await readJsonBody(req);
    const apiKey = (body.apiKey || DEFAULT_API_KEY).trim();
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No Gemini API key configured.' }));
      return;
    }

    const text = (body.text || '').trim();
    const voiceName = body.voiceName || 'Aoede';

    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Empty text' }));
      return;
    }

    const wavBuffer = await getOrSynthesizeTtsWav(text, voiceName, apiKey);

    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': wavBuffer.length,
      'Cache-Control': 'no-store'
    });
    res.end(wavBuffer);
  } catch (err) {
    console.error('/api/tts error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') {
    return handleChatApi(req, res);
  }
  if (req.method === 'POST' && req.url === '/api/analyze-gap') {
    return handleAnalyzeGapApi(req, res);
  }
  if (req.method === 'POST' && req.url === '/api/manim-script') {
    return handleManimScriptApi(req, res);
  }
  if (req.method === 'POST' && req.url === '/api/tts') {
    return handleTtsApi(req, res);
  }

  const safePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(__dirname, safePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  server.listen(PORT, () => {
    console.log(`CAN-ON-SVS-01 Server + Fast TTS Pre-Warm & Learning-Gap Engine online at http://localhost:${PORT}`);
  });
}
