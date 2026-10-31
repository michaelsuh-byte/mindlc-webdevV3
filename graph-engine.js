/**
 * Open-Source Desmos / GeoGebra-Style Interactive Graphing Engine (`graph-engine.js`)
 * Renders interactive, zoomable, pannable multi-function mathematical graphs
 * with root/vertex/intersection snapping and live expression editing inside chat bubbles.
 */

const GRAPH_COLORS = ['#38bdf8', '#4ade80', '#f472b6', '#facc15', '#a78bfa'];

/**
 * Safely compiles a mathematical expression string (e.g. "2x^2 + 5x + 2", "\frac{\sqrt{x-2}}{x^2-9}", "sin(x)")
 * into a fast JavaScript evaluator function `f(x)`.
 */
export function compileMathExpression(rawExpr = '') {
  if (!rawExpr || typeof rawExpr !== 'string') {
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
    .replace(/\\left|\right/g, '')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\\/g, '');

  // If it's an equation like "2x^2 + 5x + 2 = 0", plot the left-hand side minus right-hand side
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

  // Insert implicit multiplication: e.g. "2x" -> "2*x", "3(x+1)" -> "3*(x+1)", "(x+1)(x-1)" -> "(x+1)*(x-1)", "x sin(x)" -> "x*sin(x)"
  expr = expr
    .replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2')
    .replace(/(\))\s*(\d|[a-zA-Z(])/g, '$1*$2')
    .replace(/\bx\s*\(/g, 'x*(')
    .replace(/\^/g, '**');

  // Map standard math functions to Math.*
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

  expr = expr.replace(/\b(sin|cos|tan|asin|acos|atan|sqrt|abs|ln|log|exp|PI|pi)\b/g, match => fnMap[match] || match);

  // Replace standalone e with Math.E
  expr = expr.replace(/\be\b/g, 'Math.E');

  try {
    const fn = new Function('x', `"use strict"; try { return Number(${expr}); } catch (_) { return NaN; }`);
    // Smoke test
    fn(1);
    return fn;
  } catch (_) {
    return () => NaN;
  }
}

/**
 * Automatically finds key mathematical features (roots y=0, y-intercept x=0, local extrema/vertices)
 * within the current xDomain so they can be highlighted on the graph like Desmos!
 */
export function findCurveFeatures(fn, xMin = -10, xMax = 10) {
  const features = [];
  const steps = 400;
  const dx = (xMax - xMin) / steps;

  // 1. y-intercept (x = 0)
  if (xMin <= 0 && xMax >= 0) {
    const y0 = fn(0);
    if (Number.isFinite(y0) && Math.abs(y0) < 1e4) {
      features.push({ x: 0, y: y0, label: `y-int (0, ${formatNum(y0)})`, type: 'intercept' });
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
        if (Math.abs(currY - prevY) < 50) {
          const rootX = refineBisectionRoot(fn, prevX, currX);
          const rootY = fn(rootX);
          if (Number.isFinite(rootX) && Math.abs(rootY) < 0.05) {
            if (!features.some(f => Math.abs(f.x - rootX) < 0.15 && f.type === 'root')) {
              features.push({
                x: rootX,
                y: 0,
                label: `Root (${formatNum(rootX)}, 0)`,
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
          if (Math.abs(currSlope - prevSlope) < 100) {
            const vx = prevX - dx * 0.5;
            const vy = fn(vx);
            if (Number.isFinite(vy) && !features.some(f => Math.abs(f.x - vx) < 0.25 && f.type === 'extremum')) {
              features.push({
                x: vx,
                y: vy,
                label: `Vertex (${formatNum(vx)}, ${formatNum(vy)})`,
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

function refineBisectionRoot(fn, a, b, iterations = 16) {
  let left = a;
  let right = b;
  let fLeft = fn(left);
  for (let i = 0; i < iterations; i++) {
    const mid = 0.5 * (left + right);
    const fMid = fn(mid);
    if (!Number.isFinite(fMid)) break;
    if (Math.abs(fMid) < 1e-7) return mid;
    if ((fLeft <= 0 && fMid <= 0) || (fLeft >= 0 && fMid >= 0)) {
      left = mid;
      fLeft = fMid;
    } else {
      right = mid;
    }
  }
  return 0.5 * (left + right);
}

function formatNum(n) {
  if (Math.abs(n) < 1e-6) return '0';
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

/**
 * Creates a complete Desmos/GeoGebra-style interactive graphing widget DOM element
 * that can be embedded directly inside a chat bubble.
 */
export function createInteractiveGraphElement(graphSpec = {}) {
  const functionsList = Array.isArray(graphSpec.functions) && graphSpec.functions.length > 0
    ? [...graphSpec.functions]
    : ['x^2'];

  const customPoints = Array.isArray(graphSpec.points) ? [...graphSpec.points] : [];
  let xDomain = Array.isArray(graphSpec.xDomain) && graphSpec.xDomain.length === 2
    ? [...graphSpec.xDomain]
    : [-8, 8];
  let yDomain = Array.isArray(graphSpec.yDomain) && graphSpec.yDomain.length === 2
    ? [...graphSpec.yDomain]
    : [-6, 10];

  const defaultXDomain = [...xDomain];
  const defaultYDomain = [...yDomain];

  const wrapper = document.createElement('div');
  wrapper.className = 'desmos-graph-card';

  // Header toolbar with title + zoom/reset controls
  const header = document.createElement('div');
  header.className = 'desmos-graph-header';
  header.innerHTML = `
    <div class="desmos-title-group">
      <span class="desmos-badge">📈 INTERACTIVE GRAPH</span>
      <span class="desmos-subtitle">${graphSpec.title || 'Drag to pan • Scroll to zoom • Hover to inspect'}</span>
    </div>
    <div class="desmos-toolbar">
      <button type="button" class="desmos-tool-btn" data-action="zoom-in" title="Zoom In">+</button>
      <button type="button" class="desmos-tool-btn" data-action="zoom-out" title="Zoom Out">−</button>
      <button type="button" class="desmos-tool-btn" data-action="reset" title="Reset Viewport">⌂ Reset</button>
    </div>
  `;
  wrapper.appendChild(header);

  // Canvas container
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'desmos-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.width = 560;
  canvas.height = 260;
  canvas.className = 'desmos-canvas';
  canvasWrap.appendChild(canvas);

  // Floating coordinate tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'desmos-tooltip';
  tooltip.hidden = true;
  canvasWrap.appendChild(tooltip);
  wrapper.appendChild(canvasWrap);

  // Expression list + Add Function bar (like Desmos sidebar/footer)
  const exprBar = document.createElement('div');
  exprBar.className = 'desmos-expr-bar';
  wrapper.appendChild(exprBar);

  let compiledCurves = [];
  let hoverMouse = null;
  let isDragging = false;
  let dragStart = { x: 0, y: 0, xDomain: [0, 0], yDomain: [0, 0] };

  function rebuildCompiledCurves() {
    compiledCurves = functionsList.map((exprStr, idx) => {
      const fn = compileMathExpression(exprStr);
      const color = GRAPH_COLORS[idx % GRAPH_COLORS.length];
      const autoFeatures = findCurveFeatures(fn, xDomain[0], xDomain[1]);
      return { exprStr, fn, color, autoFeatures };
    });
    renderExpressionPills();
  }

  function renderExpressionPills() {
    exprBar.innerHTML = '';

    compiledCurves.forEach((curve, idx) => {
      const pill = document.createElement('div');
      pill.className = 'desmos-expr-pill';
      pill.innerHTML = `
        <span class="desmos-color-dot" style="background:${curve.color}"></span>
        <span class="desmos-expr-text">f<sub>${idx + 1}</sub>(x) = ${curve.exprStr}</span>
      `;
      if (compiledCurves.length > 1) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'desmos-del-expr';
        delBtn.textContent = '×';
        delBtn.title = 'Remove curve';
        delBtn.addEventListener('click', () => {
          functionsList.splice(idx, 1);
          rebuildCompiledCurves();
          drawGraph();
        });
        pill.appendChild(delBtn);
      }
      exprBar.appendChild(pill);
    });

    // Input to plot an additional function right on the graph
    const addForm = document.createElement('form');
    addForm.className = 'desmos-add-form';
    addForm.innerHTML = `
      <input type="text" class="desmos-add-input" placeholder="+ Plot f(x), e.g. 2x + 1" />
      <button type="submit" class="desmos-add-btn">Plot</button>
    `;
    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = addForm.querySelector('input');
      const val = input.value.trim();
      if (!val) return;
      functionsList.push(val);
      input.value = '';
      rebuildCompiledCurves();
      drawGraph();
    });
    exprBar.appendChild(addForm);
  }

  function worldToScreen(wx, wy) {
    const sx = ((wx - xDomain[0]) / (xDomain[1] - xDomain[0])) * canvas.width;
    const sy = canvas.height - ((wy - yDomain[0]) / (yDomain[1] - yDomain[0])) * canvas.height;
    return { x: sx, y: sy };
  }

  function screenToWorld(sx, sy) {
    const wx = xDomain[0] + (sx / canvas.width) * (xDomain[1] - xDomain[0]);
    const wy = yDomain[0] + ((canvas.height - sy) / canvas.height) * (yDomain[1] - yDomain[0]);
    return { x: wx, y: wy };
  }

  function computeNiceStep(span) {
    const rough = span / 8;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const residual = rough / mag;
    if (residual > 5) return 10 * mag;
    if (residual > 2) return 5 * mag;
    if (residual > 1) return 2 * mag;
    return mag;
  }

  function drawGraph() {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#0c111d';
    ctx.fillRect(0, 0, W, H);

    const xStep = computeNiceStep(xDomain[1] - xDomain[0]);
    const yStep = computeNiceStep(yDomain[1] - yDomain[0]);

    // 1. Minor & Major Grid lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';

    const firstX = Math.ceil(xDomain[0] / xStep) * xStep;
    for (let gx = firstX; gx <= xDomain[1]; gx += xStep) {
      const { x: sx } = worldToScreen(gx, 0);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
      ctx.stroke();

      if (Math.abs(gx) > 1e-6) {
        const axisY = Math.max(14, Math.min(H - 6, worldToScreen(0, 0).y + 13));
        ctx.fillText(formatNum(gx), sx - 8, axisY);
      }
    }

    const firstY = Math.ceil(yDomain[0] / yStep) * yStep;
    for (let gy = firstY; gy <= yDomain[1]; gy += yStep) {
      const { y: sy } = worldToScreen(0, gy);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
      ctx.stroke();

      if (Math.abs(gy) > 1e-6) {
        const axisX = Math.max(6, Math.min(W - 30, worldToScreen(0, 0).x + 6));
        ctx.fillText(formatNum(gy), axisX, sy + 3);
      }
    }

    // 2. Principal Axes (x = 0 and y = 0)
    const origin = worldToScreen(0, 0);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
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

    // 3. Plot each curve
    const allFeaturePoints = [...customPoints];

    compiledCurves.forEach((curve) => {
      ctx.strokeStyle = curve.color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();

      let penDown = false;
      let prevSy = null;

      for (let px = 0; px <= W; px += 1.5) {
        const { x: wx } = screenToWorld(px, 0);
        const wy = curve.fn(wx);

        if (Number.isFinite(wy)) {
          const { y: sy } = worldToScreen(wx, wy);
          // Avoid drawing vertical lines across asymptote discontinuities
          if (prevSy !== null && Math.abs(sy - prevSy) > H * 1.4) {
            penDown = false;
          }
          if (sy >= -H && sy <= 2 * H) {
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

      curve.autoFeatures.forEach(pt => allFeaturePoints.push({ ...pt, color: curve.color }));
    });

    // 4. Draw key feature points (roots, vertices, intercepts, custom points)
    allFeaturePoints.forEach((pt) => {
      const { x: sx, y: sy } = worldToScreen(pt.x, pt.y);
      if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) return;

      ctx.fillStyle = pt.color || '#facc15';
      ctx.beginPath();
      ctx.arc(sx, sy, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0c111d';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (pt.label) {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '10.5px Inter, sans-serif';
        ctx.fillText(pt.label, sx + 7, sy - 6);
      }
    });

    // 5. Hover crosshair & snap-to-curve point
    if (hoverMouse) {
      const { x: wx } = screenToWorld(hoverMouse.x, hoverMouse.y);
      let bestSnap = null;
      let bestDist = Infinity;

      // Snap to special feature point first if close
      allFeaturePoints.forEach((pt) => {
        const s = worldToScreen(pt.x, pt.y);
        const d = Math.hypot(s.x - hoverMouse.x, s.y - hoverMouse.y);
        if (d < 16 && d < bestDist) {
          bestDist = d;
          bestSnap = { wx: pt.x, wy: pt.y, sx: s.x, sy: s.y, label: pt.label || `(${formatNum(pt.x)}, ${formatNum(pt.y)})`, color: pt.color || '#facc15' };
        }
      });

      // Otherwise snap to nearest curve at cursor x
      if (!bestSnap) {
        compiledCurves.forEach((curve) => {
          const wy = curve.fn(wx);
          if (Number.isFinite(wy)) {
            const s = worldToScreen(wx, wy);
            const d = Math.abs(s.y - hoverMouse.y);
            if (d < 45 && d < bestDist) {
              bestDist = d;
              bestSnap = { wx, wy, sx: s.x, sy: s.y, label: `(${formatNum(wx)}, ${formatNum(wy)})`, color: curve.color };
            }
          }
        });
      }

      if (bestSnap) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(bestSnap.sx, 0);
        ctx.lineTo(bestSnap.sx, H);
        ctx.moveTo(0, bestSnap.sy);
        ctx.lineTo(W, bestSnap.sy);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = bestSnap.color;
        ctx.beginPath();
        ctx.arc(bestSnap.sx, bestSnap.sy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        tooltip.hidden = false;
        tooltip.textContent = bestSnap.label;
        tooltip.style.left = `${Math.min(W - 120, Math.max(8, bestSnap.sx + 10))}px`;
        tooltip.style.top = `${Math.max(8, bestSnap.sy - 28)}px`;
      } else {
        tooltip.hidden = true;
      }
    } else {
      tooltip.hidden = true;
    }
  }

  function zoomByFactor(factor, centerWx = 0.5 * (xDomain[0] + xDomain[1]), centerWy = 0.5 * (yDomain[0] + yDomain[1])) {
    const newXSpan = Math.max(0.5, Math.min(200, (xDomain[1] - xDomain[0]) * factor));
    const newYSpan = Math.max(0.5, Math.min(200, (yDomain[1] - yDomain[0]) * factor));
    xDomain = [centerWx - 0.5 * newXSpan, centerWx + 0.5 * newXSpan];
    yDomain = [centerWy - 0.5 * newYSpan, centerWy + 0.5 * newYSpan];
    rebuildCompiledCurves();
    drawGraph();
  }

  // Toolbar button events
  header.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (action === 'zoom-in') zoomByFactor(0.75);
      else if (action === 'zoom-out') zoomByFactor(1.33);
      else if (action === 'reset') {
        xDomain = [...defaultXDomain];
        yDomain = [...defaultYDomain];
        rebuildCompiledCurves();
        drawGraph();
      }
    });
  });

  // Mouse pan & hover events
  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = canvas.getBoundingClientRect();
    dragStart = {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
      xDomain: [...xDomain],
      yDomain: [...yDomain]
    };
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      rebuildCompiledCurves();
      drawGraph();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (isDragging) {
      const dxWorld = ((sx - dragStart.x) / canvas.width) * (dragStart.xDomain[1] - dragStart.xDomain[0]);
      const dyWorld = ((sy - dragStart.y) / canvas.height) * (dragStart.yDomain[1] - dragStart.yDomain[0]);
      xDomain = [dragStart.xDomain[0] - dxWorld, dragStart.xDomain[1] - dxWorld];
      yDomain = [dragStart.yDomain[0] + dyWorld, dragStart.yDomain[1] + dyWorld];
      hoverMouse = null;
      drawGraph();
      return;
    }

    hoverMouse = { x: sx, y: sy };
    drawGraph();
  });

  canvas.addEventListener('mouseleave', () => {
    hoverMouse = null;
    drawGraph();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
    const center = screenToWorld(sx, sy);
    const factor = e.deltaY < 0 ? 0.85 : 1.18;
    zoomByFactor(factor, center.x, center.y);
  }, { passive: false });

  rebuildCompiledCurves();
  drawGraph();

  return wrapper;
}
