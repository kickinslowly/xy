(() => {
  // Utilities
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick2 = (arr) => {
    if (!arr || arr.length < 2) return [arr && arr[0], arr && arr[0]];
    const i = Math.floor(Math.random() * arr.length);
    let j = Math.floor(Math.random() * arr.length);
    if (j === i) j = (j + 1) % arr.length;
    return [arr[i], arr[j]];
  };
  // Tracks the last challenge kind in master mode so we can avoid repeats.
  let _lastMasterKind = null;
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = b; b = a % b; a = t; } return a || 1; };
  const formatRatio = (a, b) => `${a} : ${b}`;

  // DOM elements
  const presenceEl = qs('#presence');
  const shareBtn = qs('#shareSessionBtn');
  const joinBtn = qs('#joinSessionBtn');
  const qrModal = qs('#qrModal');
  const qrImg = qs('#qrImage');
  const qrLinkText = qs('#qrLinkText');
  const qrPinText = qs('#qrPinText');
  const closeQrBtn = qs('#closeQrModal');

  const modePills = qsa('.mode-pill');
  const scoreBarFill = qs('#scoreBarFill');
  const nextChallengeBtn = qs('#nextChallengeBtn');
  const scoreEl = qs('#score');
  const challengeText = qs('#challengeText');
  const palette = qs('#palette');
  const board = qs('#board');
  const submitBtn = qs('#submitBtn');
  const clearBtn = qs('#clearBtn');
  const toast = qs('#toast');
  const victory = qs('#victory');
  const victoryTitle = qs('#victoryTitle');
  const victorySub = qs('#victorySub');
  const victoryClose = qs('#victoryClose');
  const victoryAgain = qs('#victoryAgain');
  const confettiEl = qs('#confetti');
  const confettiSuccessEl = qs('#confettiSuccess');
  const balloonsSuccessEl = qs('#balloonsSuccess');
  const splashSuccess = qs('#splashSuccess');
  const splashFail = qs('#splashFail');

  // Session/room
  const url = new URL(location.href);
  let room = url.searchParams.get('room');
  const modeId = 'ratios';

  // Connection
  const socket = io();
  let clientId = Math.random().toString(36).slice(2, 10);

  // Shared state with room
  /** @type {{ score:number, current?: any, mode?: string }} */
  let sharedState = { score: 0, mode: 'create' };

  // Local build state
  /** @type {Record<string, number>} */
  let boardCounts = {}; // src -> count

  function showToast(msg, time = 1400) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), time);
  }

  // Brief full-screen splash helper
  function flash(el, duration = 1100) {
    if (!el) return;
    el.classList.add('show');
    const token = Symbol('splash');
    el._token = token;
    setTimeout(() => { if (el._token === token) el.classList.remove('show'); }, duration);
  }

  function ensureRoom(callback) {
    if (room) { callback && callback(room); return; }
    fetch(`/api/new-session?mode=${encodeURIComponent(modeId)}`)
      .then(r => r.json())
      .then(data => {
        room = data.pin;
        url.searchParams.set('room', room);
        history.replaceState({}, '', url.toString());
        updateShareUI();
        callback && callback(room);
      })
      .catch(() => {
        room = Math.random().toString().slice(2, 8);
        url.searchParams.set('room', room);
        history.replaceState({}, '', url.toString());
        updateShareUI();
        callback && callback(room);
      });
  }

  function updateShareUI() {
    const link = `${location.origin}${location.pathname}?room=${room}`;
    if (qrLinkText) qrLinkText.value = link;
    if (qrPinText) qrPinText.textContent = `PIN: ${room}`;
    if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(link)}`;
  }

  function openQr() { if (!qrModal) return; qrModal.hidden = false; qrModal.setAttribute('aria-hidden', 'false'); }
  function closeQr() { if (!qrModal) return; qrModal.hidden = true; qrModal.setAttribute('aria-hidden', 'true'); }

  function joinSocket() {
    socket.emit('join', { room, mode: modeId });
    socket.emit('request_state', { room, mode: modeId });
  }

  // Presence
  socket.on('presence', (data) => {
    if (data && data.room === room && presenceEl) {
      presenceEl.textContent = `• ${data.count} online`;
    }
  });

  // On direct state response
  socket.on('state', (msg) => {
    if (!msg || msg.room !== room || msg.mode !== modeId) return;
    if (msg.state) {
      sharedState = Object.assign({ score: 0, mode: 'create' }, msg.state);
      applySharedState();
    }
  });

  // On broadcasted state update from others
  socket.on('state_update', (msg) => {
    if (!msg || msg.room !== room || msg.mode !== modeId) return;
    if (msg.state) {
      sharedState = Object.assign({ score: 0, mode: 'create' }, msg.state);
      applySharedState();
    }
  });

  function broadcastState() {
    socket.emit('state_update', { room, mode: modeId, clientId, state: sharedState });
  }

  // Adaptive difficulty: 0=Beginner, 1=Developing, 2=Proficient, 3=Advanced.
  // State + streak math live in static/adaptive_difficulty.js (shared with main.js).
  // Level persists per-mode to localStorage; badge stays in sync across page loads.
  const ADAPTIVE_MODE_KEY = 'ratios';
  const DIFF_LABELS = (window.AdaptiveDifficulty && window.AdaptiveDifficulty.LABELS) || ['Beginner', 'Developing', 'Proficient', 'Advanced'];
  let challengeDifficulty = (window.AdaptiveDifficulty ? window.AdaptiveDifficulty.getLevel(ADAPTIVE_MODE_KEY) : 1);

  function rndForDifficulty() {
    switch (challengeDifficulty) {
      case 0: return rnd(1, 3);
      case 2: return rnd(1, 8);
      case 3: return rnd(2, 12);
      default: return rnd(1, 5);
    }
  }
  function adjustDifficulty(correct) {
    if (!window.AdaptiveDifficulty) return;
    const r = window.AdaptiveDifficulty.recordResult(ADAPTIVE_MODE_KEY, !!correct);
    challengeDifficulty = r.level;
    window.AdaptiveDifficulty.updateBadges(r.level);
  }
  function updateDifficultyBadge() {
    if (window.AdaptiveDifficulty) window.AdaptiveDifficulty.updateBadges(challengeDifficulty);
  }
  try { updateDifficultyBadge(); } catch(e) {}

  // Challenge generation
  function generateChallenge(kind) {
    const memes = (window.AVAILABLE_MEMES || []).slice();
    if (memes.length < 2) return null; // Need two distinct memes for any ratio prompt
    let nowKind = kind || sharedState.mode || 'create';
    if (nowKind === 'master') {
      const kinds = ['create', 'partpart', 'partwhole', 'equiv', 'unitrate', 'table', 'scale', 'simplify'];
      // Anti-repeat: re-roll once if we'd repeat the previous kind. Keeps
      // master mode varied without dropping any kind from rotation.
      let pick = kinds[Math.floor(Math.random() * kinds.length)];
      if (pick === _lastMasterKind && kinds.length > 1) {
        pick = kinds[Math.floor(Math.random() * kinds.length)];
      }
      nowKind = pick;
      _lastMasterKind = pick;
    }

    if (nowKind === 'unitrate') {
      const [aSrc, bSrc] = pick2(memes);
      // b is the "per 1" denominator; a is the total of the other meme.
      // At Beginner/Developing: a is always evenly divisible by b.
      let b = rnd(2, challengeDifficulty >= 2 ? 6 : 4);
      let a;
      if (challengeDifficulty <= 1) {
        // Always divides evenly
        const mult = rnd(2, challengeDifficulty === 0 ? 3 : 5);
        a = b * mult;
      } else {
        // May not divide evenly at Proficient+
        a = rnd(3, 12);
        if (a === b) a = b + 1;
      }
      // answer: a / b  (how many aSrc per 1 bSrc)
      return { type: 'unitrate', aSrc, bSrc, a, b, answer: a / b };
    }
    if (nowKind === 'table') {
      const [aSrc, bSrc] = pick2(memes);
      // Base ratio a : b  (small, coprime-ish)
      const a = rnd(1, challengeDifficulty >= 2 ? 5 : 3);
      let b = rnd(1, challengeDifficulty >= 2 ? 5 : 3);
      if (b === a && a < 5) b = a + 1;
      // Build 4 rows with multipliers
      const mults = [1, 2, 3, 4];
      if (challengeDifficulty >= 2) { mults[2] = rnd(3, 5); mults[3] = rnd(5, 8); }
      if (challengeDifficulty >= 3) { mults[1] = rnd(2, 4); mults[2] = rnd(4, 7); mults[3] = rnd(6, 10); }
      const rows = mults.map(m => ({ aVal: a * m, bVal: b * m }));
      // Decide which cells are blank
      // First row is always shown as the "seed". Pick 2 or 3 blanks from rows 1-3.
      const numBlanks = challengeDifficulty >= 2 ? 3 : 2;
      const blanks = []; // each: { row, col } where col='a' or 'b'
      const available = [];
      for (let r = 1; r <= 3; r++) {
        available.push({ row: r, col: 'a' });
        available.push({ row: r, col: 'b' });
      }
      // Shuffle and pick
      for (let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
      }
      // Ensure no row has both cells blank (student needs at least one clue per row)
      const usedRows = new Set();
      for (const slot of available) {
        if (blanks.length >= numBlanks) break;
        if (usedRows.has(slot.row)) continue;
        blanks.push(slot);
        usedRows.add(slot.row);
      }
      // If we still need blanks, allow a second blank in a row that already has one
      // only if the other cell provides enough info (the base ratio is known from row 0)
      if (blanks.length < numBlanks) {
        for (const slot of available) {
          if (blanks.length >= numBlanks) break;
          if (blanks.some(b => b.row === slot.row && b.col === slot.col)) continue;
          blanks.push(slot);
        }
      }
      return { type: 'table', aSrc, bSrc, a, b, rows, blanks };
    }
    if (nowKind === 'scale') {
      const [aSrc, bSrc] = pick2(memes);
      let a = rndForDifficulty(), b = rndForDifficulty();
      if (a === b && a < 6) b = a + 1;
      const maxMult = challengeDifficulty <= 1 ? 6 : 12;
      const mult = rnd(2, maxMult);
      // Randomly blank either the scaled a or scaled b
      const blankSide = Math.random() < 0.5 ? 'a' : 'b';
      return { type: 'scale', aSrc, bSrc, a, b, mult, blankSide, answer: blankSide === 'a' ? a * mult : b * mult };
    }
    if (nowKind === 'simplify') {
      const [aSrc, bSrc] = pick2(memes);
      // Pick a simple base ratio, then multiply by a factor
      let a = rnd(1, 6), b = rnd(1, 6);
      // Ensure a:b is already in simplest form (gcd=1) and not a=b
      const g = gcd(a, b);
      a = a / g; b = b / g;
      if (a === b) b = (b % 6) + 1;
      const factor = rnd(2, challengeDifficulty <= 1 ? 4 : 6);
      return { type: 'simplify', aSrc, bSrc, simpleA: a, simpleB: b, shownA: a * factor, shownB: b * factor };
    }
    if (nowKind === 'equiv') {
      const [aSrc, bSrc] = pick2(memes);
      let a = rndForDifficulty(), b = rndForDifficulty();
      // Avoid degenerate 1:1 prompts where the only equivalent ratios are
      // visually identical multiples of the same image counts.
      if (a === b) b = (b % 6) + 1;
      return { type: 'equiv', aSrc, bSrc, a, b };
    }
    if (nowKind === 'partwhole') {
      const [aSrc, bSrc] = pick2(memes);
      const a = rndForDifficulty(), b = rndForDifficulty();
      const which = Math.random() < 0.5 ? 'a' : 'b';
      return { type: 'partwhole', aSrc, bSrc, a, b, which };
    }
    // create/partpart default
    const [aSrc, bSrc] = pick2(memes);
    const a = rndForDifficulty(), b = rndForDifficulty();
    return { type: nowKind === 'partpart' ? 'partpart' : 'create', aSrc, bSrc, a, b };
  }

  function imgBadge(src) { return `<img src="${src}" alt="meme" style="width:28px; height:28px; object-fit:contain; vertical-align:middle; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.15); background:#fff; margin:0 4px;"/>`; }
  function challengeTextFor(ch) {
    if (!ch) return 'Loading...';
    if (ch.type === 'scale') {
      const scaledA = ch.a * ch.mult;
      const scaledB = ch.b * ch.mult;
      const leftVal = ch.blankSide === 'a' ? '?' : scaledA;
      const rightVal = ch.blankSide === 'b' ? '?' : scaledB;
      return `
        <div class="rp-wrap">
          <div class="rp-label">Scale this ratio</div>
          <div class="ratio-prompt" role="group" aria-label="Original ratio">
            <div class="row images">
              <img class="rp-img" src="${ch.aSrc}" alt="meme A" />
              <span class="rp-colon">:</span>
              <img class="rp-img" src="${ch.bSrc}" alt="meme B" />
            </div>
            <div class="row numbers">
              <span class="rp-num">${ch.a}</span>
              <span class="rp-colon">:</span>
              <span class="rp-num">${ch.b}</span>
            </div>
          </div>
          <div class="rp-label" style="margin-top:10px;">Fill in the missing value</div>
          <div class="ratio-prompt" role="group" aria-label="Scaled ratio with blank">
            <div class="row images">
              <img class="rp-img" src="${ch.aSrc}" alt="meme A" />
              <span class="rp-colon">:</span>
              <img class="rp-img" src="${ch.bSrc}" alt="meme B" />
            </div>
            <div class="row numbers" style="gap:10px;">
              ${ch.blankSide === 'a'
                ? `<input id="scaleInput" type="number" min="0" step="1" inputmode="numeric" placeholder="?"
                    class="scale-input" />`
                : `<span class="rp-num">${scaledA}</span>`}
              <span class="rp-colon">:</span>
              ${ch.blankSide === 'b'
                ? `<input id="scaleInput" type="number" min="0" step="1" inputmode="numeric" placeholder="?"
                    class="scale-input" />`
                : `<span class="rp-num">${scaledB}</span>`}
            </div>
          </div>
        </div>
      `;
    }
    if (ch.type === 'simplify') {
      return `
        <div class="rp-wrap">
          <div class="rp-label">Simplify this ratio</div>
          <div class="ratio-prompt" role="group" aria-label="Ratio to simplify">
            <div class="row images">
              <img class="rp-img" src="${ch.aSrc}" alt="meme A" />
              <span class="rp-colon">:</span>
              <img class="rp-img" src="${ch.bSrc}" alt="meme B" />
            </div>
            <div class="row numbers">
              <span class="rp-num">${ch.shownA}</span>
              <span class="rp-colon">:</span>
              <span class="rp-num">${ch.shownB}</span>
            </div>
          </div>
          <div class="rp-label" style="margin-top:10px;">Your simplified ratio</div>
          <div class="simplify-inputs" role="group" aria-label="Enter simplified ratio">
            <input id="simplifyA" type="number" min="1" step="1" inputmode="numeric" placeholder="?"
              class="scale-input" />
            <span class="rp-colon">:</span>
            <input id="simplifyB" type="number" min="1" step="1" inputmode="numeric" placeholder="?"
              class="scale-input" />
          </div>
        </div>
      `;
    }
    if (ch.type === 'equiv') {
      return `
        <div class="rp-wrap">
          <div class="rp-label">Create an equivalent ratio to</div>
          <div class="ratio-prompt" role="group" aria-label="Equivalent ratio">
            <div class="row images">
              <img class="rp-img" src="${ch.aSrc}" alt="meme A" />
              <span class="rp-colon">:</span>
              <img class="rp-img" src="${ch.bSrc}" alt="meme B" />
            </div>
            <div class="row numbers">
              <span class="rp-num">${ch.a}</span>
              <span class="rp-colon">:</span>
              <span class="rp-num">${ch.b}</span>
            </div>
          </div>
        </div>
      `;
    }
    if (ch.type === 'partwhole') {
      const which = ch.which === 'b' ? 'b' : 'a';
      const whichLabel = which === 'a' ? 'meme A' : 'meme B';
      const totalPlaceholder = ch.a + ch.b;
      const partPlaceholder = which === 'a' ? ch.a : ch.b;
      return `
        <div class="rp-wrap">
          <div class="rp-label">Given ratio</div>
          <div class="ratio-prompt" role="group" aria-label="Given part-to-part ratio">
            <div class="row images">
              <img class="rp-img" src="${ch.aSrc}" alt="meme A" />
              <span class="rp-colon">:</span>
              <img class="rp-img" src="${ch.bSrc}" alt="meme B" />
            </div>
            <div class="row numbers">
              <span class="rp-num">${ch.a}</span>
              <span class="rp-colon">:</span>
              <span class="rp-num">${ch.b}</span>
            </div>
          </div>
          <div class="rp-label">Question: Show the ratio of ${whichLabel} to ALL memes.</div>
          <div class="ratio-prompt" role="group" aria-label="Enter your answer as two numbers">
            <div class="row numbers" style="gap:10px;">
              <label class="answer-label" style="display:flex; flex-direction:column; align-items:center; gap:6px; font-weight:700;">
                <span style="display:inline-flex; align-items:center; gap:6px;">${imgBadge(which === 'a' ? ch.aSrc : ch.bSrc)} <span>This Meme</span></span>
                <input id="pwPartInput" type="number" min="0" step="1" inputmode="numeric" placeholder="" style="width:92px; padding:6px 10px; font-weight:900; font-size:22px; text-align:center; border:2px solid #ecebff; border-radius:12px; background:#fff; box-shadow: 0 10px 24px rgba(122,92,255,0.12);" />
              </label>
              <span class="rp-colon">:</span>
              <label class="answer-label" style="display:flex; flex-direction:column; align-items:center; gap:6px; font-weight:700;">
                <span>Total memes</span>
                <input id="pwTotalInput" type="number" min="0" step="1" inputmode="numeric" placeholder="" style="width:112px; padding:6px 10px; font-weight:900; font-size:22px; text-align:center; border:2px solid #ecebff; border-radius:12px; background:#fff; box-shadow: 0 10px 24px rgba(122,92,255,0.12);" />
              </label>
            </div>
          </div>
        </div>
      `;
    }
    if (ch.type === 'unitrate') {
      const decimalsOk = challengeDifficulty >= 2 && (ch.a % ch.b !== 0);
      const hint = decimalsOk ? ' (round to 1 decimal place)' : '';
      return `
        <div class="rp-wrap">
          <div class="rp-label">Unit Rate${hint}</div>
          <div class="ratio-prompt" role="group" aria-label="Unit rate prompt">
            <div class="row images">
              <img class="rp-img" src="${ch.aSrc}" alt="meme A" />
              <span class="rp-colon">:</span>
              <img class="rp-img" src="${ch.bSrc}" alt="meme B" />
            </div>
            <div class="row numbers">
              <span class="rp-num">${ch.a}</span>
              <span class="rp-colon">:</span>
              <span class="rp-num">${ch.b}</span>
            </div>
          </div>
          <div class="rp-label" style="margin-top:10px;">How many ${imgBadge(ch.aSrc)} per 1 ${imgBadge(ch.bSrc)} ?</div>
          <div style="text-align:center; margin-top:8px;">
            <input id="unitRateInput" type="number" step="any" inputmode="decimal" placeholder="?"
              style="width:120px; padding:8px 12px; font-weight:900; font-size:24px; text-align:center;
              border:2px solid var(--border); border-radius:12px; background:var(--surface-2);
              color:var(--text); box-shadow:0 4px 12px rgba(0,0,0,0.2);" />
          </div>
        </div>
      `;
    }
    if (ch.type === 'table') {
      let tableHTML = '<div class="rp-wrap" style="width:100%;">';
      tableHTML += '<div class="rp-label">Complete the ratio table</div>';
      tableHTML += '<table class="ratio-table" role="grid" aria-label="Ratio table">';
      tableHTML += `<thead><tr><th>${imgBadge(ch.aSrc)}</th><th>${imgBadge(ch.bSrc)}</th></tr></thead>`;
      tableHTML += '<tbody>';
      const blankSet = new Set(ch.blanks.map(b => `${b.row}-${b.col}`));
      ch.rows.forEach((row, idx) => {
        const aBlank = blankSet.has(`${idx}-a`);
        const bBlank = blankSet.has(`${idx}-b`);
        const aCell = aBlank
          ? `<input class="rt-blank" data-row="${idx}" data-col="a" type="number" min="0" step="1" inputmode="numeric" placeholder="?" />`
          : `<span class="rt-given">${row.aVal}</span>`;
        const bCell = bBlank
          ? `<input class="rt-blank" data-row="${idx}" data-col="b" type="number" min="0" step="1" inputmode="numeric" placeholder="?" />`
          : `<span class="rt-given">${row.bVal}</span>`;
        tableHTML += `<tr><td>${aCell}</td><td>${bCell}</td></tr>`;
      });
      tableHTML += '</tbody></table></div>';
      return tableHTML;
    }
    if (ch.type === 'partpart') {
      return `
        <div class="rp-wrap">
          <div class="rp-label">Part-to-part ratio</div>
          <div class="ratio-prompt" role="group" aria-label="Part-to-part ratio">
            <div class="row images">
              <img class="rp-img" src="${ch.aSrc}" alt="meme A" />
              <span class="rp-colon">:</span>
              <img class="rp-img" src="${ch.bSrc}" alt="meme B" />
            </div>
            <div class="row numbers">
              <span class="rp-num">${ch.a}</span>
              <span class="rp-colon">:</span>
              <span class="rp-num">${ch.b}</span>
            </div>
          </div>
        </div>
      `;
    }
    // Create-this-ratio: show two memes with a big number centered beneath each and colons between
    if (ch.type === 'create') {
      return `
        <div class="rp-wrap">
          <div class="rp-label">Create this ratio</div>
          <div class="ratio-prompt" role="group" aria-label="Create this ratio">
            <div class="row images">
              <img class="rp-img" src="${ch.aSrc}" alt="meme A" />
              <span class="rp-colon">:</span>
              <img class="rp-img" src="${ch.bSrc}" alt="meme B" />
            </div>
            <div class="row numbers">
              <span class="rp-num">${ch.a}</span>
              <span class="rp-colon">:</span>
              <span class="rp-num">${ch.b}</span>
            </div>
          </div>
        </div>
      `;
    }
    return `Create this ratio: ${imgBadge(ch.aSrc)} ×${ch.a} : ${imgBadge(ch.bSrc)} ×${ch.b}`;
  }

  function updateLayoutForCurrent() {
    if (!board) return;
    const t = sharedState.current && sharedState.current.type;
    if (t === 'partwhole' || t === 'unitrate' || t === 'table' || t === 'scale' || t === 'simplify') {
      board.style.display = 'none';
    } else {
      board.style.display = '';
    }
  }

  function applySharedState() {
    // update UI from sharedState
    if (scoreEl) scoreEl.textContent = String(sharedState.score || 0);
    if (scoreBarFill) scoreBarFill.style.width = ((sharedState.score || 0) / 20 * 100) + '%';
    modePills.forEach(p => {
      const isActive = p.dataset.mode === (sharedState.mode || 'create');
      p.classList.toggle('active', isActive);
      p.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    if (!sharedState.current) {
      // create first challenge
      sharedState.current = generateChallenge(sharedState.mode);
    }
    if (challengeText && sharedState.current) challengeText.innerHTML = challengeTextFor(sharedState.current);
    updateLayoutForCurrent();
    updateBoardCountsUI();
    // Victory popup if score >= 20
    if ((sharedState.score || 0) >= 20) {
      showVictory();
    } else {
      hideVictory();
    }
  }

  function resetBoard() {
    boardCounts = {};
    if (board) board.innerHTML = '';
  }

  function updateBoardCountsUI() {
    let counter = document.getElementById('boardCounter');
    if (!counter) {
      counter = document.createElement('div');
      counter.id = 'boardCounter';
      counter.className = 'board-counter';
      counter.setAttribute('aria-live', 'polite');
      if (board) board.parentNode.insertBefore(counter, board);
    }
    const ch = sharedState.current;
    if (!ch || !ch.aSrc) { counter.textContent = ''; return; }
    const aCount = boardCounts[ch.aSrc] || 0;
    const bCount = ch.bSrc ? (boardCounts[ch.bSrc] || 0) : 0;
    if (aCount === 0 && bCount === 0) { counter.textContent = ''; return; }
    counter.textContent = ch.bSrc ? `${aCount} : ${bCount}` : `${aCount}`;
  }

  function placeMeme(src) {
    boardCounts[src] = (boardCounts[src] || 0) + 1;
    const cell = document.createElement('div');
    cell.className = 'placed';
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'placed meme';
    cell.appendChild(img);
    // fun bounce
    cell.style.transform = 'scale(0.85)';
    setTimeout(() => { cell.style.transform = 'scale(1)'; cell.style.transition = 'transform 130ms ease'; }, 0);
    board.appendChild(cell);
    // allow removing by click
    cell.addEventListener('click', () => {
      boardCounts[src] = Math.max(0, (boardCounts[src] || 0) - 1);
      cell.remove();
    });
  }

  let _submitLock = false;
  function handleSubmit() {
    if (_submitLock) return;
    const ch = sharedState.current;
    if (!ch) return;
    _submitLock = true;
    setTimeout(() => { _submitLock = false; }, 1200);

    // Count on board
    const aCount = boardCounts[ch.aSrc] || 0;
    const bCount = boardCounts[ch.bSrc] || 0;
    const total = Object.values(boardCounts).reduce((s, n) => s + n, 0);

    let correct = false;
    if (ch.type === 'equiv') {
      if (aCount > 0 && bCount > 0) {
        // Correct if the player's pair is proportional to the prompt pair,
        // but not the exact same counts (to enforce "equivalent", not identical).
        correct = (aCount * ch.b === bCount * ch.a) && !(aCount === ch.a && bCount === ch.b);
      }
    } else if (ch.type === 'unitrate') {
      const inp = qs('#unitRateInput');
      const val = parseFloat(inp && inp.value);
      if (Number.isNaN(val)) {
        showToast('Enter a number');
        _submitLock = false;
        return;
      }
      const expected = ch.a / ch.b;
      // At Beginner/Developing the answer is always an integer; at higher levels accept 1-decimal rounding
      if (challengeDifficulty >= 2 && (ch.a % ch.b !== 0)) {
        correct = Math.abs(val - expected) < 0.05 + Number.EPSILON;
      } else {
        correct = Math.abs(val - expected) < 0.001;
      }
    } else if (ch.type === 'table') {
      const blanks = ch.blanks || [];
      const inputs = qsa('.rt-blank');
      if (inputs.length === 0) { _submitLock = false; return; }
      let allCorrect = true;
      let anyEmpty = false;
      for (const inp of inputs) {
        const r = parseInt(inp.dataset.row, 10);
        const c = inp.dataset.col;
        const val = parseInt(inp.value, 10);
        if (Number.isNaN(val)) { anyEmpty = true; break; }
        const expected = c === 'a' ? ch.rows[r].aVal : ch.rows[r].bVal;
        if (val !== expected) { allCorrect = false; break; }
      }
      if (anyEmpty) {
        showToast('Fill in all blanks');
        _submitLock = false;
        return;
      }
      correct = allCorrect;
    } else if (ch.type === 'scale') {
      const inp = qs('#scaleInput');
      const val = parseInt(inp && inp.value, 10);
      if (Number.isNaN(val)) {
        showToast('Enter a number');
        _submitLock = false;
        return;
      }
      correct = val === ch.answer;
    } else if (ch.type === 'simplify') {
      const inpA = qs('#simplifyA');
      const inpB = qs('#simplifyB');
      const valA = parseInt(inpA && inpA.value, 10);
      const valB = parseInt(inpB && inpB.value, 10);
      if (Number.isNaN(valA) || Number.isNaN(valB)) {
        showToast('Enter both numbers');
        _submitLock = false;
        return;
      }
      if (valA <= 0 || valB <= 0) {
        correct = false;
      } else {
        // Must be equivalent to the shown ratio AND fully simplified (gcd = 1)
        const isEquiv = valA * ch.shownB === valB * ch.shownA;
        const isSimplest = gcd(valA, valB) === 1;
        correct = isEquiv && isSimplest;
      }
    } else if (ch.type === 'partwhole') {
      const which = ch.which === 'b' ? 'b' : 'a'; // default to 'a' for older states
      const partInput = qs('#pwPartInput');
      const totalInput = qs('#pwTotalInput');
      const partVal = parseInt(partInput && partInput.value, 10);
      const totalVal = parseInt(totalInput && totalInput.value, 10);
      if (Number.isNaN(partVal) || Number.isNaN(totalVal)) {
        showToast('Enter both numbers');
        correct = false;
      } else if (partVal <= 0 || totalVal <= 0 || partVal >= totalVal) {
        correct = false;
      } else {
        // Accept any equivalent ratio: part / total === target_part / (a+b)
        const targetPart = (which === 'a') ? ch.a : ch.b;
        const targetWhole = ch.a + ch.b;
        correct = partVal * targetWhole === targetPart * totalVal;
      }
    } else {
      // create or partpart
      correct = (aCount === ch.a) && (bCount === ch.b);
    }

    if (correct) {
      adjustDifficulty(true);
      // increment shared score, new challenge
      const prevMode = sharedState.mode || 'create';
      sharedState.score = (sharedState.score || 0) + 1;
      if (scoreEl) scoreEl.textContent = String(sharedState.score);
      if (scoreBarFill) scoreBarFill.style.width = (sharedState.score / 20 * 100) + '%';
      // Big silly full-screen pop!
      startSuccessFX();
      flash(splashSuccess, 1100);
      setTimeout(() => stopSuccessFX(), 1300);
      try { if (window.SoundFX) window.SoundFX.play('success'); } catch(_){}
      if (sharedState.score >= 20) {
        victoryTitle.textContent = `Goofy Ratio Victory! 🎉`;
        victorySub.textContent = `20/20 — Master of ${labelForMode(prevMode)}!`;
        // Let the success splash play first
        setTimeout(() => showVictory(), 900);
      }
      // Record this successful completion for dashboard/achievements (if authenticated)
      try {
        if (window.recordResult) {
          const ratioMode = prevMode === 'master' ? (ch.type || prevMode) : prevMode;
          const payload = {
            mode: 'ratios',
            game_name: labelForMode(prevMode),
            outcome: 'success',
            room_pin: room,
            details_json: { challenge_type: 'ratio', ratio_mode: ratioMode, correct: true, difficulty: DIFF_LABELS[challengeDifficulty], challenge: ch }
          };
          // Fire-and-forget; backend counts successes for achievements
          window.recordResult(payload).catch(() => {});
        }
      } catch (e) { /* ignore */ }
      sharedState.current = generateChallenge(sharedState.mode);
      challengeText.innerHTML = challengeTextFor(sharedState.current);
      updateLayoutForCurrent();
      broadcastState();
      resetBoard();
    } else {
      adjustDifficulty(false);
      // Full-screen fail splash, but brief
      flash(splashFail, 1000);
      try { if (window.SoundFX) window.SoundFX.play('fail'); } catch(_){}
      // Record incorrect attempt for analytics
      try {
        if (window.recordResult) {
          const failMode = (sharedState.mode === 'master' && ch.type) ? ch.type : (sharedState.mode || 'create');
          window.recordResult({
            mode: 'ratios',
            game_name: labelForMode(sharedState.mode || 'create'),
            outcome: 'incorrect',
            room_pin: room,
            details_json: { challenge_type: 'ratio', ratio_mode: failMode, correct: false, difficulty: DIFF_LABELS[challengeDifficulty] }
          }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
    }
  }

  function labelForMode(m) {
    switch (m) {
      case 'create': return 'Create This Ratio';
      case 'partpart': return 'Part-to-Part Ratio';
      case 'partwhole': return 'Part-to-Whole Ratio';
      case 'equiv': return 'Equivalent Ratio';
      case 'unitrate': return 'Unit Rate';
      case 'table': return 'Ratio Table';
      case 'scale': return 'Scale a Ratio';
      case 'simplify': return 'Simplify a Ratio';
      case 'master': return 'Master of Ratios';
      default: return 'Ratios';
    }
  }

  // Confetti utilities for victory
  let confettiTimer = null;
  const confettiEmojis = ['🎉','✨','🎊','⭐','🌈','🧠','🤪','🔥','💥','🥳'];

  function spawnConfettiPiece() {
    if (!confettiEl) return;
    const span = document.createElement('span');
    span.className = 'confetti-piece';
    span.textContent = confettiEmojis[Math.floor(Math.random() * confettiEmojis.length)];
    const left = Math.random() * 100;
    span.style.left = `${left}%`;
    span.style.setProperty('--x', `${(Math.random() * 12 - 6).toFixed(2)}vw`);
    const dur = 3 + Math.random() * 3;
    const delay = Math.random() * 1.5;
    span.style.setProperty('--dur', `${dur.toFixed(2)}s`);
    span.style.setProperty('--delay', `${delay.toFixed(2)}s`);
    confettiEl.appendChild(span);
    setTimeout(() => span.remove(), (dur + delay) * 1000 + 100);
  }

  function startConfetti() {
    if (!confettiEl) return;
    stopConfetti();
    // initial burst
    for (let i = 0; i < 40; i++) spawnConfettiPiece();
    // loop
    confettiTimer = setInterval(() => {
      for (let i = 0; i < 12; i++) spawnConfettiPiece();
    }, 900);
  }

  function stopConfetti() {
    if (confettiTimer) { clearInterval(confettiTimer); confettiTimer = null; }
    if (confettiEl) confettiEl.innerHTML = '';
  }

  function showVictory() { 
    if (victory) victory.classList.add('show'); 
    startConfetti();
  }
  function hideVictory() { 
    if (victory) victory.classList.remove('show'); 
    stopConfetti();
  }
  // Success Splash FX (confetti + balloons)
  let successConfettiTimer = null;
  let successBalloonTimer = null;

  function spawnSuccessConfettiPiece() {
    if (!confettiSuccessEl) return;
    const span = document.createElement('span');
    span.className = 'confetti-piece';
    span.textContent = confettiEmojis[Math.floor(Math.random() * confettiEmojis.length)];
    const left = Math.random() * 100;
    span.style.left = `${left}%`;
    span.style.setProperty('--x', `${(Math.random() * 16 - 8).toFixed(2)}vw`);
    const dur = 2.2 + Math.random() * 2.2;
    const delay = Math.random() * 0.6;
    span.style.setProperty('--dur', `${dur.toFixed(2)}s`);
    span.style.setProperty('--delay', `${delay.toFixed(2)}s`);
    confettiSuccessEl.appendChild(span);
    setTimeout(() => span.remove(), (dur + delay) * 1000 + 100);
  }

  function spawnBalloonPiece() {
    if (!balloonsSuccessEl) return;
    const span = document.createElement('span');
    span.className = 'balloon';
    span.textContent = '🎈';
    const left = Math.random() * 100;
    span.style.left = `${left}%`;
    span.style.setProperty('--x', `${(Math.random() * 12 - 6).toFixed(2)}vw`);
    const dur = 2.8 + Math.random() * 2.4;
    const delay = Math.random() * 0.6;
    span.style.setProperty('--dur', `${dur.toFixed(2)}s`);
    span.style.setProperty('--delay', `${delay.toFixed(2)}s`);
    balloonsSuccessEl.appendChild(span);
    setTimeout(() => span.remove(), (dur + delay) * 1000 + 200);
  }

  function startSuccessFX() {
    if (!splashSuccess) return;
    stopSuccessFX();
    for (let i = 0; i < 24; i++) spawnSuccessConfettiPiece();
    for (let i = 0; i < 8; i++) spawnBalloonPiece();
    successConfettiTimer = setInterval(() => { for (let i = 0; i < 8; i++) spawnSuccessConfettiPiece(); }, 280);
    successBalloonTimer = setInterval(() => { for (let i = 0; i < 3; i++) spawnBalloonPiece(); }, 400);
  }

  function stopSuccessFX() {
    if (successConfettiTimer) { clearInterval(successConfettiTimer); successConfettiTimer = null; }
    if (successBalloonTimer) { clearInterval(successBalloonTimer); successBalloonTimer = null; }
    if (confettiSuccessEl) confettiSuccessEl.innerHTML = '';
    if (balloonsSuccessEl) balloonsSuccessEl.innerHTML = '';
  }

  if (victoryClose) victoryClose.addEventListener('click', hideVictory);
  if (victoryAgain) victoryAgain.addEventListener('click', () => {
    // reset score and keep playing
    sharedState.score = 0;
    if (scoreEl) scoreEl.textContent = '0';
    if (scoreBarFill) scoreBarFill.style.width = '0%';
    sharedState.current = generateChallenge(sharedState.mode);
    if (challengeText) challengeText.innerHTML = challengeTextFor(sharedState.current);
    updateLayoutForCurrent();
    broadcastState();
    resetBoard();
    hideVictory();
  });
  // Allow dismissing the splashes on click or Esc
  [splashSuccess, splashFail].forEach(el => {
    if (el) el.addEventListener('click', () => {
      el.classList.remove('show');
      if (el === splashSuccess) stopSuccessFX();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (splashSuccess) { splashSuccess.classList.remove('show'); stopSuccessFX(); }
      if (splashFail) splashFail.classList.remove('show');
    }
  });

  // Drag and drop from palette to board.
  // HTML5 drag/drop does NOT fire on iOS Safari touch, and click-to-add was
  // the only working path on tablets. Now we also wire touchstart/move/end so
  // students on iPads / touch Chromebooks can drag memes naturally.
  function setupDnD() {
    let touchSrc = null;
    let touchGhost = null;

    function makeGhost(card){
      const img = card.querySelector('img');
      if (!img) return null;
      const g = img.cloneNode(true);
      g.style.position = 'fixed';
      g.style.pointerEvents = 'none';
      g.style.opacity = '0.85';
      g.style.zIndex = '99999';
      g.style.width = '64px';
      g.style.height = '64px';
      g.style.objectFit = 'contain';
      g.style.transform = 'translate(-50%, -50%)';
      document.body.appendChild(g);
      return g;
    }
    function moveGhost(g, x, y){
      if (!g) return;
      g.style.left = x + 'px';
      g.style.top = y + 'px';
    }
    function clearTouchDrag(){
      if (touchGhost) { try { touchGhost.remove(); } catch(_){} touchGhost = null; }
      touchSrc = null;
      board.removeAttribute('data-dragover');
      qsa('.meme.dragging', palette).forEach(el => el.classList.remove('dragging'));
    }
    function pointOverBoard(x, y){
      const el = document.elementFromPoint(x, y);
      return !!(el && (el === board || board.contains(el)));
    }

    qsa('.meme', palette).forEach(card => {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        const src = card.getAttribute('data-src');
        e.dataTransfer.setData('text/plain', src);
        const img = card.querySelector('img');
        if (img && e.dataTransfer.setDragImage) {
          e.dataTransfer.setDragImage(img, img.naturalWidth/2, img.naturalHeight/2);
        }
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      // Click to add (also covers tap on touch devices that didn't initiate drag).
      card.addEventListener('click', () => placeMeme(card.getAttribute('data-src')));

      // Touch-drag handlers (iOS/Android/touch Chromebooks).
      card.addEventListener('touchstart', (e) => {
        if (!e.touches || !e.touches.length) return;
        touchSrc = card.getAttribute('data-src');
        card.classList.add('dragging');
        const t = e.touches[0];
        touchGhost = makeGhost(card);
        moveGhost(touchGhost, t.clientX, t.clientY);
      }, { passive: true });
      card.addEventListener('touchmove', (e) => {
        if (!touchSrc || !e.touches || !e.touches.length) return;
        // Prevent the page from scrolling under the finger while dragging.
        e.preventDefault();
        const t = e.touches[0];
        moveGhost(touchGhost, t.clientX, t.clientY);
        if (pointOverBoard(t.clientX, t.clientY)) board.setAttribute('data-dragover', '1');
        else board.removeAttribute('data-dragover');
      }, { passive: false });
      card.addEventListener('touchend', (e) => {
        if (!touchSrc) { clearTouchDrag(); return; }
        const t = (e.changedTouches && e.changedTouches[0]) || null;
        if (t && pointOverBoard(t.clientX, t.clientY)) {
          placeMeme(touchSrc);
        }
        clearTouchDrag();
      });
      card.addEventListener('touchcancel', clearTouchDrag);
    });

    board.addEventListener('dragover', (e) => { e.preventDefault(); board.setAttribute('data-dragover', '1'); });
    board.addEventListener('dragleave', () => board.removeAttribute('data-dragover'));
    board.addEventListener('drop', (e) => {
      e.preventDefault();
      board.removeAttribute('data-dragover');
      const src = e.dataTransfer.getData('text/plain');
      if (src) placeMeme(src);
    });
  }

  // Event wiring
  submitBtn.addEventListener('click', handleSubmit);
  clearBtn.addEventListener('click', () => {
    const t = sharedState.current && sharedState.current.type;
    if (t === 'partwhole') {
      const p = qs('#pwPartInput');
      const total = qs('#pwTotalInput');
      if (p) p.value = '';
      if (total) total.value = '';
    } else if (t === 'unitrate') {
      const inp = qs('#unitRateInput');
      if (inp) inp.value = '';
    } else if (t === 'table') {
      qsa('.rt-blank').forEach(inp => { inp.value = ''; });
    } else if (t === 'scale') {
      const inp = qs('#scaleInput');
      if (inp) inp.value = '';
    } else if (t === 'simplify') {
      const inpA = qs('#simplifyA');
      const inpB = qs('#simplifyB');
      if (inpA) inpA.value = '';
      if (inpB) inpB.value = '';
    } else {
      resetBoard();
    }
  });

  nextChallengeBtn.addEventListener('click', () => {
    // Skipping at higher difficulty counts as incorrect — prevents grinding
    // for an easy prompt by hammering Skip until a 1:1 appears. At Beginner
    // and Developing the skip is free (let students explore without penalty).
    if (challengeDifficulty >= 2) {
      try { adjustDifficulty(false); } catch (e) {}
    }
    sharedState.current = generateChallenge(sharedState.mode);
    challengeText.innerHTML = challengeTextFor(sharedState.current);
    updateLayoutForCurrent();
    broadcastState();
    resetBoard();
  });

  modePills.forEach(pill => pill.addEventListener('click', () => {
    const selected = pill.dataset.mode;
    sharedState.mode = selected;
    modePills.forEach(p => {
      const isActive = p.dataset.mode === selected;
      p.classList.toggle('active', isActive);
      p.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    if (selected === 'master') {
      const kinds = ['create', 'partpart', 'partwhole', 'equiv', 'unitrate', 'table', 'scale', 'simplify'];
      const pick = kinds[Math.floor(Math.random() * kinds.length)];
      sharedState.current = generateChallenge(pick);
    } else {
      sharedState.current = generateChallenge(selected);
    }
    challengeText.innerHTML = challengeTextFor(sharedState.current);
    updateLayoutForCurrent();
    broadcastState();
    resetBoard();
  }));

  shareBtn.addEventListener('click', () => { updateShareUI(); openQr(); });
  closeQrBtn && closeQrBtn.addEventListener('click', closeQr);
  qrModal && qrModal.addEventListener('click', (e) => { if (e.target && e.target.getAttribute('data-close')) closeQr(); });

  joinBtn.addEventListener('click', async () => {
    const pin = prompt('Enter PIN to join:');
    if (!pin) return;
    // leave old room
    socket.emit('leave', { room, mode: modeId });
    room = pin.trim();
    url.searchParams.set('room', room);
    history.replaceState({}, '', url.toString());
    updateShareUI();
    joinSocket();
    socket.emit('request_state', { room, mode: modeId });
  });

  // Init
  ensureRoom(() => {
    updateShareUI();
    joinSocket();
    // announce presence once connected
    setupDnD();
    // Initialize state if none will come
    sharedState.mode = sharedState.mode || 'create';
    if (!sharedState.current) sharedState.current = generateChallenge(sharedState.mode);
    applySharedState();
  });
})();
