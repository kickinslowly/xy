(() => {
  // Helpers
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const presenceEl = qs('#presence');
  const shareBtn = qs('#shareSessionBtn');
  const joinBtn = qs('#joinSessionBtn');

  const btnJoinA = qs('#joinA');
  const btnJoinB = qs('#joinB');
  const btnStart = qs('#startBtn');
  const phaseText = qs('#phaseText');
  const lobbyPanel = qs('#lobbyPanel');

  const roomPinEl = qs('#roomPin');
  const turnPill = qs('#turnPill');
  const youAreEl = qs('#youAre');
  const countdownPill = qs('#countdownPill');
  const countdownNum = qs('#countdownNum');
  const singlePlayerToggle = qs('#singlePlayerToggle');
  let botMoveTimer = null;

  const teamAList = qs('#teamAList');
  const teamBList = qs('#teamBList');
  const countAEl = qs('#countA');
  const countBEl = qs('#countB');

  const yourBoardEl = qs('#yourBoard');
  const enemyBoardEl = qs('#enemyBoard');

  // Manual fire controls
  const shotRowEl = qs('#shotRow');
  const shotColEl = qs('#shotCol');
  const fireBtnEl = qs('#fireBtn');
  const fireMsgEl = qs('#fireMsg');
  const noobModeEl = qs('#noobMode');
  const fireSectionEl = qs('.fire-section');

  // Placement phase elements
  const placementPanel = qs('#placementPanel');
  const placementShipName = qs('#placementShipName');
  const placementProgress = qs('#placementProgress');
  const rotateBtn = qs('#rotateBtn');
  const randomizeBtn = qs('#randomizeBtn');
  const undoShipBtn = qs('#undoShipBtn');
  const readyBtn = qs('#readyBtn');
  const placementHint = qs('#placementHint');
  const placementToast = qs('#placementToast');

  const statsYouEl = qs('#statsYou');
  const yourTeamBadge = qs('#yourTeamBadge');
  const statsEnemyEl = qs('#statsEnemy');
  const enemyTeamBadge = qs('#enemyTeamBadge');

  const winnerOverlay = qs('#winnerOverlay');
  const loserOverlay = qs('#loserOverlay');
  const winnerText = qs('#winnerText');
  const playAgainBtn = qs('#playAgainBtn');
  const okLoserBtn = qs('#okLoserBtn');

  // Turn overlay and cues
  const turnOverlay = qs('#turnOverlay');
  const turnSubText = qs('#turnSubText');
  const countdownOverlay = qs('#countdownOverlay');
  const countdownBigNumEl = qs('#countdownBigNum');
  const countdownTurnTextEl = qs('#countdownTurnText');
  let countdownOverlayHideTimer = null;
  let countdownFlashUntil = 0;
  const baseTitle = document.title;
  let lastTurnWasMine = false;

  // Persistent banner above boards
  const turnBannerEl = qs('#turnBanner');

  // Session and socket
  const getParam = (name) => new URLSearchParams(window.location.search).get(name);
  const clientId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  let socket = null;
  let room = null;
  const mode = 'battleship';

  // Local client role
  let myTeam = null; // 'A' | 'B' | null (spectator)
  let myName = makeFunnyName();

  // Game state shared via server
  let state = null;
  let suppressBroadcast = false;
  let countdownTimer = null;
  let countdownEndsAt = 0;

  function defaultState() {
    return {
      phase: 'lobby', // 'lobby' | 'countdown' | 'placement' | 'playing' | 'gameover'
      ready: { A: false, B: false }, // placement readiness per team
      countdownEndsAt: null, // ms since epoch
      startedBy: null,
      winner: null,
      turn: null, // 'A' or 'B'
      // Monotonically increasing per-shot counter. Used to reject stale state
      // echoes (so a slow broadcast can't rewind turn after another shot has
      // already been applied) and to detect that a concurrent fire happened.
      shotSeq: 0,
      teams: {
        A: { members: {}, shots: 0, hits: 0, shipsRemaining: 5, shotsLog: [] },
        B: { members: {}, shots: 0, hits: 0, shipsRemaining: 5, shotsLog: [] },
      },
      boards: {
        A: { ships: null, hits: {}, misses: {} },
        B: { ships: null, hits: {}, misses: {} },
      },
      bot: { enabled: false, team: null, controllerId: null, delayMs: 1000 },
      // bookkeeping for ship sunk animation or last move
      lastShot: null, // {team:'A'|'B', r, c, hit:bool}
    };
  }
  // Local guard: while a shot is in-flight (we just fired but haven't seen the
  // echo), block additional fire attempts so rapid-clicks don't double-shoot.
  let _pendingFireUntil = 0;
  function _isFirePending() { return Date.now() < _pendingFireUntil; }
  function _markFirePending() { _pendingFireUntil = Date.now() + 800; }

  // ---- Ship Placement Phase ----
  const SHIP_DEFS = [
    { name: 'Carrier',    size: 5 },
    { name: 'Battleship', size: 4 },
    { name: 'Cruiser',    size: 3 },
    { name: 'Submarine',  size: 3 },
    { name: 'Destroyer',  size: 2 },
  ];
  const SHIP_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185'];
  let placementOrientation = 'H'; // 'H' or 'V'
  let placementShips = [];        // ships placed so far: [{name, size, coords, colorIdx}]
  let placementCurrentIdx = 0;    // index into SHIP_DEFS being placed
  let placementReady = false;     // local "ready" flag
  let _hoverPreviewCells = [];    // cells currently showing ghost preview

  function resetPlacement() {
    placementShips = [];
    placementCurrentIdx = 0;
    placementReady = false;
    placementOrientation = 'H';
    _hoverPreviewCells = [];
    if (rotateBtn) rotateBtn.textContent = 'Horizontal';
  }

  function placementGrid() {
    // Build a 10x10 occupancy grid from placementShips
    const g = Array.from({ length: 10 }, () => Array(10).fill(-1));
    placementShips.forEach((sh, idx) => {
      for (const p of sh.coords) g[p.r][p.c] = idx;
    });
    return g;
  }

  function canPlaceShipAt(r, c, size, horiz, grid) {
    if (horiz) {
      if (c + size > 10) return false;
      for (let i = 0; i < size; i++) { if (grid[r][c + i] !== -1) return false; }
    } else {
      if (r + size > 10) return false;
      for (let i = 0; i < size; i++) { if (grid[r + i][c] !== -1) return false; }
    }
    return true;
  }

  function shipCoordsAt(r, c, size, horiz) {
    const coords = [];
    for (let i = 0; i < size; i++) {
      coords.push({ r: r + (horiz ? 0 : i), c: c + (horiz ? i : 0) });
    }
    return coords;
  }

  function coordLabel(r, c) {
    // Display as (X, Y) where X = c+1, Y = 10-r (matching the axis labels)
    return `(${c + 1}, ${10 - r})`;
  }

  function showPlacementToast(msg) {
    if (!placementToast) return;
    placementToast.textContent = msg;
    placementToast.hidden = false;
    clearTimeout(showPlacementToast._t);
    showPlacementToast._t = setTimeout(() => { placementToast.hidden = true; }, 3000);
  }

  function updatePlacementUi() {
    if (!placementPanel) return;
    const total = SHIP_DEFS.length;
    const placed = placementShips.length;
    if (placementProgress) placementProgress.textContent = `${placed} / ${total} ships placed`;
    if (placed < total) {
      const def = SHIP_DEFS[placed];
      if (placementShipName) {
        placementShipName.textContent = `Place your ${def.name} (${def.size} cells)`;
        placementShipName.style.color = SHIP_COLORS[placed];
      }
    } else {
      if (placementShipName) {
        placementShipName.textContent = 'All ships placed!';
        placementShipName.style.color = '#34d399';
      }
    }
    if (readyBtn) readyBtn.disabled = placed < total;
    if (undoShipBtn) undoShipBtn.disabled = placed === 0;
    renderPlacementBoard();
  }

  function renderPlacementBoard() {
    // Re-render your board during placement to show placed ships with colors
    const cells = qsa('.cell', yourBoardEl);
    cells.forEach(c => { c.className = 'cell'; c.innerHTML = ''; c.style.backgroundColor = ''; });
    const grid = placementGrid();
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (grid[r][c] !== -1) {
          const cell = yourBoardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
          if (cell) {
            cell.classList.add('ship', 'placement-placed');
            cell.style.backgroundColor = SHIP_COLORS[grid[r][c]] + '33'; // semi-transparent
          }
        }
      }
    }
  }

  function onYourBoardPlacementClick(e) {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    if (!state || state.phase !== 'placement' || !myTeam) return;
    if (placementReady) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);

    // Check if clicking on an already-placed ship to remove it
    const grid = placementGrid();
    if (grid[r][c] !== -1) {
      const removedIdx = grid[r][c];
      const removed = placementShips[removedIdx];
      placementShips.splice(removedIdx, 1);
      placementCurrentIdx = placementShips.length;
      try { if (window.SoundFX) window.SoundFX.play('click'); } catch(_){}
      showPlacementToast(`${removed.name} removed. Click to re-place.`);
      clearHoverPreview();
      updatePlacementUi();
      return;
    }

    // Placing the next ship
    if (placementShips.length >= SHIP_DEFS.length) return;
    const def = SHIP_DEFS[placementShips.length];
    const horiz = placementOrientation === 'H';
    if (!canPlaceShipAt(r, c, def.size, horiz, grid)) {
      // Invalid — flash red
      cell.classList.add('placement-invalid');
      setTimeout(() => { try { cell.classList.remove('placement-invalid'); } catch(_){} }, 400);
      return;
    }
    const coords = shipCoordsAt(r, c, def.size, horiz);
    placementShips.push({ name: def.name, size: def.size, coords, colorIdx: placementShips.length });
    placementCurrentIdx = placementShips.length;
    try { if (window.SoundFX) window.SoundFX.play('click'); } catch(_){}

    // Coordinate practice toast
    const startCoord = coordLabel(coords[0].r, coords[0].c);
    const endCoord = coordLabel(coords[coords.length - 1].r, coords[coords.length - 1].c);
    showPlacementToast(`${def.name} placed at ${startCoord} to ${endCoord}`);

    clearHoverPreview();
    updatePlacementUi();
  }

  function onYourBoardPlacementHover(e) {
    if (!state || state.phase !== 'placement' || !myTeam || placementReady) return;
    if (placementShips.length >= SHIP_DEFS.length) return;
    const cell = e.target.closest('.cell');
    clearHoverPreview();
    if (!cell) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    const def = SHIP_DEFS[placementShips.length];
    const horiz = placementOrientation === 'H';
    const grid = placementGrid();
    const valid = canPlaceShipAt(r, c, def.size, horiz, grid);
    const coords = shipCoordsAt(r, c, def.size, horiz);
    for (const p of coords) {
      if (p.r >= 10 || p.c >= 10) continue;
      const el = yourBoardEl.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
      if (el) {
        el.classList.add('placement-preview');
        if (!valid) el.classList.add('placement-preview-invalid');
        else el.style.backgroundColor = SHIP_COLORS[placementShips.length] + '55';
        _hoverPreviewCells.push(el);
      }
    }
  }

  function clearHoverPreview() {
    for (const el of _hoverPreviewCells) {
      el.classList.remove('placement-preview', 'placement-preview-invalid');
      // Restore color from placed ships or clear
      const r = Number(el.dataset.r), c = Number(el.dataset.c);
      const grid = placementGrid();
      if (grid[r][c] !== -1) {
        el.style.backgroundColor = SHIP_COLORS[grid[r][c]] + '33';
      } else {
        el.style.backgroundColor = '';
      }
    }
    _hoverPreviewCells = [];
  }

  function onYourBoardPlacementLeave() {
    clearHoverPreview();
  }

  // Wire rotate button + R key
  rotateBtn?.addEventListener('click', () => {
    placementOrientation = placementOrientation === 'H' ? 'V' : 'H';
    rotateBtn.textContent = placementOrientation === 'H' ? 'Horizontal' : 'Vertical';
    clearHoverPreview();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      if (state && state.phase === 'placement' && !placementReady) {
        placementOrientation = placementOrientation === 'H' ? 'V' : 'H';
        if (rotateBtn) rotateBtn.textContent = placementOrientation === 'H' ? 'Horizontal' : 'Vertical';
        clearHoverPreview();
      }
    }
  });

  // Wire randomize button
  randomizeBtn?.addEventListener('click', () => {
    if (!state || state.phase !== 'placement' || placementReady) return;
    const ships = placeRandomShips();
    placementShips = ships.map((sh, i) => ({ name: sh.name, size: sh.size, coords: sh.coords, colorIdx: i }));
    placementCurrentIdx = SHIP_DEFS.length;
    try { if (window.SoundFX) window.SoundFX.play('click'); } catch(_){}
    showPlacementToast('Ships randomized! Click Ready when set.');
    updatePlacementUi();
  });

  // Wire undo button
  undoShipBtn?.addEventListener('click', () => {
    if (!state || state.phase !== 'placement' || placementReady) return;
    if (placementShips.length === 0) return;
    const removed = placementShips.pop();
    placementCurrentIdx = placementShips.length;
    try { if (window.SoundFX) window.SoundFX.play('click'); } catch(_){}
    showPlacementToast(`${removed.name} removed.`);
    clearHoverPreview();
    updatePlacementUi();
  });

  // Wire ready button
  readyBtn?.addEventListener('click', () => {
    if (!state || state.phase !== 'placement' || !myTeam) return;
    if (placementShips.length < SHIP_DEFS.length) return;
    placementReady = true;
    // Commit ships to state
    state.boards[myTeam].ships = placementShips.map(sh => ({
      name: sh.name, size: sh.size, coords: sh.coords.map(p => ({r: p.r, c: p.c})), hits: []
    }));
    if (!state.ready) state.ready = {};
    state.ready[myTeam] = true;
    try { if (window.SoundFX) window.SoundFX.play('click'); } catch(_){}
    readyBtn.textContent = 'Waiting for opponent...';
    readyBtn.disabled = true;
    broadcast();
    checkBothReady();
    updateUiFromState();
  });

  function checkBothReady() {
    if (!state || state.phase !== 'placement') return;
    if (state.ready && state.ready.A && state.ready.B) {
      state.phase = 'playing';
      // Ensure ships exist for both sides
      broadcast();
      updateUiFromState();
    }
  }

  // Initial setup
  (async function init(){
    const pin = await ensurePin(mode);
    room = pin || (window.location.pathname + ':' + mode);
    window.currentSessionPin = pin;
    if (roomPinEl) roomPinEl.textContent = 'PIN: ' + (pin || '—');

    setupShareJoinUi();
    buildBoards();

    if (singlePlayerToggle) {
      singlePlayerToggle.addEventListener('change', () => {
        if (!state) return;
        setSinglePlayer(!!singlePlayerToggle.checked);
      });
    }

    if (noobModeEl) {
      noobModeEl.addEventListener('change', () => {
        if (fireSectionEl) fireSectionEl.style.display = noobModeEl.checked ? 'none' : '';
      });
    }

    if (typeof io !== 'undefined') {
      socket = io();
      wireSocket();
    } else {
      setPresence(0, false);
    }
  })();

  function makeFunnyName() {
    const titles = ['Admiral', 'Captain', 'Commodore', 'Skipper', 'Bosun', 'Seadog'];
    const things = ['Squid', 'Anchor', 'Cannon', 'Kraken', 'Dolphin', 'Compass'];
    const t = titles[Math.floor(Math.random() * titles.length)];
    const s = things[Math.floor(Math.random() * things.length)];
    const num = Math.floor(Math.random() * 900 + 100);
    return `${t} ${s}-${num}`;
  }

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

  let _presenceCount = 0;
  // Initialize to "now" rather than 0 so the staleness check doesn't fire on
  // page load. Bumped further on every shotSeq change AND on phase transitions.
  let _lastTurnChangeAt = Date.now();
  let _lastSeenShotSeq = 0;
  let _lastSeenPhase = null;
  function setPresence(count, online) {
    if (!presenceEl) return;
    if (!online) {
      _presenceCount = 0;
      presenceEl.textContent = '• Offline';
      checkOpponentStale();
      return;
    }
    const n = Number(count) || 1;
    _presenceCount = n;
    presenceEl.textContent = `• ${n} online`;
    checkOpponentStale();
  }

  // Build (lazily) a banner shown when the opposing team has gone silent for
  // long enough that the game looks stuck. Lets the student forfeit (counts as
  // a loss) or fall back to solo vs bot rather than staring at a frozen turn.
  let _oppBanner = null;
  function getOppBanner(){
    if (_oppBanner) return _oppBanner;
    const el = document.createElement('div');
    el.id = 'opponentGoneBanner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9000;background:#1c2230;border:1px solid #f59e0b;border-radius:12px;padding:10px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,0.35);max-width:calc(100vw - 32px);';
    el.hidden = true;
    const txt = document.createElement('span');
    txt.textContent = 'Opponent disconnected.';
    txt.style.cssText = 'color:#f59e0b;font-weight:700;font-size:14px;';
    const forfeitBtn = document.createElement('button');
    forfeitBtn.type = 'button';
    forfeitBtn.textContent = 'Forfeit';
    forfeitBtn.className = 'btn-light';
    forfeitBtn.addEventListener('click', forfeitToOpponent);
    const soloBtn = document.createElement('button');
    soloBtn.type = 'button';
    soloBtn.textContent = 'Solo vs Bot';
    soloBtn.className = 'btn-3d';
    soloBtn.addEventListener('click', () => {
      try {
        if (singlePlayerToggle && !singlePlayerToggle.checked) {
          singlePlayerToggle.checked = true;
          singlePlayerToggle.dispatchEvent(new Event('change'));
        }
      } catch(_){}
      el.hidden = true;
    });
    el.appendChild(txt);
    el.appendChild(forfeitBtn);
    el.appendChild(soloBtn);
    document.body.appendChild(el);
    _oppBanner = el;
    return el;
  }
  function forfeitToOpponent(){
    if (!state || state.phase !== 'playing' || !myTeam) return;
    const enemy = (myTeam === 'A') ? 'B' : 'A';
    state.winner = enemy;
    state.phase = 'gameover';
    state.shotSeq = (state.shotSeq || 0) + 1;
    try { broadcast(); } catch(_){}
    try { updateUiFromState(); } catch(_){}
    if (_oppBanner) _oppBanner.hidden = true;
  }
  function checkOpponentStale(){
    if (!state || state.phase !== 'playing' || !myTeam) {
      if (_oppBanner) _oppBanner.hidden = true;
      return;
    }
    // Bot is a "fake" presence — solo mode never looks disconnected.
    if (state.bot && state.bot.enabled) { if (_oppBanner) _oppBanner.hidden = true; return; }
    const waiting = state.turn && state.turn !== myTeam;
    const aloneOnline = _presenceCount <= 1;
    const stalled = (Date.now() - _lastTurnChangeAt) > 12000;
    if (waiting && aloneOnline && stalled) {
      getOppBanner().hidden = false;
    } else if (_oppBanner) {
      _oppBanner.hidden = true;
    }
  }
  setInterval(checkOpponentStale, 2000);

  function setupShareJoinUi() {
    function showQrModalFor(urlStr, pinVal) {
      const modal = document.getElementById('qrModal');
      if (!modal) return;
      const img = document.getElementById('qrImage');
      const link = document.getElementById('qrLinkText');
      const pinText = document.getElementById('qrPinText');
      const closeBtn = document.getElementById('closeQrModal');
      const backdrop = modal.querySelector('.modal-backdrop');
      if (img) img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=' + encodeURIComponent(urlStr);
      if (link) { link.value = urlStr; try { link.focus(); link.select(); } catch(_){} }
      if (pinText) pinText.textContent = 'PIN: ' + (pinVal || '');
      function close(){ try { modal.hidden = true; modal.setAttribute('aria-hidden','true'); } catch(_){ } }
      closeBtn?.addEventListener('click', close, { once: true });
      backdrop?.addEventListener('click', close, { once: true });
      try { modal.hidden = false; modal.setAttribute('aria-hidden','false'); } catch(_){ }
    }
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const thePin = (window.currentSessionPin || '');
        let copied = false;
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(thePin);
            copied = true;
          }
        } catch(_) {}
        const urlObj = new URL(window.location.href);
        urlObj.searchParams.set('pin', thePin);
        showQrModalFor(urlObj.toString(), thePin);
        try {
          if (copied) {
            const pinText = document.getElementById('qrPinText');
            if (pinText) pinText.textContent = 'PIN: ' + thePin + ' (copied)';
          }
        } catch(_) {}
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

  function wireSocket() {
    socket.on('connect', () => {
      setPresence(1, true);
      socket.emit('join', { room, mode });
      socket.emit('request_state', { room, mode });
      // Seed state if none exists after a short delay
      setTimeout(() => {
        if (!state) {
          state = defaultState();
          // If server already assigned us a role, ensure we appear in the correct team
          if (myTeam) {
            try { ensureMember(myTeam, clientId, myName); } catch(_) {}
          }
          broadcast();
        }
      }, 300);
    });

    socket.on('disconnect', () => setPresence(0, false));
    socket.on('presence', (p) => { if (p && p.room === room) setPresence(p.count, true); });

    socket.on('state', (msg) => { if (msg && msg.room === room && msg.mode === mode) applyRemoteState(msg.state); });
    socket.on('state_update', (msg) => {
      if (!msg || msg.room !== room || msg.mode !== mode) return;
      // Ignore our own echoes
      if (msg.clientId === clientId) return;
      applyRemoteState(msg.state);
    });

    // Receive server-assigned role for battleship
    socket.on('role', (msg) => {
      if (!msg || msg.room !== room) return;
      const r = msg.role;
      myTeam = (r === 'A' || r === 'B') ? r : null;
      if (myTeam && state) {
        ensureMember(myTeam, clientId, myName);
        broadcast();
      }
      updateUiFromState();
    });
  }

  function applyRemoteState(remote) {
    if (!remote) return;
    // Reject stale echoes that would rewind turn after we've already fired.
    // (Concurrent shots from another client may have a higher shotSeq than ours;
    // those still apply.)
    const localSeq = (state && typeof state.shotSeq === 'number') ? state.shotSeq : 0;
    const remoteSeq = (typeof remote.shotSeq === 'number') ? remote.shotSeq : 0;
    if (state && remoteSeq < localSeq) return;
    const prevPhase = state ? state.phase : null;
    state = remote;
    // Our broadcast has been seen (or a higher-seq one has) — release the local fire-pending lock.
    _pendingFireUntil = 0;
    // If we just entered placement phase from a remote state, reset local placement
    if (state.phase === 'placement' && prevPhase !== 'placement') {
      resetPlacement();
      // Auto-switch to YOUR FLEET tab
      try {
        const btnYour = document.getElementById('tabBtnYour');
        if (btnYour && myTeam) btnYour.click();
      } catch(_){}
      // Bot auto-places immediately
      if (state.bot && state.bot.enabled && state.bot.controllerId === clientId) {
        const botTeam = state.bot.team;
        if (botTeam && !state.boards[botTeam].ships) {
          state.boards[botTeam].ships = placeRandomShips();
          if (!state.ready) state.ready = {};
          state.ready[botTeam] = true;
          broadcast();
        }
      }
    }
    // If we already have a server-assigned team, ensure we are listed in that team
    if (myTeam) {
      try {
        const members = (state.teams && state.teams[myTeam] && state.teams[myTeam].members) || {};
        if (!members[clientId]) {
          ensureMember(myTeam, clientId, myName);
          broadcast();
        }
      } catch(_) { }
    }
    updateUiFromState();
  }

  function broadcast() {
    if (!socket || !state) return;
    try {
      socket.emit('state_update', { room, mode, clientId, state });
    } catch(_){ }
  }

  // Build the two boards
  function buildBoards() {
    buildBoard(yourBoardEl, true);
    buildBoard(enemyBoardEl, false);
  }

  function buildBoard(root, isOwn) {
    root.innerHTML = '';
    // Rows with left Y-axis numeric labels (1–10) and cells
    for (let r = 0; r < 10; r++) {
      const y = document.createElement('div');
      y.className = 'lbl ylbl';
      // Reverse Y so 1 is at the bottom, 10 at the top
      y.textContent = String(10 - r);
      root.appendChild(y);
      for (let c = 0; c < 10; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        if (!isOwn) {
          cell.addEventListener('click', onEnemyCellClick);
        }
        if (isOwn) {
          cell.addEventListener('click', onYourBoardPlacementClick);
          cell.addEventListener('mouseenter', onYourBoardPlacementHover);
          cell.addEventListener('touchstart', onYourBoardPlacementHover, { passive: true });
        }
        root.appendChild(cell);
      }
    }
    // Clear hover preview when leaving the board
    if (isOwn) {
      root.addEventListener('mouseleave', onYourBoardPlacementLeave);
    }
    // Bottom X-axis numeric labels (1–10)
    const bl = document.createElement('div');
    bl.className = 'lbl bl'; // bottom-left corner
    // Move X axis label to the far right; leave bottom-left corner blank
    bl.textContent = '';
    root.appendChild(bl);
    for (let c = 0; c < 10; c++) {
      const d = document.createElement('div');
      d.className = 'lbl bottom';
      d.textContent = String(c + 1);
      // Add absolute X label at the far right (visual only)
      if (c === 9) {
        const xAxis = document.createElement('div');
        xAxis.className = 'axis x';
        xAxis.textContent = 'X';
        root.appendChild(xAxis);
      }
      root.appendChild(d);
    }
    // Add absolute Y label at the top of the Y column
    const yAxis = document.createElement('div');
    yAxis.className = 'axis y';
    yAxis.textContent = 'Y';
    root.appendChild(yAxis);
  }

  function onEnemyCellClick(e) {
    const r = Number(e.currentTarget.dataset.r);
    const c = Number(e.currentTarget.dataset.c);
    if (noobModeEl && noobModeEl.checked) {
      tryFireAt(r, c);
    } else {
      // Fill coordinate inputs so students practice reading coordinates
      if (shotColEl) shotColEl.value = c + 1;       // X = col + 1
      if (shotRowEl) shotRowEl.value = 10 - r;       // Y = 10 - row (reversed axis)
      if (shotColEl) shotColEl.focus();
    }
  }

  function fireFromInputs() {
    if (!shotRowEl || !shotColEl) return;
    const yStr = (shotRowEl.value || '').trim();
    const xStr = (shotColEl.value || '').trim();
    fireMsg('');
    const yNum = Number(yStr);
    if (!(Number.isInteger(yNum) && yNum >= 1 && yNum <= 10)) {
      return fireMsg('Enter whole-number Y from 1–10');
    }
    const xNum = Number(xStr);
    if (!(Number.isInteger(xNum) && xNum >= 1 && xNum <= 10)) {
      return fireMsg('Enter whole-number X from 1–10');
    }
    // With Y reversed (1 at bottom), map to row index: r = 10 - Y
    const r = 10 - yNum;
    const c = xNum - 1;
    tryFireAt(r, c);
  }

  function tryFireAt(r, c) {
    if (!state || state.phase !== 'playing') return fireMsg('Game not started');
    if (!myTeam) return fireMsg('Join a team to fire');
    if (state.turn !== myTeam) return fireMsg(`Waiting for Team ${state.turn}`);
    if (_isFirePending()) return fireMsg('One shot at a time…');
    const enemy = (myTeam === 'A') ? 'B' : 'A';
    if (hasShotAt(state.teams[myTeam].shotsLog, r, c)) {
      return fireMsg('Already fired at that coordinate');
    }
    const hit = isShipAt(state.boards[enemy].ships, r, c);
    markShot(myTeam, enemy, r, c, hit);
    state.turn = enemy;
    state.shotSeq = (state.shotSeq || 0) + 1;
    if (isAllSunk(state.boards[enemy].ships)) {
      state.phase = 'gameover';
      state.winner = myTeam;
    }
    _markFirePending();
    // Update local UI immediately so turn indicator changes without waiting for remote echo
    updateUiFromState();
    broadcast();
    // UI feedback
    fireMsg(hit ? 'Hit! 🎯' : 'Miss 🌊');
    // Clear inputs for next shot
    if (shotRowEl) shotRowEl.value = '';
    if (shotColEl) shotColEl.value = '';
  }

  function fireMsg(text) {
    if (!fireMsgEl) return;
    fireMsgEl.textContent = text || '';
  }

  // Wire manual fire controls
  fireBtnEl?.addEventListener('click', fireFromInputs);
  shotRowEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') fireFromInputs(); });
  shotColEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') fireFromInputs(); });

  function rcKey(r, c) { return `${r},${c}`; }

  function hasShotAt(shotsLog, r, c) {
    return shotsLog.some(s => s.r === r && s.c === c);
  }

  function isShipAt(ships, r, c) {
    if (!Array.isArray(ships)) return false;
    for (const sh of ships) {
      for (const p of sh.coords) { if (p.r === r && p.c === c) return true; }
    }
    return false;
  }

  function isAllSunk(ships) {
    if (!Array.isArray(ships)) return false;
    for (const sh of ships) {
      if (!isShipSunk(sh)) return false;
    }
    return true;
  }

  function isShipSunk(ship) {
    const hits = ship.hits || [];
    return ship.coords.every(p => hits.some(h => h.r === p.r && h.c === p.c));
  }

  function markShot(team, enemy, r, c, hit) {
    const enemyBoard = state.boards[enemy];
    const tk = rcKey(r, c);
    if (hit) {
      enemyBoard.hits[tk] = true;
      // Mark hit on the specific ship
      for (const sh of enemyBoard.ships || []) {
        if (!sh.hits) sh.hits = [];
        for (const p of sh.coords) {
          if (p.r === r && p.c === c) { sh.hits.push({ r, c }); break; }
        }
      }
      state.teams[team].hits += 1;
    } else {
      enemyBoard.misses[tk] = true;
    }
    state.teams[team].shots += 1;
    state.teams[team].shotsLog.push({ by: clientId, r, c, hit });
    // Update ships remaining for enemy
    const before = state.teams[enemy].shipsRemaining;
    const remaining = (state.boards[enemy].ships || []).filter(s => !isShipSunk(s)).length;
    state.teams[enemy].shipsRemaining = remaining;
    state.lastShot = { team, r, c, hit };
    // Sound effects + ship sunk callout
    try {
      if (window.SoundFX) {
        if (hit) {
          if (before !== undefined && remaining < before) {
            window.SoundFX.play('sunk');
            showSunkToast(before - remaining);
          } else {
            window.SoundFX.play('hit');
          }
        } else {
          window.SoundFX.play('miss');
        }
      }
    } catch(_){}
  }

  function showSunkToast(count) {
    var el = document.createElement('div');
    el.className = 'sunk-toast';
    el.setAttribute('role', 'status');
    el.textContent = 'You sunk a ship!';
    document.body.appendChild(el);
    requestAnimationFrame(function(){ el.classList.add('sunk-toast-show'); });
    setTimeout(function(){
      el.classList.remove('sunk-toast-show');
      setTimeout(function(){ el.remove(); }, 400);
    }, 2500);
  }

  // UI glue
  function updateUiFromState() {
    if (!state) return;

    // Lobby players list
    const listA = Object.values(state.teams.A.members || {});
    const listB = Object.values(state.teams.B.members || {});
    if (countAEl) countAEl.textContent = `${listA.length} player${listA.length === 1 ? '' : 's'}`;
    if (countBEl) countBEl.textContent = `${listB.length} player${listB.length === 1 ? '' : 's'}`;
    if (teamAList) teamAList.textContent = listA.length ? listA.join(', ') : 'No one yet. Be the hero they didn’t ask for.';
    if (teamBList) teamBList.textContent = listB.length ? listB.join(', ') : 'Also empty. Very mysterious.';

    // Enable start when both teams populated
    const canStart = listA.length > 0 && listB.length > 0 && state.phase === 'lobby';
    btnStart.disabled = !canStart;
    if (btnStart) {
      btnStart.textContent = (state.phase === 'countdown') ? 'Starting…' : 'Start Game';
    }

    // Phase/turn labels
    if (state.phase === 'lobby') phaseText.textContent = 'Lobby';
    else if (state.phase === 'countdown') phaseText.textContent = 'Countdown';
    else if (state.phase === 'placement') phaseText.textContent = 'Place Ships';
    else if (state.phase === 'playing') phaseText.textContent = 'Playing';
    else if (state.phase === 'gameover') phaseText.textContent = 'Game over';

    // Hide lobby bar once the game is starting/started
    if (lobbyPanel) {
      lobbyPanel.style.display = (state.phase === 'lobby') ? '' : 'none';
    }

    // Placement panel visibility
    if (placementPanel) {
      const inPlacement = state.phase === 'placement' && myTeam && !placementReady;
      const showReady = state.phase === 'placement' && myTeam && placementReady;
      placementPanel.hidden = state.phase !== 'placement';
      if (state.phase === 'placement' && myTeam) {
        updatePlacementUi();
        if (placementReady) {
          if (placementShipName) { placementShipName.textContent = 'Waiting for opponent...'; placementShipName.style.color = '#fbbf24'; }
          if (readyBtn) { readyBtn.textContent = 'Waiting...'; readyBtn.disabled = true; }
          if (placementHint) placementHint.textContent = 'Your fleet is locked in. Waiting for the other team.';
        }
      }
      // Check if both teams are ready (may arrive via remote state)
      if (state.phase === 'placement') {
        checkBothReady();
      }
    }

    // Track turn changes (for opponent-stale detection). Any seq increment OR
    // phase change resets the staleness timer — otherwise the banner would
    // fire 12s after page load on a fresh game with no shots yet.
    const seqNow = (typeof state.shotSeq === 'number') ? state.shotSeq : 0;
    if (seqNow !== _lastSeenShotSeq) {
      _lastTurnChangeAt = Date.now();
      _lastSeenShotSeq = seqNow;
    }
    if (state.phase !== _lastSeenPhase) {
      _lastTurnChangeAt = Date.now();
      _lastSeenPhase = state.phase;
    }

    // Turn pill: make it very obvious
    turnPill.classList.remove('your-turn', 'waiting');
    if (myTeam && state.turn === myTeam) {
      turnPill.textContent = `Your Turn (Team ${state.turn})`;
      turnPill.classList.add('your-turn');
    } else if (state.turn) {
      turnPill.textContent = `Waiting for Team ${state.turn}`;
      turnPill.classList.add('waiting');
    } else {
      turnPill.textContent = 'Turn: —';
    }

    // Turn cues: overlay flash, body glow, document title, control pulses
    const canFireNow = state && state.phase === 'playing' && myTeam && state.turn === myTeam;
    document.body.classList.toggle('your-turn-active', !!canFireNow);
    if (canFireNow && !lastTurnWasMine) {
      showTurnOverlayOnce();
      addTempClass(enemyBoardEl, 'turn-pulse', 1800);
      addTempClass(fireBtnEl, 'turn-pulse', 1800);
    }
    if (!canFireNow && lastTurnWasMine) {
      // Cleanup happens via class toggles/timeouts
    }
    lastTurnWasMine = !!canFireNow;
    try { document.title = canFireNow ? 'Your Turn — Battleship Mode' : baseTitle; } catch(_){}

    // Persistent turn banner above boards
    if (turnBannerEl) {
      turnBannerEl.classList.remove('is-you', 'is-opponent', 'is-spectator');
      let bText = '—';
      if (state.phase === 'playing' && state.turn) {
        if (myTeam) {
          if (state.turn === myTeam) {
            bText = 'YOUR TURN';
            turnBannerEl.classList.add('is-you');
          } else {
            bText = "OPPONENT'S TURN";
            turnBannerEl.classList.add('is-opponent');
          }
        } else {
          bText = `Team ${state.turn}'s Turn`;
          turnBannerEl.classList.add('is-spectator');
        }
      } else if (state.phase === 'placement') {
        if (myTeam && placementReady) {
          bText = 'WAITING FOR OPPONENT';
          turnBannerEl.classList.add('is-opponent');
        } else if (myTeam) {
          bText = 'PLACE YOUR SHIPS!';
          turnBannerEl.classList.add('is-you');
        } else {
          bText = 'Players Placing Ships';
          turnBannerEl.classList.add('is-spectator');
        }
      } else if (state.phase === 'countdown') {
        bText = 'Starting…';
      } else if (state.phase === 'lobby') {
        bText = 'Waiting to Start';
      } else if (state.phase === 'gameover') {
        bText = state.winner ? `Game Over — Team ${state.winner} Wins` : 'Game Over';
      }
      turnBannerEl.textContent = bText;
    }

    // Sync single player toggle and ensure bot presence
    try { if (singlePlayerToggle) singlePlayerToggle.checked = !!(state.bot && state.bot.enabled); } catch(_){ }
    if (state.bot && state.bot.enabled) { try { ensureBotPresence(true); } catch(_){ } }

    // Countdown UI (overlay)
    if (state.phase === 'countdown' && state.countdownEndsAt) {
      countdownPill.hidden = false;
      // Give immediate button feedback during countdown
      if (btnStart) { btnStart.disabled = true; btnStart.textContent = 'Starting…'; }
      // Run countdown locally on every client for robustness
      clearInterval(countdownTimer);
      const updateCountdown = () => {
        const left = (state.countdownEndsAt || 0) - Date.now();
        const s = Math.max(0, Math.ceil(left / 1000));
        try {
          if (countdownOverlay) countdownOverlay.classList.add('show');
          if (countdownBigNumEl) { countdownBigNumEl.textContent = String(s || 0); countdownBigNumEl.style.display = ''; }
          if (countdownTurnTextEl) countdownTurnTextEl.style.display = 'none';
        } catch(_){}
        countdownNum.textContent = String(s);
        if (left <= 0 && state.phase === 'countdown') {
          clearInterval(countdownTimer);
          // Switch to placement phase (not directly to playing)
          state.phase = 'placement';
          state.ready = { A: false, B: false };
          resetPlacement();
          let msg = 'PLACE YOUR SHIPS!';
          try {
            if (countdownOverlay) countdownOverlay.classList.add('show');
            if (countdownBigNumEl) countdownBigNumEl.style.display = 'none';
            if (countdownTurnTextEl) { countdownTurnTextEl.textContent = msg; countdownTurnTextEl.style.display = ''; }
          } catch(_){}
          countdownFlashUntil = Date.now() + 1300;
          try { clearTimeout(countdownOverlayHideTimer); } catch(_){}
          countdownOverlayHideTimer = setTimeout(() => {
            try {
              countdownOverlay?.classList.remove('show');
              if (countdownTurnTextEl) countdownTurnTextEl.style.display = 'none';
            } catch(_){}
          }, 1300);
          // Bot auto-places ships immediately during placement
          if (state.bot && state.bot.enabled && state.bot.controllerId === clientId) {
            const botTeam = state.bot.team;
            if (botTeam) {
              state.boards[botTeam].ships = placeRandomShips();
              if (!state.ready) state.ready = {};
              state.ready[botTeam] = true;
            }
          }
          updateUiFromState();
          broadcast();
          // Auto-switch to YOUR FLEET tab so student sees their board
          try {
            const btnYour = document.getElementById('tabBtnYour');
            if (btnYour && myTeam) btnYour.click();
          } catch(_){}
        }
      };
      updateCountdown();
      countdownTimer = setInterval(updateCountdown, 200);
    } else {
      countdownPill.hidden = true;
      clearInterval(countdownTimer);
      // Keep overlay visible briefly if we just switched to playing and are flashing turn text
      if (!(countdownFlashUntil && Date.now() < countdownFlashUntil)) {
        try {
          countdownOverlay?.classList.remove('show');
          if (countdownTurnTextEl) countdownTurnTextEl.style.display = 'none';
        } catch(_){}
      }
    }

    // Overlays + record result once on gameover
    if (state.phase === 'gameover') {
      const weWon = (state.winner && myTeam && state.winner === myTeam);
      winnerOverlay.classList.toggle('show', !!weWon);
      loserOverlay.classList.toggle('show', !!(!weWon && myTeam));
      // Best-effort: post a result one time per gameover per client
      try {
        if (!updateUiFromState._postedResult) {
          if (weWon) {
            setWinText();
            spawnConfetti();
            try { if (window.SoundFX) window.SoundFX.play('win'); } catch(_){}
          } else if (myTeam) {
            setLoseText();
            spawnRain();
            try { if (window.SoundFX) window.SoundFX.play('lose'); } catch(_){}
          }
          const outcome = weWon ? 'win' : (myTeam ? 'lose' : null);
          if (outcome && window.recordResult) {
            window.recordResult({
              mode: 'battleship',
              game_name: 'Battleship',
              outcome,
              room_pin: window.currentSessionPin,
              details_json: { challenge_type: 'battleship', team: myTeam }
            }).catch(() => {});
          }
          updateUiFromState._postedResult = true;
        }
      } catch(_) { }
    } else {
      winnerOverlay.classList.remove('show');
      loserOverlay.classList.remove('show');
      clearEffects();
      updateUiFromState._postedResult = false;
    }

    // Ships are now placed during the placement phase (manual or randomized).
    // No auto-placement on team join.

    // Render boards
    renderBoards();
    renderStats();

    // Schedule bot move if it's bot's turn
    try { maybeTriggerBotMove(); } catch(_){ }

    // You are label
    youAreEl.textContent = `You: ${myTeam ? 'Team ' + myTeam : 'Spectator'}`;
    yourTeamBadge.textContent = myTeam ? myTeam : '—';
  }

  function renderBoards() {
    // During placement, your board is rendered by renderPlacementBoard()
    if (state.phase === 'placement') {
      qsa('.cell', enemyBoardEl).forEach(c => { c.className = 'cell'; c.innerHTML = ''; });
      // Don't clear your board cells — placement renderer handles them
      return;
    }

    // Clear classes on all cells
    qsa('.cell', yourBoardEl).forEach(c => { c.className = 'cell'; c.innerHTML = ''; c.style.backgroundColor = ''; });
    qsa('.cell', enemyBoardEl).forEach(c => { c.className = 'cell'; c.innerHTML = ''; });

    const letters = 'ABCDEFGHIJ'.split('');

    if (myTeam) {
      const mine = state.boards[myTeam];
      // Show own ships
      for (const sh of mine.ships || []) {
        for (const p of sh.coords) {
          const idx = p.r * 10 + p.c;
          const cell = yourBoardEl.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
          if (cell) cell.classList.add('ship');
        }
      }
      // Show enemy hits/misses on our board
      for (const key in mine.hits) {
        const [r, c] = key.split(',').map(Number);
        const cell = yourBoardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
        if (cell) { cell.classList.add('hit'); cell.innerHTML = '<span class="ping">💥</span>'; }
      }
      for (const key in mine.misses) {
        const [r, c] = key.split(',').map(Number);
        const cell = yourBoardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
        if (cell) { cell.classList.add('miss'); cell.innerHTML = '<span class="ping">💨</span>'; }
      }

      // Enemy board: show our shots
      const enemy = myTeam === 'A' ? 'B' : 'A';
      const log = state.teams[myTeam].shotsLog || [];
      for (const s of log) {
        const cell = enemyBoardEl.querySelector(`.cell[data-r="${s.r}"][data-c="${s.c}"]`);
        if (!cell) continue;
        cell.classList.add(s.hit ? 'hit' : 'miss');
        cell.innerHTML = `<span class="ping">${s.hit ? '🎯' : '🌊'}</span>`;
      }
    } else {
      // Spectator: show both boards minimally (no ships)
      for (const team of ['A','B']) {
        const brd = state.boards[team];
        const root = (team === 'A') ? yourBoardEl : enemyBoardEl;
        for (const key in brd.hits) {
          const [r, c] = key.split(',').map(Number);
          const cell = root.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
          if (cell) { cell.classList.add('hit'); cell.innerHTML = '<span class="ping">💥</span>'; }
        }
        for (const key in brd.misses) {
          const [r, c] = key.split(',').map(Number);
          const cell = root.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
          if (cell) { cell.classList.add('miss'); cell.innerHTML = '<span class="ping">💨</span>'; }
        }
      }
    }

    // Turn hint on enemy board
    const canFire = state && state.phase === 'playing' && myTeam && state.turn === myTeam;
    enemyBoardEl.classList.toggle('can-fire', !!canFire);
    enemyBoardEl.style.outline = canFire ? '2px solid #ffd54f' : 'none';
    enemyBoardEl.style.boxShadow = canFire ? '0 0 0 3px rgba(255,213,79,0.25) inset' : 'none';
  }

  function renderStats() {
    const a = state.teams.A, b = state.teams.B;
    const acc = (sh, hi) => (sh > 0 ? Math.round((hi / sh) * 100) : 0);

    // My Stats (personal)
    if (statsYouEl) {
      if (myTeam) {
        const log = state.teams[myTeam].shotsLog || [];
        const mine = log.filter(s => s.by === clientId);
        const mineShots = mine.length;
        const mineHits = mine.filter(s => s.hit).length;
        statsYouEl.innerHTML = renderStatsList({
          team: myTeam,
          shots: mineShots,
          hits: mineHits,
          accuracy: (mineShots ? Math.round((mineHits / mineShots)*100) : 0) + '%',
        });
      } else {
        statsYouEl.innerHTML = '<li>Spectating — join a team to track your stats.</li>';
      }
    }

    // Enemy Stats (opposing team aggregate)
    if (statsEnemyEl) {
      if (myTeam) {
        const enemy = myTeam === 'A' ? 'B' : 'A';
        const t = state.teams[enemy];
        statsEnemyEl.innerHTML = renderStatsList({
          team: enemy,
          players: Object.keys(t.members).length,
          shots: t.shots,
          hits: t.hits,
          accuracy: acc(t.shots, t.hits) + '%',
          shipsRemaining: state.teams[enemy].shipsRemaining,
        });
        if (enemyTeamBadge) enemyTeamBadge.textContent = enemy;
      } else {
        // As spectator, show both teams
        const listA = renderStatsList({ team: 'A', players: Object.keys(a.members).length, shots: a.shots, hits: a.hits, accuracy: acc(a.shots, a.hits) + '%', shipsRemaining: a.shipsRemaining });
        const listB = renderStatsList({ team: 'B', players: Object.keys(b.members).length, shots: b.shots, hits: b.hits, accuracy: acc(b.shots, b.hits) + '%', shipsRemaining: b.shipsRemaining });
        statsEnemyEl.innerHTML = `<li><strong>Team A</strong></li>${listA}${`<li style="margin-top:6px;"><strong>Team B</strong></li>`}${listB}`;
        if (enemyTeamBadge) enemyTeamBadge.textContent = 'A/B';
      }
    }
  }

  function renderStatsList(obj) {
    return Object.entries(obj).map(([k,v]) => `<li><strong style="display:inline-block; width:140px;">${labelize(k)}</strong> ${v}</li>`).join('');
  }
  function labelize(k) {
    return String(k).replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
  }

  // Small emoji pulse helper
  function pulse(cell, cls, text) {
    try {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      cell.appendChild(span);
      setTimeout(() => { try { span.remove(); } catch(_){} }, 500);
    } catch(_){ }
  }

  // Utility to temporarily add a class
  function addTempClass(el, cls, ms = 1000) {
    try {
      if (!el) return;
      el.classList.add(cls);
      setTimeout(() => { try { el.classList.remove(cls); } catch(_){} }, ms);
    } catch(_){}
  }

  // Show the YOUR TURN overlay for exactly 1 second
  function showTurnOverlayOnce() {
    if (!turnOverlay) return;
    try {
      const teamText = myTeam ? `Team ${myTeam}` : '';
      if (turnSubText) turnSubText.textContent = teamText ? `${teamText} — Enter coordinates and press Fire` : 'Enter coordinates and press Fire';
      turnOverlay.classList.add('show');
      try { if (window.SoundFX) window.SoundFX.play('turn'); } catch(_){}
      setTimeout(() => { try { turnOverlay.classList.remove('show'); } catch(_){} }, 1000);
    } catch(_){}
  }

  // Team join buttons
  btnJoinA?.addEventListener('click', () => joinTeam('A'));
  btnJoinB?.addEventListener('click', () => joinTeam('B'));

  function joinTeam(team) {
    if (!state) return;
    myTeam = team;
    ensureMember(team, clientId, myName);
    broadcast();
    updateUiFromState();
  }

  function ensureMember(team, id, name) {
    if (!state.teams[team].members) state.teams[team].members = {};
    if (!state.teams[team].members[id]) state.teams[team].members[id] = name || `Player-${id.slice(0, 4)}`;
  }

  // Start game logic
  btnStart?.addEventListener('click', () => {
    if (!state) return;
    const hasA = Object.keys(state.teams.A.members).length > 0;
    const hasB = Object.keys(state.teams.B.members).length > 0;
    if (!hasA || !hasB) return;
    // Immediate button feedback
    if (btnStart) { btnStart.disabled = true; btnStart.textContent = 'Starting…'; }
    // Set countdown
    state.phase = 'countdown';
    state.countdownEndsAt = Date.now() + 3000;
    state.startedBy = clientId;
    // Random first turn
    state.turn = Math.random() < 0.5 ? 'A' : 'B';
    // Update local UI immediately (shows countdown and turn)
    updateUiFromState();
    broadcast();
  });

  // Overlays buttons
  playAgainBtn?.addEventListener('click', () => {
    resetForNextBattle();
    updateUiFromState();
    broadcast();
  });
  okLoserBtn?.addEventListener('click', () => {
    resetForNextBattle();
    updateUiFromState();
    broadcast();
  });

  function resetForNextBattle() {
    if (!state) return;
    const keepA = state.teams.A.members;
    const keepB = state.teams.B.members;
    const wasWinner = state.winner;
    state = defaultState();
    state.teams.A.members = keepA;
    state.teams.B.members = keepB;
    // Give the losing team the first turn for morale (totally scientific)
    state.turn = (wasWinner === 'A') ? 'B' : 'A';
    resetPlacement();
    // Clear any inline background colors on your board cells from placement
    qsa('.cell', yourBoardEl).forEach(c => { c.style.backgroundColor = ''; });
  }

  // Single Player (Bot) helpers
  function setSinglePlayer(enabled) {
    if (!state) return;
    state.bot = state.bot || { enabled: false, team: null, controllerId: null, delayMs: 1000 };
    if (enabled) {
      // Ensure we are on some team; default to A if none
      if (!myTeam) { myTeam = 'A'; ensureMember('A', clientId, myName); }
      state.bot.team = (myTeam === 'A') ? 'B' : 'A';
      state.bot.enabled = true;
      if (!state.bot.controllerId) state.bot.controllerId = clientId;
      ensureBotPresence(true);
    } else {
      state.bot.enabled = false;
      if (state.bot.controllerId === clientId) {
        // Remove bot member so multiplayer can resume naturally
        try { if (state.teams[state.bot.team]?.members?.BOT) delete state.teams[state.bot.team].members.BOT; } catch(_){ }
      }
      cancelBotTimer();
    }
    updateUiFromState();
    broadcast();
  }

  function ensureBotPresence(broadcastIfChanged = false) {
    if (!state?.bot?.enabled) return;
    if (state.bot.controllerId && state.bot.controllerId !== clientId) return; // only controller modifies
    let changed = false;
    const bt = state.bot.team || ((myTeam === 'A') ? 'B' : 'A');
    if (!state.bot.team) { state.bot.team = bt; changed = true; }
    // Add placeholder bot member
    if (!state.teams[bt].members) state.teams[bt].members = {};
    if (!state.teams[bt].members.BOT) { state.teams[bt].members.BOT = '🤖 Bot'; changed = true; }
    // Ensure bot's ships placed (auto-place during placement or playing phases)
    if (!state.boards[bt].ships && (state.phase === 'placement' || state.phase === 'playing')) {
      state.boards[bt].ships = placeRandomShips(); changed = true;
      if (!state.ready) state.ready = {};
      state.ready[bt] = true;
      changed = true;
    }
    if (changed && broadcastIfChanged) broadcast();
    // Check if both ready after bot auto-placed
    if (state.phase === 'placement') checkBothReady();
  }

  function maybeTriggerBotMove() {
    try { clearTimeout(botMoveTimer); } catch(_){}
    botMoveTimer = null;
    if (!state?.bot?.enabled) return;
    if (state.bot.controllerId && state.bot.controllerId !== clientId) return;
    if (state.phase !== 'playing') return;
    const botTeam = state.bot.team || ((myTeam === 'A') ? 'B' : 'A');
    if (state.turn !== botTeam) return;
    if (!state.boards || !state.boards[botTeam ? (botTeam==='A'?'B':'A') : 'A']) return;
    const delay = Math.max(200, Number(state.bot.delayMs || 1000));
    botMoveTimer = setTimeout(() => { try { performBotMove(); } catch(e){ console.error('Bot move error', e); } }, delay);
  }

  function cancelBotTimer(){ try { clearTimeout(botMoveTimer); } catch(_){} botMoveTimer = null; }

  function performBotMove() {
    if (!state?.bot?.enabled) return;
    if (state.bot.controllerId && state.bot.controllerId !== clientId) return;
    if (state.phase !== 'playing') return;
    const botTeam = state.bot.team || ((myTeam === 'A') ? 'B' : 'A');
    if (state.turn !== botTeam) return;
    const enemy = botTeam === 'A' ? 'B' : 'A';

    // Build my shots
    const myShots = (state.teams[botTeam]?.shotsLog) || [];
    let pick = null;
    try {
      pick = window.SimpleGridBot?.pickTarget({ gridSize: 10, myShots, parity: 2 });
    } catch(_){ }

    // Fallbacks if needed
    const shotMap = {};
    for (const s of myShots) { shotMap[`${s.r},${s.c}`] = true; }
    function randomUnshot(){
      const pool = [];
      for (let r=0;r<10;r++) for (let c=0;c<10;c++){ const k = `${r},${c}`; if (!shotMap[k]) pool.push({r,c}); }
      return pool.length ? pool[Math.floor(Math.random()*pool.length)] : null;
    }
    if (!pick || shotMap[`${pick.r},${pick.c}`]) pick = randomUnshot();
    if (!pick) return; // no moves left

    const r = pick.r, c = pick.c;
    const hit = isShipAt(state.boards[enemy].ships, r, c);
    markShot(botTeam, enemy, r, c, hit);
    state.shotSeq = (state.shotSeq || 0) + 1;
    state.turn = enemy;
    if (isAllSunk(state.boards[enemy].ships)) { state.phase = 'gameover'; state.winner = botTeam; }
    updateUiFromState();
    broadcast();
  }

  // Ship placement utilities
  function placeRandomShips() {
    const sizes = [5, 4, 3, 3, 2];
    const ships = [];
    const grid = Array.from({ length: 10 }, () => Array(10).fill(0));

    function canPlace(r, c, len, horiz) {
      if (horiz) {
        if (c + len > 10) return false;
        for (let i = 0; i < len; i++) { if (grid[r][c+i]) return false; }
      } else {
        if (r + len > 10) return false;
        for (let i = 0; i < len; i++) { if (grid[r+i][c]) return false; }
      }
      return true;
    }
    function doPlace(name, len) {
      for (let attempts = 0; attempts < 500; attempts++) {
        const horiz = Math.random() < 0.5;
        const r = Math.floor(Math.random() * 10);
        const c = Math.floor(Math.random() * 10);
        if (!canPlace(r, c, len, horiz)) continue;
        const coords = [];
        for (let i = 0; i < len; i++) {
          const rr = r + (horiz ? 0 : i);
          const cc = c + (horiz ? i : 0);
          grid[rr][cc] = 1;
          coords.push({ r: rr, c: cc });
        }
        ships.push({ name, size: len, coords, hits: [] });
        return true;
      }
      // If we somehow failed a lot, start over
      return false;
    }

    const names = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'];
    for (let i = 0; i < sizes.length; i++) {
      const ok = doPlace(names[i], sizes[i]);
      if (!ok) return placeRandomShips();
    }
    return ships;
  }

  // ---- Epic win/loss celebration system ----
  const winSubEl = qs('#winnerSub');
  const loserTextEl = qs('#loserText');
  const loserSubEl = qs('#loserSub');
  const winConfettiEl = qs('#winConfetti');
  const loseRainEl = qs('#loseRain');

  const WIN_TITLES = [
    'YOU WIN!!!!',
    'VICTORY!!!!',
    'ABSOLUTE DOMINATION!!!!',
    'LEGENDARY WIN!!!!',
    'FLAWLESS VICTORY!!!!',
  ];
  const WIN_SUBS = [
    'The enemy fleet is sleeping with the fishes.',
    'Admiral status: UNLOCKED.',
    'They never stood a chance.',
    'You made that look EASY.',
    'The ocean belongs to you now.',
    'GOATED. No cap. FR FR.',
    'The other team is literally crying RN.',
    'Somebody call the coast guard... for THEM.',
    'Your strategy was *chef\'s kiss*.',
    'Unmatched. Unstoppable. Unhinged.',
  ];
  const LOSE_TITLES = [
    'YOU LOST!',
    'DEFEATED!',
    'SUNK!',
    'OBLITERATED!',
    'GAME OVER!',
  ];
  const LOSE_SUBS = [
    'Your ships are now artificial reefs.',
    'Even your rubber ducky is embarrassed.',
    'Somewhere, a bot is laughing at you.',
    'F in the chat.',
    'This is the saddest thing since Titanic.',
    'Task failed successfully?',
    'Don\'t worry, nobody saw that. (Everyone saw that.)',
    'Your fleet said "aight imma head out."',
    'You fought bravely. You just also fought badly.',
    'Plot twist: the ships were the friends we lost along the way.',
    'That was... a choice.',
    'Certified bruh moment.',
  ];
  const LOSE_BTNS = ['Womp womp', 'Pain.', 'I\'m fine. This is fine.', 'Cry about it', 'Try not to cry'];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function setWinText() {
    if (winnerText) winnerText.textContent = pick(WIN_TITLES);
    if (winSubEl) winSubEl.textContent = pick(WIN_SUBS);
  }

  function setLoseText() {
    if (loserTextEl) loserTextEl.textContent = pick(LOSE_TITLES);
    if (loserSubEl) loserSubEl.textContent = pick(LOSE_SUBS);
    if (okLoserBtn) okLoserBtn.textContent = pick(LOSE_BTNS);
  }

  function spawnConfetti() {
    if (!winConfettiEl) return;
    winConfettiEl.innerHTML = '';
    const colors = ['#ffd700','#ff6b35','#ff1744','#00e676','#2979ff','#e040fb','#00e5ff','#ffea00'];
    const shapes = ['square','circle'];
    for (let i = 0; i < 80; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      el.style.width = (6 + Math.random() * 8) + 'px';
      el.style.height = (6 + Math.random() * 8) + 'px';
      if (shapes[Math.floor(Math.random() * shapes.length)] === 'circle') el.style.borderRadius = '50%';
      el.style.animationDuration = (2 + Math.random() * 3) + 's';
      el.style.animationDelay = (Math.random() * 2) + 's';
      winConfettiEl.appendChild(el);
    }
  }

  function spawnRain() {
    if (!loseRainEl) return;
    loseRainEl.innerHTML = '';
    for (let i = 0; i < 60; i++) {
      const el = document.createElement('div');
      el.className = 'rain-drop';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.height = (15 + Math.random() * 25) + 'px';
      el.style.animationDuration = (0.5 + Math.random() * 0.8) + 's';
      el.style.animationDelay = (Math.random() * 2) + 's';
      el.style.opacity = 0.3 + Math.random() * 0.4;
      loseRainEl.appendChild(el);
    }
  }

  function clearEffects() {
    if (winConfettiEl) winConfettiEl.innerHTML = '';
    if (loseRainEl) loseRainEl.innerHTML = '';
  }

})();
