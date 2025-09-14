(() => {
  const canvas = document.getElementById('plane');
  const ctx = canvas.getContext('2d');

  // UI elements
  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const ppuInput = document.getElementById('ppu');
  const gridStepSelect = document.getElementById('gridStep');

  const vertexColorInput = document.getElementById('vertexColor');
  const vertexSizeInput = document.getElementById('vertexSize');
  const clearVerticesBtn = document.getElementById('clearVertices');
  const deleteSelectedBtn = document.getElementById('deleteSelected');

  const lineColorInput = document.getElementById('lineColor');
  const lineWidthInput = document.getElementById('lineWidth');
  const connectSelectedBtn = document.getElementById('connectSelected');
  const clearLinesBtn = document.getElementById('clearLines');
  const closeLoopChk = document.getElementById('closeLoop');

  const clearAllBtn = document.getElementById('clearAll');
  const undoBtn = document.getElementById('undoBtn');
  const vertexListEl = document.getElementById('vertexList');

  // Reflection UI elements
  const reflectBtn = document.getElementById('reflectBtn');
  const modeHint = document.getElementById('modeHint');

  // Rotation UI elements
  const rotateBtn = document.getElementById('rotateBtn');
  const rotateAngleInput = document.getElementById('rotateAngle');
  const rotateDirSelect = document.getElementById('rotateDir');
  const rotateHint = document.getElementById('rotateHint');

  // Translation UI elements
  const translateBtn = document.getElementById('translateBtn');
  const translateDxInput = document.getElementById('translateDx');
  const translateDyInput = document.getElementById('translateDy');
  const translateApplyBtn = document.getElementById('translateApply');
  const translateHint = document.getElementById('translateHint');

  // Image UI elements
  const addImageBtn = document.getElementById('addImageBtn');
  const clearImagesBtn = document.getElementById('clearImages');
  const imageModal = document.getElementById('imageModal');
  const closeImageModalBtn = document.getElementById('closeImageModal');

  // Coordinate system state
  let pixelsPerUnit = clamp(parseFloat(ppuInput.value) || 50, 5, 400);
  let gridStepUnits = parseFloat(gridStepSelect.value) || 1; // grid line spacing in world units

  // origin (0,0) position on canvas in pixels
  let origin = { x: canvas.width / 2, y: canvas.height / 2 };

  // Data models
  let nextVertexId = 1;
  let selectionCounter = 1; // for ordering selected vertices
  const vertices = []; // {id, x, y, color, size, selected, selectedAt, label, imageId?, localX?, localY?}
  const lines = [];    // {aId, bId, color, width}
  // Images model
  let nextImageId = 1;
  const images = []; // {id, src, x, y, w, h, rot, scale, selected}
  const imageCache = new Map(); // src -> HTMLImageElement (loaded)
  let placeImageMode = null; // { filename }

  // Reflection state and animation
  const reflect = {
    active: false,
    p1: null,      // first point in world coords
    preview: null, // current mouse world pos when picking second point
    fade: null     // {a:{x,y}, b:{x,y}, start:number, duration:number}
  };

  // Rotation state and animation
  const rotate = {
    active: false,
    pivot: null,        // {x,y} rotation center in world coords
    startVec: null,     // vector from pivot to initial mouse position when starting drag
    previewAngle: 0,    // radians; positive is CCW
    isRotating: false,
    fade: null          // {pivot:{x,y}, from:number, to:number, start:number, duration:number}
  };

  // Translation state and animation
  const translate = {
    active: false,
    start: null,            // {x,y} start point in world coords
    previewOffset: { x: 0, y: 0 },
    isTranslating: false,
    fade: null              // {from:{x,y}, to:{x,y}, start:number, duration:number}
  };

  // History (undo) stack
  const history = [];
  function makeSnapshot() {
    return {
      vertices: vertices.map(v => ({...v})),
      lines: lines.map(l => ({...l})),
      images: images.map(im => ({...im})),
      nextVertexId,
      nextImageId,
      selectionCounter
    };
  }
  function restoreFromSnapshot(snap) {
    vertices.length = 0;
    for (const v of (snap.vertices || [])) vertices.push({...v});
    lines.length = 0;
    for (const l of (snap.lines || [])) lines.push({...l});
    images.length = 0;
    for (const im of (snap.images || [])) images.push({...im});
    nextVertexId = snap.nextVertexId || 1;
    nextImageId = snap.nextImageId || 1;
    selectionCounter = snap.selectionCounter || 1;
  }
  function canUndo() { return history.length > 1; }
  function updateUndoButton() { if (undoBtn) undoBtn.disabled = !canUndo(); }
  function pushHistory() { history.push(makeSnapshot()); updateUndoButton(); }
  function undo() {
    if (!canUndo()) return;
    history.pop();
    const prev = history[history.length - 1];
    restoreFromSnapshot(prev);
    draw();
    updateUndoButton();
  }

  // Resize handler to match canvas backing store to its CSS size
  function fitCanvasToDisplay() {
    const rect = canvas.getBoundingClientRect();
    const prevCenterWorld = screenToWorld({ x: rect.width / 2, y: rect.height / 2 });
    canvas.width = Math.max(300, Math.floor(rect.width));
    canvas.height = Math.max(300, Math.floor(rect.height));
    // Keep origin so that world center remains at canvas center after resize
    const newRect = { width: canvas.width, height: canvas.height };
    const newCenterScreen = { x: newRect.width / 2, y: newRect.height / 2 };
    const worldCenterScreen = worldToScreen(prevCenterWorld);
    const dx = newCenterScreen.x - worldCenterScreen.x;
    const dy = newCenterScreen.y - worldCenterScreen.y;
    origin.x += dx;
    origin.y += dy;
    draw();
  }

  window.addEventListener('resize', fitCanvasToDisplay);
  // initial size match (in case CSS scales it)
  setTimeout(fitCanvasToDisplay, 0);

  // Utils
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // Snap a world-space point to nearest grid intersection based on gridStepUnits
  function snapToGrid(p) {
    const step = gridStepUnits || 1;
    function snapVal(v) {
      // use rounding and limit floating drift
      const snapped = Math.round(v / step) * step;
      // fix -0 to 0 and reduce tiny epsilons
      const fixed = Math.abs(snapped) < 1e-10 ? 0 : parseFloat(snapped.toFixed(10));
      return fixed;
    }
    return { x: snapVal(p.x), y: snapVal(p.y) };
  }

  function worldToScreen(p) {
    return {
      x: origin.x + p.x * pixelsPerUnit,
      y: origin.y - p.y * pixelsPerUnit,
    };
  }

  function screenToWorld(p) {
    return {
      x: (p.x - origin.x) / pixelsPerUnit,
      y: (origin.y - p.y) / pixelsPerUnit,
    };
  }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawGrid() {
    const w = canvas.width;
    const h = canvas.height;

    // Base background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const stepPx = gridStepUnits * pixelsPerUnit;
    const leftWorld = screenToWorld({ x: 0, y: 0 }).x;
    const rightWorld = screenToWorld({ x: w, y: 0 }).x;
    const topWorld = screenToWorld({ x: 0, y: 0 }).y;
    const bottomWorld = screenToWorld({ x: 0, y: h }).y;

    const startX = Math.floor(leftWorld / gridStepUnits) * gridStepUnits;
    const endX = Math.ceil(rightWorld / gridStepUnits) * gridStepUnits;
    const startY = Math.floor(bottomWorld / gridStepUnits) * gridStepUnits;
    const endY = Math.ceil(topWorld / gridStepUnits) * gridStepUnits;

    // Grid lines
    ctx.lineWidth = 1;

    // Minor grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridStepUnits) {
      const sx = worldToScreen({ x, y: 0 }).x;
      ctx.moveTo(sx + 0.5, 0);
      ctx.lineTo(sx + 0.5, h);
    }
    for (let y = startY; y <= endY; y += gridStepUnits) {
      const sy = worldToScreen({ x: 0, y }).y;
      ctx.moveTo(0, sy + 0.5);
      ctx.lineTo(w, sy + 0.5);
    }
    ctx.stroke();

    // Emphasize every 5th line
    const emphasizeEvery = 5;
    ctx.strokeStyle = '#c5ccd6';
    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridStepUnits) {
      if (Math.round(x / gridStepUnits) % emphasizeEvery !== 0) continue;
      const sx = worldToScreen({ x, y: 0 }).x;
      ctx.moveTo(sx + 0.5, 0);
      ctx.lineTo(sx + 0.5, h);
    }
    for (let y = startY; y <= endY; y += gridStepUnits) {
      if (Math.round(y / gridStepUnits) % emphasizeEvery !== 0) continue;
      const sy = worldToScreen({ x: 0, y }).y;
      ctx.moveTo(0, sy + 0.5);
      ctx.lineTo(w, sy + 0.5);
    }
    ctx.stroke();

    // Axes
    ctx.strokeStyle = '#37474f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // x-axis
    const xAxisY = worldToScreen({ x: 0, y: 0 }).y + 0.5;
    ctx.moveTo(0, xAxisY);
    ctx.lineTo(w, xAxisY);
    // y-axis
    const yAxisX = worldToScreen({ x: 0, y: 0 }).x + 0.5;
    ctx.moveTo(yAxisX, 0);
    ctx.lineTo(yAxisX, h);
    ctx.stroke();

    // Ticks and labels
    ctx.fillStyle = '#455a64';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const tickLen = 6;

    for (let x = startX; x <= endX; x += gridStepUnits) {
      if (Math.abs(x) < 1e-8) continue; // skip origin tick on x-axis
      const p = worldToScreen({ x, y: 0 });
      ctx.beginPath();
      ctx.moveTo(p.x + 0.5, xAxisY - tickLen);
      ctx.lineTo(p.x + 0.5, xAxisY + tickLen);
      ctx.strokeStyle = '#607d8b';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (pixelsPerUnit >= 25) ctx.fillText(formatNumber(x), p.x, xAxisY + tickLen + 2);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let y = startY; y <= endY; y += gridStepUnits) {
      if (Math.abs(y) < 1e-8) continue; // skip origin tick on y-axis
      const p = worldToScreen({ x: 0, y });
      ctx.beginPath();
      ctx.moveTo(yAxisX - tickLen, p.y + 0.5);
      ctx.lineTo(yAxisX + tickLen, p.y + 0.5);
      ctx.strokeStyle = '#607d8b';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (pixelsPerUnit >= 25) ctx.fillText(formatNumber(y), yAxisX + tickLen + 3, p.y);
    }
  }

  function formatNumber(n) {
    // Avoid long floats
    const s = Math.abs(n) < 1e-8 ? '0' : n.toFixed(6);
    return parseFloat(s).toString();
  }

  // Label helpers
  const BASE_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function defaultLabelForId(id) {
    if (id <= BASE_LABELS.length) return BASE_LABELS[id - 1];
    const zeroBased = id - 1;
    const letter = BASE_LABELS[zeroBased % BASE_LABELS.length];
    const tier = Math.floor(zeroBased / BASE_LABELS.length); // 1 for 27..52, etc.
    return letter + tier;
  }
  function sanitizeLabel(s) {
    if (s == null) return '';
    s = String(s).slice(0, 20);
    return s.replace(/\s+/g, ' ').trim();
  }

  function drawVertices() {
    for (const v of vertices) {
      const p = worldToScreen(v);
      const r = v.size;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = v.color;
      ctx.fill();
      // outline for visibility
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#33333310';
      ctx.stroke();

      if (v.selected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffd600';
        ctx.stroke();
      }

      // Draw vertex label next to the point
      const label = v.label || defaultLabelForId(v.id);
      if (label) {
        const lx = p.x + r + 6;
        const ly = p.y - r - 6; // slightly above-right
        ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        // white halo for contrast
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillText(label, lx, ly);
      }
    }
  }

  function drawLines() {
    for (const ln of lines) {
      const a = vertices.find(v => v.id === ln.aId);
      const b = vertices.find(v => v.id === ln.bId);
      if (!a || !b) continue;
      const pa = worldToScreen(a);
      const pb = worldToScreen(b);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.strokeStyle = ln.color;
      ctx.lineWidth = ln.width;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  // Draw a world-space line with optional dash and alpha
  function drawStyledWorldLine(a, b, color = '#333', width = 2, dash = null, alpha = 1) {
    const pa = worldToScreen(a);
    const pb = worldToScreen(b);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash && dash.length) ctx.setLineDash(dash);
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawReflectionOverlay() {
    // Active picking preview
    if (reflect.active) {
      if (reflect.p1 && reflect.preview) {
        drawStyledWorldLine(reflect.p1, reflect.preview, '#2e7d32', 2, [8,6], 0.85);
      }
    }
    // Fading line after commit
    if (reflect.fade) {
      const { a, b, start, duration } = reflect.fade;
      const now = performance.now();
      const t = Math.min(1, (now - start) / duration);
      const alpha = 1 - t;
      if (alpha > 0) {
        drawStyledWorldLine(a, b, '#2e7d32', 3, [4,4], alpha);
        // continue animation
        requestAnimationFrame(() => draw());
      } else {
        reflect.fade = null;
      }
    }
  }

  // --- Reflection logic ---
  function reflectPointAcrossLine(P, A, B) {
    const abx = B.x - A.x, aby = B.y - A.y;
    const len2 = abx*abx + aby*aby;
    if (len2 < 1e-12) return { x: P.x, y: P.y };
    const apx = P.x - A.x, apy = P.y - A.y;
    const t = (apx * abx + apy * aby) / len2;
    const projx = A.x + abx * t;
    const projy = A.y + aby * t;
    return { x: 2 * projx - P.x, y: 2 * projy - P.y };
  }

  function performReflectionAcrossLine(A, B) {
    // Duplicate selected vertices and corresponding lines; keep originals
    const selected = vertices.filter(v => v.selected);
    if (selected.length === 0) return;

    // Map old vertex id -> new vertex id
    const idMap = new Map();

    // First, create reflected vertices
    for (const v of selected) {
      const rp = reflectPointAcrossLine({ x: v.x, y: v.y }, A, B);
      const sp = snapToGrid(rp);
      const id = nextVertexId++;
      const newV = {
        id,
        x: sp.x,
        y: sp.y,
        color: v.color,
        size: v.size,
        selected: false,
        selectedAt: undefined,
        label: defaultLabelForId(id),
      };
      vertices.push(newV);
      idMap.set(v.id, id);
    }

    // Then, duplicate lines where both endpoints were selected
    for (const ln of lines.slice()) {
      if (idMap.has(ln.aId) && idMap.has(ln.bId)) {
        const aNew = idMap.get(ln.aId);
        const bNew = idMap.get(ln.bId);
        // No need to check duplicates as new vertex ids are unique, but keep guard for safety
        if (!lineExists(aNew, bNew)) {
          lines.push({ aId: aNew, bId: bNew, color: ln.color, width: ln.width });
        }
      }
    }

    draw();
    pushHistory();
  }

  function updateReflectUi() {
    if (reflectBtn) {
      if (reflect.active) {
        reflectBtn.classList.add('active');
        reflectBtn.textContent = 'Cancel reflect';
      } else {
        reflectBtn.classList.remove('active');
        reflectBtn.textContent = 'Reflect';
      }
    }
    if (modeHint) modeHint.style.display = reflect.active ? '' : 'none';
  }

  function startReflectMode() {
    reflect.active = true;
    reflect.p1 = null;
    reflect.preview = null;
    updateReflectUi();
    draw();
  }
  function cancelReflectMode() {
    reflect.active = false;
    reflect.p1 = null;
    reflect.preview = null;
    updateReflectUi();
    draw();
  }

  // --- Rotation helpers and logic ---
  function rotVec(v, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  }
  function rotatePointAround(P, O, ang) {
    const vx = P.x - O.x, vy = P.y - O.y;
    const c = Math.cos(ang), s = Math.sin(ang);
    const rx = vx * c - vy * s;
    const ry = vx * s + vy * c;
    return { x: parseFloat((O.x + rx).toFixed(10)), y: parseFloat((O.y + ry).toFixed(10)) };
  }
  function performRotationAroundPoint(O, ang) {
    const selected = vertices.filter(v => v.selected);
    if (selected.length === 0) return;
    const idMap = new Map();
    for (const v of selected) {
      const rp = rotatePointAround(v, O, ang);
      const sp = snapToGrid(rp);
      const id = nextVertexId++;
      const newV = {
        id,
        x: sp.x,
        y: sp.y,
        color: v.color,
        size: v.size,
        selected: false,
        selectedAt: undefined,
        label: defaultLabelForId(id),
      };
      vertices.push(newV);
      idMap.set(v.id, id);
    }
    for (const ln of lines.slice()) {
      if (idMap.has(ln.aId) && idMap.has(ln.bId)) {
        const aNew = idMap.get(ln.aId);
        const bNew = idMap.get(ln.bId);
        if (!lineExists(aNew, bNew)) {
          lines.push({ aId: aNew, bId: bNew, color: ln.color, width: ln.width });
        }
      }
    }
    draw();
    pushHistory();
  }

  function drawRotationOverlay() {
    // Active rotation preview
    if (rotate.active && rotate.pivot) {
      // draw pivot marker (crosshair)
      const ps = worldToScreen(rotate.pivot);
      ctx.save();
      ctx.strokeStyle = '#6a1b9a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ps.x - 6, ps.y);
      ctx.lineTo(ps.x + 6, ps.y);
      ctx.moveTo(ps.x, ps.y - 6);
      ctx.lineTo(ps.x, ps.y + 6);
      ctx.stroke();
      ctx.restore();

      if (rotate.startVec) {
        const v0 = rotate.startVec;
        const v1 = rotVec(v0, rotate.previewAngle);
        const a = { x: rotate.pivot.x + v0.x, y: rotate.pivot.y + v0.y };
        const b = { x: rotate.pivot.x + v1.x, y: rotate.pivot.y + v1.y };
        // base ray (dashed)
        drawStyledWorldLine(rotate.pivot, a, '#6a1b9a', 2, [6,4], 0.75);
        // rotated ray (solid)
        drawStyledWorldLine(rotate.pivot, b, '#6a1b9a', 3, null, 0.95);
        // angle label near pivot
        const deg = (Math.abs(rotate.previewAngle) * 180 / Math.PI).toFixed(1);
        const label = `${deg}° ${rotate.previewAngle >= 0 ? 'CCW' : 'CW'}`;
        ctx.save();
        ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#311b92';
        ctx.fillText(label, ps.x + 8, ps.y + 8);
        ctx.restore();
      }
    }

    // Simple fade placeholder (optional)
    if (rotate.fade) {
      const { pivot, start, duration } = rotate.fade;
      const now = performance.now();
      const t = Math.min(1, (now - start) / duration);
      const alpha = 1 - t;
      if (alpha > 0) {
        const ps = worldToScreen(pivot);
        ctx.save();
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = '#6a1b9a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ps.x, ps.y, 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        requestAnimationFrame(() => draw());
      } else {
        rotate.fade = null;
      }
    }
  }

  function updateRotateUi() {
    if (rotateBtn) {
      if (rotate.active) {
        rotateBtn.classList.add('active');
        rotateBtn.textContent = 'Cancel rotate';
      } else {
        rotateBtn.classList.remove('active');
        rotateBtn.textContent = 'Rotate';
      }
    }
    if (rotateHint) rotateHint.style.display = rotate.active ? '' : 'none';
    // angle input reflects current preview if present
    if (rotateAngleInput && rotateDirSelect) {
      const deg = Math.abs(rotate.previewAngle || 0) * 180 / Math.PI;
      if (!isNaN(deg)) rotateAngleInput.value = (Math.round(deg * 10) / 10).toString();
      rotateDirSelect.value = (rotate.previewAngle || 0) >= 0 ? 'ccw' : 'cw';
    }
  }

  function startRotateMode() {
    rotate.active = true;
    rotate.pivot = null;
    rotate.startVec = null;
    rotate.previewAngle = 0;
    rotate.isRotating = false;
    updateRotateUi();
    draw();
  }
  function cancelRotateMode() {
    rotate.active = false;
    rotate.pivot = null;
    rotate.startVec = null;
    rotate.previewAngle = 0;
    rotate.isRotating = false;
    updateRotateUi();
    draw();
  }

  // --- Translation helpers and logic ---
  function performTranslationByOffset(dx, dy) {
    const selected = vertices.filter(v => v.selected);
    if (selected.length === 0) return;
    const idMap = new Map();
    for (const v of selected) {
      const tp = snapToGrid({ x: v.x + dx, y: v.y + dy });
      const id = nextVertexId++;
      const newV = {
        id,
        x: tp.x,
        y: tp.y,
        color: v.color,
        size: v.size,
        selected: false,
        selectedAt: undefined,
        label: defaultLabelForId(id),
      };
      vertices.push(newV);
      idMap.set(v.id, id);
    }
    // Duplicate connecting lines where both endpoints were selected
    for (const ln of lines.slice()) {
      if (idMap.has(ln.aId) && idMap.has(ln.bId)) {
        const aNew = idMap.get(ln.aId);
        const bNew = idMap.get(ln.bId);
        if (!lineExists(aNew, bNew)) {
          lines.push({ aId: aNew, bId: bNew, color: ln.color, width: ln.width });
        }
      }
    }
    draw();
    pushHistory();
  }

  function drawTranslationOverlay() {
    // Active drag preview
    if (translate.active && translate.isTranslating && translate.start) {
      const a = translate.start;
      const b = { x: a.x + (translate.previewOffset.x || 0), y: a.y + (translate.previewOffset.y || 0) };
      drawStyledWorldLine(a, b, '#f57c00', 3, null, 0.95);
      const ps = worldToScreen(b);
      ctx.save();
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#e65100';
      const dx = formatNumber(translate.previewOffset.x || 0);
      const dy = formatNumber(translate.previewOffset.y || 0);
      ctx.fillText(`dx=${dx}, dy=${dy}`, ps.x + 6, ps.y + 6);
      ctx.restore();
    }
    // Fade after commit
    if (translate.fade) {
      const { from, to, start, duration } = translate.fade;
      const now = performance.now();
      const t = Math.min(1, (now - start) / duration);
      const alpha = 1 - t;
      if (alpha > 0) {
        drawStyledWorldLine(from, to, '#f57c00', 3, [6,4], alpha);
        requestAnimationFrame(() => draw());
      } else {
        translate.fade = null;
      }
    }
  }

  function updateTranslateUi() {
    if (translateBtn) {
      if (translate.active) {
        translateBtn.classList.add('active');
        translateBtn.textContent = 'Cancel translate';
      } else {
        translateBtn.classList.remove('active');
        translateBtn.textContent = 'Translate';
      }
    }
    if (translateHint) translateHint.style.display = translate.active ? '' : 'none';
  }

  function startTranslateMode() {
    translate.active = true;
    translate.start = null;
    translate.previewOffset = { x: 0, y: 0 };
    translate.isTranslating = false;
    updateTranslateUi();
    draw();
  }
  function cancelTranslateMode() {
    translate.active = false;
    translate.start = null;
    translate.previewOffset = { x: 0, y: 0 };
    translate.isTranslating = false;
    updateTranslateUi();
    draw();
  }

  // --- Image helpers and rendering ---
  function getOrLoadImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    const img = new Image();
    img.src = (src.startsWith('http') || src.startsWith('/')) ? src : (document.baseURI.replace(/\/$/, '') + '/static/' + src);
    imageCache.set(src, img);
    return img;
  }

  function drawImages() {
    for (const im of images) {
      const imgEl = getOrLoadImage(im.src);
      // If intrinsic ratio not applied yet, adjust h to preserve aspect, keeping width
      if (imgEl.naturalWidth && imgEl.naturalHeight) {
        const ratio = imgEl.naturalHeight / imgEl.naturalWidth;
        if (!im._intrinsicApplied) {
          im.h = im.h != null ? im.h : (im.w != null ? im.w * ratio : 6 * ratio);
          im.w = im.w != null ? im.w : 6;
          im._intrinsicApplied = true;
        }
      } else {
        // defaults
        if (im.w == null) im.w = 6;
        if (im.h == null) im.h = 6;
      }
      const s = pixelsPerUnit * (im.scale || 1);
      const center = worldToScreen({ x: im.x, y: im.y });
      const wpx = (im.w || 6) * s;
      const hpx = (im.h || 6) * s;
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(-(im.rot || 0));
      ctx.globalAlpha = 1.0;
      if (imgEl.complete && imgEl.naturalWidth) {
        ctx.drawImage(imgEl, -wpx / 2, -hpx / 2, wpx, hpx);
      } else {
        // placeholder
        ctx.fillStyle = '#eee';
        ctx.fillRect(-wpx/2, -hpx/2, wpx, hpx);
        ctx.strokeStyle = '#ccc';
        ctx.strokeRect(-wpx/2, -hpx/2, wpx, hpx);
        imgEl.onload = () => { draw(); };
      }
      // selection outline
      if (im.selected) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffd600';
        ctx.strokeRect(-wpx/2, -hpx/2, wpx, hpx);
      }
      ctx.restore();
    }
  }

  function imageContainsPoint(im, ms) {
    const s = pixelsPerUnit * (im.scale || 1);
    const center = worldToScreen({ x: im.x, y: im.y });
    const dx = ms.x - center.x;
    const dy = ms.y - center.y;
    const ang = im.rot || 0;
    // rotate screen delta by +ang to align with image axes (inverse of drawing rotation)
    const c = Math.cos(ang), sgn = Math.sin(ang);
    const lx = dx * c - dy * sgn;
    const ly = dx * sgn + dy * c;
    const wpx = (im.w || 6) * s;
    const hpx = (im.h || 6) * s;
    return Math.abs(lx) <= wpx/2 && Math.abs(ly) <= hpx/2;
  }

  function hitTestImage(ms) {
    // topmost first: last drawn is last in array, so iterate from end
    for (let i = images.length - 1; i >= 0; i--) {
      const im = images[i];
      if (imageContainsPoint(im, ms)) return im;
    }
    return null;
  }

  function getImageScreenAABB(im) {
    const s = pixelsPerUnit * (im.scale || 1);
    const wpx = (im.w || 6) * s;
    const hpx = (im.h || 6) * s;
    const center = worldToScreen({ x: im.x, y: im.y });
    const ang = im.rot || 0;
    const corners = [
      { x: -wpx/2, y: -hpx/2 },
      { x:  wpx/2, y: -hpx/2 },
      { x:  wpx/2, y:  hpx/2 },
      { x: -wpx/2, y:  hpx/2 },
    ].map(p => ({ x: center.x + p.x * Math.cos(-ang) - p.y * Math.sin(-ang), y: center.y + p.x * Math.sin(-ang) + p.y * Math.cos(-ang) }));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of corners) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  function attachVertexToImage(v, im, worldPoint) {
    // compute local (pre-scale) coords
    const dx = worldPoint.x - im.x;
    const dy = worldPoint.y - im.y;
    const ang = im.rot || 0;
    const c = Math.cos(-ang), s = Math.sin(-ang);
    const lx = (dx * c - dy * s) / (im.scale || 1);
    const ly = (dx * s + dy * c) / (im.scale || 1);
    v.imageId = im.id;
    v.localX = parseFloat(lx.toFixed(10));
    v.localY = parseFloat(ly.toFixed(10));
  }

  function updateAttachedVerticesForImage(im) {
    const ang = im.rot || 0;
    const c = Math.cos(ang), s = Math.sin(ang);
    const scale = im.scale || 1;
    for (const v of vertices) {
      if (v.imageId === im.id && typeof v.localX === 'number' && typeof v.localY === 'number') {
        const lx = v.localX * scale;
        const ly = v.localY * scale;
        const wx = im.x + (lx * c - ly * s);
        const wy = im.y + (lx * s + ly * c);
        v.x = parseFloat(wx.toFixed(10));
        v.y = parseFloat(wy.toFixed(10));
      }
    }
  }

  function draw() {
    clear();
    drawGrid();
    drawImages();
    drawLines();
    drawVertices();
    drawReflectionOverlay();
    drawRotationOverlay();
    drawTranslationOverlay();
    drawSelectionRectOverlay();
    updateSidebar();
  }

  function updateSidebar() {
    if (!vertexListEl) return;
    const parts = [];
    for (const v of vertices) {
      const label = sanitizeLabel(v.label || defaultLabelForId(v.id));
      const coord = `(${formatNumber(v.x)}, ${formatNumber(v.y)})`;
      const selectedCls = v.selected ? ' selected' : '';
      parts.push(
        `<li class="vertex-item${selectedCls}" data-id="${v.id}">` +
          `<div class="vertex-label"><input type="text" value="${escapeHtml(label)}" aria-label="Label for vertex ${v.id}"></div>` +
          `<div class="vertex-coord">${escapeHtml(coord)}</div>` +
        `</li>`
      );
    }
    vertexListEl.innerHTML = parts.join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Interaction helpers
  function getMousePos(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (canvas.width / rect.width),
      y: (evt.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function hitTestVertex(mouseScreen) {
    // Return nearest vertex within hit radius, else null
    let best = null;
    let bestDist2 = Infinity;
    for (const v of vertices) {
      const p = worldToScreen(v);
      const dx = p.x - mouseScreen.x;
      const dy = p.y - mouseScreen.y;
      const r = Math.max(8, v.size + 4);
      const d2 = dx*dx + dy*dy;
      if (d2 <= r*r && d2 < bestDist2) {
        best = v; bestDist2 = d2;
      }
    }
    return best;
  }

  // Mouse interaction and dragging vertices
  let isDragging = false;
  let dragVertex = null;
  let dragOffsetWorld = { x: 0, y: 0 };
  let dragMoved = false;
  let suppressNextClick = false;
  // Group-drag state
  let isGroupDrag = false;
  let groupDragStartPositions = null; // Map of vertexId -> {x,y}
  let dragStartPos = null; // starting position of the dragged vertex

  // Image dragging state
  let isDraggingImage = false;
  let dragImage = null;
  let dragImageOffsetWorld = { x: 0, y: 0 };
  let imageDragMoved = false;

  // Rectangle selection (click-drag selection box)
  const RECT_ACTIVATE_DIST = 3; // pixels
  let rectSelectPending = false; // waiting for small movement to start selection box
  let isRectSelecting = false;
  let rectStart = null;    // screen coords {x,y}
  let rectCurrent = null;  // screen coords {x,y}
  let rectMode = 'replace'; // 'replace' | 'add' | 'toggle'
  let rectMoved = false;

  // Pan mode (hold Space to pan)
  let isPanning = false;
  let isSpacePan = false;
  let panMoved = false;
  let lastMousePos = null;

  // Drag start / Pan start
  canvas.addEventListener('mousedown', (evt) => {
    if (evt.button !== 0) return; // left button only
    const ms = getMousePos(evt);

    // If Space is held, start panning instead of vertex drag
    if (isSpacePan) {
      isPanning = true;
      lastMousePos = ms;
      panMoved = false;
      canvas.style.cursor = 'grabbing';
      evt.preventDefault();
      return;
    }

    // Reflect mode handled via click listener; disable vertex drag while active
    if (reflect.active) { evt.preventDefault(); return; }

    // Rotate mode: first click picks pivot; second drag sets angle
    if (rotate.active) {
      const ms = getMousePos(evt);
      const mw = screenToWorld(ms);
      const pt = snapToGrid(mw);
      if (!rotate.pivot) {
        rotate.pivot = pt;
        rotate.startVec = null;
        rotate.previewAngle = 0;
        updateRotateUi();
        draw();
        suppressNextClick = true;
      } else {
        const vec = { x: pt.x - rotate.pivot.x, y: pt.y - rotate.pivot.y };
        const len2 = vec.x * vec.x + vec.y * vec.y;
        if (len2 >= 1e-12) {
          rotate.startVec = vec;
          rotate.previewAngle = 0;
          rotate.isRotating = true;
          suppressNextClick = true;
        }
      }
      evt.preventDefault();
      return;
    }

    // Translate mode: start translation drag from current mouse world pos
    if (translate.active) {
      const mw = screenToWorld(ms);
      const pt = snapToGrid(mw);
      translate.start = pt;
      translate.previewOffset = { x: 0, y: 0 };
      translate.isTranslating = true;
      suppressNextClick = true;
      evt.preventDefault();
      return;
    }

    const hit = hitTestVertex(ms);
    if (hit) {
      isDragging = true;
      dragVertex = hit;
      const mw = screenToWorld(ms);
      dragOffsetWorld = { x: hit.x - mw.x, y: hit.y - mw.y };
      dragStartPos = { x: hit.x, y: hit.y };
      // Determine if we should group-drag: only when the hit vertex is selected and there is at least one selected
      const selected = vertices.filter(v => v.selected);
      if (hit.selected && selected.length > 0) {
        isGroupDrag = true;
        groupDragStartPositions = new Map();
        for (const v of selected) {
          groupDragStartPositions.set(v.id, { x: v.x, y: v.y });
        }
      } else {
        isGroupDrag = false;
        groupDragStartPositions = null;
      }
      dragMoved = false;
      evt.preventDefault();
    } else {
      // If clicked over an image, start dragging that image instead of starting selection
      const hitIm = hitTestImage(ms);
      if (hitIm) {
        isDraggingImage = true;
        dragImage = hitIm;
        const mw = screenToWorld(ms);
        dragImageOffsetWorld = { x: hitIm.x - mw.x, y: hitIm.y - mw.y };
        imageDragMoved = false;
        // select this image exclusively
        for (const im of images) im.selected = (im === hitIm);
        draw();
        evt.preventDefault();
        return;
      }
      // Prepare rectangle selection; activate on small movement to not interfere with click-to-add
      rectSelectPending = true;
      isRectSelecting = false;
      rectStart = ms;
      rectCurrent = ms;
      rectMode = (evt.ctrlKey || evt.metaKey) ? 'toggle' : (evt.shiftKey ? 'add' : 'replace');
      rectMoved = false;
      // do not preventDefault here to allow click handler if no drag happens
    }
  });

  // Drag move / Pan move
  window.addEventListener('mousemove', (evt) => {
    // Update reflect preview while picking the second point
    if (reflect.active && reflect.p1 && !isPanning) {
      const ms = getMousePos(evt);
      const mw = screenToWorld(ms);
      reflect.preview = snapToGrid(mw);
      // Only redraw if not dragging/panning to avoid extra work
      if (!isDragging) draw();
    }
    // Update rotate preview while dragging
    if (rotate.active && rotate.isRotating && rotate.pivot && !isPanning) {
      const ms = getMousePos(evt);
      const mw = screenToWorld(ms);
      const vec = { x: mw.x - rotate.pivot.x, y: mw.y - rotate.pivot.y };
      const v0 = rotate.startVec;
      if (v0) {
        const a0 = Math.atan2(v0.y, v0.x);
        const a1 = Math.atan2(vec.y, vec.x);
        let ang = a1 - a0;
        // normalize to [-PI, PI] for stability
        if (ang > Math.PI) ang -= 2 * Math.PI;
        if (ang < -Math.PI) ang += 2 * Math.PI;
        rotate.previewAngle = ang;
        // Sync UI angle inputs
        updateRotateUi();
        draw();
      }
      evt.preventDefault();
      return;
    }
    // Update translate preview while dragging
    if (translate.active && translate.isTranslating && !isPanning) {
      const ms = getMousePos(evt);
      const mw = screenToWorld(ms);
      const curr = snapToGrid(mw);
      if (translate.start) {
        translate.previewOffset = { x: curr.x - translate.start.x, y: curr.y - translate.start.y };
        draw();
      }
      evt.preventDefault();
      return;
    }
    // Panning takes precedence when active
    if (isPanning) {
      const ms = getMousePos(evt);
      if (lastMousePos) {
        const dx = ms.x - lastMousePos.x;
        const dy = ms.y - lastMousePos.y;
        if (dx !== 0 || dy !== 0) {
          origin.x += dx;
          origin.y += dy;
          panMoved = true;
          draw();
        }
      }
      lastMousePos = ms;
      evt.preventDefault();
      return;
    }

    // Image dragging handling
    if (isDraggingImage && dragImage) {
      const ms = getMousePos(evt);
      const mw = screenToWorld(ms);
      const target = { x: mw.x + dragImageOffsetWorld.x, y: mw.y + dragImageOffsetWorld.y };
      const snapped = snapToGrid(target);
      if (snapped.x !== dragImage.x || snapped.y !== dragImage.y) {
        dragImage.x = snapped.x;
        dragImage.y = snapped.y;
        imageDragMoved = true;
        // Update any vertices attached to this image
        updateAttachedVerticesForImage(dragImage);
        draw();
      }
      evt.preventDefault();
      return;
    }

    // Rectangle selection handling
    if (rectSelectPending || isRectSelecting) {
      const ms = getMousePos(evt);
      // If pending, check if moved enough to activate
      if (rectSelectPending && !isRectSelecting) {
        const dx = ms.x - rectStart.x;
        const dy = ms.y - rectStart.y;
        if (Math.hypot(dx, dy) >= RECT_ACTIVATE_DIST) {
          isRectSelecting = true;
        }
      }
      if (isRectSelecting) {
        rectCurrent = ms;
        rectMoved = true;
        draw();
      }
      evt.preventDefault();
      return;
    }

    if (!isDragging || !dragVertex) return;
    const ms = getMousePos(evt);
    const mw = screenToWorld(ms);
    const target = { x: mw.x + dragOffsetWorld.x, y: mw.y + dragOffsetWorld.y };
    const snapped = snapToGrid(target);

    if (isGroupDrag && groupDragStartPositions && dragStartPos) {
      const dx = snapped.x - dragStartPos.x;
      const dy = snapped.y - dragStartPos.y;
      let anyChanged = false;
      for (const [id, start] of groupDragStartPositions.entries()) {
        const v = vertices.find(v => v.id === id);
        if (!v) continue;
        const newPos = snapToGrid({ x: start.x + dx, y: start.y + dy });
        if (newPos.x !== v.x || newPos.y !== v.y) {
          v.x = newPos.x;
          v.y = newPos.y;
          anyChanged = true;
        }
      }
      if (anyChanged) {
        dragMoved = true;
        draw(); // live update canvas and sidebar labels
      }
    } else {
      if (snapped.x !== dragVertex.x || snapped.y !== dragVertex.y) {
        dragVertex.x = snapped.x;
        dragVertex.y = snapped.y;
        dragMoved = true;
        draw(); // live update canvas and sidebar labels
      }
    }
    evt.preventDefault();
  });

  // Drag end / Pan end
  window.addEventListener('mouseup', (evt) => {
    // Commit rotation if rotating
    if (rotate.active && rotate.isRotating) {
      const ang = rotate.previewAngle || 0;
      if (Math.abs(ang) > 1e-12) {
        performRotationAroundPoint(rotate.pivot, ang);
        rotate.fade = { pivot: { ...rotate.pivot }, start: performance.now(), duration: 700 };
      }
      // reset
      rotate.active = false;
      rotate.pivot = null;
      rotate.startVec = null;
      rotate.previewAngle = 0;
      rotate.isRotating = false;
      updateRotateUi();
      draw();
      evt.preventDefault();
      return;
    }

    // Commit image drag if dragging image
    if (isDraggingImage && dragImage) {
      isDraggingImage = false;
      dragImage = null;
      if (imageDragMoved) {
        pushHistory();
        suppressNextClick = true;
      }
      imageDragMoved = false;
      evt.preventDefault();
      return;
    }
    // Commit translation if translating
    if (translate.active && translate.isTranslating) {
      const dx = translate.previewOffset.x || 0;
      const dy = translate.previewOffset.y || 0;
      if (Math.abs(dx) > 1e-12 || Math.abs(dy) > 1e-12) {
        performTranslationByOffset(dx, dy);
        if (translate.start) {
          translate.fade = { from: { ...translate.start }, to: { x: translate.start.x + dx, y: translate.start.y + dy }, start: performance.now(), duration: 700 };
        }
      }
      translate.active = false;
      translate.start = null;
      translate.previewOffset = { x: 0, y: 0 };
      translate.isTranslating = false;
      updateTranslateUi();
      draw();
      evt.preventDefault();
      return;
    }
    // End panning if active
    if (isPanning) {
      isPanning = false;
      lastMousePos = null;
      if (panMoved) {
        suppressNextClick = true; // prevent click actions after a pan drag
      }
      panMoved = false;
      canvas.style.cursor = isSpacePan ? 'grab' : '';
      evt.preventDefault();
      return;
    }

    // Finalize rectangle selection if active/pending
    if (isRectSelecting || rectSelectPending) {
      const ms = getMousePos(evt);
      if (isRectSelecting) {
        rectCurrent = ms;
      }
      if (rectMoved && rectStart && rectCurrent) {
        const minX = Math.min(rectStart.x, rectCurrent.x);
        const maxX = Math.max(rectStart.x, rectCurrent.x);
        const minY = Math.min(rectStart.y, rectCurrent.y);
        const maxY = Math.max(rectStart.y, rectCurrent.y);

        const inside = (v) => {
          const p = worldToScreen(v);
          return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
        };

        if (rectMode === 'replace') {
          for (const v of vertices) { v.selected = false; v.selectedAt = undefined; }
          for (const v of vertices) {
            if (inside(v)) { v.selected = true; v.selectedAt = selectionCounter++; }
          }
        } else if (rectMode === 'add') {
          for (const v of vertices) {
            if (inside(v) && !v.selected) { v.selected = true; v.selectedAt = selectionCounter++; }
          }
        } else if (rectMode === 'toggle') {
          for (const v of vertices) {
            if (inside(v)) {
              if (v.selected) { v.selected = false; v.selectedAt = undefined; }
              else { v.selected = true; v.selectedAt = selectionCounter++; }
            }
          }
        }
        suppressNextClick = true; // prevent click adding a point after selection
      }

      // reset rect selection state
      rectSelectPending = false;
      isRectSelecting = false;
      rectStart = null;
      rectCurrent = null;
      rectMode = 'replace';
      rectMoved = false;

      draw();
      evt.preventDefault();
      return;
    }

    if (!isDragging) return;
    isDragging = false;
    dragVertex = null;
    // reset group-drag state
    isGroupDrag = false;
    groupDragStartPositions = null;
    dragStartPos = null;
    if (dragMoved) {
      pushHistory();
      suppressNextClick = true; // prevent click toggle/add right after a drag
    }
    dragMoved = false;
  });

  // Click: toggle selection or add vertex when not dragging or panning
  canvas.addEventListener('click', (evt) => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    // Ignore clicks while space-pan mode is active
    if (isSpacePan || isPanning) { evt.preventDefault(); return; }

    // Translate mode: ignore click (drag-only)
    if (translate.active) { evt.preventDefault(); return; }

    // Reflect mode: capture points instead of toggling/adding vertices
    if (reflect.active) {
      const ms = getMousePos(evt);
      const mw = screenToWorld(ms);
      const pt = snapToGrid(mw);
      if (!reflect.p1) {
        reflect.p1 = pt;
        reflect.preview = pt;
        draw();
      } else {
        // second point
        if (Math.abs(pt.x - reflect.p1.x) < 1e-10 && Math.abs(pt.y - reflect.p1.y) < 1e-10) {
          // ignore same point
          return;
        }
        performReflectionAcrossLine(reflect.p1, pt);
        // start fade
        reflect.fade = { a: reflect.p1, b: pt, start: performance.now(), duration: 700 };
        // reset mode
        reflect.active = false;
        reflect.p1 = null;
        reflect.preview = null;
        updateReflectUi();
        draw();
      }
      evt.preventDefault();
      return;
    }

    // Place image mode: place selected image on canvas at clicked position
    if (placeImageMode && placeImageMode.filename) {
      const ms = getMousePos(evt);
      const mw = screenToWorld(ms);
      const ws = snapToGrid(mw);
      const id = nextImageId++;
      const im = { id, src: placeImageMode.filename, x: ws.x, y: ws.y, w: 6, h: null, rot: 0, scale: 1, selected: true };
      images.push(im);
      // Kick image load and redraw when ready
      const el = getOrLoadImage(im.src);
      if (el && !el.complete) { el.onload = () => draw(); }
      placeImageMode = null;
      draw();
      pushHistory();
      return;
    }

    const ms = getMousePos(evt);
    const hit = hitTestVertex(ms);
    if (hit) {
      // toggle selection
      if (hit.selected) {
        hit.selected = false;
        hit.selectedAt = undefined;
      } else {
        hit.selected = true;
        hit.selectedAt = selectionCounter++;
      }
      draw();
      return;
    }

    // else add a new vertex at world coords (snapped to grid)
    const w = screenToWorld(ms);
    const ws = snapToGrid(w);
    const id = nextVertexId++;
    const vtx = {
      id,
      x: ws.x,
      y: ws.y,
      color: vertexColorInput.value,
      size: clamp(parseFloat(vertexSizeInput.value) || 6, 2, 20),
      selected: false,
      selectedAt: undefined,
      label: defaultLabelForId(id),
    };

    // If a selected image is under this click, bind the new vertex to it
    let boundImage = null;
    for (let i = images.length - 1; i >= 0; i--) {
      const im = images[i];
      if (!im.selected) continue;
      if (imageContainsPoint(im, ms)) { boundImage = im; break; }
    }
    if (boundImage) {
      attachVertexToImage(vtx, boundImage, ws);
    }

    vertices.push(vtx);
    draw();
    pushHistory();
  });

  // Zoom logic
  function setPixelsPerUnit(newPPU, anchorScreen) {
    newPPU = clamp(newPPU, 5, 400);
    const k = newPPU / pixelsPerUnit;
    if (!anchorScreen) anchorScreen = { x: canvas.width / 2, y: canvas.height / 2 };
    // Keep world point under anchor constant in screen space
    // origin' = anchor - (anchor - origin) * k
    origin.x = anchorScreen.x - (anchorScreen.x - origin.x) * k;
    origin.y = anchorScreen.y - (anchorScreen.y - origin.y) * k;
    pixelsPerUnit = newPPU;
    ppuInput.value = Math.round(pixelsPerUnit);
    draw();
  }

  const ZOOM_STEP = Math.pow(2, 1/4); // ~1.19 per step

  zoomInBtn.addEventListener('click', () => setPixelsPerUnit(pixelsPerUnit * ZOOM_STEP));
  zoomOutBtn.addEventListener('click', () => setPixelsPerUnit(pixelsPerUnit / ZOOM_STEP));

  ppuInput.addEventListener('change', () => {
    const val = parseFloat(ppuInput.value);
    if (!isFinite(val)) return;
    setPixelsPerUnit(val);
  });

  gridStepSelect.addEventListener('change', () => {
    gridStepUnits = parseFloat(gridStepSelect.value) || 1;
    // Snap all existing vertices to the new grid intersections
    for (const v of vertices) {
      const snapped = snapToGrid(v);
      v.x = snapped.x;
      v.y = snapped.y;
    }
    draw();
    pushHistory();
  });

  // Mouse wheel zoom centered at cursor
  canvas.addEventListener('wheel', (evt) => {
    evt.preventDefault();
    const anchor = getMousePos(evt);
    const direction = Math.sign(evt.deltaY);
    const factor = direction > 0 ? 1/ZOOM_STEP : ZOOM_STEP;
    setPixelsPerUnit(pixelsPerUnit * factor, anchor);
  }, { passive: false });

  // Guard: check if a line (undirected) already exists
  function lineExists(aId, bId) {
    return lines.some(l => (l.aId === aId && l.bId === bId) || (l.aId === bId && l.bId === aId));
  }

  // Delete selected vertices and any connected lines
  function deleteSelected() {
    const selectedIds = new Set(vertices.filter(v => v.selected).map(v => v.id));
    if (selectedIds.size === 0) return;
    // Remove lines that reference any selected vertex
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i];
      if (selectedIds.has(ln.aId) || selectedIds.has(ln.bId)) {
        lines.splice(i, 1);
      }
    }
    // Remove the selected vertices themselves
    for (let i = vertices.length - 1; i >= 0; i--) {
      if (selectedIds.has(vertices[i].id)) {
        vertices.splice(i, 1);
      }
    }
    draw();
    pushHistory();
  }

  // Connect selected vertices into lines; when closing loop, order vertices around centroid to avoid self-crossing
  connectSelectedBtn.addEventListener('click', () => {
    let selected = vertices
      .filter(v => v.selected)
      .sort((a, b) => (a.selectedAt ?? 0) - (b.selectedAt ?? 0));
    if (selected.length < 2) return;

    const color = lineColorInput.value;
    const width = clamp(parseFloat(lineWidthInput.value) || 2, 1, 20);

    const shouldClose = !!(closeLoopChk && closeLoopChk.checked && selected.length >= 3);

    // If closing a loop, sort by polar angle around centroid to form a proper polygon
    if (shouldClose) {
      const cx = selected.reduce((s, v) => s + v.x, 0) / selected.length;
      const cy = selected.reduce((s, v) => s + v.y, 0) / selected.length;
      selected = selected
        .slice()
        .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    }

    // Connect consecutive vertices
    for (let i = 0; i < selected.length - 1; i++) {
      const aId = selected[i].id;
      const bId = selected[i + 1].id;
      if (!lineExists(aId, bId)) {
        lines.push({ aId, bId, color, width });
      }
    }

    // Optionally close the loop
    if (shouldClose) {
      const firstId = selected[0].id;
      const lastId = selected[selected.length - 1].id;
      if (!lineExists(firstId, lastId)) {
        lines.push({ aId: lastId, bId: firstId, color, width });
      }
    }

    draw();
    pushHistory();
  });

  // Delete selected button
  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener('click', () => {
      deleteSelected();
    });
  }

  // Reflect button toggles reflect mode
  if (reflectBtn) {
    reflectBtn.addEventListener('click', () => {
      if (reflect.active) cancelReflectMode(); else startReflectMode();
    });
  }

  // Rotate button toggles rotate mode
  if (rotateBtn) {
    rotateBtn.addEventListener('click', () => {
      if (rotate.active) cancelRotateMode(); else startRotateMode();
    });
  }

  // Translate button toggles translate mode
  if (translateBtn) {
    translateBtn.addEventListener('click', () => {
      if (translate.active) cancelTranslateMode(); else startTranslateMode();
    });
  }
  // Translate numeric apply
  if (translateApplyBtn) {
    translateApplyBtn.addEventListener('click', () => {
      const dx = parseFloat(translateDxInput ? translateDxInput.value : '0') || 0;
      const dy = parseFloat(translateDyInput ? translateDyInput.value : '0') || 0;
      if (Math.abs(dx) > 1e-12 || Math.abs(dy) > 1e-12) {
        performTranslationByOffset(dx, dy);
      }
      if (translate.active) cancelTranslateMode();
    });
  }

  // --- Image modal and actions ---
  function openImageModal() {
    if (!imageModal) return;
    imageModal.hidden = false;
    imageModal.setAttribute('aria-hidden', 'false');
  }
  function closeImageModal() {
    if (!imageModal) return;
    imageModal.hidden = true;
    imageModal.setAttribute('aria-hidden', 'true');
  }
  if (addImageBtn) {
    addImageBtn.addEventListener('click', () => {
      openImageModal();
    });
  }
  if (closeImageModalBtn) {
    closeImageModalBtn.addEventListener('click', () => closeImageModal());
  }
  if (imageModal) {
    imageModal.addEventListener('click', (e) => {
      const backdrop = e.target.closest('[data-close]');
      if (backdrop) { closeImageModal(); return; }
      const btn = e.target.closest('button.gallery-item');
      if (btn) {
        const fname = btn.getAttribute('data-filename');
        if (fname) {
          placeImageMode = { filename: fname };
          closeImageModal();
        }
      }
    });
  }
  if (clearImagesBtn) {
    clearImagesBtn.addEventListener('click', () => {
      images.length = 0;
      draw();
      pushHistory();
    });
  }

  // Angle/dir inputs: update preview angle (no commit) when in rotate mode with pivot selected
  if (rotateAngleInput) {
    rotateAngleInput.addEventListener('input', () => {
      if (rotate.active && rotate.pivot) {
        const deg = parseFloat(rotateAngleInput.value) || 0;
        const dir = (rotateDirSelect && rotateDirSelect.value === 'cw') ? -1 : 1;
        rotate.previewAngle = deg * Math.PI / 180 * dir;
        updateRotateUi();
        draw();
      }
    });
  }
  if (rotateDirSelect) {
    rotateDirSelect.addEventListener('change', () => {
      if (rotate.active && rotate.pivot) {
        const deg = parseFloat(rotateAngleInput ? rotateAngleInput.value : '0') || 0;
        const dir = (rotateDirSelect.value === 'cw') ? -1 : 1;
        rotate.previewAngle = deg * Math.PI / 180 * dir;
        updateRotateUi();
        draw();
      }
    });
  }

  clearVerticesBtn.addEventListener('click', () => {
    vertices.length = 0;
    // clear lines as well since they reference vertices
    lines.length = 0;
    nextVertexId = 1;
    selectionCounter = 1;
    draw();
    pushHistory();
  });

  clearLinesBtn.addEventListener('click', () => {
    lines.length = 0;
    draw();
    pushHistory();
  });

  clearAllBtn.addEventListener('click', () => {
    vertices.length = 0;
    lines.length = 0;
    nextVertexId = 1;
    selectionCounter = 1;
    draw();
    pushHistory();
  });

  // Sidebar events for labels and selection
  if (vertexListEl) {
    // Update canvas label on input; commit to history on change/blur/Enter
    vertexListEl.addEventListener('input', (e) => {
      const target = e.target;
      if (target && target.tagName === 'INPUT') {
        const li = target.closest('li.vertex-item');
        if (!li) return;
        const id = parseInt(li.getAttribute('data-id'));
        const v = vertices.find(v => v.id === id);
        if (!v) return;
        v.label = sanitizeLabel(target.value);
        draw(); // updates canvas label and sidebar highlighting if needed
      }
    });
    vertexListEl.addEventListener('change', (e) => {
      const target = e.target;
      if (target && target.tagName === 'INPUT') {
        pushHistory();
      }
    });
    vertexListEl.addEventListener('keydown', (e) => {
      const target = e.target;
      if (target && target.tagName === 'INPUT' && (e.key === 'Enter')) {
        e.preventDefault();
        target.blur();
      }
    });
    vertexListEl.addEventListener('click', (e) => {
      const li = e.target.closest('li.vertex-item');
      if (!li) return;
      // Ignore clicks directly on the input (handled by input)
      if (e.target && e.target.tagName === 'INPUT') return;
      const id = parseInt(li.getAttribute('data-id'));
      const v = vertices.find(v => v.id === id);
      if (!v) return;
      if (v.selected) {
        v.selected = false;
        v.selectedAt = undefined;
      } else {
        v.selected = true;
        v.selectedAt = selectionCounter++;
      }
      draw();
    });
  }

  // Undo button
  if (undoBtn) {
    undoBtn.addEventListener('click', () => undo());
  }

  // Keyboard shortcuts: Space (pan), zoom +/- and Undo (Ctrl/Cmd+Z)
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');

    // Escape cancels reflect/rotate modes
    if (e.key === 'Escape') {
      let handled = false;
      if (reflect.active) { cancelReflectMode(); handled = true; }
      if (rotate.active) { cancelRotateMode(); handled = true; }
      if (translate.active) { cancelTranslateMode(); handled = true; }
      if (handled) { e.preventDefault(); return; }
    }

    // Enter applies typed rotation angle when in rotate mode
    if (e.key === 'Enter' && rotate.active && rotate.pivot) {
      // Only apply when not typing in some other unrelated input
      const target = document.activeElement;
      const isAngleInput = target && (target.id === 'rotateAngle' || target.id === 'rotateDir');
      if (isAngleInput || !isInput) {
        const deg = parseFloat(rotateAngleInput ? rotateAngleInput.value : '0') || 0;
        const dir = (rotateDirSelect && rotateDirSelect.value === 'cw') ? -1 : 1;
        const ang = deg * Math.PI / 180 * dir;
        if (Math.abs(ang) > 1e-12) {
          performRotationAroundPoint(rotate.pivot, ang);
          rotate.fade = { pivot: { ...rotate.pivot }, start: performance.now(), duration: 700 };
        }
        cancelRotateMode();
        e.preventDefault();
        return;
      }
    }

    // Enter applies typed translation dx, dy
    if (e.key === 'Enter') {
      const target = document.activeElement;
      const isTranslateInput = target && (target.id === 'translateDx' || target.id === 'translateDy');
      if (isTranslateInput || (!isInput && (translateDxInput || translateDyInput))) {
        const dx = parseFloat(translateDxInput ? translateDxInput.value : '0') || 0;
        const dy = parseFloat(translateDyInput ? translateDyInput.value : '0') || 0;
        if (Math.abs(dx) > 1e-12 || Math.abs(dy) > 1e-12) {
          performTranslationByOffset(dx, dy);
        }
        if (translate.active) cancelTranslateMode();
        e.preventDefault();
        return;
      }
    }

    // Space: temporary grab/pan mode (ignore when typing in inputs)
    if (e.code === 'Space' && !isInput) {
      if (!isSpacePan) {
        isSpacePan = true;
        if (!isPanning) canvas.style.cursor = 'grab';
      }
      e.preventDefault();
      return;
    }

    // Undo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (!isInput) {
        e.preventDefault();
        undo();
      }
      return;
    }

    // Delete selected vertices (Delete or Backspace keys)
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
      e.preventDefault();
      deleteSelected();
      return;
    }

    // Zoom
    if (e.key === '+') { setPixelsPerUnit(pixelsPerUnit * ZOOM_STEP); }
    else if (e.key === '-') { setPixelsPerUnit(pixelsPerUnit / ZOOM_STEP); }
  });

  // Space release: exit pan mode
  window.addEventListener('keyup', (e) => {
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');

    if (e.code === 'Space') {
      // End panning if still active
      if (isPanning) {
        isPanning = false;
        lastMousePos = null;
        if (panMoved) suppressNextClick = true;
        panMoved = false;
      }
      isSpacePan = false;
      canvas.style.cursor = '';
      if (!isInput) e.preventDefault();
    }
  });

  // Selection rectangle overlay
  function drawSelectionRectOverlay() {
    if (!isRectSelecting || !rectStart || !rectCurrent) return;
    const x = Math.min(rectStart.x, rectCurrent.x);
    const y = Math.min(rectStart.y, rectCurrent.y);
    const w = Math.abs(rectCurrent.x - rectStart.x);
    const h = Math.abs(rectCurrent.y - rectStart.y);
    ctx.save();
    ctx.strokeStyle = '#1976d2';
    ctx.lineWidth = 1;
    ctx.setLineDash([6,4]);
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.fillStyle = 'rgba(25, 118, 210, 0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  // --- Style update helpers for selected items ---
  function updateSelectedVerticesColor(newColor) {
    let changed = false;
    for (const v of vertices) {
      if (v.selected && v.color !== newColor) {
        v.color = newColor;
        changed = true;
      }
    }
    if (changed) draw();
    return changed;
  }

  function updateLinesForSelectedVerticesStyle({ color, width } = {}) {
    const selIds = new Set(vertices.filter(v => v.selected).map(v => v.id));
    if (selIds.size === 0) return false;
    let changed = false;
    for (const ln of lines) {
      const aSel = selIds.has(ln.aId);
      const bSel = selIds.has(ln.bId);
      if (aSel && bSel) {
        if (color != null && ln.color !== color) { ln.color = color; changed = true; }
        if (width != null) {
          const w = clamp(width, 1, 20);
          if (ln.width !== w) { ln.width = w; changed = true; }
        }
      }
    }
    if (changed) draw();
    return changed;
  }

  // --- React to control changes to apply to selected items ---
  if (vertexColorInput) {
    vertexColorInput.addEventListener('input', () => {
      updateSelectedVerticesColor(vertexColorInput.value);
    });
    vertexColorInput.addEventListener('change', () => {
      if (updateSelectedVerticesColor(vertexColorInput.value)) pushHistory();
    });
  }

  if (lineColorInput) {
    lineColorInput.addEventListener('input', () => {
      updateLinesForSelectedVerticesStyle({ color: lineColorInput.value });
    });
    lineColorInput.addEventListener('change', () => {
      if (updateLinesForSelectedVerticesStyle({ color: lineColorInput.value })) pushHistory();
    });
  }

  if (lineWidthInput) {
    lineWidthInput.addEventListener('input', () => {
      const w = clamp(parseFloat(lineWidthInput.value) || 2, 1, 20);
      updateLinesForSelectedVerticesStyle({ width: w });
    });
    lineWidthInput.addEventListener('change', () => {
      const w = clamp(parseFloat(lineWidthInput.value) || 2, 1, 20);
      if (updateLinesForSelectedVerticesStyle({ width: w })) pushHistory();
    });
  }

  // Initial draw and history init
  draw();
  pushHistory();
  updateUndoButton();
  updateReflectUi();
  updateRotateUi();
  updateTranslateUi();
})();
