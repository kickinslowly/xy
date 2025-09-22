(() => {
  // Helpers
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const presenceEl = qs('#presence');
  const shareBtn = qs('#shareSessionBtn');
  const joinBtn = qs('#joinSessionBtn');

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

  const yourBoardEl = qs('#yourBoard');
  const enemyBoardEl = qs('#enemyBoard');

  // Manual fire controls and Noob Mode
  const shotRowEl = qs('#shotRow');
  const shotColEl = qs('#shotCol');
  const fireBtnEl = qs('#fireBtn');
  const fireMsgEl = qs('#fireMsg');
  const noobModeEl = qs('#noobMode');

  const statsYouEl = qs('#statsYou');
  const yourTeamBadge = qs('#yourTeamBadge');
  const statsEnemyEl = qs('#statsEnemy');
  const enemyTeamBadge = qs('#enemyTeamBadge');

  const winnerOverlay = qs('#winnerOverlay');
  const loserOverlay = qs('#loserOverlay');
  const winnerText = qs('#winnerText');
  const playAgainBtn = qs('#playAgainBtn');
  const okLoserBtn = qs('#okLoserBtn');

  // Countdown overlay elements
  const countdownOverlay = qs('#countdownOverlay');
  const countdownBigNumEl = qs('#countdownBigNum');
  const countdownTurnTextEl = qs('#countdownTurnText');
  let countdownOverlayHideTimer = null;
  let countdownFlashUntil = 0;

  // Captured meme popup
  const captureOverlay = qs('#captureOverlay');
  const captureMemeImg = qs('#captureMemeImg');
  let captureHideTimer = null;
  let mySunkIds = null; // Set of meme ids already acknowledged as sunk on my board

  const turnBannerEl = qs('#turnBanner');

  // Session and socket
  const getParam = (name) => new URLSearchParams(window.location.search).get(name);
  const clientId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  const mode = 'memewars';
  let socket = null;
  let room = null;

  // Local client role
  let myTeam = null; // 'A' | 'B' | null
  let myName = makeFunnyName();

  // Game state
  let state = null;
  let countdownTimer = null;

  function defaultState() {
    return {
      phase: 'lobby', // 'lobby' | 'countdown' | 'playing' | 'gameover'
      countdownEndsAt: null,
      startedBy: null,
      winner: null,
      turn: null, // 'A' or 'B'
      teams: {
        A: { members: {}, shots: 0, hits: 0, memesRemaining: 4, shotsLog: [] },
        B: { members: {}, shots: 0, hits: 0, memesRemaining: 4, shotsLog: [] },
      },
      boards: {
        A: { memes: null, hits: {}, misses: {} },
        B: { memes: null, hits: {}, misses: {} },
      },
      bot: { enabled: false, team: null, controllerId: null, delayMs: 1000 },
      lastShot: null,
    };
  }

  // Init
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
    const a = ['Dank', 'Spicy', 'Cheems', 'Epic', 'Wholesome', 'Cursed'];
    const b = ['Meme', 'Pepe', 'Doge', 'Shibe', 'Troll', 'Grinch'];
    return `${a[Math.floor(Math.random()*a.length)]} ${b[Math.floor(Math.random()*b.length)]}`;
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
      } catch(e) { console.error('pin error', e); }
    }
    return pin;
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
    if (shareBtn) shareBtn.addEventListener('click', async () => {
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
    if (joinBtn) joinBtn.addEventListener('click', () => {
      const input = window.prompt('Enter the PIN to join another session:');
      const val = (input || '').trim();
      if (!val) return;
      const cleaned = val.replace(/\s+/g, '');
      const url = new URL(window.location.href);
      url.searchParams.set('pin', cleaned);
      window.location.href = url.toString();
    });
  }

  function setPresence(count, online) {
    if (!presenceEl) return;
    if (!online) { presenceEl.textContent = '• Offline'; return; }
    const n = Number(count) || 1;
    presenceEl.textContent = `• ${n} online`;
  }

  function wireSocket() {
    socket.on('connect', () => {
      setPresence(1, true);
      socket.emit('join', { room, mode });
      socket.emit('request_state', { room, mode });
      // Seed if needed
      setTimeout(() => {
        if (!state) {
          state = defaultState();
          // If we already have an assigned team, add ourselves immediately
          if (myTeam) { try { ensureMember(myTeam, clientId, myName); } catch(_) {} }
          broadcast();
        }
      }, 300);
    });
    socket.on('disconnect', () => setPresence(0, false));
    socket.on('presence', (p) => { if (p && p.room === room) setPresence(p.count, true); });
    socket.on('state', (msg) => { if (msg && msg.room === room && msg.mode === mode) applyRemoteState(msg.state); });
    socket.on('state_update', (msg) => {
      if (!msg || msg.room !== room || msg.mode !== mode) return;
      applyRemoteState(msg.state);
    });
    socket.on('role', (msg) => {
      if (!msg || msg.room !== room) return;
      const r = msg.role;
      myTeam = (r === 'A' || r === 'B') ? r : null;
      if (myTeam && state) { ensureMember(myTeam, clientId, myName); broadcast(); }
      updateUiFromState();
    });
  }

  function applyRemoteState(remote) {
    if (!remote) return;
    state = remote;
    // If server has assigned us a role already, make sure we are listed in that team
    if (myTeam) {
      try {
        const members = (state.teams && state.teams[myTeam] && state.teams[myTeam].members) || {};
        if (!members[clientId]) {
          ensureMember(myTeam, clientId, myName);
          broadcast();
        }
      } catch(_) {}
    }
    updateUiFromState();
  }

  function broadcast() {
    try {
      socket?.emit('state_update', { room, mode, clientId, state });
    } catch(_) {}
  }

  // Build boards (with axis labels, reversed Y)
  function buildBoards() { buildBoard(yourBoardEl, true); buildBoard(enemyBoardEl, false); }
  function buildBoard(root, isOwn) {
    root.innerHTML = '';
    for (let r = 0; r < 10; r++) {
      const y = document.createElement('div'); y.className = 'lbl ylbl'; y.textContent = String(10 - r); root.appendChild(y);
      for (let c = 0; c < 10; c++) {
        const cell = document.createElement('div'); cell.className = 'cell'; cell.dataset.r = String(r); cell.dataset.c = String(c);
        if (!isOwn) cell.addEventListener('click', onEnemyCellClick);
        root.appendChild(cell);
      }
    }
    const bl = document.createElement('div'); bl.className = 'lbl bl'; bl.textContent = ''; root.appendChild(bl);
    for (let c = 0; c < 10; c++) { const d = document.createElement('div'); d.className = 'lbl bottom'; d.textContent = String(c+1); if (c===9){ const xAxis=document.createElement('div'); xAxis.className='axis x'; xAxis.textContent='X'; root.appendChild(xAxis);} root.appendChild(d);} 
    const yAxis = document.createElement('div'); yAxis.className='axis y'; yAxis.textContent='Y'; root.appendChild(yAxis);
  }

  function onEnemyCellClick(e) {
    if (!noobModeEl?.checked) { pulse(e.currentTarget, 'ping', '⌨️'); return; }
    const r = Number(e.currentTarget.dataset.r);
    const c = Number(e.currentTarget.dataset.c);
    tryFireAt(r, c);
  }

  // Team & lobby helpers
  function ensureMember(team, id, name) {
    if (!state.teams[team].members) state.teams[team].members = {};
    if (!state.teams[team].members[id]) state.teams[team].members[id] = name || `Player-${id.slice(0,4)}`;
  }

  // Start game
  btnStart?.addEventListener('click', () => {
    if (!state) return;
    const hasA = Object.keys(state.teams.A.members || {}).length > 0;
    const hasB = Object.keys(state.teams.B.members || {}).length > 0;
    if (!hasA || !hasB) return;
    btnStart.disabled = true; btnStart.textContent = 'Starting…';
    state.phase = 'countdown';
    state.countdownEndsAt = Date.now() + 3000;
    state.startedBy = clientId;
    state.turn = Math.random() < 0.5 ? 'A' : 'B';
    updateUiFromState();
    broadcast();
  });

  playAgainBtn?.addEventListener('click', () => { resetGame(true); });
  okLoserBtn?.addEventListener('click', () => { resetGame(false); });
  function resetGame(won) {
    if (!state) return;
    const keepA = state.teams.A.members; const keepB = state.teams.B.members;
    const prevWinner = state.winner;
    state = defaultState();
    state.teams.A.members = keepA; state.teams.B.members = keepB;
    state.turn = (prevWinner === 'A') ? 'B' : 'A';
    updateUiFromState();
    broadcast();
  }

  // Single Player (Bot) helpers
  function setSinglePlayer(enabled) {
    if (!state) return;
    state.bot = state.bot || { enabled: false, team: null, controllerId: null, delayMs: 1000 };
    if (enabled) {
      if (!myTeam) { myTeam = 'A'; ensureMember('A', clientId, myName); }
      state.bot.team = (myTeam === 'A') ? 'B' : 'A';
      state.bot.enabled = true;
      if (!state.bot.controllerId) state.bot.controllerId = clientId;
      ensureBotPresence(true);
    } else {
      state.bot.enabled = false;
      if (state.bot.controllerId === clientId) {
        try { if (state.teams[state.bot.team]?.members?.BOT) delete state.teams[state.bot.team].members.BOT; } catch(_){}
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
    if (!state.teams[bt].members) state.teams[bt].members = {};
    if (!state.teams[bt].members.BOT) { state.teams[bt].members.BOT = '🤖 Bot'; changed = true; }
    if (!state.boards[bt].memes) { state.boards[bt].memes = placeRandomMemes(window.AVAILABLE_MEME_IMAGES || []); changed = true; }
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

    const myShots = (state.teams[botTeam]?.shotsLog) || [];
    let pick = null;
    try {
      pick = window.SimpleGridBot?.pickTarget({ gridSize: 10, myShots, parity: 1 });
    } catch(_){}

    const shotMap = {}; for (const s of myShots) { shotMap[`${s.r},${s.c}`] = true; }
    function randomUnshot(){
      const pool = [];
      for (let r=0;r<10;r++) for (let c=0;c<10;c++){ const k = `${r},${c}`; if (!shotMap[k]) pool.push({r,c}); }
      return pool.length ? pool[Math.floor(Math.random()*pool.length)] : null;
    }
    if (!pick || shotMap[`${pick.r},${pick.c}`]) pick = randomUnshot();
    if (!pick) return;

    const r = pick.r, c = pick.c;
    const hitObj = memeAt(state.boards[enemy].memes, r, c);
    const hit = !!hitObj;
    markShot(botTeam, enemy, r, c, hit);
    state.turn = enemy;
    if (allMemesSunk(state.boards[enemy].memes, state.boards[enemy].hits)) { state.phase = 'gameover'; state.winner = botTeam; }
    updateUiFromState();
    broadcast();
  }

  // Fire controls
  fireBtnEl?.addEventListener('click', fireFromInputs);
  shotRowEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') fireFromInputs(); });
  shotColEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') fireFromInputs(); });

  function fireFromInputs() {
    if (!shotRowEl || !shotColEl) return;
    const y = Number((shotRowEl.value || '').trim());
    const x = Number((shotColEl.value || '').trim());
    fireMsg('');
    if (!(y >= 1 && y <= 10)) return fireMsg('Enter Y 1–10');
    if (!(x >= 1 && x <= 10)) return fireMsg('Enter X 1–10');
    const r = 10 - y; const c = x - 1;
    tryFireAt(r, c);
  }

  function tryFireAt(r, c) {
    if (!state || state.phase !== 'playing') return fireMsg('Game not started');
    if (!myTeam) return fireMsg('Join a team to fire');
    if (state.turn !== myTeam) return fireMsg(`Waiting for Team ${state.turn}`);
    const enemy = myTeam === 'A' ? 'B' : 'A';
    if (hasShotAt(state.teams[myTeam].shotsLog, r, c)) return fireMsg('Already fired there');
    const hitObj = memeAt(state.boards[enemy].memes, r, c);
    const hit = !!hitObj;
    markShot(myTeam, enemy, r, c, hit);
    // Switch turn
    state.turn = enemy;
    // Win condition: all 4 enemy memes revealed (sunk)
    if (allMemesSunk(state.boards[enemy].memes, state.boards[enemy].hits)) {
      state.phase = 'gameover';
      state.winner = myTeam;
    }
    updateUiFromState();
    broadcast();
    fireMsg(hit ? 'Hit! 🎯' : 'Miss 🌊');
    if (shotRowEl) shotRowEl.value = '';
    if (shotColEl) shotColEl.value = '';
  }

  function hasShotAt(shotsLog, r, c) { return (shotsLog || []).some(s => s.r === r && s.c === c); }
  function rcKey(r, c) { return `${r},${c}`; }

  function markShot(team, enemy, r, c, hit) {
    const enemyBoard = state.boards[enemy];
    const tk = rcKey(r, c);
    if (hit) {
      enemyBoard.hits[tk] = true;
      state.teams[team].hits += 1;
    } else {
      enemyBoard.misses[tk] = true;
    }
    state.teams[team].shots += 1;
    state.teams[team].shotsLog.push({ by: clientId, r, c, hit });
    // Update remaining for enemy
    const remaining = (enemyBoard.memes || []).filter(m => !isMemeSunk(m, enemyBoard.hits)).length;
    state.teams[enemy].memesRemaining = remaining;
    state.lastShot = { team, r, c, hit };
  }

  function updateUiFromState() {
    if (!state) return;

    // Ensure memes exist when a member of a team is present
    if (myTeam === 'A' && !state.boards.A.memes && Object.keys(state.teams.A.members).length > 0) {
      state.boards.A.memes = placeRandomMemes(window.AVAILABLE_MEME_IMAGES || []);
      broadcast();
    }
    if (myTeam === 'B' && !state.boards.B.memes && Object.keys(state.teams.B.members).length > 0) {
      state.boards.B.memes = placeRandomMemes(window.AVAILABLE_MEME_IMAGES || []);
      broadcast();
    }

    // Sync single player toggle and ensure bot presence
    try { if (singlePlayerToggle) singlePlayerToggle.checked = !!(state.bot && state.bot.enabled); } catch(_){ }
    if (state.bot && state.bot.enabled) { try { ensureBotPresence(true); } catch(_){ } }

    // Enable/disable Start button based on team presence
    const hasA = Object.keys(state.teams.A.members || {}).length > 0;
    const hasB = Object.keys(state.teams.B.members || {}).length > 0;
    const canStart = hasA && hasB && state.phase === 'lobby';
    if (btnStart) {
      btnStart.disabled = !canStart;
      btnStart.textContent = (state.phase === 'countdown') ? 'Starting…' : 'Start Game';
    }

    // Phase label
    if (state.phase === 'lobby') phaseText.textContent = 'Lobby';
    else if (state.phase === 'countdown') phaseText.textContent = 'Countdown';
    else if (state.phase === 'playing') phaseText.textContent = 'Playing';
    else if (state.phase === 'gameover') phaseText.textContent = 'Game over';

    // Hide lobby bar once the game is starting/started
    if (lobbyPanel) {
      lobbyPanel.style.display = (state.phase === 'lobby') ? '' : 'none';
    }

    // Countdown handling (overlay)
    if (state.phase === 'countdown' && state.countdownEndsAt) {
      countdownPill.hidden = false;
      if (btnStart) { btnStart.disabled = true; btnStart.textContent = 'Starting…'; }
      clearInterval(countdownTimer);
      const tick = () => {
        const left = (state.countdownEndsAt || 0) - Date.now();
        const s = Math.max(0, Math.ceil(left/1000));
        try {
          if (countdownOverlay) countdownOverlay.classList.add('show');
          if (countdownBigNumEl) { countdownBigNumEl.textContent = String(s || 0); countdownBigNumEl.style.display = ''; }
          if (countdownTurnTextEl) countdownTurnTextEl.style.display = 'none';
        } catch(_){}
        countdownNum.textContent = String(s);
        if (left <= 0 && state.phase === 'countdown') {
          clearInterval(countdownTimer);
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
          updateUiFromState();
          broadcast();
        }
      };
      tick(); countdownTimer = setInterval(tick, 200);
    } else {
      countdownPill.hidden = true;
      clearInterval(countdownTimer);
      if (!(countdownFlashUntil && Date.now() < countdownFlashUntil)) {
        try {
          countdownOverlay?.classList.remove('show');
          if (countdownTurnTextEl) countdownTurnTextEl.style.display = 'none';
        } catch(_){}
      }
    }

    // Turn pill
    turnPill.classList.remove('your-turn','waiting');
    if (myTeam && state.turn === myTeam) { turnPill.textContent = `Your Turn (Team ${state.turn})`; turnPill.classList.add('your-turn'); }
    else if (state.turn) { turnPill.textContent = `Waiting for Team ${state.turn}`; turnPill.classList.add('waiting'); }
    else { turnPill.textContent = 'Turn: —'; }

    // Turn banner
    if (turnBannerEl) {
      turnBannerEl.classList.remove('is-you','is-opponent','is-spectator');
      let txt = '—';
      if (state.phase === 'playing' && state.turn) {
        if (myTeam) { if (state.turn === myTeam) { txt = 'YOUR TURN'; turnBannerEl.classList.add('is-you'); } else { txt = "OPPONENT'S TURN"; turnBannerEl.classList.add('is-opponent'); } }
        else { txt = `Team ${state.turn}'s Turn`; turnBannerEl.classList.add('is-spectator'); }
      } else if (state.phase === 'countdown') txt = 'Starting…';
      else if (state.phase === 'lobby') txt = 'Waiting to Start';
      else if (state.phase === 'gameover') txt = state.winner ? `Game Over — Team ${state.winner} Wins` : 'Game Over';
      turnBannerEl.textContent = txt;
    }

    // Winner/loser overlays
    if (state.phase === 'gameover') {
      const weWon = myTeam && state.winner === myTeam;
      winnerOverlay.classList.toggle('show', !!weWon);
      loserOverlay.classList.toggle('show', !!(!weWon && myTeam));
      if (state.winner) winnerText.textContent = `Team ${state.winner} Wins!`;
    } else {
      winnerOverlay.classList.remove('show');
      loserOverlay.classList.remove('show');
    }

    // Render boards and stats
    renderBoards();
    renderStats();

    // Capture popup for newly sunk memes on your board
    try {
      if (state.phase === 'playing' && myTeam) {
        const mine = state.boards[myTeam] || {};
        const memes = mine.memes || [];
        const hits = mine.hits || {};
        const currentSunk = new Set(memes.filter(m => isMemeSunk(m, hits)).map(m => m.id || JSON.stringify(m.coords)));
        if (mySunkIds === null) {
          // First run for this phase: initialize without showing
          mySunkIds = new Set(currentSunk);
        } else {
          let newMeme = null;
          for (const m of memes) {
            const id = m.id || JSON.stringify(m.coords);
            if (isMemeSunk(m, hits) && !mySunkIds.has(id)) { newMeme = m; break; }
          }
          if (newMeme) {
            mySunkIds.add(newMeme.id || JSON.stringify(newMeme.coords));
            showCaptureOverlay(newMeme.url);
          } else {
            // Keep in sync if set drifted
            mySunkIds = currentSunk;
          }
        }
      } else {
        // Reset tracking when not actively playing or not on a team
        mySunkIds = null;
      }
    } catch (_) { /* non-blocking */ }

    // Schedule bot move if it's bot's turn
    try { maybeTriggerBotMove(); } catch(_){ }

    youAreEl.textContent = `You: ${myTeam ? 'Team ' + myTeam : 'Spectator'}`;
    yourTeamBadge.textContent = myTeam ? myTeam : '—';
    enemyTeamBadge.textContent = myTeam ? (myTeam === 'A' ? 'B' : 'A') : '—';
  }

  function renderBoards() {
    qsa('.cell', yourBoardEl).forEach(c => { c.className = 'cell'; c.innerHTML = ''; c.style.backgroundImage=''; c.style.backgroundPosition=''; });
    qsa('.cell', enemyBoardEl).forEach(c => { c.className = 'cell'; c.innerHTML = ''; c.style.backgroundImage=''; c.style.backgroundPosition=''; });

    if (myTeam) {
      const mine = state.boards[myTeam];
      // Own memes visible with image tiles
      for (const m of mine.memes || []) {
        paintMemeTiles(yourBoardEl, m);
      }
      // Show enemy shots on our board
      for (const key in mine.hits) { const [r,c] = key.split(',').map(Number); const cell = yourBoardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`); if (cell) { cell.classList.add('hit'); cell.innerHTML = '<span class="ping">💥</span>'; } }
      for (const key in mine.misses) { const [r,c] = key.split(',').map(Number); const cell = yourBoardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`); if (cell) { cell.classList.add('miss'); cell.innerHTML = '<span class="ping">💨</span>'; } }

      // Enemy board: our shots
      const enemy = myTeam === 'A' ? 'B' : 'A';
      const log = state.teams[myTeam].shotsLog || [];
      for (const s of log) {
        const cell = enemyBoardEl.querySelector(`.cell[data-r="${s.r}"][data-c="${s.c}"]`);
        if (!cell) continue; cell.classList.add(s.hit ? 'hit' : 'miss'); cell.innerHTML = `<span class="ping">${s.hit ? '🎯' : '🌊'}</span>`;
      }
      // Reveal sunk enemy memes with images
      const enemyBoard = state.boards[enemy];
      for (const m of enemyBoard.memes || []) {
        if (isMemeSunk(m, enemyBoard.hits)) {
          paintMemeTiles(enemyBoardEl, m);
          // Dim hit icons over revealed meme tiles so the image is visible
          for (const p of m.coords) {
            const cell = enemyBoardEl.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
            if (cell) {
              cell.classList.add('revealed');
              const ping = cell.querySelector('.ping');
              if (ping) { ping.style.opacity = '0.25'; }
            }
          }
        }
      }
    } else {
      // Spectator: show hits/misses only
      for (const team of ['A','B']) {
        const brd = state.boards[team];
        const root = (team === 'A') ? yourBoardEl : enemyBoardEl;
        for (const key in brd.hits) { const [r,c] = key.split(',').map(Number); const cell = root.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`); if (cell) { cell.classList.add('hit'); cell.innerHTML = '<span class="ping">💥</span>'; } }
        for (const key in brd.misses) { const [r,c] = key.split(',').map(Number); const cell = root.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`); if (cell) { cell.classList.add('miss'); cell.innerHTML = '<span class="ping">💨</span>'; } }
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
    // My Stats
    if (statsYouEl) {
      if (myTeam) {
        const log = state.teams[myTeam].shotsLog || [];
        const mine = log.filter(s => s.by === clientId);
        const mineShots = mine.length; const mineHits = mine.filter(s => s.hit).length;
        const myRemaining = state.teams[myTeam].memesRemaining ?? 0;
        statsYouEl.innerHTML = renderStatsList({ shots: mineShots, hits: mineHits, accuracy: (mineShots ? Math.round((mineHits / mineShots) * 100) : 0) + '%', remaining: myRemaining, remainingLabel: 'My memes left' });
      } else {
        statsYouEl.innerHTML = '<li>Spectating — join a team to track your stats.</li>';
      }
    }
    // Enemy Stats
    if (statsEnemyEl) {
      if (myTeam) {
        const enemy = myTeam === 'A' ? 'B' : 'A';
        const t = state.teams[enemy];
        const accuracy = (t.shots ? Math.round((t.hits / t.shots) * 100) : 0) + '%';
        const theirEnemyRemaining = state.teams[myTeam].memesRemaining ?? 0;
        statsEnemyEl.innerHTML = renderStatsList({ shots: t.shots, hits: t.hits, accuracy, remaining: theirEnemyRemaining });
      } else {
        const accA = (a.shots ? Math.round((a.hits / a.shots) * 100) : 0) + '%';
        const accB = (b.shots ? Math.round((b.hits / b.shots) * 100) : 0) + '%';
        const listA = renderStatsList({ shots: a.shots, hits: a.hits, accuracy: accA, remaining: b.memesRemaining ?? 0 });
        const listB = renderStatsList({ shots: b.shots, hits: b.hits, accuracy: accB, remaining: a.memesRemaining ?? 0 });
        statsEnemyEl.innerHTML = `<li><strong>Team A</strong></li>${listA}${`<li style="margin-top:6px;"></li>`}${`<li><strong>Team B</strong></li>`}${listB}`;
      }
    }
  }

  function renderStatsList(info) {
    const parts = [];
    if (info.team) parts.push(`<li>Team: <strong>${info.team}</strong></li>`);
    if (typeof info.players !== 'undefined') parts.push(`<li>Players: ${info.players}</li>`);
    if (typeof info.shots !== 'undefined') parts.push(`<li>Shots: ${info.shots}</li>`);
    if (typeof info.hits !== 'undefined') parts.push(`<li>Hits: ${info.hits}</li>`);
    if (typeof info.accuracy !== 'undefined') parts.push(`<li>Accuracy: ${info.accuracy}</li>`);
    if (typeof info.remaining !== 'undefined') parts.push(`<li>${info.remainingLabel || 'Enemy memes left'}: ${info.remaining}</li>`);
    return parts.join('');
  }

  // Meme utilities
  function memeAt(memes, r, c) {
    if (!Array.isArray(memes)) return null;
    for (const m of memes) {
      for (const p of m.coords) { if (p.r === r && p.c === c) return m; }
    }
    return null;
  }
  function isMemeSunk(meme, hits) {
    if (!meme) return false; const H = hits || {};
    return meme.coords.every(p => H[rcKey(p.r, p.c)]);
  }
  function allMemesSunk(memes, hits) {
    if (!Array.isArray(memes)) return false;
    return memes.every(m => isMemeSunk(m, hits));
  }
  function paintMemeTiles(root, meme) {
    if (!meme) return;
    const r0 = meme.coords[0].r; const c0 = meme.coords[0].c;
    for (const p of meme.coords) {
      const cell = root.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
      if (!cell) continue;
      cell.style.backgroundImage = `url(${cssUrl(meme.url)})`;
      const dx = p.c - c0; const dy = p.r - r0;
      cell.style.backgroundPosition = `calc(-1 * var(--cell) * ${dx}) calc(-1 * var(--cell) * ${dy})`;
    }
  }
  function cssUrl(s) {
    // Allow either relative filename or full URL
    if (!s) return '';
    if (/^https?:/i.test(s)) return s;
    return `${window.location.origin}${window.location.pathname.includes('/meme-wars') ? '' : ''}/static/${encodeURIComponent(s)}`;
  }

  function placeRandomMemes(images) {
    const pool = (Array.isArray(images) ? images.slice() : []).filter(Boolean);
    // Fallback if not enough images
    while (pool.length < 4) pool.push('smile.png');
    shuffle(pool);
    const picks = pool.slice(0, 4);
    const memes = [];
    const grid = Array.from({ length: 10 }, () => Array(10).fill(0));

    function canPlace(r, c) { return r >= 0 && r+1 < 10 && c >= 0 && c+1 < 10 && !grid[r][c] && !grid[r+1][c] && !grid[r][c+1] && !grid[r+1][c+1]; }
    function doPlace(img) {
      for (let tries = 0; tries < 500; tries++) {
        const r = Math.floor(Math.random() * 9); // 0..8
        const c = Math.floor(Math.random() * 9); // 0..8
        if (!canPlace(r, c)) continue;
        grid[r][c] = grid[r+1][c] = grid[r][c+1] = grid[r+1][c+1] = 1;
        const coords = [ {r, c}, {r: r+1, c}, {r, c: c+1}, {r: r+1, c: c+1} ];
        memes.push({ id: `m${memes.length+1}`, url: img, coords });
        return true;
      }
      return false;
    }

    for (const img of picks) { if (!doPlace(img)) return placeRandomMemes(images); }
    return memes;
  }

  function shuffle(arr){ for (let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

  function fireMsg(text) { if (fireMsgEl) fireMsgEl.textContent = text || ''; }

  function pulse(el, cls, content) {
    try {
      if (!el) return; el.classList.add('ping');
      if (content) el.innerHTML = `<span class="ping">${content}</span>`;
      setTimeout(() => { try { el.classList.remove('ping'); } catch(_){} }, 300);
    } catch(_) {}
  }

  // Show 1s popup with the captured meme image
  function showCaptureOverlay(url) {
    if (!captureOverlay || !captureMemeImg) return;
    try {
      captureMemeImg.src = cssUrl(url);
      captureOverlay.classList.add('show');
      try { clearTimeout(captureHideTimer); } catch(_){ }
      captureHideTimer = setTimeout(() => {
        try { captureOverlay.classList.remove('show'); } catch(_){ }
      }, 1000);
    } catch(_){ }
  }
})();
