/**
 * Manim Mathematical Animation Canvas Video Engine (`manim-engine.js`)
 * Generates and plays a multi-scene 3Blue1Brown / Manim-style instructional video
 * directly inside a chat `<canvas>` element, synchronized with the active Gemini Neural Voice model.
 */

import { compileMathExpression } from './graph-engine.js';
import { sanitizeLatexForHud } from './svs-engine.js';

export function createManimVideoElement(storyboard = {}, options = {}) {
  const voiceName = options.voiceName || 'Aoede';
  const playbackRate = options.playbackRate || 1.0;
  const apiKey = options.apiKey || '';
  const onPlaybackStateChange = options.onPlaybackStateChange || (() => {});

  const title = storyboard.title || 'Step-by-Step Mathematical Walkthrough';
  const scenes = Array.isArray(storyboard.scenes) && storyboard.scenes.length > 0
    ? storyboard.scenes
    : [
        {
          heading: 'Step 1: Problem Setup',
          latex: '2x^2 + 5x + 2 = 0',
          annotation: 'Identify leading coefficient a = 2, middle coefficient b = 5, constant c = 2',
          narration: 'First, let us write down the quadratic equation in standard form and identify our coefficients.',
          graphExpr: '2*x^2 + 5*x + 2'
        }
      ];

  const card = document.createElement('div');
  card.className = 'manim-video-card';

  // Header
  const header = document.createElement('div');
  header.className = 'manim-video-header';
  header.innerHTML = `
    <div class="manim-title-block">
      <span class="manim-engine-badge">🎬 MANIM ENGINE // INSTRUCTIONAL VIDEO</span>
      <strong class="manim-video-title"></strong>
    </div>
    <span class="manim-voice-tag">Voice: ${voiceName}</span>
  `;
  header.querySelector('.manim-video-title').textContent = title;
  card.appendChild(header);

  // Viewport container with <canvas> + synchronized KaTeX math overlay for razor-sharp TeX vectors
  const stage = document.createElement('div');
  stage.className = 'manim-stage';

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 340;
  canvas.className = 'manim-canvas';
  stage.appendChild(canvas);

  // Synchronized Manim TeX Equation Plate rendered inside the canvas stage
  const texOverlay = document.createElement('div');
  texOverlay.className = 'manim-tex-overlay';
  stage.appendChild(texOverlay);

  card.appendChild(stage);

  // Video Controls Bar
  const controls = document.createElement('div');
  controls.className = 'manim-controls-bar';
  controls.innerHTML = `
    <button type="button" class="manim-ctrl-btn primary" data-action="play-pause">⏸ Pause</button>
    <button type="button" class="manim-ctrl-btn" data-action="replay">↺ Replay</button>
    <div class="manim-scene-dots"></div>
    <span class="manim-status-label">Synthesizing voiceover...</span>
  `;
  card.appendChild(controls);

  const btnPlayPause = controls.querySelector('[data-action="play-pause"]');
  const btnReplay = controls.querySelector('[data-action="replay"]');
  const sceneDotsContainer = controls.querySelector('.manim-scene-dots');
  const statusLabel = controls.querySelector('.manim-status-label');

  let currentSceneIdx = 0;
  let isPlaying = true;
  let isDestroyed = false;
  let sceneStartTimestamp = performance.now();
  let sceneDurationMs = 7000;
  let currentAudio = null;
  let audioCache = new Map();
  let fallbackTimer = null;

  // Render clickable scene step pills
  scenes.forEach((_sc, idx) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `manim-scene-dot ${idx === 0 ? 'active' : ''}`;
    dot.textContent = `Step ${idx + 1}`;
    dot.addEventListener('click', () => {
      playScene(idx);
    });
    sceneDotsContainer.appendChild(dot);
  });

  function updateSceneDots() {
    sceneDotsContainer.querySelectorAll('.manim-scene-dot').forEach((dot, idx) => {
      dot.classList.toggle('active', idx === currentSceneIdx);
    });
  }

  function renderTexOverlayForScene(scene) {
    const cleanLatex = sanitizeLatexForHud(scene.latex || '');
    texOverlay.innerHTML = '';
    if (!cleanLatex) return;

    const eqBox = document.createElement('div');
    eqBox.className = 'manim-tex-box';
    if (window.katex) {
      try {
        window.katex.render(cleanLatex, eqBox, {
          displayMode: true,
          throwOnError: false
        });
      } catch (_) {
        eqBox.textContent = cleanLatex;
      }
    } else {
      eqBox.textContent = cleanLatex;
    }
    texOverlay.appendChild(eqBox);
  }

  async function fetchSceneAudioBlob(sceneIdx) {
    if (audioCache.has(sceneIdx)) {
      return audioCache.get(sceneIdx);
    }
    const narration = (scenes[sceneIdx]?.narration || '').replace(/\$/g, '').trim();
    if (!narration) return null;

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: narration,
          voiceName,
          apiKey: apiKey || undefined
        })
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioCache.set(sceneIdx, url);
      return url;
    } catch (_) {
      return null;
    }
  }

  function stopCurrentAudio() {
    clearTimeout(fallbackTimer);
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.onended = null;
      } catch (_) {}
      currentAudio = null;
    }
  }

  async function playScene(idx) {
    if (isDestroyed) return;
    stopCurrentAudio();

    currentSceneIdx = Math.max(0, Math.min(scenes.length - 1, idx));
    isPlaying = true;
    btnPlayPause.textContent = '⏸ Pause';
    updateSceneDots();

    const scene = scenes[currentSceneIdx];
    renderTexOverlayForScene(scene);
    sceneStartTimestamp = performance.now();
    sceneDurationMs = 6500;

    onPlaybackStateChange(true);
    statusLabel.textContent = `Scene ${currentSceneIdx + 1} / ${scenes.length} • Loading voice...`;

    // Pre-fetch next scene audio in parallel so transitions are instant
    if (currentSceneIdx + 1 < scenes.length) {
      fetchSceneAudioBlob(currentSceneIdx + 1);
    }

    const audioUrl = await fetchSceneAudioBlob(currentSceneIdx);
    if (isDestroyed || !isPlaying) return;

    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.playbackRate = Math.max(0.85, Math.min(1.25, playbackRate));
      currentAudio = audio;

      audio.onloadedmetadata = () => {
        if (audio.duration && Number.isFinite(audio.duration)) {
          sceneDurationMs = Math.max(4000, (audio.duration / audio.playbackRate) * 1000 + 600);
        }
      };

      audio.onplay = () => {
        sceneStartTimestamp = performance.now();
        statusLabel.textContent = `Scene ${currentSceneIdx + 1} / ${scenes.length} • Playing`;
      };

      audio.onended = () => {
        advanceToNextScene();
      };

      audio.onerror = () => {
        fallbackTimer = setTimeout(() => advanceToNextScene(), 5500);
      };

      try {
        await audio.play();
      } catch (_) {
        statusLabel.textContent = `Scene ${currentSceneIdx + 1} / ${scenes.length}`;
        fallbackTimer = setTimeout(() => advanceToNextScene(), 5500);
      }
    } else {
      statusLabel.textContent = `Scene ${currentSceneIdx + 1} / ${scenes.length}`;
      fallbackTimer = setTimeout(() => advanceToNextScene(), 6000);
    }
  }

  function advanceToNextScene() {
    if (!isPlaying || isDestroyed) return;
    if (currentSceneIdx + 1 < scenes.length) {
      playScene(currentSceneIdx + 1);
    } else {
      isPlaying = false;
      btnPlayPause.textContent = '▶ Play';
      statusLabel.textContent = 'Completed • Click Replay to watch again';
      onPlaybackStateChange(false);
    }
  }

  btnPlayPause.addEventListener('click', () => {
    if (isPlaying) {
      isPlaying = false;
      btnPlayPause.textContent = '▶ Play';
      statusLabel.textContent = `Scene ${currentSceneIdx + 1} / ${scenes.length} • Paused`;
      stopCurrentAudio();
      onPlaybackStateChange(false);
    } else {
      if (currentSceneIdx >= scenes.length - 1 && statusLabel.textContent.includes('Completed')) {
        playScene(0);
      } else {
        playScene(currentSceneIdx);
      }
    }
  });

  btnReplay.addEventListener('click', () => {
    playScene(0);
  });

  // 60fps Manim Canvas Animation Loop
  function renderManimFrame() {
    if (isDestroyed) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const scene = scenes[currentSceneIdx] || scenes[0];

    const elapsed = performance.now() - sceneStartTimestamp;
    const progress = Math.min(1, Math.max(0, elapsed / sceneDurationMs));
    const introAlpha = Math.min(1, elapsed / 450);

    // 1. Deep Manim Slate Background
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, W, H);

    // 2. Animated 3Blue1Brown NumberPlane Grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.11)';
    const gridSpacing = 32;
    for (let x = 0; x <= W; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // 3. Top Scene Heading Banner (Manim Write animation)
    ctx.save();
    ctx.globalAlpha = introAlpha;
    ctx.fillStyle = '#38bdf8';
    ctx.font = '600 14.5px "Google Sans", Inter, sans-serif';
    ctx.fillText(scene.heading || `Step ${currentSceneIdx + 1}`, 24, 30);

    // Gold accent line under heading
    const lineW = Math.min(W - 48, 260 * Math.min(1, elapsed / 600));
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(24, 38);
    ctx.lineTo(24 + lineW, 38);
    ctx.stroke();
    ctx.restore();

    // 4. Glowing Manim SurroundingRectangle around the TeX equation region
    const boxX = 24;
    const boxY = 52;
    const boxW = scene.graphExpr ? 320 : W - 48;
    const boxH = 86;

    ctx.save();
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
    ctx.lineWidth = 1.6;
    const perimProgress = Math.min(1, elapsed / 800);
    ctx.strokeRect(boxX, boxY, boxW * perimProgress, boxH);
    ctx.restore();

    // Position the DOM KaTeX overlay to match the SurroundingRectangle
    texOverlay.style.left = `${(boxX / W) * 100}%`;
    texOverlay.style.top = `${(boxY / H) * 100}%`;
    texOverlay.style.width = `${(boxW / W) * 100}%`;
    texOverlay.style.height = `${(boxH / H) * 100}%`;
    texOverlay.style.opacity = String(introAlpha);

    // 5. Visual Annotation / Geometric Callout Box
    if (scene.annotation) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, (elapsed - 300) / 500));
      ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
      ctx.strokeStyle = 'rgba(129, 201, 149, 0.5)';
      ctx.lineWidth = 1.2;
      ctx.fillRect(24, 152, boxW, 52);
      ctx.strokeRect(24, 152, boxW, 52);

      ctx.fillStyle = '#81c995';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillText('KEY INSIGHT', 34, 169);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '12px Inter, sans-serif';
      wrapCanvasText(ctx, String(scene.annotation).replace(/\$/g, ''), 34, 187, boxW - 20, 15);
      ctx.restore();
    }

    // 6. Animated Manim Function Graph (`Create(FunctionGraph)` + `ValueTracker` dot) on Right Half
    if (scene.graphExpr) {
      const gx0 = 364;
      const gy0 = 52;
      const gw = W - gx0 - 20;
      const gh = 165;

      ctx.save();
      ctx.fillStyle = 'rgba(12, 18, 32, 0.92)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.fillRect(gx0, gy0, gw, gh);
      ctx.strokeRect(gx0, gy0, gw, gh);

      // Axes inside mini-plane
      const cx = gx0 + gw / 2;
      const cy = gy0 + gh * 0.6;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx0 + 8, cy);
      ctx.lineTo(gx0 + gw - 8, cy);
      ctx.moveTo(cx, gy0 + 8);
      ctx.lineTo(cx, gy0 + gh - 8);
      ctx.stroke();

      // Animated curve sweep
      const fn = compileMathExpression(scene.graphExpr);
      const xMin = -5;
      const xMax = 5;
      const yScale = 12;
      const sweepMaxPx = Math.floor(gw * Math.min(1, elapsed / 1400));

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      let pen = false;
      for (let px = 0; px <= sweepMaxPx; px += 2) {
        const wx = xMin + (px / gw) * (xMax - xMin);
        const wy = fn(wx);
        if (Number.isFinite(wy)) {
          const sy = cy - wy * yScale;
          if (sy >= gy0 + 4 && sy <= gy0 + gh - 4) {
            if (!pen) {
              ctx.moveTo(gx0 + px, sy);
              pen = true;
            } else {
              ctx.lineTo(gx0 + px, sy);
            }
          } else {
            pen = false;
          }
        } else {
          pen = false;
        }
      }
      ctx.stroke();

      // Moving ValueTracker highlight dot along curve
      const trackerT = (Math.sin(elapsed * 0.002) + 1) * 0.5;
      const txWorld = xMin + trackerT * (xMax - xMin);
      const tyWorld = fn(txWorld);
      if (Number.isFinite(tyWorld)) {
        const tsx = gx0 + trackerT * gw;
        const tsy = cy - tyWorld * yScale;
        if (tsy >= gy0 + 6 && tsy <= gy0 + gh - 6) {
          ctx.fillStyle = '#facc15';
          ctx.beginPath();
          ctx.arc(tsx, tsy, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 7. Bottom Subtitle / Voiceover Caption Box
    ctx.fillStyle = 'rgba(10, 15, 26, 0.92)';
    ctx.fillRect(16, H - 78, W - 32, 58);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.strokeRect(16, H - 78, W - 32, 58);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '12.5px "Google Sans", Inter, sans-serif';
    wrapCanvasText(ctx, String(scene.narration || '').replace(/\$/g, ''), 28, H - 56, W - 56, 17);

    // 8. Bottom Scene Timeline Progress Bar
    const totalProgress = (currentSceneIdx + progress) / scenes.length;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.fillRect(0, H - 5, W, 5);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, H - 5, W * totalProgress, 5);

    requestAnimationFrame(renderManimFrame);
  }

  requestAnimationFrame(renderManimFrame);
  playScene(0);

  return card;
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let currY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, currY);
      line = words[n] + ' ';
      currY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, currY);
}
