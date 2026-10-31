/**
 * Manim Formal Step-by-Step Solution Video Engine (`manim-engine.js`)
 * Renders a 3Blue1Brown / Manim-style multi-scene formal mathematical solution & conceptual lesson
 * inside a chat `<canvas>` element + cumulative KaTeX derivation board, synchronized with the active
 * Gemini Neural Voice model (`/api/tts`).
 */

import { compileMathExpression } from './graph-engine.js';
import { sanitizeLatexForHud } from './svs-engine.js';

export function createManimVideoElement(storyboard = {}, options = {}) {
  const voiceName = options.voiceName || 'Puck';
  const playbackRate = options.playbackRate || 1.0;
  const apiKey = options.apiKey || '';
  const onPlaybackStateChange = options.onPlaybackStateChange || (() => {});

  const title = String(storyboard.title || 'Formal Step-by-Step Mathematical Solution').replace(/\$/g, '');
  const course = String(storyboard.course || 'Ontario Secondary STEM — Formal Solution').replace(/\$/g, '');
  const scenes = Array.isArray(storyboard.scenes) && storyboard.scenes.length > 0
    ? storyboard.scenes
    : [
        {
          heading: 'Step 1: Formal Problem Statement & Standard Form',
          conceptTag: 'Standard Quadratic Form: ax² + bx + c = 0',
          latex: '2x^2 + 5x + 2 = 0 \\quad (a = 2,\\; b = 5,\\; c = 2)',
          annotation: 'Identify coefficients: leading coefficient a = 2, linear coefficient b = 5, constant term c = 2.',
          narration: 'We begin by stating the quadratic equation in standard form, two x squared plus five x plus two equals zero. Here, the leading coefficient a is two, the middle coefficient b is five, and the constant term c is two.',
          graphExpr: '2*x^2 + 5*x + 2',
          highlightPoint: [0, 2]
        },
        {
          heading: 'Step 2: Governing Concept — The ac-Decomposition Theorem',
          conceptTag: 'Find integers p, q such that p·q = a·c and p + q = b',
          latex: 'p \\cdot q = 2 \\times 2 = 4, \\quad p + q = 5 \\implies p = 4,\\; q = 1',
          annotation: 'Multiply a·c = 4. The unique pair of factors of 4 that sum to 5 is 4 and 1.',
          narration: 'To factor a non-monic quadratic by decomposition, we multiply the leading coefficient a by the constant c to get four. We then find two numbers that multiply to positive four and add to positive five, which are four and one.',
          graphExpr: '2*x^2 + 5*x + 2',
          highlightPoint: [-1.25, -1.125]
        },
        {
          heading: 'Step 3: Splitting the Middle Term & Factoring by Grouping',
          conceptTag: 'Distributive Law & Common Monomial Factoring',
          latex: '2x^2 + 4x + 1x + 2 = 0 \\implies 2x(x + 2) + 1(x + 2) = 0',
          annotation: 'Rewrite 5x as 4x + x, then factor 2x from the first pair and 1 from the second pair.',
          narration: 'Next, we split the middle term five x into four x plus one x. Grouping the first two terms and the last two terms lets us factor out two x from the first pair and one from the second pair, revealing the shared binomial factor x plus two.',
          graphExpr: '2*x^2 + 5*x + 2',
          highlightPoint: [-2, 0]
        },
        {
          heading: 'Step 4: Zero-Product Property & Exact Roots',
          conceptTag: 'Zero-Product Property: A · B = 0 ⟺ A = 0 or B = 0',
          latex: '(2x + 1)(x + 2) = 0 \\implies x_1 = -\\frac{1}{2}, \\quad x_2 = -2',
          annotation: 'Set each linear factor to zero: 2x + 1 = 0 gives x = -1/2, and x + 2 = 0 gives x = -2.',
          narration: 'Factoring out x plus two yields the complete factored form: two x plus one, times x plus two, equals zero. By the Zero-Product Property, setting each factor to zero gives our two exact roots: x equals negative one half, and x equals negative two.',
          graphExpr: '2*x^2 + 5*x + 2',
          highlightPoint: [-0.5, 0]
        }
      ];

  const LOGICAL_W = 660;
  const LOGICAL_H = 380;
  const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));

  const card = document.createElement('div');
  card.className = 'manim-video-card';

  // Header
  const header = document.createElement('div');
  header.className = 'manim-video-header';
  header.innerHTML = `
    <div class="manim-badge-group">
      <span class="manim-engine-badge">🎬 MANIM FORMAL SOLUTION</span>
      <strong class="manim-video-title"></strong>
    </div>
    <span class="manim-voice-tag">Narrator: ${voiceName} (${course})</span>
  `;
  header.querySelector('.manim-video-title').textContent = title;
  card.appendChild(header);

  // Stage container with HiDPI <canvas> + Cumulative Step-by-Step KaTeX Derivation Overlay
  const stage = document.createElement('div');
  stage.className = 'manim-stage';

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(LOGICAL_W * dpr);
  canvas.height = Math.round(LOGICAL_H * dpr);
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.className = 'manim-canvas';
  stage.appendChild(canvas);

  // Cumulative Step-by-Step Formal Derivation Stack Overlay (Left/Main Board)
  const derivationOverlay = document.createElement('div');
  derivationOverlay.className = 'manim-derivation-ledger';
  stage.appendChild(derivationOverlay);

  card.appendChild(stage);

  // Video Controls Bar
  const controls = document.createElement('div');
  controls.className = 'manim-controls-bar';
  controls.innerHTML = `
    <div class="manim-left-ctrls">
      <button type="button" class="manim-ctrl-btn primary" data-action="play-pause">⏸ Pause</button>
      <button type="button" class="manim-ctrl-btn" data-action="replay">↺ Replay Full Solution</button>
    </div>
    <div class="manim-scene-dots"></div>
    <span class="manim-status-tag">Synthesizing voiceover...</span>
  `;
  card.appendChild(controls);

  const btnPlayPause = controls.querySelector('[data-action="play-pause"]');
  const btnReplay = controls.querySelector('[data-action="replay"]');
  const sceneDotsContainer = controls.querySelector('.manim-scene-dots');
  const statusLabel = controls.querySelector('.manim-status-tag');

  let currentSceneIdx = 0;
  let isPlaying = true;
  let isDestroyed = false;
  let sceneStartTimestamp = performance.now();
  let sceneDurationMs = 8000;
  let currentAudio = null;
  const audioCache = new Map();
  let fallbackTimer = null;

  // Render clickable step pills
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

  /**
   * Renders the cumulative formal derivation ledger up to `currentSceneIdx`
   * so the student sees the full solution building step-by-step on the Manim board!
   */
  function renderDerivationLedger(upToIdx) {
    derivationOverlay.innerHTML = '';

    // Show up to 3 most recent steps (previous completed steps + active highlighted step)
    const startIdx = Math.max(0, upToIdx - 2);
    for (let i = startIdx; i <= upToIdx; i++) {
      const sc = scenes[i];
      if (!sc) continue;
      const isCurrent = i === upToIdx;

      const stepRow = document.createElement('div');
      stepRow.className = `manim-ledger-step ${isCurrent ? 'active-step' : 'completed-step'}`;

      const stepHeader = document.createElement('div');
      stepHeader.className = 'manim-ledger-step-hdr';
      stepHeader.textContent = isCurrent
        ? `▶ ${sc.conceptTag || sc.heading || `Step ${i + 1}`}`
        : `✓ Step ${i + 1}: ${sc.conceptTag || sc.heading || ''}`;
      stepRow.appendChild(stepHeader);

      const mathBox = document.createElement('div');
      mathBox.className = 'manim-ledger-math';
      const cleanLatex = sanitizeLatexForHud(sc.latex || '');
      if (window.katex && cleanLatex) {
        try {
          window.katex.render(cleanLatex, mathBox, {
            displayMode: false,
            throwOnError: false
          });
        } catch (_) {
          mathBox.textContent = cleanLatex;
        }
      } else {
        mathBox.textContent = cleanLatex;
      }
      stepRow.appendChild(mathBox);

      if (isCurrent && sc.annotation) {
        const note = document.createElement('div');
        note.className = 'manim-ledger-note';
        note.textContent = String(sc.annotation).replace(/\$/g, '');
        stepRow.appendChild(note);
      }

      derivationOverlay.appendChild(stepRow);
    }
  }

  async function fetchSceneAudioBlob(sceneIdx) {
    if (audioCache.has(sceneIdx)) {
      return audioCache.get(sceneIdx);
    }
    const narration = String(scenes[sceneIdx]?.narration || '').replace(/\$/g, '').trim();
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

    renderDerivationLedger(currentSceneIdx);
    sceneStartTimestamp = performance.now();
    sceneDurationMs = 8500;

    onPlaybackStateChange(true);
    statusLabel.textContent = `Step ${currentSceneIdx + 1} of ${scenes.length} • Synthesizing voice...`;

    // Pre-fetch next scene audio in parallel so step transitions have zero lag
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
          sceneDurationMs = Math.max(4500, (audio.duration / audio.playbackRate) * 1000 + 650);
        }
      };

      audio.onplay = () => {
        sceneStartTimestamp = performance.now();
        statusLabel.textContent = `Step ${currentSceneIdx + 1} of ${scenes.length} • Narrating`;
      };

      audio.onended = () => {
        advanceToNextScene();
      };

      audio.onerror = () => {
        fallbackTimer = setTimeout(() => advanceToNextScene(), 6500);
      };

      try {
        await audio.play();
      } catch (_) {
        statusLabel.textContent = `Step ${currentSceneIdx + 1} of ${scenes.length}`;
        fallbackTimer = setTimeout(() => advanceToNextScene(), 6500);
      }
    } else {
      statusLabel.textContent = `Step ${currentSceneIdx + 1} of ${scenes.length}`;
      fallbackTimer = setTimeout(() => advanceToNextScene(), 7000);
    }
  }

  function advanceToNextScene() {
    if (!isPlaying || isDestroyed) return;
    if (currentSceneIdx + 1 < scenes.length) {
      playScene(currentSceneIdx + 1);
    } else {
      isPlaying = false;
      btnPlayPause.textContent = '▶ Play';
      statusLabel.textContent = 'Full Solution Complete • Click Replay to watch again';
      onPlaybackStateChange(false);
    }
  }

  btnPlayPause.addEventListener('click', () => {
    if (isPlaying) {
      isPlaying = false;
      btnPlayPause.textContent = '▶ Play';
      statusLabel.textContent = `Step ${currentSceneIdx + 1} of ${scenes.length} • Paused`;
      stopCurrentAudio();
      onPlaybackStateChange(false);
    } else {
      if (currentSceneIdx >= scenes.length - 1 && statusLabel.textContent.includes('Complete')) {
        playScene(0);
      } else {
        playScene(currentSceneIdx);
      }
    }
  });

  btnReplay.addEventListener('click', () => {
    playScene(0);
  });

  // 60fps HiDPI Manim Canvas Animation Loop
  function renderManimFrame() {
    if (isDestroyed) return;

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const W = LOGICAL_W;
    const H = LOGICAL_H;
    const scene = scenes[currentSceneIdx] || scenes[0];

    const elapsed = performance.now() - sceneStartTimestamp;
    const progress = Math.min(1, Math.max(0, elapsed / sceneDurationMs));
    const introAlpha = Math.min(1, elapsed / 400);

    // 1. Deep Manim Slate Backdrop
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#070b14');
    bgGrad.addColorStop(1, '#0d1526');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // 2. Subtle 3Blue1Brown NumberPlane Background Grid
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    const gridSpacing = 30;
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
    ctx.font = '600 14px "Google Sans", Inter, sans-serif';
    const headingText = String(scene.heading || `Step ${currentSceneIdx + 1}`).replace(/\$/g, '');
    ctx.fillText(headingText, 20, 26);

    const lineW = Math.min(W - 40, 340 * Math.min(1, elapsed / 550));
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, 33);
    ctx.lineTo(20 + lineW, 33);
    ctx.stroke();
    ctx.restore();

    // Determine whether we have a graph expression to show on the right half
    const graphExprStr = String(scene.graphExpr || storyboard.scenes?.[0]?.graphExpr || '').trim();
    const hasGraph = Boolean(graphExprStr);

    // Position the cumulative derivation ledger DOM overlay
    derivationOverlay.style.left = '18px';
    derivationOverlay.style.top = '42px';
    derivationOverlay.style.width = hasGraph ? '380px' : `${W - 36}px`;
    derivationOverlay.style.height = '240px';

    // 4. Right-Side Manim Coordinate Plane (`NumberPlane` + `FunctionGraph` + `FocusOn` point)
    if (hasGraph) {
      const gx0 = 410;
      const gy0 = 42;
      const gw = W - gx0 - 16;
      const gh = 236;

      ctx.save();
      ctx.fillStyle = 'rgba(10, 16, 29, 0.94)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
      ctx.lineWidth = 1.3;
      ctx.fillRect(gx0, gy0, gw, gh);
      ctx.strokeRect(gx0, gy0, gw, gh);

      // Coordinate domain
      const xMin = Array.isArray(storyboard.xDomain) ? Number(storyboard.xDomain[0]) : -5;
      const xMax = Array.isArray(storyboard.xDomain) ? Number(storyboard.xDomain[1]) : 5;
      const yMin = Array.isArray(storyboard.yDomain) ? Number(storyboard.yDomain[0]) : -5;
      const yMax = Array.isArray(storyboard.yDomain) ? Number(storyboard.yDomain[1]) : 9;

      const toScreenX = wx => gx0 + ((wx - xMin) / (xMax - xMin)) * gw;
      const toScreenY = wy => gy0 + gh - ((wy - yMin) / (yMax - yMin)) * gh;

      // Internal mini-grid
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
      ctx.lineWidth = 0.8;
      for (let wx = Math.ceil(xMin); wx <= Math.floor(xMax); wx++) {
        const sx = toScreenX(wx);
        ctx.beginPath();
        ctx.moveTo(sx, gy0);
        ctx.lineTo(sx, gy0 + gh);
        ctx.stroke();
      }
      for (let wy = Math.ceil(yMin); wy <= Math.floor(yMax); wy += 2) {
        const sy = toScreenY(wy);
        ctx.beginPath();
        ctx.moveTo(gx0, sy);
        ctx.lineTo(gx0 + gw, sy);
        ctx.stroke();
      }

      // Principal axes
      const ox = toScreenX(0);
      const oy = toScreenY(0);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
      ctx.lineWidth = 1.3;
      if (ox >= gx0 && ox <= gx0 + gw) {
        ctx.beginPath();
        ctx.moveTo(ox, gy0);
        ctx.lineTo(ox, gy0 + gh);
        ctx.stroke();
      }
      if (oy >= gy0 && oy <= gy0 + gh) {
        ctx.beginPath();
        ctx.moveTo(gx0, oy);
        ctx.lineTo(gx0 + gw, oy);
        ctx.stroke();
      }

      // Animated curve sweep
      const fn = compileMathExpression(graphExprStr);
      const sweepMaxPx = Math.floor(gw * Math.min(1, elapsed / 1200));

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      let pen = false;
      for (let px = 0; px <= sweepMaxPx; px += 1.5) {
        const wx = xMin + (px / gw) * (xMax - xMin);
        const wy = fn(wx);
        if (Number.isFinite(wy)) {
          const sy = toScreenY(wy);
          if (sy >= gy0 + 3 && sy <= gy0 + gh - 3) {
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

      // Highlight specific mathematical point (`highlightPoint: [x, y]`) or animate tracker dot
      let targetWx = null;
      let targetWy = null;
      if (Array.isArray(scene.highlightPoint) && scene.highlightPoint.length === 2) {
        targetWx = Number(scene.highlightPoint[0]);
        targetWy = Number(scene.highlightPoint[1]);
      } else {
        const trackerT = (Math.sin(elapsed * 0.002) + 1) * 0.5;
        targetWx = xMin + trackerT * (xMax - xMin);
        targetWy = fn(targetWx);
      }

      if (Number.isFinite(targetWx) && Number.isFinite(targetWy)) {
        const tsx = toScreenX(targetWx);
        const tsy = toScreenY(targetWy);
        if (tsx >= gx0 + 4 && tsx <= gx0 + gw - 4 && tsy >= gy0 + 4 && tsy <= gy0 + gh - 4) {
          // Pulsing Manim FocusOn ring
          const pulseRadius = 7 + 3 * Math.sin(elapsed * 0.006);
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(tsx, tsy, pulseRadius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = '#facc15';
          ctx.beginPath();
          ctx.arc(tsx, tsy, 4.2, 0, Math.PI * 2);
          ctx.fill();

          const ptLabel = `(${Math.round(targetWx * 100) / 100}, ${Math.round(targetWy * 100) / 100})`;
          ctx.fillStyle = '#fef08a';
          ctx.font = '600 10.5px "Google Sans", Inter, sans-serif';
          ctx.fillText(ptLabel, Math.min(gx0 + gw - 62, Math.max(gx0 + 6, tsx + 8)), Math.max(gy0 + 14, tsy - 7));
        }
      }

      ctx.restore();
    }

    // 5. Bottom Instructor Voiceover Subtitle Box
    ctx.fillStyle = 'rgba(10, 15, 26, 0.94)';
    ctx.fillRect(16, H - 84, W - 32, 68);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(16, H - 84, W - 32, 68);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '12px "Google Sans", Inter, sans-serif';
    wrapCanvasText(ctx, String(scene.narration || '').replace(/\$/g, ''), 26, H - 64, W - 52, 16.5);

    // 6. Bottom Timeline Progress Bar
    const totalProgress = (currentSceneIdx + progress) / scenes.length;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.fillRect(0, H - 5, W, 5);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, H - 5, W * totalProgress, 5);

    ctx.restore();
    requestAnimationFrame(renderManimFrame);
  }

  requestAnimationFrame(renderManimFrame);
  playScene(0);

  const controller = {
    stop: () => {
      isDestroyed = true;
      isPlaying = false;
      stopCurrentAudio();
      onPlaybackStateChange(false);
    },
    playScene
  };

  // Attach controller directly onto `card` as well as returning `{ element: card, controller }`
  card.controller = controller;
  return {
    element: card,
    controller
  };
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
