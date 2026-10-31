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

    const { systemInstruction, history = [], message } = body;
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
          temperature: 0.5,
          maxOutputTokens: 320
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
    }

    const replyText = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(' ').trim() || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reply: replyText }));
  } catch (err) {
    console.error('/api/chat error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * POST /api/manim-script
 * Generates a 5-Step Formal Full Solution & Concept Walkthrough Manim Storyboard JSON
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

    const { history = [], topicHint = '' } = body;
    const transcriptSummary = history
      .slice(-12)
      .map(t => `${t.role === 'svs' ? 'Tutor' : 'Student'}: ${t.text}`)
      .join('\n');

    const prompt = `You are a Master Ontario Secondary STEM Instructor (MCR3U, MHF4U, MCV4U, SPH4U, SCH4U) authoring a formal 3Blue1Brown / Manim instructional solution video.

Identify the exact math or science problem from the session below:
${transcriptSummary || topicHint || 'Solve and graph the quadratic equation 2x^2 + 5x + 2 = 0'}

CRITICAL REQUIREMENTS:
1. DO NOT write a casual summary of the conversation (never say "As we discussed" or "Earlier you said").
2. Instead, produce a FORMAL, COMPLETE, SELF-CONTAINED STEP-BY-STEP SOLUTION of the problem from first principles to the final verified answer, teaching the underlying mathematical/scientific concept rigorously.
3. Structure the solution into exactly 5 sequential steps in the "scenes" array:
   - Step 1: Formal Problem Statement, Standard Form & Given Parameters
   - Step 2: Governing Mathematical Theorem, Definition, or Physical Law (explain WHY this principle applies)
   - Step 3: Explicit Substitution & Initial Algebraic / Analytical Transformation
   - Step 4: Intermediate Simplification, Factoring, or Solving Step-by-Step
   - Step 5: Final Exact Solution, Domain/Constraint Verification & Graphical Interpretation
4. Every step MUST include:
   - "heading": Formal title of the step (e.g. "Step 2: Governing Principle — The ac-Decomposition Method")
   - "conceptTag": The specific mathematical rule/theorem applied in this step (e.g. "Theorem: Find p, q such that p·q = a·c and p + q = b")
   - "latex": The formal mathematical equation/derivation line for this step in pure LaTeX WITHOUT any $ signs
   - "annotation": Concise 1-line formal justification of the algebraic transformation
   - "narration": 2 to 3 complete, formal, articulate spoken sentences (30-50 words) explaining the concept and exact algebraic step in plain spoken English (write all math phonetically in words for TTS; zero $ signs or raw LaTeX commands).
   - "graphExpr": A valid JavaScript math expression in x to plot on the Manim coordinate plane (e.g. "2*x^2 + 5*x + 2"), or "" if non-graphical
   - "highlightPoint": An array [x, y] of a key coordinate point to highlight on the graph in this step (e.g. [-0.5, 0] or [0, 2]), or null

Return ONLY valid JSON matching this schema:
{
  "title": "Formal Solution: ...",
  "course": "Ontario STEM (e.g. MCR3U / MCV4U)",
  "xDomain": [-6, 6],
  "yDomain": [-6, 10],
  "scenes": [
    {
      "heading": "Step 1: ...",
      "conceptTag": "...",
      "latex": "...",
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
 * Studio-quality Natural Human Voice synthesis via Gemini Neural TTS models
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

    const modelsToTry = [
      'gemini-3.8-flash-lite-tts',
      'gemini-2.5-flash-preview-tts'
    ];

    let audioPart = null;
    let lastErr = null;

    for (const modelName of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName
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
    }

    if (!audioPart) {
      throw lastErr || new Error('Neural TTS generation failed');
    }

    const rawBuffer = Buffer.from(audioPart.data, 'base64');
    const mime = (audioPart.mimeType || '').toLowerCase();

    let wavBuffer;
    if (mime.includes('wav')) {
      wavBuffer = rawBuffer;
    } else {
      wavBuffer = pcm16ToWavBuffer(rawBuffer, 24000, 1);
    }

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
  console.log(`CAN-ON-SVS-01 Server + Gemini AI, Graph & Manim Engine online at http://localhost:${PORT}`);
});
