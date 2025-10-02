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

  const canvas = qs('#gameCanvas');
  const ctx = canvas.getContext('2d');

  const getParam = (name) => new URLSearchParams(window.location.search).get(name);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();

  // Session & socket
  // Stable player id across refreshes (per room PIN)
  let clientId = null;
  const mode = 'memedash';
  let socket = null;
  let room = null;

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
  const MAGNET_RANGE = Math.hypot(canvas.width, canvas.height) * 0.05; // ~5% of screen diagonal
  const MAGNET_PULL_SPEED = 520; // px/s pull speed toward player

  // State kept in rooms_state[room]['memedash']
  // We elect a host (ownerId = first creator). Host spawns memes, resolves collisions.
  let state = null; // { ownerId, players: {id: {...}}, memes: [...], lastSpawnAt }

  const my = {
    input: { left: false, right: false, up: false },
  };

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
      powerups: [], // {id, kind:'magnet', x, y}
      lastPowerSpawnAt: 0,
      seed: (Math.random() * 1e9) | 0,
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
    socket.on('presence', (p) => { if (p && p.room === room) setPresence(p.count, true); });
    socket.on('state', (msg) => { if (msg && msg.room === room && msg.mode === mode) applyRemoteState(msg.state); });
    socket.on('state_update', (msg) => { if (msg && msg.room === room && msg.mode === mode) applyRemoteState(msg.state); });
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

    // If we're not the owner, preserve our locally simulated kinematics to avoid rubberbanding
    // This lets a joining client move smoothly even if the host isn't simulating their input.
    if (prev && state.ownerId !== clientId) {
      const localMe = prev.players && prev.players[clientId];
      if (localMe) {
        const incomingMe = state.players[clientId] || (state.players[clientId] = {});
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

    // If we were missing from remote, broadcast once so everyone learns about us
    if (!hadMe) {
      broadcast();
    }

    // If owner switched away from us, stop authoritative actions (no-op for now)
    const amOwnerAfter = state.ownerId === clientId;
    if (wasOwner && !amOwnerAfter) {
      // nothing specific for now
    }
  }

  function broadcast(){
    try { socket?.emit('state_update', { room, mode, clientId, state }); } catch(_){ }
  }

  // Input
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA'].includes(e.target?.tagName)) return;
    keys.add(e.key);
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.key);
  });

  function updateInput(){
    my.input.left = keys.has('a') || keys.has('A') || keys.has('ArrowLeft');
    my.input.right = keys.has('d') || keys.has('D') || keys.has('ArrowRight');
    my.input.up = keys.has('w') || keys.has('W') || keys.has('ArrowUp') || keys.has(' ');
  }

  // Game loop
  let lastTs = 0;
  function tick(ts){
    const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
    lastTs = ts;

    updateInput();

    // Owner runs simulation & spawning, then broadcasts
    if (state) {
      const amOwner = state.ownerId === clientId;
      if (amOwner) {
        spawnLoop(ts);
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

    const accelX = (my.input.left && p.id === clientId ? -1 : 0) + (my.input.right && p.id === clientId ? 1 : 0);
    const targetVx = accelX * BASE_SPEED * s;
    const ax = (targetVx - p.vx) * 10 * dt; // simple PD toward target
    p.vx += ax;

    // Jump: reverse-scale jump strength as speed decreases (slower => higher jumps)
    // Keep gravity constant so higher jump velocity yields a higher apex.
    const jumpScale = clamp(1 + (1 - s), 1, 1.8); // at min speed (s=0.4) -> 1.6x; cap at 1.8x
    const gravity = GRAVITY;
    if ((my.input.up && p.id === clientId) && p.grounded) {
      p.vy = -JUMP_VELOCITY * jumpScale;
      p.grounded = false;
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
  }

  function simulate(dt){
    // Ensure my player exists
    addMeIfMissing();

    // Move all players
    for (const id of Object.keys(state.players)) moveAndCollide(state.players[id], dt);

    // Resolve collections and power effects
    resolveCollisionsAndPower(dt);
  }

  function simulateLocal(dt){
    // Only move my local representation (others will update from network)
    if (!state.players[clientId]) return;
    moveAndCollide(state.players[clientId], dt);
  }

  function resolveCollisionsAndPower(dt){
    const nowMs = Date.now();

    // 1) Power-up pickups (magnet)
    const powerups = state.powerups || [];
    const remainingUps = [];
    for (const up of powerups) {
      let picked = null;
      if (up.kind === 'magnet') {
        for (const id of Object.keys(state.players)) {
          const p = state.players[id];
          if (rectOverlap(p.x, p.y, p.w, p.h, up.x - 16, up.y - 16, 32, 32)) {
            picked = p; break;
          }
        }
      }
      if (picked) {
        picked.magnetEndsAt = nowMs + MAGNET_DURATION_MS;
        showMagnetFx(picked.magnetEndsAt);
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
    // Simple banner and record
    try {
      const msg = `${p.name || 'Player'} wins!`;
      alert(msg);
      // Best-effort telemetry
      window.recordResult?.({ mode: 'memedash', game_name: 'Meme Dash', outcome: (p.id === clientId ? 'win' : 'completed'), score: p.total, room_pin: window.currentSessionPin });
    } catch(_){}

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
      else if ((me.powerEndsAt || 0) > nowT) { endsAt = me.powerEndsAt; label = 'POWERED UP'; }
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

  // Utility
  function setMemeRespawnTimer(){ /* handled by spawnLoop */ }

})();
