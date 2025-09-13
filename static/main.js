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

  const lineColorInput = document.getElementById('lineColor');
  const lineWidthInput = document.getElementById('lineWidth');
  const connectSelectedBtn = document.getElementById('connectSelected');
  const clearLinesBtn = document.getElementById('clearLines');

  const clearAllBtn = document.getElementById('clearAll');
  const undoBtn = document.getElementById('undoBtn');
  const vertexListEl = document.getElementById('vertexList');

  // Coordinate system state
  let pixelsPerUnit = clamp(parseFloat(ppuInput.value) || 50, 5, 400);
  let gridStepUnits = parseFloat(gridStepSelect.value) || 1; // grid line spacing in world units

  // origin (0,0) position on canvas in pixels
  let origin = { x: canvas.width / 2, y: canvas.height / 2 };

  // Data models
  let nextVertexId = 1;
  let selectionCounter = 1; // for ordering selected vertices
  const vertices = []; // {id, x, y, color, size, selected, selectedAt}
  const lines = [];    // {aId, bId, color, width}

  // History (undo) stack
  const history = [];
  function makeSnapshot() {
    return {
      vertices: vertices.map(v => ({...v})),
      lines: lines.map(l => ({...l})),
      nextVertexId,
      selectionCounter
    };
  }
  function restoreFromSnapshot(snap) {
    vertices.length = 0;
    for (const v of snap.vertices) vertices.push({...v});
    lines.length = 0;
    for (const l of snap.lines) lines.push({...l});
    nextVertexId = snap.nextVertexId;
    selectionCounter = snap.selectionCounter;
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

  function draw() {
    clear();
    drawGrid();
    drawLines();
    drawVertices();
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

  // Mouse interaction
  canvas.addEventListener('click', (evt) => {
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

  // Connect selected vertices into lines in selection order
  connectSelectedBtn.addEventListener('click', () => {
    const selected = vertices.filter(v => v.selected).sort((a, b) => (a.selectedAt ?? 0) - (b.selectedAt ?? 0));
    if (selected.length < 2) return;
    const color = lineColorInput.value;
    const width = clamp(parseFloat(lineWidthInput.value) || 2, 1, 20);
    for (let i = 0; i < selected.length - 1; i++) {
      lines.push({ aId: selected[i].id, bId: selected[i+1].id, color, width });
    }
    draw();
    pushHistory();
  });

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

  // Keyboard shortcuts for zoom +/- and Undo (Ctrl/Cmd+Z)
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');

    // Undo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (!isInput) {
        e.preventDefault();
        undo();
      }
      return;
    }

    // Zoom
    if (e.key === '+') { setPixelsPerUnit(pixelsPerUnit * ZOOM_STEP); }
    else if (e.key === '-') { setPixelsPerUnit(pixelsPerUnit / ZOOM_STEP); }
  });

  // Initial draw and history init
  draw();
  pushHistory();
  updateUndoButton();
})();
