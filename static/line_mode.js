(() => {
  // Helpers
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // UI elements
  const seriesContainer = qs('#seriesContainer');
  const addSeriesBtn = qs('#addSeriesBtn');

  const xAxisLabelText = qs('#xAxisLabelText');
  const xAxisLabelSize = qs('#xAxisLabelSize');
  const xAxisLabelColor = qs('#xAxisLabelColor');
  const xAxisLabelFont = qs('#xAxisLabelFont');
  const yAxisLabelText = qs('#yAxisLabelText');
  const yAxisLabelSize = qs('#yAxisLabelSize');
  const yAxisLabelColor = qs('#yAxisLabelColor');
  const yAxisLabelFont = qs('#yAxisLabelFont');

  const xTickSize = qs('#xTickSize');
  const xTickColor = qs('#xTickColor');
  const xTickFont = qs('#xTickFont');
  const yTickSize = qs('#yTickSize');
  const yTickColor = qs('#yTickColor');
  const yTickFont = qs('#yTickFont');

  const legendDisplay = qs('#legendDisplay');
  const legendSize = qs('#legendSize');
  const legendColor = qs('#legendColor');
  const legendFont = qs('#legendFont');

  const chartCanvas = qs('#lineChart');
  const mathInfoLineContent = qs('#mathInfoLineContent');
  const createDeleteLineBtn = qs('#createDeleteLineBtn');
  const selectAllBtn = qs('#selectAllBtn');

  // Help tooltip for Line info
  const helpBtn = document.getElementById('lineInfoHelp');
  const helpTip = document.getElementById('lineInfoHelpTip');
  if (helpBtn && helpTip) {
    let hoverTimeout;
    let listening = false;

    const repositionTip = () => {
      if (helpTip.getAttribute('data-open') !== 'true') return;
      const btnRect = helpBtn.getBoundingClientRect();
      // Ensure we can measure the tooltip size
      const prevDisplay = helpTip.style.display;
      const prevVisibility = helpTip.style.visibility;
      helpTip.style.visibility = 'hidden';
      helpTip.style.display = 'block';
      const tipWidth = helpTip.offsetWidth || 400;
      const tipHeight = helpTip.offsetHeight || 60;
      helpTip.style.display = prevDisplay;
      helpTip.style.visibility = prevVisibility;

      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const spaceRight = vw - btnRect.right - margin;
      const spaceLeft = btnRect.left - margin;
      let placeRight = true;
      if (tipWidth > spaceRight && spaceLeft > spaceRight) {
        placeRight = false;
      }

      let left = placeRight ? (btnRect.right + margin) : Math.max(margin, btnRect.left - margin - tipWidth);
      left = Math.min(left, vw - tipWidth - margin);

      let top = btnRect.top + btnRect.height / 2 - tipHeight / 2;
      top = Math.max(margin, Math.min(top, vh - tipHeight - margin));

      helpTip.style.left = `${Math.round(left)}px`;
      helpTip.style.top = `${Math.round(top)}px`;
    };

    const openTip = () => {
      helpTip.setAttribute('data-open', 'true');
      helpBtn.setAttribute('aria-expanded', 'true');
      repositionTip();
      if (!listening) {
        window.addEventListener('resize', repositionTip);
        window.addEventListener('scroll', repositionTip, true);
        listening = true;
      }
    };
    const closeTip = () => {
      helpTip.removeAttribute('data-open');
      helpBtn.setAttribute('aria-expanded', 'false');
    };
    helpBtn.addEventListener('mouseenter', () => { clearTimeout(hoverTimeout); openTip(); });
    helpBtn.addEventListener('mouseleave', () => { hoverTimeout = setTimeout(closeTip, 150); });
    helpTip.addEventListener('mouseenter', () => { clearTimeout(hoverTimeout); });
    helpTip.addEventListener('mouseleave', () => { hoverTimeout = setTimeout(closeTip, 150); });
    helpBtn.addEventListener('focus', openTip);
    helpBtn.addEventListener('blur', () => { hoverTimeout = setTimeout(closeTip, 150); });
    helpBtn.addEventListener('click', (e) => { e.preventDefault(); const isOpen = helpTip.getAttribute('data-open') === 'true'; if (isOpen) { closeTip(); } else { openTip(); } });
    document.addEventListener('click', (e) => { if (!helpBtn.contains(e.target) && !helpTip.contains(e.target)) closeTip(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTip(); });
  }

  /** @type {Chart|null} */
  let chart = null;

  // State: list of series, each with DOM refs and id
  let seriesSeq = 1;
  const allSeries = new Map(); // id -> {id, cardEl, labelEl, colorEl, widthEl, tbodyEl}
  let rowSelectCounter = 1;
  let rowIdSeq = 1; // unique id for each row
  const infiniteLines = new Map(); // key "id1|id2" -> { rowIds:[id1,id2], datasetLabel, color }

  // Simple undo stack to restore deletions (rows/series)
  const undoStack = [];
  function pushUndo(action) {
    // Only keep last 50 actions
    undoStack.push(action);
    if (undoStack.length > 50) undoStack.shift();
  }
  function undoLast() {
    const action = undoStack.pop();
    if (!action) return false;
    try {
      if (action.type === 'row-delete') {
        const { tbodyEl, index, rowEl, infiniteEntries } = action;
        if (!tbodyEl || !rowEl) return false;
        const rows = Array.from(tbodyEl.children);
        if (index >= 0 && index < rows.length) {
          tbodyEl.insertBefore(rowEl, rows[index]);
        } else {
          tbodyEl.appendChild(rowEl);
        }
        // Restore any infinite lines that were removed due to the row deletion
        if (Array.isArray(infiniteEntries)) {
          for (const [k, v] of infiniteEntries) {
            infiniteLines.set(k, v);
          }
        }
        updateChart();
        updateMathInfoLineMode();
        updateSelectAllBtnLabel();
        return true;
      } else if (action.type === 'series-delete') {
        const { index, cardEl, seriesId, infiniteEntries } = action;
        if (!cardEl) return false;
        const cards = Array.from(seriesContainer.children);
        if (index >= 0 && index < cards.length) {
          seriesContainer.insertBefore(cardEl, cards[index]);
        } else {
          seriesContainer.appendChild(cardEl);
        }
        // Re-register in allSeries map
        const labelEl = cardEl.querySelector('.series-label');
        const colorEl = cardEl.querySelector('.series-color');
        const widthEl = cardEl.querySelector('.series-width');
        const tbodyEl = cardEl.querySelector('tbody');
        const thXEl = cardEl.querySelector('.th-x-label');
        const thYEl = cardEl.querySelector('.th-y-label');
        const id = seriesId || cardEl.dataset.id;
        if (id) allSeries.set(id, { id, cardEl, labelEl, colorEl, widthEl, tbodyEl, thXEl, thYEl });
        // Restore any infinite lines connected to rows in this series
        if (Array.isArray(infiniteEntries)) {
          for (const [k, v] of infiniteEntries) {
            infiniteLines.set(k, v);
          }
        }
        updateChart();
        updateMathInfoLineMode();
        updateSelectAllBtnLabel();
        return true;
      }
    } catch (e) {
      console.error('Undo failed', e);
    }
    return false;
  }

  // Keyboard shortcut: Ctrl/Cmd+Z to undo last deletion in line mode
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    if (!ctrl) return;
    // Only handle plain Ctrl+Z without Shift for now (browser Ctrl+Shift+Z redo unaffected)
    if (e.key === 'z' || e.key === 'Z') {
      // If there is something to undo in our stack, prefer app-level undo
      if (undoStack.length > 0) {
        e.preventDefault();
        undoLast();
      }
    }
  });

  function createSeriesCard(initial = false) {
    const id = `S${seriesSeq++}`;
    const card = document.createElement('div');
    card.className = 'series-card';
    card.dataset.id = id;

    card.innerHTML = `
      <header>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <strong>Series</strong>
          <label>Label: <input type="text" class="series-label" value="${id}" aria-label="Series label"></label>
          <label>Color: <input type="color" class="series-color" value="#1e88e5" aria-label="Series line color"></label>
          <label>Thickness: <input type="number" class="series-width" min="1" max="10" step="1" value="2" aria-label="Series line thickness" style="width: 6ch;"></label>
        </div>
        <div>
          <button type="button" class="add-row">+ Row</button>
          <button type="button" class="remove-series" title="Remove Series">Remove Series</button>
        </div>
      </header>
      <table aria-label="Data table for ${id}">
        <thead>
          <tr>
            <th style="width:10%">Select</th>
            <th style="width:30%"><span class="th-x-label">X</span></th>
            <th style="width:30%"><span class="th-y-label">Y</span></th>
            <th class="row-actions" style="width:30%">Action</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;

    const tbody = card.querySelector('tbody');
    const labelEl = card.querySelector('.series-label');
    const colorEl = card.querySelector('.series-color');
    const widthEl = card.querySelector('.series-width');
    const addRowBtn = card.querySelector('.add-row');
    const removeSeriesBtn = card.querySelector('.remove-series');
    const thXEl = card.querySelector('.th-x-label');
    const thYEl = card.querySelector('.th-y-label');
    if (thXEl) thXEl.textContent = (xAxisLabelText?.value || 'X');
    if (thYEl) thYEl.textContent = (yAxisLabelText?.value || 'Y');

    function addRow(x = '', y = '') {
      const tr = document.createElement('tr');
      const rowId = `R${rowIdSeq++}`;
      tr.setAttribute('data-row-id', rowId);
      tr.innerHTML = `
        <td class="row-select"><label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="select-point"> Select</label></td>
        <td><input type="number" step="any" class="cell-x" value="${x}" aria-label="X value"></td>
        <td><input type="number" step="any" class="cell-y" value="${y}" aria-label="Y value"></td>
        <td class="row-actions"><button type="button" class="del-row">Delete</button></td>
      `;
      tbody.appendChild(tr);
    }


    addRowBtn.addEventListener('click', () => { addRow('', ''); updateChart(); });
    card.addEventListener('input', (e) => {
      const t = e.target;
      if (t.classList.contains('cell-x') || t.classList.contains('cell-y') || t.classList.contains('series-label') || t.classList.contains('series-color') || t.classList.contains('series-width')) {
        updateChart();
      }
    });
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('.del-row');
      if (btn) {
        const tr = btn.closest('tr');
        const rowId = tr.getAttribute('data-row-id');
        // Prepare undo action before removal
        const tbodyEl = tbody;
        const index = Array.prototype.indexOf.call(tbodyEl.children, tr);
        const infiniteEntries = rowId ? collectInfiniteEntriesForRow(rowId) : [];
        pushUndo({ type: 'row-delete', tbodyEl, index, rowEl: tr, infiniteEntries });
        // Now remove row and associated infinite lines
        tr.remove();
        if (rowId) removeInfiniteLinesForRow(rowId);
        updateChart();
      }
    });
    removeSeriesBtn.addEventListener('click', () => {
      // Prepare undo before removal
      const index = Array.prototype.indexOf.call(seriesContainer.children, card);
      const infiniteEntries = collectInfiniteEntriesForSeries(card);
      pushUndo({ type: 'series-delete', index, cardEl: card, seriesId: id, infiniteEntries });
      // Remove series and related infinite lines
      removeInfiniteLinesForSeries(card);
      allSeries.delete(id);
      card.remove();
      updateChart();
    });

    seriesContainer.appendChild(card);
    allSeries.set(id, { id, cardEl: card, labelEl, colorEl, widthEl, tbodyEl: tbody, thXEl, thYEl });
    if (!initial) { updateChart(); updateMathInfoLineMode(); }
    return id;
  }

  function gatherSeriesData() {
    /** @type {{label:string, color:string, width:number, points:{x:number,y:number,_rowId?:string}[]}[]} */
    const result = [];
    for (const { cardEl, labelEl, colorEl, widthEl, tbodyEl } of allSeries.values()) {
      const pts = [];
      qsa('tr', tbodyEl).forEach(tr => {
        const x = parseFloat(qs('.cell-x', tr)?.value ?? '');
        const y = parseFloat(qs('.cell-y', tr)?.value ?? '');
        const rowId = tr.getAttribute('data-row-id') || undefined;
        if (!Number.isNaN(x) && !Number.isNaN(y)) {
          // Allow negative Y values; preserve as entered
          pts.push({ x, y, _rowId: rowId });
        }
      });
      // Sort by x for clean line rendering
      pts.sort((a, b) => a.x - b.x);
      result.push({
        label: (labelEl.value || 'Series').trim(),
        color: colorEl.value || '#1e88e5',
        width: Math.max(1, Math.min(10, Number(widthEl.value) || 2)),
        points: pts,
      });
    }
    return result;
  }

  function computeXBounds(series) {
    let min = Infinity, max = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.x < min) min = p.x;
        if (p.x > max) max = p.x;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 10 };
    }
    if (min === max) {
      // Expand a little if single point or flat x
      const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
      return { min: min - pad, max: max + pad };
    }
    return { min, max };
  }

  function computeYBounds(series) {
    let min = Infinity, max = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 10 };
    }
    if (min === max) {
      const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
      return { min: min - pad, max: max + pad };
    }
    return { min, max };
  }

  function ensureChart() {
    if (chart) return chart;
    chart = new Chart(chartCanvas.getContext('2d'), {
      type: 'line',
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: true,
        animation: false,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'X' },
            ticks: { color: '#444', font: { size: 12, family: getComputedStyle(document.body).fontFamily }, stepSize: 1 },
            grid: {
              color: (ctx) => (ctx.tick?.value === 0 ? '#000000' : 'rgba(0,0,0,0.06)'),
              lineWidth: (ctx) => (ctx.tick?.value === 0 ? 1.5 : 1),
            },
          },
          y: {
            type: 'linear',
            beginAtZero: true,
            min: 0,
            title: { display: true, text: 'Y' },
            ticks: { color: '#444', font: { size: 12, family: getComputedStyle(document.body).fontFamily }, stepSize: 1 },
            grid: {
              color: (ctx) => (ctx.tick?.value === 0 ? '#000000' : 'rgba(0,0,0,0.06)'),
              lineWidth: (ctx) => (ctx.tick?.value === 0 ? 1.5 : 1),
            },
          },
        },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#333', font: { size: 12, family: getComputedStyle(document.body).fontFamily } },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const x = (typeof ctx.parsed.x === 'number') ? ctx.parsed.x : ctx.raw?.x;
                const y = (typeof ctx.parsed.y === 'number') ? ctx.parsed.y : ctx.raw?.y;
                return `${ctx.dataset.label || 'Series'}: (${x}, ${y})`;
              }
            }
          }
        }
      }
    });
    return chart;
  }

  function pairKey(id1, id2) {
    const [a, b] = [String(id1), String(id2)].sort();
    return `${a}|${b}`;
  }
  function getRowXY(tr) {
    const x = parseFloat(qs('.cell-x', tr)?.value ?? '');
    const y = parseFloat(qs('.cell-y', tr)?.value ?? '');
    return { x, y };
  }
  function getRowById(id) {
    return seriesContainer.querySelector(`tr[data-row-id="${id}"]`);
  }
  function computeMBFromRows(tr1, tr2) {
    const p1 = getRowXY(tr1);
    const p2 = getRowXY(tr2);
    if (![p1.x, p1.y, p2.x, p2.y].every(Number.isFinite)) return { valid: false };
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return { valid: false }; // same point
    if (Math.abs(dx) < 1e-12) return { valid: false, vertical: true, x: p1.x };
    const m = dy / dx;
    const b = p1.y - m * p1.x;
    return { valid: true, m, b };
  }
  function refreshCreateDeleteBtn() {
    if (!createDeleteLineBtn) return;
    const selected = Array.from(seriesContainer.querySelectorAll('tbody tr.selected-point'));
    if (selected.length !== 2) {
      createDeleteLineBtn.style.display = 'none';
      return;
    }
    const id1 = selected[0].getAttribute('data-row-id');
    const id2 = selected[1].getAttribute('data-row-id');
    const key = pairKey(id1, id2);
    const comp = computeMBFromRows(selected[0], selected[1]);
    if (!comp.valid || comp.vertical) {
      createDeleteLineBtn.style.display = 'none';
      return;
    }
    const exists = infiniteLines.has(key);
    createDeleteLineBtn.style.display = '';
    createDeleteLineBtn.textContent = exists ? 'Delete line' : 'Create line';
  }
  function collectInfiniteEntriesForRow(rowId) {
    const found = [];
    for (const [k, v] of infiniteLines) {
      if (v.rowIds && v.rowIds.includes(rowId)) found.push([k, { ...v, rowIds: [...v.rowIds] }]);
    }
    return found;
  }
  function collectInfiniteEntriesForSeries(cardEl) {
    const found = [];
    const rows = qsa('tbody tr', cardEl);
    const ids = rows.map(r => r.getAttribute('data-row-id'));
    for (const [k, v] of infiniteLines) {
      if (v.rowIds && v.rowIds.some(id => ids.includes(id))) found.push([k, { ...v, rowIds: [...v.rowIds] }]);
    }
    return found;
  }
  function removeInfiniteLinesForRow(rowId) {
    const toDelete = [];
    for (const [k, v] of infiniteLines) {
      if (v.rowIds.includes(rowId)) toDelete.push(k);
    }
    if (toDelete.length) {
      toDelete.forEach(k => infiniteLines.delete(k));
      updateChart();
    }
  }
  function removeInfiniteLinesForSeries(cardEl) {
    const rows = qsa('tbody tr', cardEl);
    const ids = rows.map(r => r.getAttribute('data-row-id'));
    const toDelete = [];
    for (const [k, v] of infiniteLines) {
      if (v.rowIds.some(id => ids.includes(id))) toDelete.push(k);
    }
    toDelete.forEach(k => infiniteLines.delete(k));
  }

  // Select-all helpers
  function updateSelectAllBtnLabel() {
    if (!selectAllBtn) return;
    const rows = qsa('tbody tr', seriesContainer);
    const selected = qsa('tbody tr.selected-point', seriesContainer);
    selectAllBtn.disabled = rows.length === 0;
    const allSelected = rows.length > 0 && selected.length === rows.length;
    selectAllBtn.textContent = allSelected ? 'Clear selection' : 'Select all rows';
  }

  function updateChart() {
    updateMathInfoLineMode();
    const sers = gatherSeriesData();
    const c = ensureChart();

    // Update datasets
    const selectedIds = new Set(Array.from(seriesContainer.querySelectorAll('tbody tr.selected-point')).map(tr => tr.getAttribute('data-row-id')));
    const anySelected = selectedIds.size > 0;
    c.data.datasets = sers.map(s => ({
      label: s.label || 'Series',
      data: s.points,
      borderColor: s.color,
      backgroundColor: (ctx) => s.color,
      borderWidth: s.width,
      pointRadius: (ctx) => {
        const id = ctx?.raw?._rowId;
        if (!id) return anySelected ? 0 : 3;
        return selectedIds.has(id) ? 6 : (anySelected ? 0 : 3);
      },
      pointHoverRadius: (ctx) => {
        const id = ctx?.raw?._rowId;
        return selectedIds.has(id) ? 7 : (anySelected ? 0 : 4);
      },
      pointBorderColor: (ctx) => {
        const id = ctx?.raw?._rowId;
        return selectedIds.has(id) ? '#ffd600' : s.color;
      },
      pointBorderWidth: (ctx) => {
        const id = ctx?.raw?._rowId;
        return selectedIds.has(id) ? 3 : 0;
      },
      showLine: true,
      fill: false,
      tension: 0, // straight lines
      order: 1,
    }));

    // Axis bounds: x can be negative; y can be negative when present
    const xb = computeXBounds(sers);
    const yb = computeYBounds(sers);
    // Ensure the origin (0,0) is always visible horizontally
    let xmin = xb.min;
    let xmax = xb.max;
    if (!(Number.isFinite(xmin) && Number.isFinite(xmax))) { xmin = 0; xmax = 10; }
    if (xmin > 0) xmin = 0;
    if (xmax < 0) xmax = 0;
    c.options.scales.x.min = xmin;
    c.options.scales.x.max = xmax;

    // Y bounds: default to positive quadrant when no negatives yet, else fit data
    const hasNegY = Number.isFinite(yb.min) && yb.min < 0;
    if (hasNegY) {
      c.options.scales.y.min = yb.min;
      c.options.scales.y.max = yb.max;
    } else {
      c.options.scales.y.min = 0;
      c.options.scales.y.max = yb.max;
    }

    // Append infinite lines datasets (for 2-point exact lines the user created)
    for (const [key, info] of infiniteLines) {
      const tr1 = getRowById(info.rowIds[0]);
      const tr2 = getRowById(info.rowIds[1]);
      if (!tr1 || !tr2) { infiniteLines.delete(key); continue; }
      const comp = computeMBFromRows(tr1, tr2);
      if (!comp.valid || comp.vertical) { infiniteLines.delete(key); continue; }
      const x1 = c.options.scales.x.min;
      const x2 = c.options.scales.x.max;
      const y1 = comp.m * x1 + comp.b;
      const y2 = comp.m * x2 + comp.b;
      c.data.datasets.push({
        label: info.datasetLabel || 'Infinite line',
        data: [ { x: x1, y: y1 }, { x: x2, y: y2 } ],
        borderColor: info.color || '#ff6f00',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 0,
        borderDash: [6, 6],
        fill: false,
        tension: 0,
        order: 0,
      });
    }

    // Append best-fit line dataset when 3 or more rows are selected
    const sel = getSelectedRows();
    if (sel.length >= 3) {
      const reg = computeRegressionFromRows(sel);
      if (reg.valid) {
        const x1 = c.options.scales.x.min;
        const x2 = c.options.scales.x.max;
        const y1 = reg.m * x1 + reg.b;
        const y2 = reg.m * x2 + reg.b;
        c.data.datasets.push({
          label: `Best fit (${sel.length} pts)`,
          data: [ { x: x1, y: y1 }, { x: x2, y: y2 } ],
          borderColor: '#2e7d32',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          borderDash: [4, 4],
          fill: false,
          tension: 0,
          order: 0,
        });
      }
    }

    // Axis titles and styles
    c.options.scales.x.title.display = true;
    c.options.scales.x.title.text = xAxisLabelText.value || '';
    c.options.scales.x.title.color = xAxisLabelColor.value || '#333';
    c.options.scales.x.title.font = { size: clampNum(xAxisLabelSize.value, 8, 48, 14), family: xAxisLabelFont.value };

    c.options.scales.y.title.display = true;
    c.options.scales.y.title.text = yAxisLabelText.value || '';
    c.options.scales.y.title.color = yAxisLabelColor.value || '#333';
    c.options.scales.y.title.font = { size: clampNum(yAxisLabelSize.value, 8, 48, 14), family: yAxisLabelFont.value };

    // Sync series table headers with axis labels
    const xHeader = xAxisLabelText.value || 'X';
    const yHeader = yAxisLabelText.value || 'Y';
    for (const s of allSeries.values()) {
      if (s.thXEl) s.thXEl.textContent = xHeader;
      if (s.thYEl) s.thYEl.textContent = yHeader;
    }

    // Tick styling
    c.options.scales.x.ticks.color = xTickColor.value || '#444';
    c.options.scales.x.ticks.font = { size: clampNum(xTickSize.value, 6, 36, 12), family: xTickFont.value };
    c.options.scales.x.ticks.stepSize = 1;
    c.options.scales.y.ticks.color = yTickColor.value || '#444';
    c.options.scales.y.ticks.font = { size: clampNum(yTickSize.value, 6, 36, 12), family: yTickFont.value };
    c.options.scales.y.ticks.stepSize = 1;

    // Legend
    c.options.plugins.legend.display = !!legendDisplay.checked;
    c.options.plugins.legend.labels.color = legendColor.value || '#333';
    c.options.plugins.legend.labels.font = { size: clampNum(legendSize.value, 8, 36, 12), family: legendFont.value };

    c.update();
    refreshCreateDeleteBtn();
    updateSelectAllBtnLabel();
  }

  function clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
    return fallback;
  }

  function formatNum(n) {
    if (!Number.isFinite(n)) return '';
    const s = Math.abs(n) < 1e-8 ? '0' : n.toFixed(6);
    return parseFloat(s).toString();
  }

  // Fraction helpers for slope display
  function gcdInt(a, b) {
    a = Math.abs(a|0); b = Math.abs(b|0);
    while (b) { const t = b; b = a % b; a = t; }
    return a || 1;
  }
  function toFractionApprox(x, maxDenPow = 6) {
    if (!Number.isFinite(x)) return { num: 0, den: 1 };
    if (Math.abs(x) < 1e-12) return { num: 0, den: 1 };
    const s = x.toFixed(maxDenPow);
    const parts = s.split('.');
    if (parts.length === 1) return { num: parseInt(parts[0], 10), den: 1 };
    const decimals = parts[1].replace(/0+$/,'');
    if (decimals.length === 0) return { num: parseInt(parts[0], 10), den: 1 };
    const den = Math.pow(10, decimals.length);
    const num = Math.round(parseFloat(s) * den);
    const g = gcdInt(num, den);
    const sign = num < 0 ? -1 : 1;
    return { num: sign * Math.abs(num / g), den: Math.abs(den / g) };
  }
  function divideFractions(n1, d1, n2, d2) {
    if (n2 === 0) return { num: NaN, den: 1 };
    let num = n1 * d2;
    let den = d1 * n2;
    if (den < 0) { num = -num; den = -den; }
    const g = gcdInt(num, den);
    return { num: num / g, den: den / g };
  }
  function formatFraction(num, den) {
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 'undefined';
    if (num === 0) return '0';
    if (den === 1) return String(num);
    return `${num}/${den}`;
  }
  function slopeAsFraction(dy, dx) {
    const fDy = toFractionApprox(dy);
    const fDx = toFractionApprox(dx);
    const f = divideFractions(fDy.num, fDy.den, fDx.num, fDx.den);
    let num = f.num; let den = f.den;
    if (den < 0) { num = -num; den = -den; }
    num = Math.trunc(num); den = Math.trunc(den);
    return { str: formatFraction(num, den), num, den };
  }

  function getSelectedRows() {
    return Array.from(seriesContainer.querySelectorAll('tbody tr.selected-point'))
      .sort((a,b) => (parseInt(a.getAttribute('data-selected-at')||'0',10)) - (parseInt(b.getAttribute('data-selected-at')||'0',10)));
  }
  function computeRegressionFromRows(rows) {
    let n = 0, sumx = 0, sumy = 0, sumxy = 0, sumx2 = 0;
    for (const tr of rows) {
      const x = parseFloat(qs('.cell-x', tr)?.value ?? '');
      const y = parseFloat(qs('.cell-y', tr)?.value ?? '');
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { valid: false };
      n++;
      sumx += x; sumy += y; sumxy += x*y; sumx2 += x*x;
    }
    const denom = (n * sumx2 - sumx * sumx);
    if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return { valid: false };
    const m = (n * sumxy - sumx * sumy) / denom;
    const b = (sumy - m * sumx) / n;
    return { valid: true, m, b };
  }
  function updateMathInfoLineMode() {
    if (!mathInfoLineContent) return;
    const selected = getSelectedRows();
    if (selected.length >= 3) {
      const reg = computeRegressionFromRows(selected);
      if (!reg.valid) {
        mathInfoLineContent.innerHTML = 'Selected rows must have numeric X and Y values and non-degenerate X spread for regression.';
        refreshCreateDeleteBtn();
        return;
      }
      const mStr = formatNum(reg.m);
      const bStr = formatNum(reg.b);
      const sign = reg.b >= 0 ? '+' : '−';
      const absBStr = formatNum(Math.abs(reg.b));
      const eq = `y = ${mStr}x ${sign} ${absBStr}`;
      mathInfoLineContent.innerHTML = [
        `<div><strong>Best-fit line</strong> (${selected.length} pts): ${eq}</div>`,
        `<div><strong>Slope (m)</strong>: ${mStr}</div>`,
        `<div><strong>Y-intercept (b)</strong>: ${bStr}</div>`
      ].join('');
      refreshCreateDeleteBtn();
      return;
    }
    if (selected.length !== 2) {
      mathInfoLineContent.innerHTML = '';
      refreshCreateDeleteBtn();
      return;
    }
    function parseRow(tr) {
      const x = parseFloat(tr.querySelector('.cell-x')?.value);
      const y = parseFloat(tr.querySelector('.cell-y')?.value);
      return {x, y};
    }
    const p1 = parseRow(selected[0]);
    const p2 = parseRow(selected[1]);
    if (!Number.isFinite(p1.x) || !Number.isFinite(p1.y) || !Number.isFinite(p2.x) || !Number.isFinite(p2.y)) {
      mathInfoLineContent.innerHTML = 'Both selected rows must have numeric X and Y values.';
      refreshCreateDeleteBtn();
      return;
    }
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const samePoint = Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12;
    if (samePoint) {
      mathInfoLineContent.innerHTML = '<div><strong>Points coincide</strong>: slope undefined.</div>';
      refreshCreateDeleteBtn();
      return;
    }
    if (Math.abs(dx) < 1e-12) {
      const c = p1.x;
      const eq = `x = ${formatNum(c)}`;
      mathInfoLineContent.innerHTML = [
        `<div><strong>Line</strong>: ${eq}</div>`,
        `<div><strong>Slope (m)</strong>: undefined (vertical)</div>`,
        `<div><strong>Y-intercept (b)</strong>: n/a</div>`
      ].join('');
      refreshCreateDeleteBtn();
      return;
    }
    const m = dy / dx;
    const b = p1.y - m * p1.x;
    const mFrac = slopeAsFraction(dy, dx);
    const mStr = mFrac.str;
    const bStr = formatNum(b);
    const sign = b >= 0 ? '+' : '−';
    const absBStr = formatNum(Math.abs(b));
    const eq = `y = ${mStr}x ${sign} ${absBStr}`;
    mathInfoLineContent.innerHTML = [
      `<div><strong>Line</strong>: ${eq}</div>`,
      `<div><strong>Slope (m)</strong>: ${mStr}</div>`,
      `<div><strong>Y-intercept (b)</strong>: ${bStr}</div>`
    ].join('');
    refreshCreateDeleteBtn();
  }

  // Retrofit existing rows from older sessions (ensure Select checkbox and IDs)
  function retrofitExistingRows() {
    const rows = qsa('tbody tr', seriesContainer);
    for (const tr of rows) {
      // Ensure a unique data-row-id
      if (!tr.hasAttribute('data-row-id')) {
        tr.setAttribute('data-row-id', `R${rowIdSeq++}`);
      }
      // Ensure Select checkbox cell exists as the first cell
      const firstTd = tr.querySelector('td');
      const hasSelect = tr.querySelector('.select-point');
      if (!hasSelect) {
        const td = document.createElement('td');
        td.className = 'row-select';
        td.innerHTML = '<label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" class="select-point"> Select</label>';
        if (firstTd) {
          tr.insertBefore(td, firstTd);
        } else {
          tr.appendChild(td);
        }
      }
    }
  }

  // Initialize
  retrofitExistingRows();
  addSeriesBtn.addEventListener('click', () => { createSeriesCard(); retrofitExistingRows(); });
  if (createDeleteLineBtn) {
    createDeleteLineBtn.addEventListener('click', () => {
      const selected = Array.from(seriesContainer.querySelectorAll('tbody tr.selected-point'))
        .sort((a,b) => (parseInt(a.getAttribute('data-selected-at')||'0',10)) - (parseInt(b.getAttribute('data-selected-at')||'0',10)));
      if (selected.length !== 2) return;
      const id1 = selected[0].getAttribute('data-row-id');
      const id2 = selected[1].getAttribute('data-row-id');
      const key = pairKey(id1, id2);
      if (infiniteLines.has(key)) {
        infiniteLines.delete(key);
        updateChart();
        refreshCreateDeleteBtn();
      } else {
        const p1 = getRowXY(selected[0]);
        const p2 = getRowXY(selected[1]);
        const comp = computeMBFromRows(selected[0], selected[1]);
        if (!comp.valid || comp.vertical) return;
        infiniteLines.set(key, {
          rowIds: [id1, id2],
          datasetLabel: `Line through (${formatNum(p1.x)}, ${formatNum(p1.y)}) and (${formatNum(p2.x)}, ${formatNum(p2.y)})`,
          color: '#ff6f00'
        });
        updateChart();
        refreshCreateDeleteBtn();
      }
    });
  }

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const rows = qsa('tbody tr', seriesContainer);
      const selected = qsa('tbody tr.selected-point', seriesContainer);
      const allSelected = rows.length > 0 && selected.length === rows.length;
      if (!allSelected) {
        // Select all
        for (const tr of rows) {
          if (!tr.classList.contains('selected-point')) {
            tr.classList.add('selected-point');
            tr.setAttribute('data-selected-at', String(rowSelectCounter++));
            tr.style.backgroundColor = '#fff8e1';
          }
          const cb = qs('.select-point', tr);
          if (cb) cb.checked = true;
        }
      } else {
        // Clear all
        for (const tr of rows) {
          tr.classList.remove('selected-point');
          tr.removeAttribute('data-selected-at');
          tr.style.backgroundColor = '';
          const cb = qs('.select-point', tr);
          if (cb) cb.checked = false;
        }
      }
      updateMathInfoLineMode();
      refreshCreateDeleteBtn();
      updateChart();
      updateSelectAllBtnLabel();
    });
  }

  // React to control changes
  [xAxisLabelText, xAxisLabelSize, xAxisLabelColor, xAxisLabelFont,
   yAxisLabelText, yAxisLabelSize, yAxisLabelColor, yAxisLabelFont,
   xTickSize, xTickColor, xTickFont, yTickSize, yTickColor, yTickFont,
   legendDisplay, legendSize, legendColor, legendFont].forEach(el => {
    el.addEventListener('input', updateChart);
    el.addEventListener('change', updateChart);
  });

  // Initialize empty chart (no default series or data)
  updateChart();
  updateMathInfoLineMode();

  // Row selection for slope/equation info
  seriesContainer.addEventListener('click', (e) => {
    const tr = e.target.closest('tbody tr');
    if (!tr) return;
    if (e.target.closest('.del-row')) return; // ignore delete button
    if (e.target.tagName === 'INPUT' && !e.target.classList.contains('select-point')) return; // avoid toggling when editing

    // Toggle selection
    const wasSelected = tr.classList.contains('selected-point');
    if (wasSelected) {
      tr.classList.remove('selected-point');
      tr.removeAttribute('data-selected-at');
      tr.style.backgroundColor = '';
      const cb = qs('.select-point', tr);
      if (cb) cb.checked = false;
    } else {
      tr.classList.add('selected-point');
      tr.setAttribute('data-selected-at', String(rowSelectCounter++));
      tr.style.backgroundColor = '#fff8e1';
      const cb = qs('.select-point', tr);
      if (cb) cb.checked = true;
    }
    updateMathInfoLineMode();
    refreshCreateDeleteBtn();
    updateChart();
  });

  // Checkbox selection handler (more discoverable)
  seriesContainer.addEventListener('change', (e) => {
    const cb = e.target.closest('.select-point');
    if (!cb) return;
    const tr = e.target.closest('tr');
    if (!tr) return;
    if (cb.checked) {
      tr.classList.add('selected-point');
      tr.setAttribute('data-selected-at', String(rowSelectCounter++));
      tr.style.backgroundColor = '#fff8e1';
    } else {
      tr.classList.remove('selected-point');
      tr.removeAttribute('data-selected-at');
      tr.style.backgroundColor = '';
    }
    updateMathInfoLineMode();
    refreshCreateDeleteBtn();
    updateChart();
  });

  seriesContainer.addEventListener('input', () => {
    updateMathInfoLineMode();
  });

  // PDF Export
  async function exportPdf() {
    try {
      // Ensure chart is up to date
      updateChart();

      const { jsPDF } = window.jspdf || {};
      if (!jsPDF || !window.html2canvas) {
        alert('PDF export dependencies failed to load.');
        return;
      }

      // 1) First page: Chart in landscape A4
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const lMargin = 10;
      const lPageW = pdf.internal.pageSize.getWidth(); // 297mm for A4 landscape
      const lPageH = pdf.internal.pageSize.getHeight(); // 210mm for A4 landscape

      // Use the actual canvas pixels for best quality
      const chartEl = chartCanvas;
      const chartDataUrl = chartEl.toDataURL('image/png', 1.0);

      // Fit chart to page with margins, preserving aspect
      const availLW = lPageW - 2 * lMargin;
      const availLH = lPageH - 2 * lMargin;
      const cpxW = chartEl.width;
      const cpxH = chartEl.height;
      let drawLW = availLW;
      let drawLH = (cpxH / cpxW) * drawLW;
      if (drawLH > availLH) {
        drawLH = availLH;
        drawLW = (cpxW / cpxH) * drawLH;
      }
      const chartX = (lPageW - drawLW) / 2;
      const chartY = (lPageH - drawLH) / 2; // center vertically to reduce risk of label cutoff
      pdf.addImage(chartDataUrl, 'PNG', chartX, chartY, drawLW, drawLH, undefined, 'FAST');

      // 2) Subsequent page(s): Tables in portrait A4
      const portraitW = 210; // mm
      const portraitH = 297; // mm
      const pMargin = 10; // mm
      const availPW = portraitW - 2 * pMargin; // mm
      const availPH = portraitH - 2 * pMargin; // mm

      // Build a clean, export-only view of the series data (no controls/buttons)
      const tablesRoot = document.getElementById('seriesContainer');
      const hasContent = tablesRoot && tablesRoot.children.length > 0;

      if (hasContent) {
        // Create off-screen container to render clean tables
        const exportRoot = document.createElement('div');
        exportRoot.style.position = 'fixed';
        exportRoot.style.left = '-10000px';
        exportRoot.style.top = '0';
        exportRoot.style.zIndex = '-1';
        exportRoot.style.backgroundColor = '#ffffff';
        exportRoot.style.padding = '0';
        exportRoot.style.margin = '0';
        exportRoot.style.width = (Math.max(600, tablesRoot.clientWidth || 600)) + 'px';
        exportRoot.style.fontFamily = getComputedStyle(document.body).fontFamily;
        exportRoot.style.color = '#000';

        // For each series, render label and X/Y table only
        for (const { labelEl, colorEl, tbodyEl } of allSeries.values()) {
          const wrap = document.createElement('div');
          wrap.style.border = '1px solid #e0e0e0';
          wrap.style.borderRadius = '8px';
          wrap.style.padding = '8px';
          wrap.style.margin = '0 0 10px 0';
          wrap.style.background = '#fff';

          // Header: color swatch + label text
          const head = document.createElement('div');
          head.style.display = 'flex';
          head.style.alignItems = 'center';
          head.style.gap = '8px';
          head.style.marginBottom = '6px';

          const swatch = document.createElement('span');
          swatch.style.display = 'inline-block';
          swatch.style.width = '12px';
          swatch.style.height = '12px';
          swatch.style.borderRadius = '2px';
          swatch.style.background = (colorEl.value || '#1e88e5');

          const title = document.createElement('strong');
          title.textContent = (labelEl.value || 'Series').trim() || 'Series';

          head.appendChild(swatch);
          head.appendChild(title);
          wrap.appendChild(head);

          // Table with X and Y only
          const table = document.createElement('table');
          table.style.width = '100%';
          table.style.borderCollapse = 'collapse';
          table.style.tableLayout = 'fixed';

          const thead = document.createElement('thead');
          const thr = document.createElement('tr');
          const thx = document.createElement('th');
          thx.textContent = 'X';
          const thy = document.createElement('th');
          thy.textContent = 'Y';
          [thx, thy].forEach(th => {
            th.style.border = '1px solid #eee';
            th.style.padding = '4px 6px';
            th.style.textAlign = 'left';
          });
          thr.appendChild(thx);
          thr.appendChild(thy);
          thead.appendChild(thr);
          table.appendChild(thead);

          const tbody = document.createElement('tbody');
          const rows = Array.from(tbodyEl.querySelectorAll('tr'));
          let anyRow = false;
          for (const tr of rows) {
            const x = parseFloat(tr.querySelector('.cell-x')?.value ?? '');
            const yRaw = parseFloat(tr.querySelector('.cell-y')?.value ?? '');
            if (!Number.isNaN(x) && !Number.isNaN(yRaw)) {
              anyRow = true;
              const y = Math.max(0, yRaw);
              const rr = document.createElement('tr');
              const tdx = document.createElement('td');
              const tdy = document.createElement('td');
              tdx.textContent = String(x);
              tdy.textContent = String(y);
              [tdx, tdy].forEach(td => {
                td.style.border = '1px solid #f0f0f0';
                td.style.padding = '4px 6px';
                td.style.textAlign = 'left';
                td.style.whiteSpace = 'nowrap';
              });
              rr.appendChild(tdx);
              rr.appendChild(tdy);
              tbody.appendChild(rr);
            }
          }

          // If no valid numeric rows, still render an empty row to keep structure readable
          if (!anyRow) {
            const rr = document.createElement('tr');
            const tdx = document.createElement('td');
            const tdy = document.createElement('td');
            tdx.textContent = '';
            tdy.textContent = '';
            [tdx, tdy].forEach(td => {
              td.style.border = '1px solid #f0f0f0';
              td.style.padding = '4px 6px';
              td.style.textAlign = 'left';
              td.style.whiteSpace = 'nowrap';
            });
            rr.appendChild(tdx);
            rr.appendChild(tdy);
            tbody.appendChild(rr);
          }

          table.appendChild(tbody);
          wrap.appendChild(table);
          exportRoot.appendChild(wrap);
        }

        document.body.appendChild(exportRoot);

        const tblCanvas = await html2canvas(exportRoot, {
          backgroundColor: '#ffffff',
          scale: Math.min(3, Math.max(2, window.devicePixelRatio || 2)),
          useCORS: true,
          logging: false
        });

        // Clean up the temporary DOM
        exportRoot.remove();

        const imgWpx = tblCanvas.width;
        const imgHpx = tblCanvas.height;

        // Compute scaling so that image width fits the available portrait width
        const wmm = availPW; // we will draw with this width in mm
        const pxPerMm = imgWpx / wmm; // pixels per mm at this target width
        const pageSlicePx = Math.floor(availPH * pxPerMm); // max pixels per page vertically

        // We will slice the tall canvas into page-height chunks
        let y = 0;
        let firstTablePage = true;
        while (y < imgHpx) {
          const sliceHpx = Math.min(pageSlicePx, imgHpx - y);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = imgWpx;
          sliceCanvas.height = sliceHpx;
          const sctx = sliceCanvas.getContext('2d');
          sctx.drawImage(tblCanvas, 0, y, imgWpx, sliceHpx, 0, 0, imgWpx, sliceHpx);
          const sliceUrl = sliceCanvas.toDataURL('image/png', 1.0);

          // Add a new portrait page and place the slice
          pdf.addPage('a4', 'portrait');
          const sliceHmm = sliceHpx / pxPerMm; // mm
          pdf.addImage(sliceUrl, 'PNG', pMargin, pMargin, wmm, sliceHmm, undefined, 'FAST');

          y += sliceHpx;
        }
      }

      pdf.save('line_graph.pdf');
    } catch (err) {
      console.error('Export PDF failed:', err);
      alert('Failed to export PDF. See console for details.');
    }
  }

  const exportBtn = document.getElementById('exportPdfBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportPdf());
  }
  // Collaboration (Socket.IO) setup for multi-user real-time line graph editing
  (async function setupCollaboration(){
    const presenceEl = document.getElementById('presence');
    const shareBtn = document.getElementById('shareSessionBtn');
    const joinBtn = document.getElementById('joinSessionBtn');
    const getParam = (name) => new URLSearchParams(window.location.search).get(name);

    async function ensurePin(mode) {
      let pin = (getParam('pin') || '').trim();
      if (!pin) {
        try {
          const res = await fetch(`/api/new-session?mode=${encodeURIComponent(mode)}`);
          const data = await res.json();
          pin = String(data.pin || '').trim();
          if (pin) {
            const url = new URL(window.location.href);
            url.searchParams.set('pin', pin);
            history.replaceState(null, '', url.toString());
          }
        } catch (e) {
          console.error('Failed to create a new session PIN', e);
        }
      }
      return pin;
    }

    const mode = 'line';
    const pin = await ensurePin(mode);
    window.currentSessionPin = pin;
    const room = pin || (window.location.pathname + ':line');
    const clientId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));

    function setPresence(count, online) {
      if (!presenceEl) return;
      if (!online) {
        presenceEl.textContent = '• Offline';
        return;
      }
      const n = Number(count) || 1;
      presenceEl.textContent = `• ${n} online`;
    }

    function setupShareJoinUi() {
      if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
          const txt = `Session PIN: ${window.currentSessionPin || pin}`;
          try {
            if (navigator.clipboard && window.isSecureContext) {
              await navigator.clipboard.writeText(window.currentSessionPin || pin);
              alert(`${txt}\n(Copied to clipboard)`);
            } else {
              window.prompt('Copy this PIN to share:', window.currentSessionPin || pin);
            }
          } catch(_) {
            window.prompt('Copy this PIN to share:', window.currentSessionPin || pin);
          }
        });
      }
      if (joinBtn) {
        joinBtn.addEventListener('click', () => {
          const input = window.prompt('Enter the PIN to join another session:');
          const val = (input || '').trim();
          if (!val) return;
          const cleaned = val.replace(/\s+/g, '');
          const url = new URL(window.location.href);
          url.searchParams.set('pin', cleaned);
          window.location.href = url.toString();
        });
      }
    }

    setupShareJoinUi();

    function serializeLineState() {
      const series = [];
      for (const { cardEl, labelEl, colorEl, widthEl, tbodyEl } of allSeries.values()) {
        const rows = [];
        Array.from(tbodyEl.querySelectorAll('tr')).forEach(tr => {
          const x = tr.querySelector('.cell-x')?.value ?? '';
          const y = tr.querySelector('.cell-y')?.value ?? '';
          rows.push({ x: String(x), y: String(y) });
        });
        series.push({
          label: labelEl.value || '',
          color: colorEl.value || '#1e88e5',
          width: Number(widthEl.value) || 2,
          rows,
        });
      }
      return {
        axes: {
          x: { text: xAxisLabelText.value || '', size: Number(xAxisLabelSize.value) || 14, color: xAxisLabelColor.value || '#333', font: xAxisLabelFont.value },
          y: { text: yAxisLabelText.value || '', size: Number(yAxisLabelSize.value) || 14, color: yAxisLabelColor.value || '#333', font: yAxisLabelFont.value },
        },
        ticks: {
          x: { size: Number(xTickSize.value) || 12, color: xTickColor.value || '#444', font: xTickFont.value },
          y: { size: Number(yTickSize.value) || 12, color: yTickColor.value || '#444', font: yTickFont.value },
        },
        legend: {
          display: !!legendDisplay.checked,
          size: Number(legendSize.value) || 12,
          color: legendColor.value || '#333',
          font: legendFont.value,
        },
        series,
      };
    }

    function restoreLineState(state) {
      if (!state) return;
      const now = Date.now();
      const RECENT_EDIT_MS = 1500;

      function recentlyEdited(el) {
        if (!el) return false;
        if (document.activeElement === el) return true;
        const t = Number(el.dataset?.lastEdit || 0);
        return (now - t) < RECENT_EDIT_MS;
      }

      // Capture current focus to restore later
      const activeEl = document.activeElement;
      const focusInfo = (() => {
        if (!activeEl || !seriesContainer.contains(activeEl)) return null;
        const cardEl = activeEl.closest('.series-card');
        if (!cardEl) return null;
        const seriesIndex = Array.prototype.indexOf.call(seriesContainer.children, cardEl);
        if (seriesIndex < 0) return null;
        let name = null, rowIndex = null;
        if (activeEl.classList.contains('series-label')) name = 'label';
        else if (activeEl.classList.contains('series-color')) name = 'color';
        else if (activeEl.classList.contains('series-width')) name = 'width';
        else if (activeEl.classList.contains('cell-x')) name = 'x';
        else if (activeEl.classList.contains('cell-y')) name = 'y';
        if (name === 'x' || name === 'y') {
          const tr = activeEl.closest('tr');
          rowIndex = tr ? Array.prototype.indexOf.call(cardEl.querySelector('tbody')?.children || [], tr) : -1;
        }
        return { seriesIndex, name, rowIndex, selStart: activeEl.selectionStart, selEnd: activeEl.selectionEnd };
      })();

      // Avoid rebroadcast while applying remote
      suppressBroadcast = true;

      // Axes
      if (state.axes) {
        if (!recentlyEdited(xAxisLabelText)) xAxisLabelText.value = state.axes.x?.text ?? xAxisLabelText.value;
        if (!recentlyEdited(xAxisLabelSize)) xAxisLabelSize.value = state.axes.x?.size ?? xAxisLabelSize.value;
        if (!recentlyEdited(xAxisLabelColor)) xAxisLabelColor.value = state.axes.x?.color ?? xAxisLabelColor.value;
        if (!recentlyEdited(xAxisLabelFont)) xAxisLabelFont.value = state.axes.x?.font ?? xAxisLabelFont.value;
        if (!recentlyEdited(yAxisLabelText)) yAxisLabelText.value = state.axes.y?.text ?? yAxisLabelText.value;
        if (!recentlyEdited(yAxisLabelSize)) yAxisLabelSize.value = state.axes.y?.size ?? yAxisLabelSize.value;
        if (!recentlyEdited(yAxisLabelColor)) yAxisLabelColor.value = state.axes.y?.color ?? yAxisLabelColor.value;
        if (!recentlyEdited(yAxisLabelFont)) yAxisLabelFont.value = state.axes.y?.font ?? yAxisLabelFont.value;
      }
      // Ticks
      if (state.ticks) {
        if (!recentlyEdited(xTickSize)) xTickSize.value = state.ticks.x?.size ?? xTickSize.value;
        if (!recentlyEdited(xTickColor)) xTickColor.value = state.ticks.x?.color ?? xTickColor.value;
        if (!recentlyEdited(xTickFont)) xTickFont.value = state.ticks.x?.font ?? xTickFont.value;
        if (!recentlyEdited(yTickSize)) yTickSize.value = state.ticks.y?.size ?? yTickSize.value;
        if (!recentlyEdited(yTickColor)) yTickColor.value = state.ticks.y?.color ?? yTickColor.value;
        if (!recentlyEdited(yTickFont)) yTickFont.value = state.ticks.y?.font ?? yTickFont.value;
      }
      // Legend
      if (state.legend) {
        legendDisplay.checked = !!state.legend.display;
        if (!recentlyEdited(legendSize)) legendSize.value = state.legend.size ?? legendSize.value;
        if (!recentlyEdited(legendColor)) legendColor.value = state.legend.color ?? legendColor.value;
        if (!recentlyEdited(legendFont)) legendFont.value = state.legend.font ?? legendFont.value;
      }

      // Series: incrementally sync to avoid blowing away focus/edits
      const desiredSeries = state.series || [];

      // Ensure series count matches
      let currentCards = Array.from(seriesContainer.children);
      for (let i = currentCards.length; i < desiredSeries.length; i++) {
        createSeriesCard(true);
      }
      currentCards = Array.from(seriesContainer.children);
      for (let i = currentCards.length - 1; i >= desiredSeries.length; i--) {
        const card = currentCards[i];
        const id = card?.dataset?.id;
        if (id) allSeries.delete(id);
        card.remove();
      }

      // Update each series
      for (let i = 0; i < desiredSeries.length; i++) {
        const s = desiredSeries[i] || {};
        const card = seriesContainer.children[i];
        if (!card) continue;
        const tbodyEl = card.querySelector('tbody');
        const labelEl = card.querySelector('.series-label');
        const colorEl = card.querySelector('.series-color');
        const widthEl = card.querySelector('.series-width');

        if (labelEl && !recentlyEdited(labelEl)) labelEl.value = s.label ?? '';
        if (colorEl && !recentlyEdited(colorEl)) colorEl.value = s.color ?? '#1e88e5';
        if (widthEl && !recentlyEdited(widthEl)) widthEl.value = s.width ?? 2;

        const rows = Array.isArray(s.rows) ? s.rows : [];
        let currentRows = Array.from(tbodyEl.children);
        // Add missing rows
        for (let r = currentRows.length; r < rows.length; r++) {
          const tr = document.createElement('tr');
          const rv = rows[r] || {};
          tr.innerHTML = `
            <td><input type="number" step="any" class="cell-x" value="${rv.x ?? ''}" aria-label="X value"></td>
            <td><input type="number" step="any" class="cell-y" value="${rv.y ?? ''}" aria-label="Y value"></td>
            <td class="row-actions"><button type="button" class="del-row">Delete</button></td>
          `;
          tbodyEl.appendChild(tr);
        }
        // Remove extra rows
        currentRows = Array.from(tbodyEl.children);
        for (let r = currentRows.length - 1; r >= rows.length; r--) {
          currentRows[r].remove();
        }
        // Update values
        currentRows = Array.from(tbodyEl.children);
        for (let r = 0; r < rows.length; r++) {
          const tr = currentRows[r];
          if (!tr) continue;
          const xEl = tr.querySelector('.cell-x');
          const yEl = tr.querySelector('.cell-y');
          const rv = rows[r] || {};
          if (xEl && !recentlyEdited(xEl)) xEl.value = rv.x ?? '';
          if (yEl && !recentlyEdited(yEl)) yEl.value = rv.y ?? '';
        }
      }

      // Update chart once after applying
      updateChart();
      suppressBroadcast = false;

      // Try to restore focus and caret
      if (focusInfo && Number.isInteger(focusInfo.seriesIndex) && focusInfo.seriesIndex >= 0) {
        const card = seriesContainer.children[focusInfo.seriesIndex];
        let el = null;
        if (card) {
          if (focusInfo.name === 'label') el = card.querySelector('.series-label');
          else if (focusInfo.name === 'color') el = card.querySelector('.series-color');
          else if (focusInfo.name === 'width') el = card.querySelector('.series-width');
          else if (focusInfo.name === 'x' || focusInfo.name === 'y') {
            const tbody = card.querySelector('tbody');
            const tr = tbody && tbody.children[focusInfo.rowIndex];
            if (tr) el = tr.querySelector(focusInfo.name === 'x' ? '.cell-x' : '.cell-y');
          }
        }
        if (el) {
          try {
            el.focus({ preventScroll: true });
            if (typeof focusInfo.selStart === 'number' && typeof focusInfo.selEnd === 'number' && el.setSelectionRange) {
              el.setSelectionRange(focusInfo.selStart, focusInfo.selEnd);
            }
          } catch(_){}
        }
      }
    }

    let suppressBroadcast = false;
    let broadcastTimer = null;
    function scheduleBroadcast(socket) {
      if (!socket || suppressBroadcast) return;
      clearTimeout(broadcastTimer);
      broadcastTimer = setTimeout(() => {
        try {
          socket.emit('state_update', { room, mode: 'line', clientId, state: serializeLineState() });
        } catch(_){ }
      }, 120);
    }

    if (typeof io !== 'undefined') {
      const socket = io();

      socket.on('connect', () => {
        setPresence(1, true);
        socket.emit('join', { room, mode: 'line' });
        socket.emit('request_state', { room, mode: 'line' });
      });

      socket.on('disconnect', () => setPresence(0, false));
      socket.on('presence', (p) => { if (p && p.room === room) setPresence(p.count, true); });

      function applyRemote(msg) {
        if (!msg || msg.room !== room || msg.mode !== 'line' || msg.clientId === clientId) return;
        restoreLineState(msg.state);
      }

      // Editing guard to prevent disruptive remote overwrites while user is interacting
      let isEditing = false;
      let editIdleTimer = null;
      let pendingRemoteState = null;

      function armEditIdleTimer(delay = 500) {
        clearTimeout(editIdleTimer);
        editIdleTimer = setTimeout(() => {
          isEditing = false;
          if (pendingRemoteState) {
            const st = pendingRemoteState;
            pendingRemoteState = null;
            restoreLineState(st);
          }
        }, delay);
      }

      function markEditingPulse(delay = 500) {
        isEditing = true;
        armEditIdleTimer(delay);
      }

      // Mark editing on pointer and input within the series container
      seriesContainer.addEventListener('pointerdown', () => markEditingPulse(1200), { passive: true });
      seriesContainer.addEventListener('input', (e) => {
        const t = e.target;
        if (t && (t.matches('input,select,textarea'))) {
          t.dataset.lastEdit = String(Date.now());
          markEditingPulse(1200);
        }
      });
      seriesContainer.addEventListener('focusin', (e) => {
        if (e.target && (e.target.matches('input,select,textarea'))) {
          markEditingPulse(1200);
        }
      });
      seriesContainer.addEventListener('focusout', () => armEditIdleTimer(150));

      function maybeApplyRemoteState(state) {
        if (!state) return;
        if (isEditing) {
          pendingRemoteState = state; // keep only the latest
          return;
        }
        restoreLineState(state);
      }

      socket.on('state', (msg) => { if (msg && msg.room === room && msg.mode === 'line') maybeApplyRemoteState(msg.state); });
      socket.on('state_update', (msg) => {
        if (!msg || msg.room !== room || msg.mode !== 'line' || msg.clientId === clientId) return;
        maybeApplyRemoteState(msg.state);
      });

      // Decorate updateChart to also broadcast (debounced)
      const _updateChart = updateChart;
      updateChart = function() {
        _updateChart();
        if (!suppressBroadcast) {
          scheduleBroadcast(socket);
        }
      };

      // Seed an initial broadcast after first render so later joiners may get state
      setTimeout(() => scheduleBroadcast(socket), 300);
    } else {
      setPresence(0, false);
    }
  })();

  // Escape clears selection of all rows in Line Graph Mode
  function clearAllRowSelections() {
    const selected = qsa('tbody tr.selected-point', seriesContainer);
    if (selected.length === 0) return false;
    for (const tr of selected) {
      tr.classList.remove('selected-point');
      tr.removeAttribute('data-selected-at');
      tr.style.backgroundColor = '';
      const cb = qs('.select-point', tr);
      if (cb) cb.checked = false;
    }
    updateMathInfoLineMode();
    refreshCreateDeleteBtn();
    updateChart();
    updateSelectAllBtnLabel();
    return true;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const cleared = clearAllRowSelections();
      if (cleared) {
        e.preventDefault();
      }
    }
  });
})();
