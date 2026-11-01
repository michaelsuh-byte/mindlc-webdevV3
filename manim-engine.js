/**
 * Step-by-Step Visual Solution Video Engine (`manim-engine.js`)
 * Key Design Principles:
 *  1. Dedicated Single-Step Screen: Each step (Step 1, Step 2, ...) displays its own clean, concise slide with zero scrollbars.
 *  2. Strictly Decoupled Visuals vs. Voice: The spoken narration script is NEVER displayed on the video screen;
 *     the screen shows only the crucial equation, a structured comparison/summary table, and a clean coordinate graph.
 *  3. Stationary Graph Highlights: Important points on the graph are highlighted statically with zero moving dots or distracting motion.
 *  4. User-Focused Presentation: No technical engine jargon in the UI.
 */

import { compileMathExpression, findCurveFeatures } from './graph-engine.js';
import { sanitizeLatexForHud, sanitizeForSpeech } from './svs-engine.js';

export function createManimVideoElement(storyboard = {}, options = {}) {
  const voiceName = options.voiceName || 'Aoede';
  const basePlaybackRate = options.playbackRate || 1.1;
  const getPlaybackRate =
    typeof options.getPlaybackRate === 'function'
      ? options.getPlaybackRate
      : () => basePlaybackRate;
  const apiKey = options.apiKey || '';
  const onPlaybackStateChange = options.onPlaybackStateChange || (() => {});
  const onVideoComplete = options.onVideoComplete || (() => {});

  const title = String(storyboard.title || 'Step-by-Step Solution').replace(/\$/g, '');
  const course = String(storyboard.course || 'Ontario Secondary STEM').replace(/\$/g, '');
  const scenes = Array.isArray(storyboard.scenes) && storyboard.scenes.length > 0
    ? storyboard.scenes
    : [
        {
          heading: 'Step 1: Standard Form & Coefficients',
          conceptTag: 'Quadratic Form: ax² + bx + c = 0',
          latex: '2x^2 + 5x + 2 = 0',
          table: {
            headers: ['Coefficient', 'Value', 'Role in Equation'],
            rows: [
              ['a', '2', 'Leading (x² term)'],
              ['b', '5', 'Linear (x term)'],
              ['c', '2', 'Constant intercept']
            ]
          },
          narration: 'We begin by writing the quadratic equation in standard form, two x squared plus five x plus two equals zero. As shown in the table, the leading coefficient a is two, the linear coefficient b is five, and the constant c is two.',
          graphExpr: '',
          highlightPoint: null
        },
        {
          heading: 'Step 2: Product-Sum Decomposition',
          conceptTag: 'Find p, q where p · q = a · c and p + q = b',
          latex: 'p \\cdot q = 4, \\quad p + q = 5 \\implies p = 4,\\; q = 1',
          table: {
            headers: ['Candidate Pair (p, q)', 'Product (p · q)', 'Sum (p + q)'],
            rows: [
              ['1 and 4', '4 ✓', '5 ✓ (Match)'],
              ['2 and 2', '4 ✓', '4 ✗']
            ]
          },
          narration: 'To factor by decomposition, we multiply a times c, which gives four. Testing factor pairs of four in our table, four and one multiply to four and add to five.',
          graphExpr: '',
          highlightPoint: null
        },
        {
          heading: 'Step 3: Factoring by Grouping',
          conceptTag: 'Split 5x into 4x + 1x and group pairs',
          latex: '2x^2 + 4x + x + 2 = 0 \\implies 2x(x + 2) + 1(x + 2) = 0',
          annotation: 'Common binomial factor (x + 2) extracted from both groups.',
          narration: 'Next, we split the middle term five x into four x plus one x. Factoring two x from the first pair and one from the second pair reveals the shared binomial factor x plus two.',
          graphExpr: '',
          highlightPoint: null
        },
        {
          heading: 'Step 4: Zero-Product Property & Verified Roots',
          conceptTag: 'Set each linear factor to zero',
          latex: '(2x + 1)(x + 2) = 0 \\implies x = -0.5, \\quad x = -2',
          table: {
            headers: ['Factor Equation', 'Solved Root', 'Graph Intercept'],
            rows: [
              ['2x + 1 = 0', 'x = -0.5', '(-0.5, 0)'],
              ['x + 2 = 0', 'x = -2', '(-2, 0)']
            ]
          },
          narration: 'Finally, setting each factor to zero gives our two exact solutions: x equals negative zero point five, and x equals negative two, which match the two horizontal intercepts on the graph.',
          graphExpr: '2*x^2 + 5*x + 2',
          highlightPoint: [-0.5, 0]
        }
      ];

  const LOGICAL_W = 660;
  const LOGICAL_H = 324;
  const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));

  const card = document.createElement('div');
  card.className = 'manim-video-card';

  // Clean User-Focused Header (No technology jargon)
  const header = document.createElement('div');
  header.className = 'manim-video-header';
  header.innerHTML = `
    <div class="manim-badge-group">
      <span class="manim-engine-badge">🎬 STEP-BY-STEP SOLUTION</span>
      <strong class="manim-video-title"></strong>
    </div>
    <span class="manim-voice-tag">${course} • Voice: ${voiceName}</span>
  `;
  header.querySelector('.manim-video-title').textContent = title;
  card.appendChild(header);

  // Stage container: Dedicated Single-Step Slide Screen (No Scrollbars!)
  const stage = document.createElement('div');
  stage.className = 'manim-stage';

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(LOGICAL_W * dpr);
  canvas.height = Math.round(LOGICAL_H * dpr);
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.className = 'manim-canvas';
  stage.appendChild(canvas);

  // Single-Step Concise Visual Content Overlay (Percentage-bounded inside canvas safe zone)
  const slideContentOverlay = document.createElement('div');
  slideContentOverlay.className = 'manim-slide-content';

  const slideInner = document.createElement('div');
  slideInner.className = 'manim-slide-inner';
  slideContentOverlay.appendChild(slideInner);
  stage.appendChild(slideContentOverlay);

  card.appendChild(stage);

  // Video Controls Bar
  const controls = document.createElement('div');
  controls.className = 'manim-controls-bar';
  controls.innerHTML = `
    <div class="manim-left-ctrls">
      <button type="button" class="manim-ctrl-btn primary" data-action="play-pause">⏸ Pause</button>
      <button type="button" class="manim-ctrl-btn" data-action="replay">↺ Replay</button>
    </div>
    <div class="manim-scene-dots"></div>
    <span class="manim-status-tag">Loading voice...</span>
  `;
  card.appendChild(controls);

  const btnPlayPause = controls.querySelector('[data-action="play-pause"]');
  const btnReplay = controls.querySelector('[data-action="replay"]');
  const sceneDotsContainer = controls.querySelector('.manim-scene-dots');
  const statusLabel = controls.querySelector('.manim-status-tag');

  let currentSceneIdx = 0;
  let isPlaying = true;
  let isDestroyed = false;
  let initialCompletionFired = false;
  let sceneStartTimestamp = performance.now();
  let sceneDurationMs = 7500;
  let currentAudio = null;
  const audioCache = new Map();
  let fallbackTimer = null;

  // Render clickable step screen buttons
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
   * Dynamically scales the equation and inner content stack if needed so that no box, table,
   * or text ever overlaps or extends beyond the canvas area at any window size.
   */
  function fitSlideContentToStage() {
    if (isDestroyed) return;
    slideInner.style.transform = 'none';

    const mathBody = slideInner.querySelector('.manim-math-fit-inner');
    const mathCard = slideInner.querySelector('.manim-slide-math-card');
    if (mathBody && mathCard) {
      mathBody.style.transform = 'none';
      const availMathW = Math.max(80, mathCard.clientWidth - 22);
      const naturalMathW = mathBody.scrollWidth;
      if (naturalMathW > availMathW && availMathW > 0) {
        const mathScale = Math.max(0.62, availMathW / naturalMathW);
        mathBody.style.transform = `scale(${mathScale.toFixed(3)})`;
      }
    }

    const availW = slideContentOverlay.clientWidth;
    const availH = slideContentOverlay.clientHeight;
    if (availW <= 0 || availH <= 0) return;

    const naturalW = slideInner.scrollWidth;
    const naturalH = slideInner.offsetHeight;
    const scaleX = naturalW > availW ? (availW - 4) / naturalW : 1;
    const scaleY = naturalH > availH ? (availH - 4) / naturalH : 1;
    const scale = Math.max(0.6, Math.min(1, scaleX, scaleY));

    if (scale < 0.995) {
      slideInner.style.transform = `scale(${scale.toFixed(3)})`;
    }
  }

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      fitSlideContentToStage();
    });
    ro.observe(stage);
  }

  /**
   * Renders ONLY the single active step's concise visual cues (Equation + Table or Key Rule).
   * Never renders the voiceover script and never overflows or extends past the canvas.
   */
  function renderStepSlideContent(sceneIdx) {
    slideInner.innerHTML = '';
    const sc = scenes[sceneIdx] || scenes[0];
    if (!sc) return;

    const rawGraphExpr = String(sc.graphExpr || '').trim();
    const stepHasGraph = Boolean(rawGraphExpr && !/^(none|null|false|n\/a)$/i.test(rawGraphExpr));
    slideContentOverlay.style.left = '2.75%';
    slideContentOverlay.style.top = '16.5%';
    slideContentOverlay.style.width = stepHasGraph ? '54.5%' : '94.5%';
    slideContentOverlay.style.height = '78.5%';

    // 1. Concise Concept / Rule Pill
    if (sc.conceptTag) {
      const rulePill = document.createElement('div');
      rulePill.className = 'manim-rule-pill';
      rulePill.textContent = String(sc.conceptTag).replace(/\$/g, '');
      slideInner.appendChild(rulePill);
    }

    // 2. Primary Mathematical Equation Box (KaTeX inside auto-fitting wrapper)
    const mathCard = document.createElement('div');
    mathCard.className = 'manim-slide-math-card';
    const mathFitInner = document.createElement('div');
    mathFitInner.className = 'manim-math-fit-inner';
    const cleanLatex = sanitizeLatexForHud(sc.latex || '');
    if (window.katex && cleanLatex) {
      try {
        window.katex.render(cleanLatex, mathFitInner, {
          displayMode: false,
          throwOnError: false
        });
      } catch (_) {
        mathFitInner.textContent = cleanLatex;
      }
    } else {
      mathFitInner.textContent = cleanLatex;
    }
    mathCard.appendChild(mathFitInner);
    slideInner.appendChild(mathCard);

    // 3. Structured Table (if provided for this step) OR concise 1-line Key Takeaway
    if (
      sc.table &&
      Array.isArray(sc.table.headers) &&
      Array.isArray(sc.table.rows) &&
      sc.table.rows.length > 0
    ) {
      const tableEl = document.createElement('table');
      tableEl.className = 'stem-info-table video-slide-table';

      const thead = document.createElement('thead');
      const hRow = document.createElement('tr');
      sc.table.headers.slice(0, 4).forEach((hText) => {
        const th = document.createElement('th');
        th.textContent = String(hText).replace(/\$/g, '');
        hRow.appendChild(th);
      });
      thead.appendChild(hRow);
      tableEl.appendChild(thead);

      const tbody = document.createElement('tbody');
      sc.table.rows.slice(0, 3).forEach((rowArr) => {
        if (!Array.isArray(rowArr)) return;
        const tr = document.createElement('tr');
        rowArr.slice(0, 4).forEach((cellVal) => {
          const td = document.createElement('td');
          td.textContent = String(cellVal).replace(/\$/g, '');
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      tableEl.appendChild(tbody);
      slideInner.appendChild(tableEl);
    } else if (sc.annotation) {
      const keyCue = document.createElement('div');
      keyCue.className = 'manim-slide-key-cue';
      keyCue.textContent = String(sc.annotation).replace(/\$/g, '');
      slideInner.appendChild(keyCue);
    }

    requestAnimationFrame(() => {
      fitSlideContentToStage();
    });
  }

  async function fetchSceneAudioBlob(sceneIdx) {
    if (audioCache.has(sceneIdx)) {
      return audioCache.get(sceneIdx);
    }
    const rawNarration = String(scenes[sceneIdx]?.narration || '').replace(/\$/g, '').trim();
    const speechAudit = sanitizeForSpeech(rawNarration, 45);
    const narration = (speechAudit && typeof speechAudit === 'object' ? speechAudit.cleanText : speechAudit) || rawNarration;
    if (!narration) return null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: narration,
            voiceName: voiceName || 'Aoede',
            apiKey: apiKey || undefined
          })
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          audioCache.set(sceneIdx, url);
          return url;
        }
      } catch (_) {}
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 300 * attempt));
      }
    }
    return null;
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

  // Shared Web Audio API DynamicsCompressor + Leveling Gain so video narration volume is 100% consistent
  let videoAudioCtx = null;
  let videoCompressor = null;

  function routeAudioThroughNormalizer(audioEl) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!videoAudioCtx) {
        videoAudioCtx = new AudioCtx();
        videoCompressor = videoAudioCtx.createDynamicsCompressor();
        videoCompressor.threshold.value = -20;
        videoCompressor.knee.value = 12;
        videoCompressor.ratio.value = 4;
        videoCompressor.attack.value = 0.005;
        videoCompressor.release.value = 0.15;

        const makeupGain = videoAudioCtx.createGain();
        makeupGain.gain.value = 1.08;
        videoCompressor.connect(makeupGain);
        makeupGain.connect(videoAudioCtx.destination);
      }
      if (videoAudioCtx.state === 'suspended') {
        videoAudioCtx.resume().catch(() => {});
      }
      const sourceNode = videoAudioCtx.createMediaElementSource(audioEl);
      sourceNode.connect(videoCompressor);
    } catch (_) {
      // Server-side PCM16 RMS normalization is already applied to the WAV buffer
    }
  }

  async function playScene(idx) {
    if (isDestroyed) return;
    stopCurrentAudio();

    currentSceneIdx = Math.max(0, Math.min(scenes.length - 1, idx));
    isPlaying = true;
    btnPlayPause.textContent = '⏸ Pause';
    updateSceneDots();

    renderStepSlideContent(currentSceneIdx);
    sceneStartTimestamp = performance.now();
    sceneDurationMs = 8000;

    onPlaybackStateChange(true);
    statusLabel.textContent = `Step ${currentSceneIdx + 1} of ${scenes.length} • Loading voice...`;

    if (currentSceneIdx + 1 < scenes.length) {
      fetchSceneAudioBlob(currentSceneIdx + 1);
    }

    const audioUrl = await fetchSceneAudioBlob(currentSceneIdx);
    if (isDestroyed || !isPlaying) return;

    if (audioUrl) {
      const activeRate = Math.max(0.75, Math.min(1.5, Number(getPlaybackRate()) || 1.1));
      const audio = new Audio(audioUrl);
      audio.volume = 1.0;
      audio.defaultPlaybackRate = activeRate;
      audio.playbackRate = activeRate;
      audio.preservesPitch = true;
      routeAudioThroughNormalizer(audio);
      currentAudio = audio;

      audio.onloadedmetadata = () => {
        if (audio.duration && Number.isFinite(audio.duration)) {
          sceneDurationMs = Math.max(4500, (audio.duration / audio.playbackRate) * 1000 + 500);
        }
      };

      audio.onplay = () => {
        const latestRate = Math.max(0.75, Math.min(1.5, Number(getPlaybackRate()) || 1.1));
        audio.playbackRate = latestRate;
        sceneStartTimestamp = performance.now();
        statusLabel.textContent = `Step ${currentSceneIdx + 1} of ${scenes.length} • Playing`;
      };

      audio.onended = () => {
        advanceToNextScene();
      };

      audio.onerror = () => {
        fallbackTimer = setTimeout(() => advanceToNextScene(), 6000);
      };

      try {
        await audio.play();
      } catch (_) {
        statusLabel.textContent = `Step ${currentSceneIdx + 1} of ${scenes.length}`;
        fallbackTimer = setTimeout(() => advanceToNextScene(), 6000);
      }
    } else {
      statusLabel.textContent = `Step ${currentSceneIdx + 1} of ${scenes.length}`;
      fallbackTimer = setTimeout(() => advanceToNextScene(), 6500);
    }
  }

  function advanceToNextScene() {
    if (!isPlaying || isDestroyed) return;
    if (currentSceneIdx + 1 < scenes.length) {
      playScene(currentSceneIdx + 1);
    } else {
      isPlaying = false;
      btnPlayPause.textContent = '▶ Play';
      statusLabel.textContent = 'Solution Complete • Click Replay to watch again';
      onPlaybackStateChange(false);
      if (!initialCompletionFired) {
        initialCompletionFired = true;
        onVideoComplete(storyboard);
      }
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

  // HiDPI Frame Renderer (Clean, Stationary Key Points, Zero Spoken Script Clutter)
  function renderSlideFrame() {
    if (isDestroyed) return;

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const W = LOGICAL_W;
    const H = LOGICAL_H;
    const scene = scenes[currentSceneIdx] || scenes[0];

    const elapsed = performance.now() - sceneStartTimestamp;
    const progress = Math.min(1, Math.max(0, elapsed / sceneDurationMs));
    const introAlpha = Math.min(1, elapsed / 300);

    // 1. Clean Dark Presentation Backdrop
    // 1. Clean Dark Presentation Backdrop + Inset Frame Border
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#090e1a');
    bgGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // 2. Top Step Screen Header Bar
    ctx.save();
    ctx.globalAlpha = introAlpha;

    // Step Number Pill
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 1;
    ctx.fillRect(18, 14, 84, 22);
    ctx.strokeRect(18, 14, 84, 22);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '700 10.5px "Google Sans", Inter, sans-serif';
    ctx.fillText(`STEP ${currentSceneIdx + 1} OF ${scenes.length}`, 27, 29);

    // Concise Step Heading (strictly bounded within W - 130 so it never overflows the right edge)
    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 13.5px "Google Sans", Inter, sans-serif';
    const rawHeading = String(scene.heading || `Step ${currentSceneIdx + 1}`).replace(/^Step\s+\d+\s*:\s*/i, '').replace(/\$/g, '');
    ctx.fillText(rawHeading, 112, 29, W - 130);

    // Subtle divider line
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.beginPath();
    ctx.moveTo(18, 44);
    ctx.lineTo(W - 18, 44);
    ctx.stroke();
    ctx.restore();

    // Render a graph on this step ONLY when `scene.graphExpr` is explicitly provided for this step
    const graphExprStr = String(scene.graphExpr || '').trim();
    const hasGraph = Boolean(graphExprStr && !/^(none|null|false|n\/a)$/i.test(graphExprStr));

    // Percentage-based positioning keeps `slideContentOverlay` strictly inside the canvas at all widths
    slideContentOverlay.style.left = '2.75%';
    slideContentOverlay.style.top = '16.5%';
    slideContentOverlay.style.width = hasGraph ? '54.5%' : '94.5%';
    slideContentOverlay.style.height = '78.5%';
    slideContentOverlay.style.opacity = String(introAlpha);

    // 3. Right-Side Coordinate Graph Panel (Strictly Clipped & Stationary Key Points ONLY)
    if (hasGraph) {
      const gx0 = 392;
      const gy0 = 54;
      const gw = W - gx0 - 18;
      const gh = H - 70;

      ctx.save();
      ctx.fillStyle = 'rgba(11, 17, 30, 0.95)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
      ctx.lineWidth = 1.2;
      ctx.fillRect(gx0, gy0, gw, gh);
      ctx.strokeRect(gx0, gy0, gw, gh);

      // Strictly clip all grid lines, axes, curves, and point labels to the interior of the graph box!
      ctx.beginPath();
      ctx.rect(gx0 + 2, gy0 + 2, gw - 4, gh - 4);
      ctx.clip();

      const xMin = Array.isArray(storyboard.xDomain) ? Number(storyboard.xDomain[0]) : -5;
      const xMax = Array.isArray(storyboard.xDomain) ? Number(storyboard.xDomain[1]) : 5;
      const yMin = Array.isArray(storyboard.yDomain) ? Number(storyboard.yDomain[0]) : -5;
      const yMax = Array.isArray(storyboard.yDomain) ? Number(storyboard.yDomain[1]) : 9;

      const toScreenX = wx => gx0 + ((wx - xMin) / (xMax - xMin)) * gw;
      const toScreenY = wy => gy0 + gh - ((wy - yMin) / (yMax - yMin)) * gh;

      // Subtle coordinate grid
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.11)';
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
      ctx.lineWidth = 1.2;
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

      // Function Curve
      const fn = compileMathExpression(graphExprStr);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.3;
      ctx.beginPath();
      let pen = false;
      for (let px = 0; px <= gw; px += 1) {
        const wx = xMin + (px / gw) * (xMax - xMin);
        const wy = fn(wx);
        if (Number.isFinite(wy)) {
          const sy = toScreenY(wy);
          if (sy >= gy0 + 2 && sy <= gy0 + gh - 2) {
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

      // Stationary Key Points (Roots, Vertex, y-intercept, plus Step's highlightPoint)
      const autoPts = findCurveFeatures(fn, xMin, xMax);
      autoPts.forEach((pt) => {
        const sx = toScreenX(pt.x);
        const sy = toScreenY(pt.y);
        if (sx >= gx0 + 6 && sx <= gx0 + gw - 6 && sy >= gy0 + 6 && sy <= gy0 + gh - 6) {
          ctx.fillStyle = '#64748b';
          ctx.beginPath();
          ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Highlight ONLY the stationary point relevant to this step (no moving dot or pulsing ring)
      if (Array.isArray(scene.highlightPoint) && scene.highlightPoint.length === 2) {
        const hWx = Number(scene.highlightPoint[0]);
        const hWy = Number(scene.highlightPoint[1]);
        if (Number.isFinite(hWx) && Number.isFinite(hWy)) {
          const tsx = toScreenX(hWx);
          const tsy = toScreenY(hWy);
          if (tsx >= gx0 + 4 && tsx <= gx0 + gw - 4 && tsy >= gy0 + 4 && tsy <= gy0 + gh - 4) {
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.arc(tsx, tsy, 4.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            const ptLabel = `(${Math.round(hWx * 100) / 100}, ${Math.round(hWy * 100) / 100})`;
            ctx.fillStyle = '#fef08a';
            ctx.font = '600 10.5px "Google Sans", Inter, sans-serif';
            ctx.fillText(
              ptLabel,
              Math.min(gx0 + gw - 64, Math.max(gx0 + 6, tsx + 8)),
              Math.max(gy0 + 14, tsy - 6)
            );
          }
        }
      }

      ctx.restore();
    }

    // 4. Bottom Step Progress Indicator Bar
    const totalProgress = (currentSceneIdx + progress) / scenes.length;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.fillRect(0, H - 4, W, 4);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, H - 4, W * totalProgress, 4);

    ctx.restore();
    requestAnimationFrame(renderSlideFrame);
  }

  requestAnimationFrame(renderSlideFrame);
  playScene(0);

  const controller = {
    stop: () => {
      isDestroyed = true;
      isPlaying = false;
      stopCurrentAudio();
      onPlaybackStateChange(false);
    },
    setPlaybackRate: (newRate) => {
      if (currentAudio) {
        const clamped = Math.max(0.75, Math.min(1.5, Number(newRate) || 1.1));
        currentAudio.defaultPlaybackRate = clamped;
        currentAudio.playbackRate = clamped;
      }
    },
    playScene
  };

  card.controller = controller;
  return {
    element: card,
    controller
  };
}
