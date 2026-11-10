/**
 * Refined HiDPI Interactive Graphing Engine (`graph-engine.js`)
 * Features:
 *  - Razor-sharp HiDPI / Retina (`window.devicePixelRatio`) canvas rendering
 *  - Multi-level minor & major coordinate gridlines + haloed axis tick labels
 *  - Structured Key Graph Features Table (Roots, Vertex/Extrema, y-intercept) for instant legibility
 *  - Stationary key point highlighting (no moving dots or distracting motion)
 *  - True 2D Euclidean proximity inspection: coordinates appear only when hovering directly on a curve/key point
 *    or clicking a row in the Key Features Table.
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
    .replace(/^[a-zA-Z]\s*\(\s*x\s*\)\s*=\s*/i, '')
    .replace(/^y\s*=\s*/i, '')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))')
    .replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\pi\b/g, 'PI')
    .replace(/\\left|\\right/g, '')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\\/g, '');

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
        meaning: 'Value at x = 0',
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
      // 2. Root detection (f(x) = 0)
      if ((prevY <= 0 && currY >= 0) || (prevY >= 0 && currY <= 0)) {
        if (Math.abs(currY - prevY) < 40) {
          const rootX = refineBisectionRoot(fn, prevX, currX);
          const rootY = fn(rootX);
          if (Number.isFinite(rootX) && Math.abs(rootY) < 0.05) {
            if (!features.some(f => Math.abs(f.x - rootX) < 0.12 && f.type === 'root')) {
              features.push({
                x: rootX,
                y: 0,
                title: 'Root (x-intercept)',
                meaning: 'f(x) = 0',
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
              const isMax = prevSlope > 0;
              features.push({
                x: vx,
                y: vy,
                title: isMax ? 'Vertex (Local Max)' : 'Vertex (Local Min)',
                meaning: isMax ? 'Maximum turning point' : 'Minimum turning point',
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

  return features.slice(0, 6);
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
 * Creates a refined HiDPI Interactive Graphing widget with a structured Key Features Table
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
  let isInteractive = Boolean(graphSpec.interactive);

  const LOGICAL_W = 600;
  const LOGICAL_H = 280;
  const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));

  const wrapper = document.createElement('div');
  wrapper.className = 'desmos-graph-card';

  // Header Bar
  const header = document.createElement('div');
  header.className = 'desmos-graph-header';
  header.innerHTML = `
    <div class="desmos-title-group">
      <span class="desmos-badge">📈 GRAPH</span>
      <span class="desmos-title"></span>
    </div>
    <div class="desmos-toolbar">
      <button type="button" class="desmos-tool-btn" data-action="toggle-interactive" title="Unlock only when tracing points or testing parameter changes"></button>
      <button type="button" class="desmos-tool-btn" data-action="zoom-in" title="Zoom In">＋</button>
      <button type="button" class="desmos-tool-btn" data-action="zoom-out" title="Zoom Out">－</button>
      <button type="button" class="desmos-tool-btn" data-action="reset" title="Reset View">⟲ Reset</button>
    </div>
  `;
  header.querySelector('.desmos-title').textContent =
    String(graphSpec.title || 'Coordinate Plane').replace(/\$/g, '');
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

  const tooltip = document.createElement('div');
  tooltip.className = 'desmos-tooltip';
  tooltip.hidden = true;
  canvasWrap.appendChild(tooltip);

  wrapper.appendChild(canvasWrap);

  // Structured Key Features Table (Roots, Vertex, y-intercept) for high legibility
  const tableContainer = document.createElement('div');
  tableContainer.className = 'desmos-table-wrap';
  wrapper.appendChild(tableContainer);

  // Expression Bar
  const exprBar = document.createElement('div');
  exprBar.className = 'desmos-expr-bar';
  wrapper.appendChild(exprBar);

  let compiledCurves = [];
  let hoverMouse = null;
  let isPanning = false;
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
    renderFeaturesTable();
    renderExpressionPills();
  }

  function renderFeaturesTable() {
    tableContainer.innerHTML = '';
    const allPts = [];
    compiledCurves.forEach((c) => {
      c.autoFeatures.forEach((pt) => {
        allPts.push({ ...pt, color: c.color });
      });
    });

    if (allPts.length === 0) {
      tableContainer.hidden = true;
      return;
    }
    tableContainer.hidden = false;

    const table = document.createElement('table');
    table.className = 'stem-info-table compact';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Key Graph Feature</th>
          <th>Coordinate (x, y)</th>
          <th>Algebraic Condition</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    allPts.slice(0, 4).forEach((pt) => {
      const tr = document.createElement('tr');
      tr.className = 'clickable-row';
      tr.innerHTML = `
        <td><span class="desmos-feature-dot" style="background:${pt.color};display:inline-block;margin-right:6px;"></span><strong>${pt.title}</strong></td>
        <td><code>${pt.label}</code></td>
        <td>${pt.meaning || ''}</td>
      `;
      tr.addEventListener('click', () => {
        pinnedPoint = {
          wx: pt.x,
          wy: pt.y,
          title: pt.title,
          label: `${pt.title}: (${formatNum(pt.x)}, ${formatNum(pt.y)})`,
          color: pt.color
        };
        drawGraph();
      });
      tbody.appendChild(tr);
    });

    tableContainer.appendChild(table);
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

      if (isInteractive && compiledCurves.length > 1) {
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

    if (isInteractive) {
      const addForm = document.createElement('form');
      addForm.className = 'desmos-add-form';
      addForm.innerHTML = `
        <input type="text" class="desmos-expr-input" placeholder="+ Test parameter / plot f(x), e.g. 2x + 1" />
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
   * Inspects ONLY stationary key points when the cursor hovers directly over them (`< 12px`).
   * Does NOT follow horizontal cursor movement across the curve.
   */
  function findHoveredKeyPoint(mouseLogical) {
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

    let bestSpecial = null;
    let bestSpecialDist = 12;
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
          color: pt.color
        };
      }
    }
    return bestSpecial;
  }

  function drawGraph() {
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const W = LOGICAL_W;
    const H = LOGICAL_H;

    // 1. Clean Slate Canvas Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0b101b');
    bgGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const xStep = computeNiceStep(xDomain[1] - xDomain[0]);
    const yStep = computeNiceStep(yDomain[1] - yDomain[0]);
    const xMinor = xStep / 5;
    const yMinor = yStep / 5;

    // 2. Minor Sub-Gridlines
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
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

    // 4. Principal Coordinate Axes (x = 0, y = 0)
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

    // 5. Crisp Axis Tick Numbers
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
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();

      let penDown = false;
      let prevSy = null;

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

    // 7. Draw Stationary Key Points (Roots, Vertex, y-intercept) with clean static coordinate labels
    allFeaturePoints.forEach((pt) => {
      const { x: sx, y: sy } = worldToScreen(pt.x, pt.y);
      if (sx < 10 || sx > W - 10 || sy < 10 || sy > H - 10) return;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.beginPath();
      ctx.arc(sx, sy, 5.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = pt.color || '#38bdf8';
      ctx.beginPath();
      ctx.arc(sx, sy, 3.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Static subtle coordinate label next to key points
      const coordText = `(${formatNum(pt.x)}, ${formatNum(pt.y)})`;
      ctx.font = '600 10px "Google Sans", Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.strokeStyle = 'rgba(11, 16, 27, 0.92)';
      ctx.lineWidth = 3;
      ctx.strokeText(coordText, sx + 7, sy - 4);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(coordText, sx + 7, sy - 4);
    });

    // 8. Highlighted Key Point when hovered directly or selected from the Key Features Table
    const activePt = findHoveredKeyPoint(hoverMouse) || (pinnedPoint ? {
      ...pinnedPoint,
      sx: worldToScreen(pinnedPoint.wx, pinnedPoint.wy).x,
      sy: worldToScreen(pinnedPoint.wx, pinnedPoint.wy).y
    } : null);

    if (activePt) {
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

  function syncInteractiveControlsUI() {
    const toggleBtn = header.querySelector('[data-action="toggle-interactive"]');
    const zoomInBtn = header.querySelector('[data-action="zoom-in"]');
    const zoomOutBtn = header.querySelector('[data-action="zoom-out"]');
    const resetBtn = header.querySelector('[data-action="reset"]');

    if (toggleBtn) {
      toggleBtn.textContent = isInteractive ? '🔓 Trace / Test: ON' : '🔒 Locked (Click to Trace/Test)';
    }
    if (zoomInBtn) zoomInBtn.hidden = !isInteractive;
    if (zoomOutBtn) zoomOutBtn.hidden = !isInteractive;
    if (resetBtn) resetBtn.hidden = !isInteractive;
    canvas.style.cursor = isInteractive ? 'grab' : 'default';
  }

  header.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (action === 'toggle-interactive') {
        isInteractive = !isInteractive;
        if (!isInteractive) {
          isPanning = false;
          hoverMouse = null;
          xDomain = [...defaultXDomain];
          yDomain = [...defaultYDomain];
        }
        syncInteractiveControlsUI();
        rebuildCompiledCurves();
        drawGraph();
      } else if (action === 'zoom-in' && isInteractive) {
        zoomByFactor(0.75);
      } else if (action === 'zoom-out' && isInteractive) {
        zoomByFactor(1.33);
      } else if (action === 'reset') {
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
    const hitKeyPt = findHoveredKeyPoint(m);
    if (hitKeyPt) {
      pinnedPoint = hitKeyPt;
      drawGraph();
      return;
    }
    if (!isInteractive) return;
    isPanning = true;
    pinnedPoint = null;
    dragStart = {
      x: m.x,
      y: m.y,
      xDomain: [...xDomain],
      yDomain: [...yDomain]
    };
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      rebuildCompiledCurves();
      drawGraph();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isInteractive) return;
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
    const nearKeyPt = findHoveredKeyPoint(m);
    canvas.style.cursor = isPanning ? 'grabbing' : nearKeyPt ? 'pointer' : 'grab';
    drawGraph();
  });

  canvas.addEventListener('mouseleave', () => {
    if (!isInteractive) return;
    hoverMouse = null;
    drawGraph();
  });

  canvas.addEventListener('wheel', (e) => {
    if (!isInteractive) return;
    e.preventDefault();
    const m = getLogicalMouseCoords(e);
    const center = screenToWorld(m.x, m.y);
    const factor = e.deltaY < 0 ? 0.85 : 1.18;
    zoomByFactor(factor, center.x, center.y);
  }, { passive: false });

  syncInteractiveControlsUI();
  rebuildCompiledCurves();
  drawGraph();

  return wrapper;
}
