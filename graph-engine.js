/**
 * Refined Desmos / GeoGebra-Style HiDPI Interactive Graphing Engine (`graph-engine.js`)
 * Features:
 *  - Razor-sharp HiDPI / Retina (`window.devicePixelRatio`) canvas rendering
 *  - Multi-level Desmos-style minor & major coordinate gridlines + haloed axis tick labels
 *  - Supports both string expressions and `{ expr, label, color }` objects with KaTeX legend rendering
 *  - Automatic root, vertex/extremum, and y-intercept detection with pinned interactive points
 *  - Refined 2D Euclidean proximity hover: moving the cursor across empty space does NOT drag a trace dot;
 *    point coordinates appear only when hovering directly near a curve/key point (within 13px) or when clicking & dragging along a curve.
 */

const GRAPH_COLORS = ['#38bdf8', '#4ade80', '#f472b6', '#facc15', '#a78bfa'];

/**
 * Safely compiles a mathematical expression string or `{ expr }` object
 * into a fast JavaScript evaluator function `f(x)`.
 */
export function compileMathExpression(rawInput = '') {
  const rawExpr =
    typeof rawInput === 'object' && rawInput !== null
      ? String(rawInput.expr || rawInput.latex || '')
      : String(rawInput || '');

  if (!rawExpr.trim()) {
    return () => NaN;
  }

  let expr = rawExpr
    .trim()
    .replace(/^\$\$|\$\$$/g, '')
    .replace(/^\$|\$$/g, '')
    // Strip leading "y =", "f(x) =", "g(x) =", "M(x) ="
    .replace(/^[a-zA-Z]\s*\(\s*x\s*\)\s*=\s*/i, '')
    .replace(/^y\s*=\s*/i, '')
    // Convert LaTeX fractions \frac{a}{b} -> ((a)/(b))
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))')
    // Convert LaTeX \sqrt{a} -> sqrt(a)
    .replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\pi\b/g, 'PI')
    .replace(/\\left|\\right/g, '')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\\/g, '');

  // If it's an equation like "2x^2 + 5x + 2 = 0", plot LHS - RHS
  if (expr.includes('=')) {
    const parts = expr.split('=');
    const lhs = parts[0].trim();
    const rhs = parts[1].trim();
    if (rhs === '0' || rhs === '') {
      expr = lhs;
    } else {
      expr = `(${lhs}) - (${rhs})`;
    }
  }

  // Insert implicit multiplication: e.g. "2x" -> "2*x", "3(x+1)" -> "3*(x+1)", "(x+1)(x-1)" -> "(x+1)*(x-1)"
  expr = expr
    .replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2')
    .replace(/(\))\s*(\d|[a-zA-Z(])/g, '$1*$2')
    .replace(/\bx\s*\(/g, 'x*(')
    .replace(/\^/g, '**');

  const fnMap = {
    sin: 'Math.sin',
    cos: 'Math.cos',
    tan: 'Math.tan',
    asin: 'Math.asin',
    acos: 'Math.acos',
    atan: 'Math.atan',
    sqrt: 'Math.sqrt',
    abs: 'Math.abs',
    ln: 'Math.log',
    log: 'Math.log10',
    exp: 'Math.exp',
    PI: 'Math.PI',
    pi: 'Math.PI'
  };

  expr = expr.replace(
    /\b(sin|cos|tan|asin|acos|atan|sqrt|abs|ln|log|exp|PI|pi)\b/g,
    match => fnMap[match] || match
  );

  // Replace standalone e with Math.E
  expr = expr.replace(/\be\b/g, 'Math.E');

  try {
    const fn = new Function('x', `"use strict"; try { return Number(${expr}); } catch (_) { return NaN; }`);
    fn(1);
    return fn;
  } catch (_) {
    return () => NaN;
  }
}

/**
 * Automatically finds key mathematical features (roots y=0, y-intercept x=0, local extrema/vertices)
 * within [xMin, xMax].
 */
export function findCurveFeatures(fn, xMin = -10, xMax = 10) {
  const features = [];
  const steps = 450;
  const dx = (xMax - xMin) / steps;

  // 1. y-intercept (x = 0)
  if (xMin <= 0 && xMax >= 0) {
    const y0 = fn(0);
    if (Number.isFinite(y0) && Math.abs(y0) < 1e4) {
      features.push({
        x: 0,
        y: y0,
        title: 'y-intercept',
        label: `(0, ${formatNum(y0)})`,
        type: 'intercept'
      });
    }
  }

  let prevX = xMin;
  let prevY = fn(prevX);
  let prevSlope = NaN;

  for (let i = 1; i <= steps; i++) {
    const currX = xMin + i * dx;
    const currY = fn(currX);

    if (Number.isFinite(prevY) && Number.isFinite(currY)) {
      // 2. Root detection (sign change across y = 0, excluding vertical asymptotes)
      if ((prevY <= 0 && currY >= 0) || (prevY >= 0 && currY <= 0)) {
        if (Math.abs(currY - prevY) < 40) {
          const rootX = refineBisectionRoot(fn, prevX, currX);
          const rootY = fn(rootX);
          if (Number.isFinite(rootX) && Math.abs(rootY) < 0.05) {
            if (!features.some(f => Math.abs(f.x - rootX) < 0.12 && f.type === 'root')) {
              features.push({
                x: rootX,
                y: 0,
                title: 'Root',
                label: `(${formatNum(rootX)}, 0)`,
                type: 'root'
              });
            }
          }
        }
      }

      // 3. Local extremum / vertex detection (slope sign change)
      const currSlope = (currY - prevY) / dx;
      if (Number.isFinite(prevSlope) && Number.isFinite(currSlope)) {
        if ((prevSlope > 1e-4 && currSlope < -1e-4) || (prevSlope < -1e-4 && currSlope > 1e-4)) {
          if (Math.abs(currSlope - prevSlope) < 80) {
            const vx = refineExtremum(fn, prevX - dx, currX);
            const vy = fn(vx);
            if (Number.isFinite(vy) && !features.some(f => Math.abs(f.x - vx) < 0.2 && f.type === 'extremum')) {
              features.push({
                x: vx,
                y: vy,
                title: prevSlope > 0 ? 'Local Max' : 'Vertex / Min',
                label: `(${formatNum(vx)}, ${formatNum(vy)})`,
                type: 'extremum'
              });
            }
          }
        }
      }
      prevSlope = currSlope;
    } else {
      prevSlope = NaN;
    }

    prevX = currX;
    prevY = currY;
  }

  return features.slice(0, 8);
}

function refineBisectionRoot(fn, a, b, iterations = 20) {
  let left = a;
  let right = b;
  let fLeft = fn(left);
  for (let i = 0; i < iterations; i++) {
    const mid = 0.5 * (left + right);
    const fMid = fn(mid);
    if (!Number.isFinite(fMid)) break;
    if (Math.abs(fMid) < 1e-8) return mid;
    if ((fLeft <= 0 && fMid <= 0) || (fLeft >= 0 && fMid >= 0)) {
      left = mid;
      fLeft = fMid;
    } else {
      right = mid;
    }
  }
  return 0.5 * (left + right);
}

function refineExtremum(fn, a, b, iterations = 16) {
  const gr = (Math.sqrt(5) - 1) / 2;
  let x1 = b - gr * (b - a);
  let x2 = a + gr * (b - a);
  const fMid = fn(0.5 * (a + b));
  const fEnds = 0.5 * (fn(a) + fn(b));
  const isMin = fMid < fEnds;

  for (let i = 0; i < iterations; i++) {
    const y1 = fn(x1);
    const y2 = fn(x2);
    if (isMin ? y1 < y2 : y1 > y2) {
      b = x2;
    } else {
      a = x1;
    }
    x1 = b - gr * (b - a);
    x2 = a + gr * (b - a);
  }
  return 0.5 * (a + b);
}

function formatNum(n) {
  if (Math.abs(n) < 1e-5) return '0';
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

function normalizeFunctionEntry(entry, idx) {
  if (typeof entry === 'string') {
    const cleanExpr = entry.trim();
    return {
      expr: cleanExpr,
      label: cleanExpr.startsWith('f') || cleanExpr.startsWith('y') ? cleanExpr : `f_${idx + 1}(x) = ${cleanExpr}`,
      color: GRAPH_COLORS[idx % GRAPH_COLORS.length]
    };
  }
  if (entry && typeof entry === 'object') {
    const cleanExpr = String(entry.expr || entry.latex || 'x^2').trim();
    return {
      expr: cleanExpr,
      label: String(entry.label || `f_${idx + 1}(x) = ${cleanExpr}`).replace(/\$/g, '').trim(),
      color: entry.color || GRAPH_COLORS[idx % GRAPH_COLORS.length]
    };
  }
  return {
    expr: 'x^2',
    label: 'f(x) = x^2',
    color: GRAPH_COLORS[0]
  };
}

function exprToLatexPreview(labelStr) {
  return String(labelStr || '')
    .replace(/\$/g, '')
    .replace(/\*\*/g, '^')
    .replace(/\*/g, ' \\cdot ')
    .replace(/sqrt\(([^()]+)\)/g, '\\sqrt{$1}');
}

/**
 * Creates a refined HiDPI Desmos/GeoGebra-style interactive graphing widget DOM element
 */
export function createInteractiveGraphElement(graphSpec = {}) {
  const rawFunctions = Array.isArray(graphSpec.functions) && graphSpec.functions.length > 0
    ? graphSpec.functions
    : ['x^2 - 4'];

  const functionsList = rawFunctions.map((item, i) => normalizeFunctionEntry(item, i));
  const customPoints = Array.isArray(graphSpec.points) ? [...graphSpec.points] : [];

  let xDomain = Array.isArray(graphSpec.xDomain) && graphSpec.xDomain.length === 2
    ? [Number(graphSpec.xDomain[0]), Number(graphSpec.xDomain[1])]
    : [-7, 7];
  let yDomain = Array.isArray(graphSpec.yDomain) && graphSpec.yDomain.length === 2
    ? [Number(graphSpec.yDomain[0]), Number(graphSpec.yDomain[1])]
    : [-6, 10];

  const defaultXDomain = [...xDomain];
  const defaultYDomain = [...yDomain];

  const LOGICAL_W = 600;
  const LOGICAL_H = 300;
  const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));

  const wrapper = document.createElement('div');
  wrapper.className = 'desmos-graph-card';

  // Refined Header Bar
  const header = document.createElement('div');
  header.className = 'desmos-graph-header';
  header.innerHTML = `
    <div class="desmos-title-group">
      <span class="desmos-badge">📈 INTERACTIVE GRAPH</span>
      <span class="desmos-title"></span>
    </div>
    <div class="desmos-toolbar">
      <button type="button" class="desmos-tool-btn" data-action="zoom-in" title="Zoom In">＋</button>
      <button type="button" class="desmos-tool-btn" data-action="zoom-out" title="Zoom Out">－</button>
      <button type="button" class="desmos-tool-btn" data-action="reset" title="Reset View">⟲ Reset</button>
    </div>
  `;
  header.querySelector('.desmos-title').textContent =
    String(graphSpec.title || 'Coordinate Plane Explorer').replace(/\$/g, '');
  wrapper.appendChild(header);

  // HiDPI Canvas Viewport
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'desmos-canvas-wrap';

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(LOGICAL_W * dpr);
  canvas.height = Math.round(LOGICAL_H * dpr);
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.className = 'desmos-canvas';
  canvasWrap.appendChild(canvas);

  // Floating Point Inspection Badge (only visible when hovering near a point/curve or click-tracing)
  const tooltip = document.createElement('div');
  tooltip.className = 'desmos-tooltip';
  tooltip.hidden = true;
  canvasWrap.appendChild(tooltip);

  wrapper.appendChild(canvasWrap);

  // Key Feature Summary Strip (lists exact roots, vertex, y-intercept like GeoGebra/Desmos)
  const featuresStrip = document.createElement('div');
  featuresStrip.className = 'desmos-features-strip';
  wrapper.appendChild(featuresStrip);

  // Expression Bar (with KaTeX function badges + Add Function input)
  const exprBar = document.createElement('div');
  exprBar.className = 'desmos-expr-bar';
  wrapper.appendChild(exprBar);

  let compiledCurves = [];
  let hoverMouse = null;
  let isPanning = false;
  let isTraceMode = false; // Click-and-hold on a curve traces it smoothly; normal mouse move only highlights on close proximity
  let pinnedPoint = null;
  let dragStart = { x: 0, y: 0, xDomain: [0, 0], yDomain: [0, 0] };

  function rebuildCompiledCurves() {
    compiledCurves = functionsList.map((item, idx) => {
      const normalized = normalizeFunctionEntry(item, idx);
      const fn = compileMathExpression(normalized.expr);
      const autoFeatures = findCurveFeatures(fn, xDomain[0], xDomain[1]);
      return {
        ...normalized,
        fn,
        autoFeatures
      };
    });
    renderFeaturesStrip();
    renderExpressionPills();
  }

  function renderFeaturesStrip() {
    featuresStrip.innerHTML = '';
    const allPts = [];
    compiledCurves.forEach((c) => {
      c.autoFeatures.forEach((pt) => {
        allPts.push({ ...pt, color: c.color });
      });
    });

    if (allPts.length === 0) {
      featuresStrip.hidden = true;
      return;
    }
    featuresStrip.hidden = false;

    allPts.slice(0, 5).forEach((pt) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'desmos-feature-chip';
      chip.innerHTML = `<span class="desmos-feature-dot" style="background:${pt.color}"></span><strong>${pt.title}:</strong> ${pt.label}`;
      chip.addEventListener('click', () => {
        pinnedPoint = {
          wx: pt.x,
          wy: pt.y,
          title: pt.title,
          label: `${pt.title}: (${formatNum(pt.x)}, ${formatNum(pt.y)})`,
          color: pt.color
        };
        drawGraph();
      });
      featuresStrip.appendChild(chip);
    });
  }

  function renderExpressionPills() {
    exprBar.innerHTML = '';
    const listWrap = document.createElement('div');
    listWrap.className = 'desmos-expr-list';

    compiledCurves.forEach((curve, idx) => {
      const pill = document.createElement('div');
      pill.className = 'desmos-expr-pill';

      const dot = document.createElement('span');
      dot.className = 'desmos-color-dot';
      dot.style.background = curve.color;
      pill.appendChild(dot);

      const mathSpan = document.createElement('span');
      mathSpan.className = 'desmos-expr-text';
      const latexCandidate = exprToLatexPreview(curve.label);
      if (window.katex) {
        try {
          window.katex.render(latexCandidate, mathSpan, { displayMode: false, throwOnError: false });
        } catch (_) {
          mathSpan.textContent = curve.label;
        }
      } else {
        mathSpan.textContent = curve.label;
      }
      pill.appendChild(mathSpan);

      if (compiledCurves.length > 1) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'desmos-remove-fn';
        delBtn.textContent = '×';
        delBtn.title = 'Remove function';
        delBtn.addEventListener('click', () => {
          functionsList.splice(idx, 1);
          rebuildCompiledCurves();
          drawGraph();
        });
        pill.appendChild(delBtn);
      }

      listWrap.appendChild(pill);
    });

    exprBar.appendChild(listWrap);

    const addForm = document.createElement('form');
    addForm.className = 'desmos-add-form';
    addForm.innerHTML = `
      <input type="text" class="desmos-expr-input" placeholder="+ Plot f(x), e.g. 2x + 1" />
      <button type="submit" class="desmos-add-btn">Plot</button>
    `;
    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = addForm.querySelector('input');
      const val = input.value.trim();
      if (!val) return;
      functionsList.push(normalizeFunctionEntry(val, functionsList.length));
      input.value = '';
      rebuildCompiledCurves();
      drawGraph();
    });
    exprBar.appendChild(addForm);
  }

  function worldToScreen(wx, wy) {
    const sx = ((wx - xDomain[0]) / (xDomain[1] - xDomain[0])) * LOGICAL_W;
    const sy = LOGICAL_H - ((wy - yDomain[0]) / (yDomain[1] - yDomain[0])) * LOGICAL_H;
    return { x: sx, y: sy };
  }

  function screenToWorld(sx, sy) {
    const wx = xDomain[0] + (sx / LOGICAL_W) * (xDomain[1] - xDomain[0]);
    const wy = yDomain[0] + ((LOGICAL_H - sy) / LOGICAL_H) * (yDomain[1] - yDomain[0]);
    return { x: wx, y: wy };
  }

  function computeNiceStep(span) {
    const rough = span / 7;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const residual = rough / mag;
    if (residual > 5) return 10 * mag;
    if (residual > 2) return 5 * mag;
    if (residual > 1) return 2 * mag;
    return mag;
  }

  /**
   * Finds a point only when the cursor is genuinely close in 2D Euclidean pixels (`< 12px`)
   * to a special point or to the curve itself (unless the user clicked & held on the curve to trace).
   */
  function findHoverOrTracePoint(mouseLogical) {
    if (!mouseLogical) return null;

    const allFeaturePoints = [];
    customPoints.forEach(pt => allFeaturePoints.push({
      x: Number(pt.x),
      y: Number(pt.y),
      title: pt.label || 'Point',
      label: pt.label || `(${formatNum(pt.x)}, ${formatNum(pt.y)})`,
      color: pt.color || '#facc15'
    }));
    compiledCurves.forEach((curve) => {
      curve.autoFeatures.forEach(pt => allFeaturePoints.push({
        ...pt,
        color: curve.color
      }));
    });

    // 1. Check 2D Euclidean proximity to key points (Roots, Vertex, Intercepts) within 13px
    let bestSpecial = null;
    let bestSpecialDist = 13;
    for (const pt of allFeaturePoints) {
      const s = worldToScreen(pt.x, pt.y);
      const dist = Math.hypot(s.x - mouseLogical.x, s.y - mouseLogical.y);
      if (dist < bestSpecialDist) {
        bestSpecialDist = dist;
        bestSpecial = {
          wx: pt.x,
          wy: pt.y,
          sx: s.x,
          sy: s.y,
          label: pt.title ? `${pt.title}: (${formatNum(pt.x)}, ${formatNum(pt.y)})` : pt.label,
          color: pt.color,
          isKeyPoint: true
        };
      }
    }
    if (bestSpecial) return bestSpecial;

    // 2. Check true 2D Euclidean distance to each curve in a small neighborhood around mouseLogical.x
    // If not in click-trace mode, require the mouse cursor to be within 10px of the curve itself!
    const maxCurveDist = isTraceMode ? 180 : 10;
    let bestCurvePt = null;
    let bestCurveDist = maxCurveDist;

    compiledCurves.forEach((curve) => {
      const searchSpanPx = isTraceMode ? 0 : 10;
      const stepPx = 1;
      for (let dx = -searchSpanPx; dx <= searchSpanPx; dx += stepPx) {
        const testSx = mouseLogical.x + dx;
        const { x: wx } = screenToWorld(testSx, 0);
        const wy = curve.fn(wx);
        if (!Number.isFinite(wy)) continue;
        const s = worldToScreen(wx, wy);
        const d = isTraceMode
          ? Math.abs(s.y - mouseLogical.y)
          : Math.hypot(s.x - mouseLogical.x, s.y - mouseLogical.y);
        if (d < bestCurveDist) {
          bestCurveDist = d;
          bestCurvePt = {
            wx,
            wy,
            sx: s.x,
            sy: s.y,
            label: `(${formatNum(wx)}, ${formatNum(wy)})`,
            color: curve.color,
            isKeyPoint: false
          };
        }
      }
    });

    return bestCurvePt;
  }

  function drawGraph() {
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const W = LOGICAL_W;
    const H = LOGICAL_H;

    // 1. Sleek Deep Slate Canvas Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0b101b');
    bgGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const xStep = computeNiceStep(xDomain[1] - xDomain[0]);
    const yStep = computeNiceStep(yDomain[1] - yDomain[0]);
    const xMinor = xStep / 5;
    const yMinor = yStep / 5;

    // 2. Minor Sub-Gridlines (Desmos-style subtle subdivision)
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.055)';
    const firstMinorX = Math.ceil(xDomain[0] / xMinor) * xMinor;
    for (let gx = firstMinorX; gx <= xDomain[1]; gx += xMinor) {
      const { x: sx } = worldToScreen(gx, 0);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
      ctx.stroke();
    }
    const firstMinorY = Math.ceil(yDomain[0] / yMinor) * yMinor;
    for (let gy = firstMinorY; gy <= yDomain[1]; gy += yMinor) {
      const { y: sy } = worldToScreen(0, gy);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
      ctx.stroke();
    }

    // 3. Major Gridlines
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    const firstX = Math.ceil(xDomain[0] / xStep) * xStep;
    for (let gx = firstX; gx <= xDomain[1]; gx += xStep) {
      const { x: sx } = worldToScreen(gx, 0);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
      ctx.stroke();
    }
    const firstY = Math.ceil(yDomain[0] / yStep) * yStep;
    for (let gy = firstY; gy <= yDomain[1]; gy += yStep) {
      const { y: sy } = worldToScreen(0, gy);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
      ctx.stroke();
    }

    // 4. Principal Coordinate Axes (x = 0, y = 0) with clean arrowheads
    const origin = worldToScreen(0, 0);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.65)';
    ctx.lineWidth = 1.5;

    if (origin.x >= 0 && origin.x <= W) {
      ctx.beginPath();
      ctx.moveTo(origin.x, 0);
      ctx.lineTo(origin.x, H);
      ctx.stroke();
    }
    if (origin.y >= 0 && origin.y <= H) {
      ctx.beginPath();
      ctx.moveTo(0, origin.y);
      ctx.lineTo(W, origin.y);
      ctx.stroke();
    }

    // 5. Crisp Axis Tick Numbers with dark halo so curves never obscure numbers
    ctx.font = '500 10.5px "Google Sans", Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let gx = firstX; gx <= xDomain[1]; gx += xStep) {
      if (Math.abs(gx) < 1e-6) continue;
      const { x: sx } = worldToScreen(gx, 0);
      if (sx < 18 || sx > W - 18) continue;
      const labelY = Math.max(6, Math.min(H - 18, origin.y + 5));
      const txt = formatNum(gx);
      ctx.strokeStyle = 'rgba(11, 16, 27, 0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(txt, sx, labelY);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(txt, sx, labelY);
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let gy = firstY; gy <= yDomain[1]; gy += yStep) {
      if (Math.abs(gy) < 1e-6) continue;
      const { y: sy } = worldToScreen(0, gy);
      if (sy < 14 || sy > H - 14) continue;
      const labelX = Math.max(26, Math.min(W - 8, origin.x - 6));
      const txt = formatNum(gy);
      ctx.strokeStyle = 'rgba(11, 16, 27, 0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(txt, labelX, sy);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(txt, labelX, sy);
    }

    // 6. Plot High-Resolution Anti-Aliased Function Curves
    const allFeaturePoints = [];
    customPoints.forEach(pt => allFeaturePoints.push({
      x: Number(pt.x),
      y: Number(pt.y),
      title: pt.label || 'Point',
      label: pt.label || `(${formatNum(pt.x)}, ${formatNum(pt.y)})`,
      color: pt.color || '#facc15'
    }));

    compiledCurves.forEach((curve) => {
      ctx.save();
      ctx.strokeStyle = curve.color;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = curve.color;
      ctx.shadowBlur = 4;
      ctx.beginPath();

      let penDown = false;
      let prevSy = null;

      // Sub-pixel sampling (0.75px step) for silky smooth parabolas and trig waves
      for (let px = 0; px <= W; px += 0.75) {
        const { x: wx } = screenToWorld(px, 0);
        const wy = curve.fn(wx);

        if (Number.isFinite(wy)) {
          const { y: sy } = worldToScreen(wx, wy);
          if (prevSy !== null && Math.abs(sy - prevSy) > H * 1.2) {
            penDown = false;
          }
          if (sy >= -H * 0.5 && sy <= H * 1.5) {
            if (!penDown) {
              ctx.moveTo(px, sy);
              penDown = true;
            } else {
              ctx.lineTo(px, sy);
            }
            prevSy = sy;
          } else {
            penDown = false;
            prevSy = null;
          }
        } else {
          penDown = false;
          prevSy = null;
        }
      }
      ctx.stroke();
      ctx.restore();

      curve.autoFeatures.forEach(pt => allFeaturePoints.push({ ...pt, color: curve.color }));
    });

    // 7. Draw Subtle Desmos-Style Key Points (Roots, Vertex, y-intercept)
    allFeaturePoints.forEach((pt) => {
      const { x: sx, y: sy } = worldToScreen(pt.x, pt.y);
      if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) return;

      // Outer halo
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.beginPath();
      ctx.arc(sx, sy, 5.2, 0, Math.PI * 2);
      ctx.fill();

      // Inner colored dot
      ctx.fillStyle = pt.color || '#38bdf8';
      ctx.beginPath();
      ctx.arc(sx, sy, 3.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });

    // 8. Active Point Highlight (ONLY when hovering directly on a point/curve or when a feature chip was clicked)
    const activePt = findHoverOrTracePoint(hoverMouse) || (pinnedPoint ? {
      ...pinnedPoint,
      sx: worldToScreen(pinnedPoint.wx, pinnedPoint.wy).x,
      sy: worldToScreen(pinnedPoint.wx, pinnedPoint.wy).y
    } : null);

    if (activePt) {
      // Subtle coordinate projection lines to the axes (only when actively inspecting a point)
      ctx.save();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      if (origin.y >= 0 && origin.y <= H) {
        ctx.moveTo(activePt.sx, activePt.sy);
        ctx.lineTo(activePt.sx, origin.y);
      }
      if (origin.x >= 0 && origin.x <= W) {
        ctx.moveTo(activePt.sx, activePt.sy);
        ctx.lineTo(origin.x, activePt.sy);
      }
      ctx.stroke();
      ctx.restore();

      // Glowing outer ring around the inspected point
      ctx.save();
      ctx.fillStyle = activePt.color || '#38bdf8';
      ctx.beginPath();
      ctx.arc(activePt.sx, activePt.sy, 6.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();

      tooltip.hidden = false;
      tooltip.textContent = activePt.label;
      const pctX = (activePt.sx / W) * 100;
      const pctY = (activePt.sy / H) * 100;
      tooltip.style.left = `${Math.min(82, Math.max(8, pctX))}%`;
      tooltip.style.top = `${Math.max(12, pctY)}%`;
    } else {
      tooltip.hidden = true;
    }

    ctx.restore();
  }

  function zoomByFactor(
    factor,
    centerWx = 0.5 * (xDomain[0] + xDomain[1]),
    centerWy = 0.5 * (yDomain[0] + yDomain[1])
  ) {
    const newXSpan = Math.max(0.5, Math.min(200, (xDomain[1] - xDomain[0]) * factor));
    const newYSpan = Math.max(0.5, Math.min(200, (yDomain[1] - yDomain[0]) * factor));
    xDomain = [centerWx - 0.5 * newXSpan, centerWx + 0.5 * newXSpan];
    yDomain = [centerWy - 0.5 * newYSpan, centerWy + 0.5 * newYSpan];
    rebuildCompiledCurves();
    drawGraph();
  }

  header.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (action === 'zoom-in') zoomByFactor(0.75);
      else if (action === 'zoom-out') zoomByFactor(1.33);
      else if (action === 'reset') {
        xDomain = [...defaultXDomain];
        yDomain = [...defaultYDomain];
        pinnedPoint = null;
        rebuildCompiledCurves();
        drawGraph();
      }
    });
  });

  function getLogicalMouseCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (LOGICAL_W / rect.width),
      y: (e.clientY - rect.top) * (LOGICAL_H / rect.height)
    };
  }

  canvas.addEventListener('mousedown', (e) => {
    const m = getLogicalMouseCoords(e);
    hoverMouse = m;
    const hitPoint = findHoverOrTracePoint(m);

    // If the user clicks directly on a curve or key point, enter smooth curve-trace mode;
    // otherwise pan the coordinate plane!
    if (hitPoint) {
      isTraceMode = true;
      pinnedPoint = hitPoint;
      drawGraph();
    } else {
      isPanning = true;
      pinnedPoint = null;
      dragStart = {
        x: m.x,
        y: m.y,
        xDomain: [...xDomain],
        yDomain: [...yDomain]
      };
    }
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      rebuildCompiledCurves();
      drawGraph();
    }
    if (isTraceMode) {
      isTraceMode = false;
      drawGraph();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const m = getLogicalMouseCoords(e);

    if (isPanning) {
      const dxWorld = ((m.x - dragStart.x) / LOGICAL_W) * (dragStart.xDomain[1] - dragStart.xDomain[0]);
      const dyWorld = ((m.y - dragStart.y) / LOGICAL_H) * (dragStart.yDomain[1] - dragStart.yDomain[0]);
      xDomain = [dragStart.xDomain[0] - dxWorld, dragStart.xDomain[1] - dxWorld];
      yDomain = [dragStart.yDomain[0] + dyWorld, dragStart.yDomain[1] + dyWorld];
      hoverMouse = null;
      drawGraph();
      return;
    }

    hoverMouse = m;
    const nearPt = findHoverOrTracePoint(m);
    canvas.style.cursor = isPanning ? 'grabbing' : nearPt ? 'pointer' : 'grab';
    drawGraph();
  });

  canvas.addEventListener('mouseleave', () => {
    hoverMouse = null;
    isTraceMode = false;
    drawGraph();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const m = getLogicalMouseCoords(e);
    const center = screenToWorld(m.x, m.y);
    const factor = e.deltaY < 0 ? 0.85 : 1.18;
    zoomByFactor(factor, center.x, center.y);
  }, { passive: false });

  rebuildCompiledCurves();
  drawGraph();

  return wrapper;
}
