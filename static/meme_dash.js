(() => {
  // Basic helpers
  const qs = (sel, root = document) => root.querySelector(sel);
  const presenceEl = qs('#presence');
  const roomPinEl = qs('#roomPin');
  const shareBtn = qs('#shareSessionBtn');
  const joinBtn = qs('#joinSessionBtn');
  const scoreboardEl = qs('#scoreboard');
  const powerupPill = qs('#powerupPill');
  const powerupCountdownEl = qs('#powerupCountdown');
  const bigFlash = qs('#bigFlash');
  // Celebration overlay elements
  const celebrateOverlay = qs('#celebrateOverlay');
  const celebrateTitleEl = qs('#celebrateTitle');
  const celebrateSubtitleEl = qs('#celebrateSubtitle');
  const celebrateCloseBtn = qs('#celebrateCloseBtn');
  const fxConfetti = qs('#fxConfetti');
  const fxEmojis = qs('#fxEmojis');
  const fxBalloons = qs('#fxBalloons');

  const canvas = qs('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const gameWrap = qs('.game-wrap');
  const terminatorToggle = qs('#terminatorToggle');
  const terminatorCtrl = qs('#terminatorCtrl');

  const getParam = (name) => new URLSearchParams(window.location.search).get(name);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();

  // Session & socket
  // Stable player id across refreshes (per room PIN)
  let clientId = null;
  const mode = 'memedash';
  let socket = null;
  let room = null;
  let presentCount = 1;
  // TERMINATOR bot tracking
  let botBrain = { lastX: 0, stuckTime: 0, upCooldown: 0 };

  // Images library (from template)
  let ALL_IMAGES = (window.AVAILABLE_MEME_IMAGES || []).filter(x => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(x));
  if (!ALL_IMAGES.length) {
    ALL_IMAGES = ['doge.png','grinch.png','smile.png','skibidi.png','labubu.png'].filter(Boolean);
  }
  const MEME_SET = ALL_IMAGES.slice(0, 5); // pick first 5 to define types in this session
  const imageCache = new Map();

  // Fixed level platforms (x,y,w,h) in canvas pixels
  const W = canvas.width;
  const H = canvas.height;
  const FLOOR_Y = H - 40;
  const platforms = [
    { x: 40,  y: FLOOR_Y - 80, w: 180, h: 16 },
    { x: 360, y: FLOOR_Y - 140, w: 180, h: 16 },
    { x: 680, y: FLOOR_Y - 210, w: 180, h: 16 },
    { x: 920, y: FLOOR_Y - 100, w: 140, h: 16 },
    { x: 240, y: FLOOR_Y - 260, w: 140, h: 16 },
    { x: 540, y: FLOOR_Y - 320, w: 200, h: 16 },
  ];

  // Game parameters
  const GRAVITY = 2000; // px/s^2
  const BASE_SPEED = 260; // px/s
  const JUMP_VELOCITY = 700; // px/s
  const AIR_DRAG = 0.85;
  const MEME_SPAWN_MS = 1700;
  const MAX_MEMES = 9;
  const POWER_MS = 12000;

  // Magnet power-up settings
  const MAGNET_SPAWN_MS = 30000; // spawn every 30s
  const MAGNET_DURATION_MS = 5000; // 5 seconds effect
  const MAGNET_RANGE = Math.hypot(canvas.width, canvas.height) * 0.05 * 1.33; // +33% radius (~6.65% of screen diagonal)
  const MAGNET_PULL_SPEED = 520; // px/s pull speed toward player

  // Double Jump power-up settings
  const DOUBLEJUMP_SPAWN_MS = 30000; // spawn every 30s (like magnet)
  const DOUBLEJUMP_DURATION_MS = 5000; // 5 seconds effect

  // State kept in rooms_state[room]['memedash']
  // We elect a host (ownerId = first creator). Host spawns memes, resolves collisions.
  let state = null; // { ownerId, players: {id: {...}}, memes: [...], lastSpawnAt }
  // Timestamp (performance.now) of last remote authoritative state received; drives owner failover
  let lastRemoteStateAt = 0;

  const my = {
    input: { left: false, right: false, up: false },
  };

  // Remote input state for other players (filled from network)
  const remoteInputs = {};
  const EMPTY_INPUT = { left: false, right: false, up: false };

  function sanitizeInput(x){
    return { left: !!(x && x.left), right: !!(x && x.right), up: !!(x && x.up) };
  }

  // Player prototype
  function defaultPlayer(id) {
    return {
      id,
      name: makeName(),
      x: Math.random() * (W - 80) + 40,
      y: -120, // spawn from sky
      vx: 0,
      vy: 0,
      w: 20,
      h: 40,
      color: randColor(),
      joinedAt: Date.now(),
      grounded: false,
      counts: Object.fromEntries(MEME_SET.map(m => [m, 0])), // per type collected
      total: 0, // total memes collected
      powerType: null,
      powerEndsAt: 0,
      magnetEndsAt: 0,
      // Double jump power-up state
      doubleJumpEndsAt: 0,
      usedSecondJump: false,
      prevUp: false,
      flashUntil: 0,
    };
  }

  function defaultState() {
    return {
      ownerId: clientId,
      createdAt: Date.now(),
      players: {},
      memes: [],
      lastSpawnAt: 0,
      // Magnet power-up state
      powerups: [], // {id, kind:'magnet'|'doublejump', x, y}
      lastPowerSpawnAt: 0,
      lastDoubleSpawnAt: 0,
      seed: (Math.random() * 1e9) | 0,
      // TERMINATOR bot support
      terminatorMode: false,
      botId: null,
    };
  }

  // Init
  (async function init(){
    const pin = await ensurePin(mode);
    room = pin || (window.location.pathname + ':' + mode);
    window.currentSessionPin = pin;
    if (roomPinEl) roomPinEl.textContent = 'PIN: ' + (pin || '—');

    // Establish a stable player id per room so refresh reconnects to same avatar
    clientId = getStablePlayerId(pin);

    setupShareJoinUi();
    setupTerminatorUi();
    updateTerminatorUi();

    if (typeof io !== 'undefined') {
      socket = io();
      wireSocket();
    } else {
      setPresence(0, false);
    }

    // Load images
    MEME_SET.forEach(loadImage);

    // Start render loop
    lastTs = now();
    requestAnimationFrame(tick);
  })();

  function makeName(){
    const a = ['Speedy','Zippy','Wobbly','Chunky','Glowy','Bouncy','Shiny'];
    const b = ['Stick','Runner','Dash','Zoom','Blink','Boing'];
    return a[Math.random()*a.length|0] + ' ' + b[Math.random()*b.length|0];
  }
  function randColor(){
    const h = Math.random()*360|0;
    return `hsl(${h} 75% 45%)`;
  }

  function loadImage(file){
    if (imageCache.has(file)) return imageCache.get(file);
    const img = new Image();
    img.src = `/static/${file}`;
    imageCache.set(file, img);
    return img;
  }

  function getStablePlayerId(pin) {
    try {
      const key = `memedash:player:${pin || 'no-pin'}`;
      let id = localStorage.getItem(key);
      if (!id || typeof id !== 'string' || id.length < 6) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        localStorage.setItem(key, id);
      }
      return id;
    } catch (_) {
      // Fallback if localStorage unavailable
      return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    }
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
      try { if (copied) { const pinText = document.getElementById('qrPinText'); if (pinText) pinText.textContent = 'PIN: ' + thePin + ' (copied)'; } } catch(_){ }
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

  // TERMINATOR UI logic
  function setTerminatorOutline(on){ try { if (gameWrap) { gameWrap.classList.toggle('terminator-on', !!on); } if (terminatorToggle) terminatorToggle.checked = !!on; } catch(_){} }
  function updateTerminatorUi(){
    const active = !!(state && state.terminatorMode);
    // Hide control if 2+ humans present and not active; keep visible during active mode
    if (terminatorCtrl) {
      const shouldHide = !active && (presentCount >= 2);
      terminatorCtrl.hidden = !!shouldHide;
    }
    setTerminatorOutline(active);
  }
  function setupTerminatorUi(){
    if (!terminatorToggle) return;
    terminatorToggle.addEventListener('change', () => {
      const want = !!terminatorToggle.checked;
      if (!state) { if (want) { state = defaultState(); addMeIfMissing(); } }
      const amOwner = state && state.ownerId === clientId;
      if (!amOwner) {
        // attempt to take ownership if stale
        if (now() - lastRemoteStateAt <= 2000) { terminatorToggle.checked = !!(state && state.terminatorMode); return; }
        if (state) state.ownerId = clientId;
      }
      if (want) {
        // Enable mode
        state.terminatorMode = true;
        ensureBotPlayer();
        broadcast();
      } else {
        // Disable mode
        state.terminatorMode = false;
        removeBotPlayer();
        broadcast();
      }
      updateTerminatorUi();
    });
  }

  function setPresence(count, online) {
    if (!presenceEl) return;
    if (!online) { presenceEl.textContent = '• Offline'; return; }
    const n = Number(count) || 1;
    presenceEl.textContent = `• ${n} online`;
  }

  function wireSocket(){
    socket.on('connect', () => {
      setPresence(1, true);
      socket.emit('join', { room, mode });
      socket.emit('request_state', { room, mode });
      setTimeout(() => { if (!state) { state = defaultState(); addMeIfMissing(); broadcast(); } }, 250);
    });
    socket.on('disconnect', () => setPresence(0, false));
    socket.on('presence', (p) => { if (p && p.room === room) { presentCount = Number(p.count) || 1; setPresence(p.count, true); updateTerminatorUi(); } });
    socket.on('state', (msg) => { if (msg && msg.room === room && msg.mode === mode) { applyRemoteState(msg.state); lastRemoteStateAt = now(); } });
    socket.on('state_update', (msg) => { if (msg && msg.room === room && msg.mode === mode) { applyRemoteState(msg.state); lastRemoteStateAt = now(); } });
    socket.on('input_update', (msg) => {
      if (msg && msg.room === room && msg.mode === mode && msg.clientId && msg.clientId !== clientId) {
        remoteInputs[msg.clientId] = sanitizeInput(msg.input);
      }
    });

    // Join denied (e.g., TERMINATOR mode active)
    socket.on('join_denied', (msg) => {
      try {
        if (!msg || msg.room !== room) return;
        alert('Unable to join: Terminator mode is active in this session. Create a new session or wait until it is disabled.');
        // Optionally prompt to create a new session
      } catch(_){ }
    });

    // Game result broadcast: show winner/loser overlays for all clients
    socket.on('memedash_win', (msg) => {
      try {
        if (!msg || msg.room !== room || msg.mode !== mode) return;
        const winnerId = msg.winnerId;
        const winnerName = msg.winnerName || 'Player';
        const isYou = (winnerId === clientId);
        const outcome = isYou ? 'win' : 'lose';
        showCelebration(outcome, { winnerName, isYou, score: msg.score });
        // Record result (best-effort)
        const payload = { mode: 'memedash', game_name: 'Meme Dash', outcome: outcome, score: (msg.score || 0), room_pin: window.currentSessionPin };
        window.recordResult?.(payload);
      } catch(_) { }
    });
  }

  function addMeIfMissing(){
    if (!state.players[clientId]) state.players[clientId] = defaultPlayer(clientId);
  }

  function applyRemoteState(remote){
    if (!remote) return;
    const wasOwner = state && state.ownerId === clientId;
    const prev = state;
    const hadMe = !!(remote.players && remote.players[clientId]);

    // Base apply
    state = remote;

    // Ensure our player exists (in case owner created state without us yet)
    addMeIfMissing();

    // If we're not the owner, preserve our locally simulated kinematics to avoid rubberbanding,
    // but accept authoritative remote positions if they differ too much (e.g., teleports after power hits).
    if (prev && state.ownerId !== clientId) {
      const localMe = prev.players && prev.players[clientId];
      if (localMe) {
        const remoteMe = state.players && state.players[clientId];
        const hasRemote = !!remoteMe;
        const dist = hasRemote ? Math.hypot((remoteMe.x || 0) - (localMe.x || 0), (remoteMe.y || 0) - (localMe.y || 0)) : 0;
        const bigDelta = hasRemote && dist > 80; // threshold before snapping to owner
        const incomingMe = state.players[clientId] || (state.players[clientId] = {});
        if (bigDelta) {
          // Adopt authoritative owner position/velocity; keep cosmetics
          incomingMe.color = incomingMe.color || localMe.color;
          incomingMe.name = incomingMe.name || localMe.name;
          incomingMe.id = incomingMe.id || localMe.id || clientId;
          // Do not overwrite x/y/vx/vy with local; accept remote values already in incomingMe
        } else {
          // Preserve local smooth movement
          incomingMe.x = localMe.x;
          incomingMe.y = localMe.y;
          incomingMe.vx = localMe.vx;
          incomingMe.vy = localMe.vy;
          incomingMe.grounded = localMe.grounded;
          // Preserve cosmetic/local-only fields too
          incomingMe.color = incomingMe.color || localMe.color;
          incomingMe.name = incomingMe.name || localMe.name;
          incomingMe.id = incomingMe.id || localMe.id || clientId;
        }
      }
    }

    // If we were missing from remote, broadcast once so everyone learns about us
    if (!hadMe) {
      broadcast();
    }

    // If owner switched away from us, stop authoritative actions (no-op for now)
    const amOwnerAfter = state.ownerId === clientId;
    if (wasOwner && !amOwnerAfter) {
      // nothing specific for now
    }
    // Sync UI elements to new state (outline/toggle)
    updateTerminatorUi();
  }

  function broadcast(){
    try { socket?.emit('state_update', { room, mode, clientId, state }); } catch(_){ }
  }

  // Input
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA'].includes(e.target?.tagName)) return;
    keys.add(e.key);
    updateInput();
    sendInputUpdate();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.key);
    updateInput();
    sendInputUpdate();
  });

  function updateInput(){
    my.input.left = keys.has('a') || keys.has('A') || keys.has('ArrowLeft');
    my.input.right = keys.has('d') || keys.has('D') || keys.has('ArrowRight');
    my.input.up = keys.has('w') || keys.has('W') || keys.has('ArrowUp') || keys.has(' ');
  }

  let lastInputSent = { left: false, right: false, up: false };
  function sendInputUpdate(){
    if (!socket || !room) return;
    const cur = { left: !!my.input.left, right: !!my.input.right, up: !!my.input.up };
    if (cur.left !== lastInputSent.left || cur.right !== lastInputSent.right || cur.up !== lastInputSent.up) {
      lastInputSent = { ...cur };
      try { socket.emit('input_update', { room, mode, clientId, input: cur }); } catch(_){ }
    }
  }

  // Game loop
  let lastTs = 0;
  function tick(ts){
    const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
    lastTs = ts;

    updateInput();

    // Owner runs simulation & spawning, then broadcasts
    if (state) {
      // Owner failover: if remote owner appears inactive for >2s, promote self
      if (state.ownerId !== clientId && (now() - lastRemoteStateAt) > 2000) {
        state.ownerId = clientId;
        addMeIfMissing();
        lastRemoteStateAt = now();
      }
      const amOwner = state.ownerId === clientId;
      if (amOwner) {
        spawnLoop(ts);
        if (state.terminatorMode) { driveBotAI(dt); }
        simulate(dt);
        broadcast();
      } else {
        simulateLocal(dt); // move our player locally for responsiveness
      }
    }

    render();
    requestAnimationFrame(tick);
  }

  function spawnLoop(ts){
    // Spawn memes regularly
    if (state.memes.length < MAX_MEMES && (ts - state.lastSpawnAt) > MEME_SPAWN_MS) {
      const type = MEME_SET[Math.random()*MEME_SET.length|0];
      let tries = 30;
      while (tries-- > 0) {
        const x = 40 + Math.random() * (W - 80);
        const y = 60 + Math.random() * (H - 180);
        if (isPositionWalkable(x, y)) {
          state.memes.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, type, x, y });
          state.lastSpawnAt = ts;
          break;
        }
      }
    }

    // Spawn a magnet power-up roughly every 30 seconds, only one at a time
    const hasMagnet = (state.powerups || []).some(p => p.kind === 'magnet');
    if (!hasMagnet && (ts - (state.lastPowerSpawnAt || 0)) > MAGNET_SPAWN_MS) {
      let tries = 40;
      while (tries-- > 0) {
        const x = 40 + Math.random() * (W - 80);
        const y = 60 + Math.random() * (H - 200);
        if (isPositionWalkable(x, y)) {
          state.powerups = state.powerups || [];
          state.powerups.push({ id: `mag_${Date.now()}_${Math.random().toString(36).slice(2)}`, kind: 'magnet', x, y });
          state.lastPowerSpawnAt = ts;
          break;
        }
      }
    }

    // Spawn a double-jump power-up roughly every 30 seconds, only one at a time
    const hasDJ = (state.powerups || []).some(p => p.kind === 'doublejump');
    if (!hasDJ && (ts - (state.lastDoubleSpawnAt || 0)) > DOUBLEJUMP_SPAWN_MS) {
      let triesDj = 40;
      while (triesDj-- > 0) {
        const x = 40 + Math.random() * (W - 80);
        const y = 60 + Math.random() * (H - 200);
        if (isPositionWalkable(x, y)) {
          state.powerups = state.powerups || [];
          state.powerups.push({ id: `dj_${Date.now()}_${Math.random().toString(36).slice(2)}`, kind: 'doublejump', x, y });
          state.lastDoubleSpawnAt = ts;
          break;
        }
      }
    }
  }

  function isPositionWalkable(x, y){
    // avoid inside platforms
    for (const p of platforms) {
      if (x >= p.x && x <= p.x + p.w && y >= p.y - 30 && y <= p.y + p.h + 30) return false;
    }
    // otherwise ok
    return true;
  }

  function getProgressFraction(player){
    // fraction of meme types completed to 5
    const kinds = MEME_SET.length || 1;
    let doneKinds = 0;
    for (const t of MEME_SET) if ((player.counts[t] || 0) >= 5) doneKinds++;
    return doneKinds / kinds;
  }

  function moveAndCollide(p, dt, applySlow=true){
    const progress = getProgressFraction(p);
    const speedScale = 1 - 0.6 * progress; // slower near win; never below 0.4
    const s = applySlow ? clamp(speedScale, 0.4, 1) : 1;

    const inp = (p.id === clientId) ? my.input : (remoteInputs[p.id] || EMPTY_INPUT);
    const accelX = (inp.left ? -1 : 0) + (inp.right ? 1 : 0);
    const targetVx = accelX * BASE_SPEED * s;
    const ax = (targetVx - p.vx) * 10 * dt; // simple PD toward target
    p.vx += ax;

    // Jump: reverse-scale jump strength as speed decreases (slower => higher jumps)
    // Keep gravity constant so higher jump velocity yields a higher apex.
    const jumpScale = clamp(1 + (1 - s), 1, 1.8); // at min speed (s=0.4) -> 1.6x; cap at 1.8x
    const gravity = GRAVITY;
    const upEdge = !!inp.up && !p.prevUp;
    const djActive = (p.doubleJumpEndsAt || 0) > Date.now();

    if (inp.up && p.grounded) {
      p.vy = -JUMP_VELOCITY * jumpScale;
      p.grounded = false;
      p.usedSecondJump = false; // allow a second jump later in this airtime
    } else if (upEdge && !p.grounded && djActive && !p.usedSecondJump) {
      // mid-air double jump
      p.vy = -JUMP_VELOCITY * jumpScale;
      p.usedSecondJump = true;
    }
    p.vy += gravity * dt;

    // Integrate
    let nx = p.x + p.vx * dt;
    let ny = p.y + p.vy * dt;

    // Collide with floor
    if (ny + p.h > FLOOR_Y) {
      ny = FLOOR_Y - p.h;
      p.vy = 0;
      p.grounded = true;
    } else {
      p.grounded = false;
    }

    // Collide with platforms (axis-aligned)
    for (const plat of platforms) {
      // Vertical landing
      const wasAbove = (p.y + p.h) <= plat.y;
      const willOver = (ny + p.h) >= plat.y;
      const withinX = (nx + p.w) > plat.x && nx < plat.x + plat.w;
      if (wasAbove && willOver && withinX && p.vy >= 0) {
        ny = plat.y - p.h;
        p.vy = 0;
        p.grounded = true;
      }
    }

    // Clamp to screen
    nx = clamp(nx, 0, W - p.w);
    ny = clamp(ny, -400, FLOOR_Y - p.h);

    p.x = nx; p.y = ny;

    // Reset double-jump availability when grounded
    if (p.grounded) p.usedSecondJump = false;

    // Track edge of Up for next frame
    p.prevUp = !!inp.up;
  }

  function simulate(dt){
    // Ensure my player exists
    addMeIfMissing();

    // Move all players
    for (const id of Object.keys(state.players)) moveAndCollide(state.players[id], dt);

    // Resolve collections and power effects
    resolveCollisionsAndPower(dt);
  }

  // --- TERMINATOR bot helpers ---
  function ensureBotPlayer(){
    if (!state) return;
    if (!state.botId) state.botId = `BOT_${Math.random().toString(36).slice(2,8)}`;
    const id = state.botId;
    if (!state.players[id]) {
      const p = defaultPlayer(id);
      p.name = 'TERMINATOR';
      p.color = '#b00020';
      state.players[id] = p;
    }
  }
  function removeBotPlayer(){
    if (!state || !state.botId) return;
    try { delete remoteInputs[state.botId]; } catch(_){ }
    try { delete state.players[state.botId]; } catch(_){ }
  }
  function driveBotAI(dt){
    if (!state || !state.terminatorMode) return;
    ensureBotPlayer();
    const id = state.botId;
    const bot = state.players[id];
    if (!bot) return;

    // --- Helpers for reachability and waypoints ---
    const progress = getProgressFraction(bot);
    const speedScale = clamp(1 - 0.6 * progress, 0.4, 1);
    const jumpScale = clamp(1 + (1 - speedScale), 1, 1.8);
    const vy0 = JUMP_VELOCITY * jumpScale;
    const maxJump = (vy0 * vy0) / (2 * GRAVITY);
    const tUp = vy0 / GRAVITY; // time to apex
    const maxAirTime = tUp * 2; // symmetric approximately
    const maxAirHoriz = BASE_SPEED * speedScale * maxAirTime * 0.9; // conservative

    function findNearestMeme(){
      let t = null; let bestD = Infinity;
      for (const m of state.memes || []){
        const dx = (m.x) - (bot.x + bot.w/2);
        const dy = (m.y) - (bot.y + bot.h/2);
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; t = m; }
      }
      return t;
    }

    function targetReachableFromHere(m){
      if (!m) return true;
      const cx = bot.x + bot.w/2;
      const dx = Math.abs(m.x - cx);
      // positive if target is above bot center
      const verticalGap = (bot.y + bot.h/2) - m.y;
      // require both vertical and horizontal reach within a single jump
      if (verticalGap <= maxJump + 8 && dx <= maxAirHoriz + 24) return true;
      return false;
    }

    function pickWaypoint(target){
      // Choose highest reachable platform toward target within one jump
      let best = null; let bestScore = Infinity;
      for (const p of platforms){
        // platform must be above bot and within max jump height
        if (p.y < bot.y - 6 && (bot.y - p.y) <= (maxJump + 10)){
          const cx = p.x + p.w/2;
          const tx = (target ? target.x : W/2);
          const dx = Math.abs(tx - cx);
          const heightGain = (bot.y - p.y); // bigger is better (higher platform)
          const score = dx - heightGain * 0.35; // slightly favor higher platforms
          if (score < bestScore){ bestScore = score; best = { x: clamp(cx, p.x + 18, p.x + p.w - 18), y: p.y }; }
        }
      }
      return best;
    }

    function platformFor(y, x){
      for (const p of platforms){
        if (Math.abs(p.y - y) < 2 && x >= p.x && x <= p.x + p.w) return p;
      }
      return null;
    }

    function currentSupport(centerX){
      if (bot.grounded){
        const p = platformFor(bot.y + bot.h, centerX);
        if (p) return p;
        // floor as a synthetic platform
        if (Math.abs((bot.y + bot.h) - FLOOR_Y) < 4) return { x: 0, y: FLOOR_Y, w: W, h: 0, floor: true };
      }
      return null;
    }

    function greedyPathToward(target, maxSteps){
      const steps = Math.max(1, maxSteps|0);
      const path = [];
      const tx = target ? target.x : (W/2);
      const ty = target ? target.y : 0;
      let cur = currentSupport(bot.x + bot.w/2);
      let curY = cur ? cur.y : (bot.grounded ? (bot.y + bot.h) : (bot.y + bot.h));
      let curX = bot.x + bot.w/2;
      for (let i=0; i<steps; i++){
        // candidates above current within jump reach and roughly toward target
        let best = null; let bestScore = Infinity;
        for (const p of platforms){
          if (p.y < curY - 6 && (curY - p.y) <= (maxJump + 10)){
            const landX = clamp(tx, p.x + 18, p.x + p.w - 18);
            const startX = cur ? clamp(curX, cur.x + 18, cur.x + cur.w - 18) : curX;
            const horiz = Math.abs(landX - startX);
            if (horiz <= maxAirHoriz + 24){
              const towardX = Math.abs((p.x + p.w/2) - tx);
              const heightGain = curY - p.y;
              const score = towardX - heightGain * 0.4;
              if (score < bestScore){
                bestScore = score;
                best = { x: landX, y: p.y };
              }
            }
          }
        }
        if (!best) break;
        path.push(best);
        curX = best.x;
        curY = best.y;
        if (curY <= ty + 10) break; // reached near target height
      }
      return path;
    }

    function bfsPathToward(target, maxSteps){
      const steps = Math.max(1, maxSteps|0);
      const margin = 18;
      // Build nodes: floor + platforms with safe landing zones
      const nodes = [];
      const floorNode = { idx: 0, x: 0, y: FLOOR_Y, w: W, h: 0, safeL: 0 + margin, safeR: W - margin, floor: true };
      nodes.push(floorNode);
      for (let i = 0; i < platforms.length; i++){
        const p = platforms[i];
        nodes.push({ idx: i + 1, x: p.x, y: p.y, w: p.w, h: p.h, safeL: p.x + margin, safeR: p.x + p.w - margin });
      }
      function canAscend(a, b){
        // must go to a strictly higher platform (smaller y)
        if (b.y >= a.y - 6) return false;
        const vUp = a.y - b.y;
        if (vUp > (maxJump + 10)) return false;
        // horizontal feasibility: intervals within maxAirHoriz
        const gap = (b.safeL > a.safeR) ? (b.safeL - a.safeR) : (a.safeL > b.safeR ? (a.safeL - b.safeR) : 0);
        return gap <= (maxAirHoriz + 24);
      }
      const adj = nodes.map(() => []);
      for (let i = 0; i < nodes.length; i++){
        for (let j = 0; j < nodes.length; j++){
          if (i === j) continue;
          if (canAscend(nodes[i], nodes[j])) adj[i].push(j);
        }
      }
      // Start from current support (or floor)
      const cSup = currentSupport(bot.x + bot.w/2);
      let startIdx = 0;
      if (cSup && !cSup.floor){
        const k = platforms.findIndex(p => p.x === cSup.x && p.y === cSup.y && p.w === cSup.w);
        startIdx = (k >= 0) ? (k + 1) : 0;
      }
      // Goal: platform directly under target.x (just below target.y), else floor
      let goalIdx = 0;
      if (target){
        let bestY = Infinity; let bestK = -1;
        for (let i = 0; i < platforms.length; i++){
          const p = platforms[i];
          if (target.x >= p.x && target.x <= p.x + p.w && p.y > target.y && p.y < bestY){
            bestY = p.y; bestK = i;
          }
        }
        goalIdx = (bestK >= 0) ? (bestK + 1) : 0;
      }
      // BFS (limit by steps)
      const q = [startIdx];
      const prev = new Array(nodes.length).fill(-1);
      const depth = new Array(nodes.length).fill(0);
      const seen = new Array(nodes.length).fill(false);
      seen[startIdx] = true;
      let found = false;
      while (q.length){
        const u = q.shift();
        if (u === goalIdx){ found = true; break; }
        if (depth[u] >= steps) continue;
        for (const v of adj[u]){
          if (!seen[v]){ seen[v] = true; prev[v] = u; depth[v] = depth[u] + 1; q.push(v); }
        }
      }
      let end = found ? goalIdx : startIdx;
      if (!found){
        // fallback: highest seen node still below target height
        let best = startIdx;
        for (let i = 0; i < nodes.length; i++){
          if (seen[i] && (!target || (nodes[i].y > target.y)) && nodes[i].y < nodes[best].y) best = i;
        }
        end = best;
      }
      const seq = [];
      while (end !== -1 && end !== startIdx){ seq.push(end); end = prev[end]; }
      seq.reverse();
      const result = [];
      for (let i = 0; i < seq.length; i++){
        const idx = seq[i];
        const n = nodes[idx];
        let refX;
        if (i < seq.length - 1){
          const nextN = nodes[seq[i+1]];
          refX = nextN.x + nextN.w/2; // align under the next platform for an easier subsequent jump
        } else {
          refX = target ? target.x : (n.x + n.w/2);
        }
        const landX = clamp(refX, n.safeL, n.safeR);
        result.push({ x: landX, y: n.y });
      }
      return result;
    }

    // Current target (with short lock to avoid oscillation) and potential waypoint/path
    const nowT = now();
    function nearestMemeWithDist(){
      let m = null, d = Infinity;
      for (const mm of (state.memes || [])){
        const dx = (mm.x) - (bot.x + bot.w/2);
        const dy = (mm.y) - (bot.y + bot.h/2);
        const dd = Math.hypot(dx, dy);
        if (dd < d){ d = dd; m = mm; }
      }
      return { m, d };
    }
    let target = null;
    const near = nearestMemeWithDist();
    if (botBrain.lockTargetId){
      const locked = (state.memes || []).find(m => m.id === botBrain.lockTargetId) || null;
      if (locked){
        const dxL = (locked.x) - (bot.x + bot.w/2);
        const dyL = (locked.y) - (bot.y + bot.h/2);
        const dL = Math.hypot(dxL, dyL);
        if (nowT <= (botBrain.lockUntil || 0)){
          target = locked;
        } else {
          if (near.m && (dL === Infinity || near.d < dL * 0.7)){
            target = near.m;
            botBrain.lockTargetId = target.id;
            botBrain.lockUntil = nowT + 1400;
          } else {
            target = locked;
            botBrain.lockUntil = nowT + 600;
          }
        }
      } else {
        if (near.m){
          target = near.m;
          botBrain.lockTargetId = target.id;
          botBrain.lockUntil = nowT + 1400;
        }
      }
    } else {
      if (near.m){
        target = near.m;
        botBrain.lockTargetId = target.id;
        botBrain.lockUntil = nowT + 1400;
      }
    }
    let goalX = null; let goalY = null;

    // Anti-under-meme lock: if target is not reachable and we're nearly under it for too long, force sidestep
    if (target){
      const cx = bot.x + bot.w/2;
      const dx = Math.abs(target.x - cx);
      const verticalGap = (bot.y + bot.h/2) - target.y;
      if (verticalGap > maxJump + 8 && dx < 60){
        botBrain.underLock = (botBrain.underLock || 0) + dt;
        if (botBrain.underLock > 0.6){
          const dir = (Math.random() < 0.5) ? -1 : 1;
          botBrain.goalX = clamp(cx + dir * 240, 20, W - 20);
          botBrain.goalY = null;
          botBrain.goalUntil = nowT + 1100;
          botBrain.noJumpUntil = nowT + 750; // walk sideways before considering jumps to avoid bounce loops
          botBrain.underLock = 0;
        }
      } else {
        botBrain.underLock = Math.max(0, (botBrain.underLock || 0) - dt*0.5);
      }
    }

    // Descend when target is below: walk to the nearest edge toward the target and drop
    if (target && (target.y > (bot.y + bot.h/2) + 8)){
      const s = currentSupport(bot.x + bot.w/2);
      if (s && Math.abs((bot.y + bot.h) - s.y) < 2){
        const toRight = target.x >= (s.x + s.w/2);
        const dropX = toRight ? (s.x + s.w + 6) : (s.x - 6);
        botBrain.goalX = clamp(dropX, 4, W - 4);
        botBrain.goalY = null;
        botBrain.goalUntil = nowT + 1600;
        botBrain.noJumpUntil = Math.max((botBrain.noJumpUntil || 0), nowT + 600);
        goalX = botBrain.goalX; goalY = botBrain.goalY;
      }
    }

    if (target && !targetReachableFromHere(target)){
      // Maintain a short multi-step ascent path toward the target
      if (!botBrain.path || !botBrain.path.length || (botBrain.pathUntil || 0) < nowT){
        const path = bfsPathToward(target, 5);
        if (path && path.length){
          botBrain.path = path.slice(0, 3);
          botBrain.pathUntil = nowT + 4000;
          // lock on target while following path
          botBrain.lockTargetId = target.id;
          botBrain.lockUntil = nowT + 1400;
        } else {
          botBrain.path = null;
        }
      }
      if (botBrain.path && botBrain.path.length){
        const next = botBrain.path[0];
        botBrain.goalX = next.x;
        botBrain.goalY = next.y;
        botBrain.goalUntil = nowT + 2800;
        // Compute takeoff edge on current support toward destination platform
        const cX = bot.x + bot.w/2;
        const src = currentSupport(cX);
        const dest = platformFor(botBrain.goalY, botBrain.goalX);
        if (src && dest){
          const toRight = ((dest.x + dest.w/2) > (src.x + src.w/2));
          const m = 18;
          const sL = src.x + m, sR = src.x + src.w - m;
          const landX = botBrain.goalX;
          botBrain.takeoffX = clamp(landX, sL, sR);
          botBrain.jumpDir = toRight ? 1 : -1;
          botBrain.srcY = src.y;
        } else {
          botBrain.takeoffX = null; botBrain.srcY = null; botBrain.jumpDir = 0;
        }
        goalX = botBrain.goalX; goalY = botBrain.goalY;
      } else {
        // Fallback: single-hop waypoint or sidestep to get unstuck
        if (!botBrain.goalX || (botBrain.goalUntil || 0) < nowT || Math.random() < 0.03){
          const wp = pickWaypoint(target);
          if (wp){
            botBrain.goalX = wp.x;
            botBrain.goalY = wp.y;
            botBrain.goalUntil = nowT + 2600;
          } else {
            const dir = (target.x > (bot.x + bot.w/2)) ? 1 : -1;
            botBrain.goalX = clamp(bot.x + dir * 200, 20, W - 20);
            botBrain.goalY = null;
            botBrain.goalUntil = nowT + 1200;
          }
        }
        if (botBrain.goalX){ goalX = botBrain.goalX; goalY = botBrain.goalY; }
      }
    } else {
      // Clear any stale waypoint/path when a direct jump is viable
      botBrain.path = null;
      botBrain.goalX = null; botBrain.goalY = null; botBrain.goalUntil = 0;
      botBrain.takeoffX = null; botBrain.srcY = null; botBrain.jumpDir = 0;
    }

    // Adopt goal if present, else head to the target (or center fallback)
    let desiredX = (goalX != null) ? goalX : (target ? target.x : (W/2));
    const input = { left: false, right: false, up: false };

    // Lateral steering toward desired X
    const centerX = bot.x + bot.w/2;
    if (botBrain.takeoffX != null && bot.grounded && botBrain.srcY != null && Math.abs((bot.y + bot.h) - botBrain.srcY) < 2){ desiredX = botBrain.takeoffX; }
    if (Math.abs(desiredX - centerX) > 6) {
      if (desiredX > centerX) input.right = true; else input.left = true;
    } else {
      // Close enough to goal horizontally: expire waypoint to re-evaluate next tick
      if (goalX != null) { botBrain.goalUntil = 0; }
    }

    // Jump heuristics: prefer ledge-aligned jumps for waypoints, or arc-feasible jumps for direct targets
    const targetAbove = target ? (target.y + 6) < (bot.y + bot.h/2) : false;
    const waypointAbove = (goalY != null) ? (goalY + 2) < (bot.y + bot.h/2) : false;

    // Stuck detection
    const movedX = Math.abs(bot.x - (botBrain.lastX || 0));
    if ((movedX < 2 && (input.left || input.right) && bot.grounded)) {
      botBrain.stuckTime = (botBrain.stuckTime || 0) + dt;
    } else {
      botBrain.stuckTime = Math.max(0, (botBrain.stuckTime || 0) - dt*0.5);
    }
    botBrain.lastX = bot.x;

    // Ledge alignment check for waypoint
    let okToJump = false;
    if (bot.grounded){
      if (waypointAbove && goalY != null){
        const dest = platformFor(goalY, goalX != null ? goalX : centerX);
        const src = currentSupport(centerX);
        if (dest && src){
          const margin = 18;
          const left = dest.x + margin;
          const right = dest.x + dest.w - margin;
          const atTakeoff = (botBrain.takeoffX != null) ? Math.abs(centerX - botBrain.takeoffX) <= 10 : true;
          if (atTakeoff) okToJump = true; // jump when at computed takeoff point; dest alignment not required
        }
      }
      if (!okToJump && targetAbove && targetReachableFromHere(target)){
        // Only jump directly for targets when arc-feasible horizontally
        const dx = Math.abs((target ? target.x : centerX) - centerX);
        if (dx <= maxAirHoriz * 0.8) okToJump = true;
      }
      // Last resort if stuck while grounded, but avoid bounce when target is too high or we're aligning to a waypoint
      const tooHighNow = target && ((bot.y + bot.h/2) - target.y) > (maxJump + 8);
      const aligning = waypointAbove && (goalY != null);
      if (!okToJump && (botBrain.stuckTime || 0) > 0.5 && !tooHighNow && !aligning) okToJump = true;
    }

    botBrain.upCooldown = Math.max(0, (botBrain.upCooldown || 0) - dt);
    if (bot.grounded && okToJump && botBrain.upCooldown <= 0 && nowT >= (botBrain.noJumpUntil || 0)) {
      input.up = true;
      botBrain.stuckTime = 0;
      botBrain.upCooldown = 0.28; // avoid bunny hopping
    }
    
    // Advance along multi-step path upon landing on the target platform
    if (botBrain.path && botBrain.path.length){
      const gy = botBrain.goalY;
      if (gy != null && bot.grounded && Math.abs((bot.y + bot.h) - gy) < 2){
        botBrain.path.shift();
        if (botBrain.path.length){
          const nxt = botBrain.path[0];
          botBrain.goalX = nxt.x; botBrain.goalY = nxt.y;
          botBrain.goalUntil = nowT + 2800;
          // Recompute takeoff for next edge
          const cX2 = bot.x + bot.w/2;
          const src2 = currentSupport(cX2);
          const dest2 = platformFor(botBrain.goalY, botBrain.goalX);
          if (src2 && dest2){
            const toRight2 = ((dest2.x + dest2.w/2) > (src2.x + src2.w/2));
            const m2 = 18;
            const sL2 = src2.x + m2, sR2 = src2.x + src2.w - m2;
            const landX2 = botBrain.goalX;
            botBrain.takeoffX = clamp(landX2, sL2, sR2);
            botBrain.jumpDir = toRight2 ? 1 : -1;
            botBrain.srcY = src2.y;
          } else {
            botBrain.takeoffX = null; botBrain.srcY = null; botBrain.jumpDir = 0;
          }
        } else {
          botBrain.goalX = null; botBrain.goalY = null;
          botBrain.takeoffX = null; botBrain.srcY = null; botBrain.jumpDir = 0;
        }
      }
    }
    
    remoteInputs[id] = input;
  }

  function simulateLocal(dt){
    // Only move my local representation (others will update from network)
    if (!state.players[clientId]) return;
    moveAndCollide(state.players[clientId], dt);
  }

  function resolveCollisionsAndPower(dt){
    const nowMs = Date.now();

    // 1) Power-up pickups (magnet, doublejump)
    const powerups = state.powerups || [];
    const remainingUps = [];
    for (const up of powerups) {
      let picked = null;
      if (up.kind === 'magnet' || up.kind === 'doublejump') {
        for (const id of Object.keys(state.players)) {
          const p = state.players[id];
          if (rectOverlap(p.x, p.y, p.w, p.h, up.x - 16, up.y - 16, 32, 32)) {
            picked = p; break;
          }
        }
      }
      if (picked) {
        if (up.kind === 'magnet') {
          picked.magnetEndsAt = nowMs + MAGNET_DURATION_MS;
          showMagnetFx(picked.magnetEndsAt);
        } else if (up.kind === 'doublejump') {
          picked.doubleJumpEndsAt = nowMs + DOUBLEJUMP_DURATION_MS;
          picked.usedSecondJump = false;
          showDoubleJumpFx(picked.doubleJumpEndsAt);
        }
      } else {
        remainingUps.push(up);
      }
    }
    state.powerups = remainingUps;

    // 2) Magnet attraction: gently pull nearby memes toward any magnetized player
    const magnets = Object.values(state.players).filter(p => (p.magnetEndsAt || 0) > nowMs);
    if (magnets.length) {
      for (const m of state.memes) {
        // Find nearest magnet player within range
        let target = null; let bestD = Infinity; let tx = 0; let ty = 0;
        for (const p of magnets) {
          const cx = p.x + p.w/2;
          const cy = p.y + p.h/2;
          const dx = cx - m.x; const dy = cy - m.y;
          const d = Math.hypot(dx, dy);
          if (d < MAGNET_RANGE && d < bestD) { bestD = d; target = p; tx = dx; ty = dy; }
        }
        if (target && bestD > 1) {
          const step = MAGNET_PULL_SPEED * (dt || 0.016);
          if (bestD <= step + 14) {
            // close enough -> will be collected in the collection pass below
            m.x += (tx / bestD) * Math.max(0, bestD - 14);
            m.y += (ty / bestD) * Math.max(0, bestD - 14);
          } else {
            m.x += (tx / bestD) * step;
            m.y += (ty / bestD) * step;
          }
        }
      }
    }

    // 3) Meme collection (normal overlap with any player, including magnetized one)
    const remaining = [];
    for (const m of state.memes) {
      let collectedBy = null;
      for (const id of Object.keys(state.players)) {
        const p = state.players[id];
        if (rectOverlap(p.x, p.y, p.w, p.h, m.x-14, m.y-14, 28, 28)) { collectedBy = p; break; }
      }
      if (collectedBy) {
        onCollect(collectedBy, m);
      } else {
        remaining.push(m);
      }
    }
    state.memes = remaining;

    // 4) Power touch kill (existing power from collecting 5 of a kind)
    const ps = Object.values(state.players);
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      const powered = a.powerEndsAt > nowMs;
      if (!powered) continue;
      for (let j = 0; j < ps.length; j++) {
        if (i === j) continue;
        const b = ps[j];
        if (rectOverlap(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h)) {
          // instant kill: drop from sky
          b.x = Math.random() * (W - 80) + 40;
          b.y = -160;
          b.vx = 0; b.vy = 0; b.grounded = false;
        }
      }
    }
  }

  function onCollect(p, meme){
    p.total = (p.total || 0) + 1;
    const prev = p.counts[meme.type] || 0;
    p.counts[meme.type] = prev + 1;
    p.flashUntil = Date.now() + 300; // flash feedback
    spawnWarmFuzzy(meme.x, meme.y);

    // Got 5 of a kind => power up
    if (p.counts[meme.type] === 5) {
      p.powerType = meme.type;
      p.powerEndsAt = Date.now() + POWER_MS;
      showPowerupFx();
    }

    // Win if 5 of each
    const win = MEME_SET.every(t => (p.counts[t] || 0) >= 5);
    if (win) {
      announceWin(p);
    }
  }

  function showPowerupFx(){
    try {
      powerupPill?.classList.remove('hidden');
      let endsAt = Date.now() + POWER_MS;
      updatePowerCountdown(endsAt);
      bigFlash?.classList.add('show');
      setTimeout(() => bigFlash?.classList.remove('show'), 900);
      // Countdown updates
      const iv = setInterval(() => {
        const left = Math.max(0, Math.ceil((endsAt - Date.now())/1000));
        updatePowerCountdown(endsAt);
        if (left <= 0) { clearInterval(iv); powerupPill?.classList.add('hidden'); }
      }, 250);
    } catch(_){}
  }

  function updatePowerCountdown(endsAt){
    if (!powerupCountdownEl) return;
    const left = Math.max(0, Math.ceil((endsAt - Date.now())/1000));
    powerupCountdownEl.textContent = String(left);
  }

  function announceWin(p){
    // Broadcast a synchronized win event to all clients (including the winner)
    try {
      if (socket) {
        socket.emit('memedash_win', { room, mode, winnerId: p.id, winnerName: p.name || 'Player', score: p.total });
      } else {
        // Fallback offline: show locally
        const isYou = (p.id === clientId);
        showCelebration(isYou ? 'win' : 'lose', { winnerName: p.name || 'Player', isYou });
        window.recordResult?.({ mode: 'memedash', game_name: 'Meme Dash', outcome: (isYou ? 'win' : 'loss'), score: p.total, room_pin: window.currentSessionPin });
      }
    } catch(_){ }

    // Reset minimal: clear memes and some progress to allow replay quickly
    for (const id of Object.keys(state.players)) {
      const pl = state.players[id];
      pl.total = 0;
      for (const t of MEME_SET) pl.counts[t] = 0;
      pl.powerEndsAt = 0; pl.powerType = null;
      pl.x = Math.random() * (W - 80) + 40; pl.y = -120; pl.vx = 0; pl.vy = 0; pl.grounded = false;
    }
    state.memes = [];
  }

  function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh){
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // Rendering
  function render(){
    // Background sky
    ctx.clearRect(0, 0, W, H);
    // Parallax simple
    ctx.fillStyle = '#e8f5ff';
    ctx.fillRect(0,0,W,H);

    // Ground
    ctx.fillStyle = '#9bd27f';
    ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    ctx.fillStyle = '#6e994d';
    ctx.fillRect(0, FLOOR_Y, W, 6);

    // Platforms
    ctx.fillStyle = '#3f51b5';
    for (const p of platforms) {
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }

    if (!state) return;

    // Power-ups (render)
    const ups = state.powerups || [];
    for (const up of ups) {
      if (up.kind === 'magnet') drawMagnetPickup(up.x, up.y);
      if (up.kind === 'doublejump') drawDoubleJumpPickup(up.x, up.y);
    }

    // Memes
    for (const m of state.memes) {
      const img = imageCache.get(m.type);
      if (img && img.complete) {
        const s = 28;
        ctx.drawImage(img, m.x - s/2, m.y - s/2, s, s);
        // glow
        ctx.save();
        ctx.globalAlpha = 0.2; ctx.fillStyle = '#ffcc00';
        ctx.beginPath(); ctx.arc(m.x, m.y, 18, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = '#ff9800';
        ctx.beginPath(); ctx.arc(m.x, m.y, 12, 0, Math.PI*2); ctx.fill();
      }
    }

    // Attraction lines to magnetized players
    const nowMs = Date.now();
    const magnetPlayers = Object.values(state.players).filter(pp => (pp.magnetEndsAt || 0) > nowMs);
    if (magnetPlayers.length) {
      ctx.save();
      for (const m of state.memes) {
        let target = null; let bestD = Infinity; let cx=0, cy=0;
        for (const mp of magnetPlayers) {
          const tx = mp.x + mp.w/2; const ty = mp.y + mp.h/2;
          const d = Math.hypot(tx - m.x, ty - m.y);
          if (d < MAGNET_RANGE && d < bestD) { bestD = d; target = mp; cx = tx; cy = ty; }
        }
        if (target) {
          const a = clamp(1 - (bestD / MAGNET_RANGE), 0.15, 0.9);
          ctx.strokeStyle = `rgba(255, 99, 0, ${a.toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(cx, cy);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Players
    for (const id of Object.keys(state.players)) {
      const p = state.players[id];
      const powered = p.powerEndsAt > nowMs;
      const scale = powered ? 1.6 : 1;
      const w = p.w * scale;
      const h = p.h * scale;
      const x = p.x + p.w/2 - w/2;
      const y = p.y + p.h - h;

      // magnet aura
      if ((p.magnetEndsAt || 0) > nowMs) {
        drawMagnetAura(p);
      }

      // body
      ctx.fillStyle = powered ? pulseColor() : p.color;
      if (p.flashUntil > nowMs) ctx.fillStyle = '#fff176';
      roundRect(ctx, x, y, w, h, 6);

      // face
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x + w*0.5, y + h*0.35, 6, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(x + w*0.47, y + h*0.33, 1.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w*0.53, y + h*0.33, 1.5, 0, Math.PI*2); ctx.fill();

      // name tag
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.id === clientId ? 'You' : (p.name || 'Player'), x + w/2, y - 8);
    }

    // HUD scoreboard badges
    renderScoreboard();

    // Powerup pill time left (only for my player) — show Magnet if active, else regular power
    const me = state.players[clientId];
    if (me) {
      const nowT = Date.now();
      let endsAt = 0; let label = '';
      if ((me.magnetEndsAt || 0) > nowT) { endsAt = me.magnetEndsAt; label = 'MAGNET'; }
      else if ((me.doubleJumpEndsAt || 0) > nowT) { endsAt = me.doubleJumpEndsAt; label = 'DOUBLE JUMP'; }
      else if ((me.powerEndsAt || 0) > nowT) { endsAt = me.powerEndsAt; label = 'ALL POWERFUL BEING'; }
      if (endsAt > nowT) {
        powerupPill?.classList.remove('hidden');
        const secsLeft = Math.max(0, Math.ceil((endsAt - nowT)/1000));
        if (powerupPill) powerupPill.innerHTML = `${label}! <span id="powerupCountdown">${secsLeft}</span>s`;
      } else {
        powerupPill?.classList.add('hidden');
      }
    }
  }

  function pulseColor(){
    const t = (Date.now() % 800) / 800;
    const a = Math.sin(t * Math.PI*2) * 0.5 + 0.5;
    return `hsl(${(a*60)|0} 100% 60%)`;
  }

  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  function renderScoreboard(){
    if (!scoreboardEl || !state) return;
    const me = state.players[clientId];
    if (!me) return;
    let html = '';
    for (const t of MEME_SET) {
      const img = `/static/${t}`;
      const c = me.counts[t] || 0;
      html += `<span class="meme"><img alt="${t}" src="${img}"><span class="count">${c}/5</span></span>`;
    }
    scoreboardEl.innerHTML = html;
  }

  function spawnWarmFuzzy(x, y){
    if (!bigFlash?.parentElement) return;
    const el = document.createElement('div');
    el.className = 'warm-fuzzy';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    bigFlash.parentElement.appendChild(el);
    setTimeout(() => el.remove(), 820);
  }

  // Visual: draw magnet pickup on field
  function drawMagnetPickup(x, y){
    const t = (Date.now() % 1200) / 1200;
    const pulse = 1 + Math.sin(t * Math.PI * 2) * 0.08;
    const r = 16 * pulse;
    // aura
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#ff5722';
    ctx.beginPath(); ctx.arc(x, y, r + 10, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    // coin base
    ctx.save();
    ctx.fillStyle = '#fffbe6';
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // magnet glyph (U shape)
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * Math.PI*2) * 0.2);
    ctx.fillStyle = '#ff3b30';
    ctx.strokeStyle = '#b71c1c';
    ctx.lineWidth = 2;
    const w = 12, h = 14, th = 4;
    // left leg
    roundRect(ctx, -w, -h/2, th, h, 2);
    // right leg
    roundRect(ctx, w - th, -h/2, th, h, 2);
    // bridge
    ctx.beginPath();
    ctx.moveTo(-w + th, -h/2);
    ctx.lineTo(w - th, -h/2);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  // Visual: draw double jump pickup on field
  function drawDoubleJumpPickup(x, y){
    const t = (Date.now() % 1200) / 1200;
    const pulse = 1 + Math.sin(t * Math.PI * 2) * 0.08;
    const r = 16 * pulse;
    // aura
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = '#2196f3';
    ctx.beginPath(); ctx.arc(x, y, r + 10, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    // coin base
    ctx.save();
    ctx.fillStyle = '#e3f2fd';
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // glyph: "2x"
    ctx.fillStyle = '#0d47a1';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('2x', x, y);
    ctx.restore();
  }

  function drawMagnetAura(p){
    const cx = p.x + p.w/2;
    const cy = p.y + p.h/2;
    const t = (Date.now() % 1000) / 1000;
    const base = MAGNET_RANGE;
    const r = base * (0.9 + 0.1 * Math.sin(t * Math.PI*2));
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 87, 34, 0.6)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 10]);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function showMagnetFx(endsAt){
    try {
      if (bigFlash) {
        const h1 = bigFlash.querySelector('h1');
        if (h1) h1.textContent = 'MAGNET MODE!';
        bigFlash.classList.add('show');
        setTimeout(() => bigFlash.classList.remove('show'), 900);
      }
      if (powerupPill) {
        powerupPill.classList.remove('hidden');
        let iv;
        const update = () => {
          const left = Math.max(0, Math.ceil((endsAt - Date.now())/1000));
          powerupPill.innerHTML = `MAGNET! <span id="powerupCountdown">${left}</span>s`;
          if (left <= 0) { clearInterval(iv); powerupPill.classList.add('hidden'); }
        };
        update();
        iv = setInterval(update, 250);
      }
    } catch(_){ }
  }

  function showDoubleJumpFx(endsAt){
    try {
      if (bigFlash) {
        const h1 = bigFlash.querySelector('h1');
        if (h1) h1.textContent = 'DOUBLE JUMP!';
        bigFlash.classList.add('show');
        setTimeout(() => bigFlash.classList.remove('show'), 900);
      }
      if (powerupPill) {
        powerupPill.classList.remove('hidden');
        let iv;
        const update = () => {
          const left = Math.max(0, Math.ceil((endsAt - Date.now())/1000));
          powerupPill.innerHTML = `DOUBLE JUMP! <span id="powerupCountdown">${left}</span>s`;
          if (left <= 0) { clearInterval(iv); powerupPill.classList.add('hidden'); }
        };
        update();
        iv = setInterval(update, 250);
      }
    } catch(_){ }
  }

  // Celebration overlay logic
  const WIN_EMOJIS = ['🎉','🎊','🤑','💸','💰','🥳','🎈','💵','⭐'];
  const LOSE_EMOJIS = ['💔','😢','💀','☔','🪦','🥀','😞','🫥','🌧️'];
  function showCelebration(outcome, { winnerName = 'Player', isYou = false } = {}) {
    try {
      if (!celebrateOverlay) return;
      celebrateOverlay.hidden = false;
      celebrateOverlay.setAttribute('data-outcome', outcome);
      celebrateOverlay.setAttribute('aria-hidden', 'false');
      if (celebrateTitleEl) celebrateTitleEl.textContent = isYou ? 'You Win!' : (outcome === 'win' ? `${winnerName} Wins!` : 'You Lost!');
      if (celebrateSubtitleEl) {
        if (outcome === 'win') {
          celebrateSubtitleEl.textContent = isYou ? 'First to collect all the memes!' : `Winner: ${winnerName}`;
        } else {
          celebrateSubtitleEl.textContent = `Winner: ${winnerName} — better luck next round!`;
        }
      }
      const rootW = window.innerWidth || document.documentElement.clientWidth || 1200;
      const confettiCount = Math.max(60, Math.min(180, Math.floor(rootW / 8)));
      const emojiCount = Math.max(24, Math.min(64, Math.floor(rootW / 30)));
      const balloonCount = outcome === 'win' ? Math.max(14, Math.min(28, Math.floor(rootW / 80))) : Math.max(10, Math.min(20, Math.floor(rootW / 100)));
      // Clear existing
      [fxConfetti, fxEmojis, fxBalloons].forEach(layer => { if (layer) layer.innerHTML = ''; });
      // Confetti
      if (fxConfetti) {
        for (let i = 0; i < confettiCount; i++) {
          const d = document.createElement('div');
          d.className = 'fx-piece confetti c' + ((i % 5) + 1);
          const x = (Math.random() * 100).toFixed(2) + 'vw';
          const delay = (Math.random() * 0.8).toFixed(2) + 's';
          const dur = (2.8 + Math.random()*2.6).toFixed(2) + 's';
          d.style.left = x;
          d.style.top = (-10 - Math.random()*30) + 'vh';
          d.style.setProperty('--x', (Math.random()*10-5).toFixed(2) + 'vw');
          d.style.setProperty('--delay', delay);
          d.style.setProperty('--dur', dur);
          if (outcome === 'lose') {
            d.style.background = ''; // color via CSS class for loss
          }
          fxConfetti.appendChild(d);
        }
      }
      // Emojis
      if (fxEmojis) {
        const set = outcome === 'win' ? WIN_EMOJIS : LOSE_EMOJIS;
        for (let i = 0; i < emojiCount; i++) {
          const s = document.createElement('div');
          s.className = 'fx-piece emoji';
          s.textContent = set[i % set.length];
          const x = (Math.random() * 100).toFixed(2) + 'vw';
          const delay = (Math.random() * 1.2).toFixed(2) + 's';
          const dur = (3.2 + Math.random()*3.5).toFixed(2) + 's';
          s.style.left = x;
          s.style.top = (-12 - Math.random()*20) + 'vh';
          s.style.setProperty('--x', (Math.random()*12-6).toFixed(2) + 'vw');
          s.style.setProperty('--delay', delay);
          s.style.setProperty('--dur', dur);
          fxEmojis.appendChild(s);
        }
      }
      // Balloons: rise on win, fall on loss (reuse emoji class with fall anim for loss)
      if (fxBalloons) {
        const balloonEmoji = outcome === 'win' ? '🎈' : '🎈';
        for (let i = 0; i < balloonCount; i++) {
          const b = document.createElement('div');
          b.className = 'fx-piece balloon';
          b.textContent = balloonEmoji;
          const x = (Math.random() * 100).toFixed(2) + 'vw';
          const delay = (Math.random() * 0.8).toFixed(2) + 's';
          const dur = (5.5 + Math.random()*3.5).toFixed(2) + 's';
          b.style.left = x;
          if (outcome === 'win') {
            b.style.top = '106vh';
          } else {
            // for loss, let them fall like deflated balloons
            b.className = 'fx-piece emoji';
            b.style.top = (-12 - Math.random()*10) + 'vh';
          }
          b.style.setProperty('--x', (Math.random()*14-7).toFixed(2) + 'vw');
          b.style.setProperty('--delay', delay);
          b.style.setProperty('--dur', dur);
          fxBalloons.appendChild(b);
        }
      }
      // Close button
      if (celebrateCloseBtn) {
        celebrateCloseBtn.onclick = hideCelebration;
      }
      // Auto-hide in 5.5s
      clearTimeout(showCelebration._t);
      showCelebration._t = setTimeout(hideCelebration, 5500);
    } catch(e) { console.warn('celebration error', e); }
  }
  function hideCelebration(){
    try {
      if (!celebrateOverlay) return;
      celebrateOverlay.hidden = true;
      celebrateOverlay.setAttribute('aria-hidden','true');
      [fxConfetti, fxEmojis, fxBalloons].forEach(layer => { if (layer) layer.innerHTML = ''; });
    } catch(_){ }
  }

  // Hook close button early
  if (celebrateCloseBtn) {
    celebrateCloseBtn.addEventListener('click', hideCelebration);
  }

  // Utility
  function setMemeRespawnTimer(){ /* handled by spawnLoop */ }

})();
