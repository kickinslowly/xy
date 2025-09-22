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
      phase: 'lobby', // 'lobby' | 'countdown' | 'playing' | 'gameover'
      countdownEndsAt: null, // ms since epoch
      startedBy: null,
      winner: null,
      turn: null, // 'A' or 'B'
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
    state = remote;
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
        // Clicking to fire is disabled; use manual coordinate input instead.
        // if (!isOwn) {
        //   cell.addEventListener('click', onEnemyCellClick);
        // }
        root.appendChild(cell);
      }
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
    // Disabled: use manual inputs to fire
    pulse(e.currentTarget, 'ping', '⌨️');
  }

  function fireFromInputs() {
    if (!shotRowEl || !shotColEl) return;
    const yStr = (shotRowEl.value || '').trim();
    const xStr = (shotColEl.value || '').trim();
    fireMsg('');
    const yNum = Number(yStr);
    if (!(yNum >= 1 && yNum <= 10)) {
      return fireMsg('Enter Y 1–10');
    }
    const xNum = Number(xStr);
    if (!(xNum >= 1 && xNum <= 10)) {
      return fireMsg('Enter X 1–10');
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
    const enemy = (myTeam === 'A') ? 'B' : 'A';
    if (hasShotAt(state.teams[myTeam].shotsLog, r, c)) {
      return fireMsg('Already fired at that coordinate');
    }
    const hit = isShipAt(state.boards[enemy].ships, r, c);
    markShot(myTeam, enemy, r, c, hit);
    state.turn = enemy;
    if (isAllSunk(state.boards[enemy].ships)) {
      state.phase = 'gameover';
      state.winner = myTeam;
    }
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
    else if (state.phase === 'playing') phaseText.textContent = 'Playing';
    else if (state.phase === 'gameover') phaseText.textContent = 'Game over';

    // Hide lobby bar once the game is starting/started
    if (lobbyPanel) {
      lobbyPanel.style.display = (state.phase === 'lobby') ? '' : 'none';
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
          // Switch to playing, then flash "Your Turn"/"Opponent's Turn"
          state.phase = 'playing';
          let msg = 'Team ' + (state.turn || '—') + "'s Turn";
          if (myTeam) msg = (state.turn === myTeam) ? 'YOUR TURN' : "OPPONENT'S TURN";
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
          // Immediately refresh local UI so turn indicators and bot scheduling update without needing server echo
          updateUiFromState();
          broadcast();
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

    // Overlays
    if (state.phase === 'gameover') {
      const weWon = (state.winner && myTeam && state.winner === myTeam);
      winnerOverlay.classList.toggle('show', !!weWon);
      loserOverlay.classList.toggle('show', !!(!weWon && myTeam));
      if (state.winner) {
        winnerText.textContent = `Team ${state.winner} Wins!`;
      }
    } else {
      winnerOverlay.classList.remove('show');
      loserOverlay.classList.remove('show');
    }

    // Ensure ships exist when teams join (only a member places their own team's ships)
    if (myTeam === 'A' && !state.boards.A.ships && listA.length > 0) {
      state.boards.A.ships = placeRandomShips();
      broadcast();
    }
    if (myTeam === 'B' && !state.boards.B.ships && listB.length > 0) {
      state.boards.B.ships = placeRandomShips();
      broadcast();
    }

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
    // Clear classes on all cells
    qsa('.cell', yourBoardEl).forEach(c => { c.className = 'cell'; c.innerHTML = ''; });
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
    // Ensure bot's ships placed
    if (!state.boards[bt].ships) { state.boards[bt].ships = placeRandomShips(); changed = true; }
    if (changed && broadcastIfChanged) broadcast();
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

})();
