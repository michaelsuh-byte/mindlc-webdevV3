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
  header.writeUInt32LE(16, 16);          // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);           // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);          // BitsPerSample
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

    for (const turn of history.slice(-12)) {
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
          maxOutputTokens: 250
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
 * POST /api/tts
 * Studio-quality Natural Human Voice synthesis via Gemini Neural TTS models
 * (gemini-3.8-flash-lite-tts with automatic fallback to gemini-2.5-flash-preview-tts)
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
            contents: [
              {
                parts: [
                  {
                    text
                  }
                ]
              }
            ],
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
      // Convert raw L16 24kHz PCM to WAV
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
  console.log(`CAN-ON-SVS-01 Server + Gemini AI & Neural TTS online at http://localhost:${PORT}`);
});
