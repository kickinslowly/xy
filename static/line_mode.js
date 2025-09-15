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

  /** @type {Chart|null} */
  let chart = null;

  // State: list of series, each with DOM refs and id
  let seriesSeq = 1;
  const allSeries = new Map(); // id -> {id, cardEl, labelEl, colorEl, widthEl, tbodyEl}

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
          <label>Thickness: <input type="number" class="series-width" min="1" max="10" step="1" value="2" aria-label="Series line thickness"></label>
        </div>
        <div>
          <button type="button" class="add-row">+ Row</button>
          <button type="button" class="remove-series" title="Remove series">Remove</button>
        </div>
      </header>
      <table aria-label="Data table for ${id}">
        <thead>
          <tr><th style="width:40%">X</th><th style="width:40%">Y</th><th class="row-actions" style="width:20%">Action</th></tr>
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

    function addRow(x = '', y = '') {
      const tr = document.createElement('tr');
      tr.innerHTML = `
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
        tr.remove();
        updateChart();
      }
    });
    removeSeriesBtn.addEventListener('click', () => {
      allSeries.delete(id);
      card.remove();
      updateChart();
    });

    seriesContainer.appendChild(card);
    allSeries.set(id, { id, cardEl: card, labelEl, colorEl, widthEl, tbodyEl: tbody });
    if (!initial) updateChart();
    return id;
  }

  function gatherSeriesData() {
    /** @type {{label:string, color:string, width:number, points:{x:number,y:number}[]}[]} */
    const result = [];
    for (const { cardEl, labelEl, colorEl, widthEl, tbodyEl } of allSeries.values()) {
      const pts = [];
      qsa('tr', tbodyEl).forEach(tr => {
        const x = parseFloat(qs('.cell-x', tr)?.value ?? '');
        const y = parseFloat(qs('.cell-y', tr)?.value ?? '');
        if (!Number.isNaN(x) && !Number.isNaN(y)) {
          // Enforce y >= 0 (positive quadrant along Y) by clamping
          pts.push({ x, y: Math.max(0, y) });
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
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          y: {
            type: 'linear',
            beginAtZero: true,
            min: 0,
            title: { display: true, text: 'Y' },
            ticks: { color: '#444', font: { size: 12, family: getComputedStyle(document.body).fontFamily }, stepSize: 1 },
            grid: { color: 'rgba(0,0,0,0.06)' },
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

  function updateChart() {
    const sers = gatherSeriesData();
    const c = ensureChart();

    // Update datasets
    c.data.datasets = sers.map(s => ({
      label: s.label || 'Series',
      data: s.points,
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: s.width,
      pointRadius: 3,
      pointHoverRadius: 4,
      showLine: true,
      fill: false,
      tension: 0, // straight lines
    }));

    // Axis bounds: x can be negative, y constrained to >= 0
    const xb = computeXBounds(sers);
    c.options.scales.x.min = xb.min;
    c.options.scales.x.max = xb.max;
    c.options.scales.y.min = 0; // positive Y only

    // Axis titles and styles
    c.options.scales.x.title.display = true;
    c.options.scales.x.title.text = xAxisLabelText.value || '';
    c.options.scales.x.title.color = xAxisLabelColor.value || '#333';
    c.options.scales.x.title.font = { size: clampNum(xAxisLabelSize.value, 8, 48, 14), family: xAxisLabelFont.value };

    c.options.scales.y.title.display = true;
    c.options.scales.y.title.text = yAxisLabelText.value || '';
    c.options.scales.y.title.color = yAxisLabelColor.value || '#333';
    c.options.scales.y.title.font = { size: clampNum(yAxisLabelSize.value, 8, 48, 14), family: yAxisLabelFont.value };

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
  }

  function clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
    return fallback;
  }

  // Initialize
  addSeriesBtn.addEventListener('click', () => createSeriesCard());

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
})();
