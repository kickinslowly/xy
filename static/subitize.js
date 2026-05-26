(function () {
  'use strict';

  const ADAPTIVE_MODE_KEY = 'subitize';
  const GOAL = 20;
  const DIFF_LABELS = ['Beginner', 'Developing', 'Proficient', 'Advanced'];
  const OPS = ['multiply', 'add', 'subtract', 'divide', 'mixed'];
  const OP_SYMBOLS = { multiply: '×', add: '+', subtract: '−', divide: '÷' };

  let currentOp = 'multiply';
  let score = 0;
  let challengeDifficulty = 1;
  let currentProblem = null;
  let streak = 0;

  // Response time tracking
  let problemStartMs = 0;
  let responseTimes = [];
  const speedBadgeEl = document.getElementById('speedBadge');
  const victoryStatsEl = document.getElementById('victoryStats');

  // Flash mode state
  let flashMode = localStorage.getItem('subitize_flash') === 'true';
  let flashTimer = null;
  const FLASH_DURATIONS = [3000, 2000, 1500, 1000];

  // Ten-frame mode state
  let tenFrameMode = localStorage.getItem('subitize_tenframe') === 'true';

  // DOM refs
  const canvas = document.getElementById('subitizeCanvas');
  const ctx = canvas.getContext('2d');
  const questionText = document.getElementById('questionText');
  const answerInput = document.getElementById('answerInput');
  const submitBtn = document.getElementById('submitBtn');
  const skipBtn = document.getElementById('skipBtn');
  const scoreEl = document.getElementById('score');
  const scoreBarFill = document.getElementById('scoreBarFill');
  const hintArea = document.getElementById('hintArea');
  const hintText = document.getElementById('hintText');
  const successSub = document.getElementById('successSub');
  const failSub = document.getElementById('failSub');
  const splashSuccess = document.getElementById('splashSuccess');
  const splashFail = document.getElementById('splashFail');
  const victory = document.getElementById('victory');

  // Flash mode DOM
  const canvasWrap = document.querySelector('.subitize-canvas-wrap');
  const flashToggle = document.getElementById('flashToggle');
  if (flashToggle) {
    // Sync button to saved state
    if (flashMode) flashToggle.classList.add('active');
    flashToggle.querySelector('.flash-label').textContent = flashMode ? 'Flash: ON' : 'Flash: OFF';
    flashToggle.addEventListener('click', () => {
      flashMode = !flashMode;
      localStorage.setItem('subitize_flash', flashMode ? 'true' : 'false');
      flashToggle.classList.toggle('active', flashMode);
      flashToggle.querySelector('.flash-label').textContent = flashMode ? 'Flash: ON' : 'Flash: OFF';
      // If toggled on mid-problem, start flash; if toggled off, clear blur
      cancelFlash();
      if (flashMode && currentProblem) {
        startFlash();
      }
    });
  }

  // Ten-frame toggle
  const tenFrameToggle = document.getElementById('tenFrameToggle');
  if (tenFrameToggle) {
    if (tenFrameMode) tenFrameToggle.classList.add('active');
    tenFrameToggle.querySelector('.tf-label').textContent = tenFrameMode ? '10-Frame: ON' : '10-Frame: OFF';
    tenFrameToggle.addEventListener('click', () => {
      tenFrameMode = !tenFrameMode;
      localStorage.setItem('subitize_tenframe', tenFrameMode ? 'true' : 'false');
      tenFrameToggle.classList.toggle('active', tenFrameMode);
      tenFrameToggle.querySelector('.tf-label').textContent = tenFrameMode ? '10-Frame: ON' : '10-Frame: OFF';
      if (currentProblem) renderProblem(currentProblem);
    });
  }

  function cancelFlash() {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    canvasWrap.classList.remove('flash-hidden');
  }

  function startFlash() {
    canvasWrap.classList.remove('flash-hidden');
    const dur = FLASH_DURATIONS[challengeDifficulty] || 2000;
    flashTimer = setTimeout(() => {
      flashTimer = null;
      canvasWrap.classList.add('flash-hidden');
      answerInput.focus();
    }, dur);
  }

  // Pill tabs
  const pills = document.querySelectorAll('.mode-pill[data-op]');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => { p.classList.remove('active'); p.setAttribute('aria-selected', 'false'); });
      pill.classList.add('active');
      pill.setAttribute('aria-selected', 'true');
      currentOp = pill.dataset.op;
      score = 0;
      streak = 0;
      cancelFlash();
      updateScore();
      nextProblem();
    });
  });

  // Difficulty ranges per level
  function getRange() {
    switch (challengeDifficulty) {
      case 0: return { groups: [2, 3], dots: [1, 3], maxNum: 9 };
      case 1: return { groups: [2, 4], dots: [2, 5], maxNum: 20 };
      case 2: return { groups: [3, 6], dots: [2, 6], maxNum: 36 };
      case 3: return { groups: [3, 8], dots: [3, 9], maxNum: 72 };
      default: return { groups: [2, 4], dots: [2, 5], maxNum: 20 };
    }
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pickOp() {
    if (currentOp === 'mixed') {
      const ops = ['multiply', 'add', 'subtract', 'divide'];
      return ops[randInt(0, ops.length - 1)];
    }
    return currentOp;
  }

  function generateProblem() {
    const op = pickOp();
    const range = getRange();
    let groups, dotsPerGroup, answer, a, b;

    switch (op) {
      case 'multiply':
        groups = randInt(range.groups[0], range.groups[1]);
        dotsPerGroup = randInt(range.dots[0], range.dots[1]);
        answer = groups * dotsPerGroup;
        return { op, groups, dotsPerGroup, answer, a: groups, b: dotsPerGroup, uniform: true };

      case 'add':
        a = randInt(range.dots[0], Math.min(range.dots[1], 9));
        b = randInt(range.dots[0], Math.min(range.dots[1], 9));
        answer = a + b;
        return { op, groups: 2, dotCounts: [a, b], answer, a, b, uniform: false };

      case 'subtract':
        a = randInt(Math.max(range.dots[0] + 2, 4), Math.min(range.maxNum, 15));
        b = randInt(1, a - 1);
        answer = a - b;
        return { op, groups: 1, totalDots: a, crossedOut: b, answer, a, b, uniform: false };

      case 'divide':
        dotsPerGroup = randInt(range.dots[0], Math.min(range.dots[1], 6));
        groups = randInt(range.groups[0], Math.min(range.groups[1], 6));
        const total = groups * dotsPerGroup;
        answer = dotsPerGroup;
        return { op, groups, dotsPerGroup, totalDots: total, answer, a: total, b: groups, uniform: true };

      default:
        return generateProblem();
    }
  }

  function buildQuestion(p) {
    switch (p.op) {
      case 'multiply':
        return 'How many dots total?';
      case 'add':
        return 'How many dots altogether?';
      case 'subtract':
        return 'How many dots are left?';
      case 'divide':
        return 'How many dots in each group?';
      default:
        return 'How many?';
    }
  }

  // Drawing
  const COLORS = ['#7a5cff', '#ff4da6', '#36d1ff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];

  function drawDots(cx, cy, radius, count, color, crossed) {
    const positions = arrangeDots(count, radius * 0.7);
    positions.forEach((pos, i) => {
      const x = cx + pos[0];
      const y = cy + pos[1];
      ctx.beginPath();
      ctx.arc(x, y, Math.min(radius * 0.18, 12), 0, Math.PI * 2);
      ctx.fillStyle = crossed && i >= (count - (crossed || 0)) ? '#555' : color;
      ctx.fill();
      if (crossed && i >= (count - crossed)) {
        ctx.beginPath();
        ctx.moveTo(x - 8, y - 8);
        ctx.lineTo(x + 8, y + 8);
        ctx.moveTo(x + 8, y - 8);
        ctx.lineTo(x - 8, y + 8);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    });
  }

  function arrangeDots(count, radius) {
    if (count <= 0) return [];
    if (count === 1) return [[0, 0]];
    if (count === 2) return [[-radius * 0.4, 0], [radius * 0.4, 0]];
    if (count === 3) return [[0, -radius * 0.35], [-radius * 0.35, radius * 0.25], [radius * 0.35, radius * 0.25]];
    if (count === 4) return [[-radius * 0.3, -radius * 0.3], [radius * 0.3, -radius * 0.3], [-radius * 0.3, radius * 0.3], [radius * 0.3, radius * 0.3]];
    if (count === 5) return [[0, 0], [-radius * 0.4, -radius * 0.4], [radius * 0.4, -radius * 0.4], [-radius * 0.4, radius * 0.4], [radius * 0.4, radius * 0.4]];
    if (count === 6) return [[-radius * 0.35, -radius * 0.4], [0, -radius * 0.4], [radius * 0.35, -radius * 0.4], [-radius * 0.35, radius * 0.3], [0, radius * 0.3], [radius * 0.35, radius * 0.3]];
    // 7: domino — top row of 4, bottom row of 3
    if (count === 7) {
      const s = radius * 0.3;
      return [
        [-1.5 * s, -s], [-0.5 * s, -s], [0.5 * s, -s], [1.5 * s, -s],
        [-s, s], [0, s], [s, s]
      ];
    }
    // 8: two rows of 4
    if (count === 8) {
      const s = radius * 0.3;
      return [
        [-1.5 * s, -s], [-0.5 * s, -s], [0.5 * s, -s], [1.5 * s, -s],
        [-1.5 * s, s], [-0.5 * s, s], [0.5 * s, s], [1.5 * s, s]
      ];
    }
    // 9: dice — three rows of 3
    if (count === 9) {
      const s = radius * 0.35;
      return [
        [-s, -s], [0, -s], [s, -s],
        [-s, 0],  [0, 0],  [s, 0],
        [-s, s],  [0, s],  [s, s]
      ];
    }
    // 10+ : circle layout
    const pts = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
      pts.push([Math.cos(angle) * radius * 0.55, Math.sin(angle) * radius * 0.55]);
    }
    return pts;
  }

  function drawCircle(cx, cy, radius, color) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawTenFrame(cx, cy, cellSize, filled, color, crossedOut) {
    const gapX = cellSize * 0.1;
    const gapY = cellSize * 0.1;
    const cw = cellSize;
    const ch = cellSize;
    const totalW = 5 * cw + 4 * gapX;
    const totalH = 2 * ch + gapY;
    const startX = cx - totalW / 2;
    const startY = cy - totalH / 2;

    for (let i = 0; i < 10; i++) {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const x = startX + col * (cw + gapX);
      const y = startY + row * (ch + gapY);

      // Cell border
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cw, ch);

      if (i < filled) {
        const isCrossed = crossedOut && i >= (filled - crossedOut);
        // Filled dot
        ctx.beginPath();
        ctx.arc(x + cw / 2, y + ch / 2, cw * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = isCrossed ? '#555' : color;
        ctx.fill();
        if (isCrossed) {
          const dx = cw * 0.22;
          ctx.beginPath();
          ctx.moveTo(x + cw / 2 - dx, y + ch / 2 - dx);
          ctx.lineTo(x + cw / 2 + dx, y + ch / 2 + dx);
          ctx.moveTo(x + cw / 2 + dx, y + ch / 2 - dx);
          ctx.lineTo(x + cw / 2 - dx, y + ch / 2 + dx);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
    }
  }

  function renderTenFrame(p, w, h) {
    const cellSize = Math.min(w / 8, h / 4, 50);

    if (p.op === 'subtract') {
      drawTenFrame(w / 2, h / 2, cellSize, p.totalDots, COLORS[0], p.crossedOut);
      return;
    }
    if (p.op === 'add') {
      const gap = cellSize * 2;
      drawTenFrame(w / 2 - gap - cellSize * 2, h / 2, cellSize, p.dotCounts[0], COLORS[0]);
      drawTenFrame(w / 2 + gap + cellSize * 2, h / 2, cellSize, p.dotCounts[1], COLORS[1]);
      // Plus sign between
      ctx.fillStyle = '#8899aa';
      ctx.font = `bold ${cellSize}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', w / 2, h / 2);
      return;
    }
    // multiply / divide: show multiple ten-frames
    const numFrames = p.groups;
    const cols = Math.min(numFrames, 3);
    const rows = Math.ceil(numFrames / cols);
    const frameW = (5 * cellSize + 4 * cellSize * 0.1);
    const frameH = (2 * cellSize + cellSize * 0.1);
    const spacingX = frameW + cellSize;
    const spacingY = frameH + cellSize * 0.6;
    const totalW = cols * spacingX - cellSize;
    const totalH = rows * spacingY - cellSize * 0.6;
    const startX = (w - totalW) / 2 + frameW / 2;
    const startY = (h - totalH) / 2 + frameH / 2;

    for (let i = 0; i < numFrames; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = startX + col * spacingX;
      const cy = startY + row * spacingY;
      drawTenFrame(cx, cy, cellSize, p.dotsPerGroup, COLORS[i % COLORS.length]);
    }
  }

  function renderProblem(p) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (tenFrameMode) {
      renderTenFrame(p, w, h);
      return;
    }

    if (p.op === 'subtract') {
      const radius = Math.min(w, h) * 0.35;
      const cx = w / 2, cy = h / 2;
      drawCircle(cx, cy, radius, COLORS[0]);
      drawDots(cx, cy, radius, p.totalDots, COLORS[0], p.crossedOut);
      return;
    }

    if (p.op === 'add') {
      const counts = p.dotCounts;
      const cols = counts.length;
      const spacing = w / (cols + 1);
      const radius = Math.min(spacing * 0.4, h * 0.35);
      counts.forEach((count, i) => {
        const cx = spacing * (i + 1);
        const cy = h / 2;
        drawCircle(cx, cy, radius, COLORS[i % COLORS.length]);
        drawDots(cx, cy, radius, count, COLORS[i % COLORS.length]);
      });
      return;
    }

    // multiply / divide: uniform groups
    const numGroups = p.groups;
    const cols = Math.min(numGroups, 4);
    const rows = Math.ceil(numGroups / cols);
    const cellW = w / cols;
    const cellH = h / rows;
    const radius = Math.min(cellW, cellH) * 0.38;

    for (let i = 0; i < numGroups; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = cellW * (col + 0.5);
      const cy = cellH * (row + 0.5);
      const color = COLORS[i % COLORS.length];
      drawCircle(cx, cy, radius, color);
      drawDots(cx, cy, radius, p.dotsPerGroup, color);
    }
  }

  function updateSpeedBadge() {
    if (!speedBadgeEl || responseTimes.length === 0) return;
    const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const avgSec = (avg / 1000).toFixed(1);
    let tier, label;
    if (avg < 2000) { tier = 'lightning'; label = '⚡ ' + avgSec + 's'; }
    else if (avg < 3000) { tier = 'quick'; label = '\u{1F3C3} ' + avgSec + 's'; }
    else { tier = 'steady'; label = '⏱ ' + avgSec + 's'; }
    speedBadgeEl.textContent = label;
    speedBadgeEl.dataset.tier = tier;
    speedBadgeEl.hidden = false;
  }

  function nextProblem() {
    hintArea.hidden = true;
    answerInput.value = '';
    cancelFlash();
    currentProblem = generateProblem();
    problemStartMs = Date.now();
    questionText.textContent = buildQuestion(currentProblem);
    renderProblem(currentProblem);
    if (flashMode) {
      startFlash();
    } else {
      answerInput.focus();
    }
  }

  function updateScore() {
    scoreEl.textContent = score;
    scoreBarFill.style.width = `${(score / GOAL) * 100}%`;
  }

  function flash(el, duration) {
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration || 1200);
  }

  function adjustDifficulty(correct) {
    if (!window.AdaptiveDifficulty) return;
    const r = window.AdaptiveDifficulty.recordResult(ADAPTIVE_MODE_KEY, !!correct);
    challengeDifficulty = r.level;
    window.AdaptiveDifficulty.updateBadges(r.level);
  }

  function recordToServer(correct, responseMs) {
    if (!window.recordResult) return;
    const p = currentProblem;
    window.recordResult({
      mode: 'subitize',
      game_name: 'Subitize ' + (p.op.charAt(0).toUpperCase() + p.op.slice(1)),
      outcome: correct ? 'success' : 'incorrect',
      score: correct ? 1 : 0,
      details_json: {
        challenge_type: p.op,
        difficulty: DIFF_LABELS[challengeDifficulty],
        a: p.a,
        b: p.b,
        answer: p.answer,
        correct: correct,
        responseMs: responseMs,
      }
    }).catch(() => {});
  }

  function checkAnswer() {
    const val = parseInt(answerInput.value, 10);
    if (isNaN(val)) { answerInput.focus(); return; }

    cancelFlash(); // reveal dots for feedback

    const responseMs = Date.now() - problemStartMs;
    const correct = val === currentProblem.answer;
    adjustDifficulty(correct);
    recordToServer(correct, responseMs);

    if (correct) {
      responseTimes.push(responseMs);
      updateSpeedBadge();
      score++;
      streak++;
      updateScore();

      // Speed feedback layered onto success splash
      let speedLabel = '';
      if (responseMs < 1500) speedLabel = 'Lightning!';
      else if (responseMs < 3000) speedLabel = 'Quick!';

      if (streak >= 3) {
        successSub.textContent = `${streak} in a row!` + (speedLabel ? ' ' + speedLabel : '');
        try { if (window.SoundFX) window.SoundFX.play('streak', streak); } catch(_){}
      } else {
        successSub.textContent = speedLabel || 'Nice number sense!';
        try { if (window.SoundFX) window.SoundFX.play('success'); } catch(_){}
      }
      flash(splashSuccess, 1000);
      if (score >= GOAL) {
        setTimeout(() => {
          showVictoryStats();
          victory.classList.add('show');
          try { if (window.SoundFX) window.SoundFX.play('win'); } catch(_){}
        }, 1100);
        return;
      }
      setTimeout(nextProblem, 1100);
    } else {
      streak = 0;
      failSub.textContent = `The answer was ${currentProblem.answer}`;
      try { if (window.SoundFX) window.SoundFX.play('fail'); } catch(_){}
      flash(splashFail, 1500);
      showHint();
      setTimeout(nextProblem, 1600);
    }
  }

  function showHint() {
    const p = currentProblem;
    const sym = OP_SYMBOLS[p.op];
    hintText.textContent = `${p.a} ${sym} ${p.b} = ${p.answer}`;
    hintArea.hidden = false;
  }

  function skip() {
    cancelFlash();
    try { if (window.SoundFX) window.SoundFX.play('skip'); } catch(_){}
    if (challengeDifficulty >= 2) {
      adjustDifficulty(false);
      recordToServer(false);
    }
    nextProblem();
  }

  function showVictoryStats() {
    if (!victoryStatsEl || responseTimes.length === 0) return;
    const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const fastest = Math.min.apply(null, responseTimes);
    let badge = 'Steady';
    if (avg < 2000) badge = '⚡ Lightning';
    else if (avg < 3000) badge = '\u{1F3C3} Quick';
    victoryStatsEl.innerHTML =
      '<p class="victory-stat">Avg: <strong>' + (avg / 1000).toFixed(1) + 's</strong></p>' +
      '<p class="victory-stat">Fastest: <strong>' + (fastest / 1000).toFixed(1) + 's</strong></p>' +
      '<p class="victory-stat speed-tier-' + (avg < 2000 ? 'lightning' : avg < 3000 ? 'quick' : 'steady') + '">' + badge + '</p>';
  }

  // Events
  submitBtn.addEventListener('click', checkAnswer);
  answerInput.addEventListener('keydown', e => { if (e.key === 'Enter') checkAnswer(); });
  skipBtn.addEventListener('click', skip);

  document.getElementById('victoryAgain').addEventListener('click', () => {
    victory.classList.remove('show');
    score = 0;
    responseTimes = [];
    if (speedBadgeEl) { speedBadgeEl.hidden = true; }
    updateScore();
    nextProblem();
  });
  document.getElementById('victoryClose').addEventListener('click', () => {
    victory.classList.remove('show');
  });

  // Resize
  window.addEventListener('resize', () => { if (currentProblem) renderProblem(currentProblem); });

  // Init
  if (window.AdaptiveDifficulty) {
    const saved = window.AdaptiveDifficulty.getLevel(ADAPTIVE_MODE_KEY);
    challengeDifficulty = saved;
    window.AdaptiveDifficulty.updateBadges(saved);
  }
  nextProblem();
})();
