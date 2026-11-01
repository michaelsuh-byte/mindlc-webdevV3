import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * In-memory TTS WAV cache & in-flight deduplication map.
 * Allows `/api/chat` and `/api/manim-script` to pre-warm TTS synthesis in the background
 * the millisecond text is generated, eliminating multi-second voice startup lag!
 */
const ttsWavCache = new Map();
const inFlightTtsMap = new Map();
let ttsQueuePromise = Promise.resolve();

function normalizeTtsText(text = '') {
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
    // Queue TTS requests so simultaneous calls never collide or hit rate limits
    const prevJob = ttsQueuePromise;
    let releaseQueue;
    ttsQueuePromise = new Promise(resolve => {
      releaseQueue = resolve;
    });

    try {
      await prevJob.catch(() => {});

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
      const wavBuffer = mime.includes('wav') ? rawBuffer : pcm16ToWavBuffer(rawBuffer, 24000, 1);

      // Keep cache bounded to 80 recent clips
      if (ttsWavCache.size >= 80) {
        const oldestKey = ttsWavCache.keys().next().value;
        ttsWavCache.delete(oldestKey);
      }
      ttsWavCache.set(key, wavBuffer);
      return wavBuffer;
    } finally {
      releaseQueue();
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

    const { systemInstruction, history = [], message, voiceName = 'Aoede' } = body;
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

    // Kick off background TTS synthesis immediately on the server so when client requests /api/tts it is already hot!
    prewarmSpokenTextTts(replyText, voiceName, apiKey);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reply: replyText }));
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
6. "graphExpr": Valid JS math expression in x to plot (e.g. "2*x^2 + 5*x + 2"), or "" if non-graphical.
7. "highlightPoint": Stationary key point [x, y] to highlight on the graph for this step (e.g. [-0.5, 0] or [0, 2]), or null.

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

server.listen(PORT, () => {
  console.log(`CAN-ON-SVS-01 Server + Fast TTS Pre-Warm & Learning-Gap Engine online at http://localhost:${PORT}`);
});
