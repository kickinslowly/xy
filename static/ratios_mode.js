(() => {
  // Utilities
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick2 = (arr) => {
    if (arr.length < 2) return [arr[0], arr[0]];
    const i = Math.floor(Math.random() * arr.length);
    let j = Math.floor(Math.random() * arr.length);
    if (j === i) j = (j + 1) % arr.length;
    return [arr[i], arr[j]];
  };
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

  const modeSelect = qs('#modeSelect');
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

  // Challenge generation
  function generateChallenge(kind) {
    const memes = (window.AVAILABLE_MEMES || []).slice();
    if (memes.length === 0) return null;
    let nowKind = kind || sharedState.mode || 'create';
    if (nowKind === 'master') {
      const kinds = ['create', 'partpart', 'partwhole', 'equiv'];
      nowKind = kinds[Math.floor(Math.random() * kinds.length)];
    }

    if (nowKind === 'equiv') {
      const [aSrc, bSrc] = pick2(memes);
      const a = rnd(1, 5), b = rnd(1, 5);
      return { type: 'equiv', aSrc, bSrc, a, b };
    }
    if (nowKind === 'partwhole') {
      const [aSrc, bSrc] = pick2(memes);
      const a = rnd(1, 5), b = rnd(1, 5); // a of A, b of B => total = a+b
      const which = Math.random() < 0.5 ? 'a' : 'b'; // which part is asked to compare to the whole
      return { type: 'partwhole', aSrc, bSrc, a, b, which };
    }
    // create/partpart default
    const [aSrc, bSrc] = pick2(memes);
    const a = rnd(1, 5), b = rnd(1, 5);
    return { type: nowKind === 'partpart' ? 'partpart' : 'create', aSrc, bSrc, a, b };
  }

  function imgBadge(src) { return `<img src="${src}" alt="meme" style="width:28px; height:28px; object-fit:contain; vertical-align:middle; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.15); background:#fff; margin:0 4px;"/>`; }
  function challengeTextFor(ch) {
    if (!ch) return 'Loading...';
    if (ch.type === 'equiv') return `Create an equivalent ratio to ${formatRatio(ch.a, ch.b)} using ${imgBadge(ch.aSrc)} and ${imgBadge(ch.bSrc)}.`;
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
    if (ch.type === 'partpart') return `Part-to-part: ${imgBadge(ch.aSrc)} ×${ch.a} : ${imgBadge(ch.bSrc)} ×${ch.b}`;
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
    if (sharedState.current && sharedState.current.type === 'partwhole') {
      board.style.display = 'none';
    } else {
      board.style.display = '';
    }
  }

  function applySharedState() {
    // update UI from sharedState
    if (scoreEl) scoreEl.textContent = String(sharedState.score || 0);
    if (modeSelect) modeSelect.value = sharedState.mode || 'create';
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
    // no-op for now; board shows placed items already
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

  function handleSubmit() {
    const ch = sharedState.current;
    if (!ch) return;

    // Count on board
    const aCount = boardCounts[ch.aSrc] || 0;
    const bCount = boardCounts[ch.bSrc] || 0;
    const total = Object.values(boardCounts).reduce((s, n) => s + n, 0);

    let correct = false;
    if (ch.type === 'equiv') {
      if (aCount > 0 && bCount > 0) {
        const g = gcd(aCount, bCount);
        const ra = aCount / g, rb = bCount / g;
        correct = (ra === ch.a && rb === ch.b) && !(aCount === ch.a && bCount === ch.b);
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
      } else {
        if (which === 'a') {
          correct = (partVal === ch.a) && (totalVal === ch.a + ch.b);
        } else {
          correct = (partVal === ch.b) && (totalVal === ch.a + ch.b);
        }
      }
    } else {
      // create or partpart
      correct = (aCount === ch.a) && (bCount === ch.b);
    }

    if (correct) {
      // increment shared score, new challenge
      const prevMode = sharedState.mode || 'create';
      sharedState.score = (sharedState.score || 0) + 1;
      if (scoreEl) scoreEl.textContent = String(sharedState.score);
      // Big silly full-screen pop!
      startSuccessFX();
      flash(splashSuccess, 1100);
      setTimeout(() => stopSuccessFX(), 1300);
      if (sharedState.score >= 20) {
        victoryTitle.textContent = `Goofy Ratio Victory! 🎉`;
        victorySub.textContent = `20/20 — Master of ${labelForMode(prevMode)}!`;
        // Let the success splash play first
        setTimeout(() => showVictory(), 900);
      }
      // Record this successful completion for dashboard/achievements (if authenticated)
      try {
        if (window.recordResult) {
          const payload = {
            mode: 'ratios',
            game_name: labelForMode(prevMode),
            outcome: 'success',
            room_pin: room,
            details_json: { challenge: ch }
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
      // Full-screen fail splash, but brief
      flash(splashFail, 1000);
    }
  }

  function labelForMode(m) {
    switch (m) {
      case 'create': return 'Create This Ratio';
      case 'partpart': return 'Part-to-Part Ratio';
      case 'partwhole': return 'Part-to-Whole Ratio';
      case 'equiv': return 'Equivalent Ratio';
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

  // Drag and drop from palette to board
  function setupDnD() {
    qsa('.meme', palette).forEach(card => {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        const src = card.getAttribute('data-src');
        e.dataTransfer.setData('text/plain', src);
        // drag image ghost
        const img = card.querySelector('img');
        if (img && e.dataTransfer.setDragImage) {
          e.dataTransfer.setDragImage(img, img.naturalWidth/2, img.naturalHeight/2);
        }
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      // Click to add (mobile)
      card.addEventListener('click', () => placeMeme(card.getAttribute('data-src')));
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
    if (sharedState.current && sharedState.current.type === 'partwhole') {
      const p = qs('#pwPartInput');
      const t = qs('#pwTotalInput');
      if (p) p.value = '';
      if (t) t.value = '';
    } else {
      resetBoard();
    }
  });

  nextChallengeBtn.addEventListener('click', () => {
    sharedState.current = generateChallenge(sharedState.mode);
    challengeText.innerHTML = challengeTextFor(sharedState.current);
    updateLayoutForCurrent();
    broadcastState();
    resetBoard();
  });

  modeSelect.addEventListener('change', () => {
    const selected = modeSelect.value;
    sharedState.mode = selected;
    // If master: choose one of the four types randomly for each challenge
    if (selected === 'master') {
      const kinds = ['create', 'partpart', 'partwhole', 'equiv'];
      const pick = kinds[Math.floor(Math.random() * kinds.length)];
      sharedState.current = generateChallenge(pick);
    } else {
      sharedState.current = generateChallenge(selected);
    }
    challengeText.innerHTML = challengeTextFor(sharedState.current);
    updateLayoutForCurrent();
    broadcastState();
    resetBoard();
  });

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
