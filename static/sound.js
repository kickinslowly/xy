(function () {
  'use strict';

  var ctx = null;
  var enabled = true;
  var volume = 0.35;
  var initialized = false;

  var STORAGE_KEY = 'sound_enabled';

  function getCtx() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return null; }
    return ctx;
  }

  function ensureResumed() {
    var c = getCtx();
    if (c && c.state === 'suspended') c.resume().catch(function(){});
    return c;
  }

  function initOnInteraction() {
    if (initialized) return;
    initialized = true;
    ensureResumed();
  }

  document.addEventListener('click', initOnInteraction, { once: false, capture: true });
  document.addEventListener('keydown', initOnInteraction, { once: false, capture: true });
  document.addEventListener('touchstart', initOnInteraction, { once: false, capture: true });

  // Load preference
  try {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'false') enabled = false;
  } catch (e) {}

  function masterGain() {
    var c = ensureResumed();
    if (!c) return null;
    var g = c.createGain();
    g.gain.value = volume;
    g.connect(c.destination);
    return g;
  }

  function playTone(freq, duration, type, vol, detune) {
    if (!enabled) return;
    var c = ensureResumed();
    if (!c) return;
    var now = c.currentTime;
    var g = c.createGain();
    g.gain.setValueAtTime((vol || 0.3) * volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    g.connect(c.destination);
    var o = c.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, now);
    if (detune) o.detune.setValueAtTime(detune, now);
    o.connect(g);
    o.start(now);
    o.stop(now + duration);
  }

  function playNoise(duration, vol, filterFreq) {
    if (!enabled) return;
    var c = ensureResumed();
    if (!c) return;
    var now = c.currentTime;
    var bufferSize = Math.floor(c.sampleRate * duration);
    var buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource();
    src.buffer = buffer;
    var filt = c.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = filterFreq || 800;
    filt.Q.value = 1.5;
    var g = c.createGain();
    g.gain.setValueAtTime((vol || 0.15) * volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(filt);
    filt.connect(g);
    g.connect(c.destination);
    src.start(now);
    src.stop(now + duration);
  }

  // ---- Sound Effects ----

  var sounds = {};

  // Bright success chime — ascending major arpeggio with bell harmonics
  sounds.success = function () {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    var notes = [523.25, 659.25, 783.99, 1046.50]; // C5 E5 G5 C6
    notes.forEach(function (freq, i) {
      var t = now + i * 0.07;
      var g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25 * volume, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      g.connect(c.destination);

      var o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.5);

      // Harmonic overtone for bell quality
      var g2 = c.createGain();
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(0.08 * volume, t + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      g2.connect(c.destination);
      var o2 = c.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(freq * 3, t);
      o2.connect(g2);
      o2.start(t);
      o2.stop(t + 0.35);
    });
  };

  // Gentle fail — descending minor second with soft buzz
  sounds.fail = function () {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    var g = c.createGain();
    g.gain.setValueAtTime(0.2 * volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    g.connect(c.destination);
    var o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(330, now);
    o.frequency.linearRampToValueAtTime(220, now + 0.35);
    o.connect(g);
    o.start(now);
    o.stop(now + 0.45);

    var g2 = c.createGain();
    g2.gain.setValueAtTime(0.08 * volume, now + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    g2.connect(c.destination);
    var o2 = c.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(165, now + 0.05);
    o2.connect(g2);
    o2.start(now + 0.05);
    o2.stop(now + 0.35);
  };

  // Click — short percussive tap
  sounds.click = function () {
    playNoise(0.04, 0.2, 3000);
    playTone(1200, 0.04, 'sine', 0.15);
  };

  // Coin collect — classic two-tone ascending
  sounds.coin = function () {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    [987.77, 1318.51].forEach(function (freq, i) { // B5, E6
      var t = now + i * 0.08;
      var g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22 * volume, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      g.connect(c.destination);
      var o = c.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(freq, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.28);
    });
  };

  // Level up — ascending major scale fanfare
  sounds.levelup = function () {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    var scale = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.50];
    scale.forEach(function (freq, i) {
      var t = now + i * 0.06;
      var g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18 * volume, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      g.connect(c.destination);
      var o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.4);
    });
  };

  // Achievement unlocked — triumphant brass chord
  sounds.achievement = function () {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    // Fanfare: two quick grace notes then sustained major chord
    [392, 440].forEach(function (freq, i) { // G4, A4 grace
      var t = now + i * 0.1;
      var g = c.createGain();
      g.gain.setValueAtTime(0.15 * volume, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      g.connect(c.destination);
      var o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.15);
    });
    // Sustained C major chord
    [523.25, 659.25, 783.99].forEach(function (freq) {
      var t = now + 0.2;
      var g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2 * volume, t + 0.02);
      g.gain.setValueAtTime(0.2 * volume, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      g.connect(c.destination);
      var o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, t);
      o.connect(g);

      var filt = c.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(2000, t);
      o.disconnect();
      o.connect(filt);
      filt.connect(g);
      o.start(t);
      o.stop(t + 1.1);
    });
  };

  // Turn change — attention chime (two quick bell tones)
  sounds.turn = function () {
    playTone(880, 0.12, 'sine', 0.2);
    setTimeout(function () { playTone(1100, 0.15, 'sine', 0.25); }, 100);
  };

  // Collect / pickup — sparkly ascending sweep
  sounds.collect = function () {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    var g = c.createGain();
    g.gain.setValueAtTime(0.2 * volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    g.connect(c.destination);
    var o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(600, now);
    o.frequency.exponentialRampToValueAtTime(1800, now + 0.15);
    o.connect(g);
    o.start(now);
    o.stop(now + 0.25);
    playNoise(0.06, 0.08, 6000);
  };

  // Jump — quick rising sweep
  sounds.jump = function () {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    var g = c.createGain();
    g.gain.setValueAtTime(0.15 * volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    g.connect(c.destination);
    var o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(280, now);
    o.frequency.exponentialRampToValueAtTime(560, now + 0.08);
    o.connect(g);
    o.start(now);
    o.stop(now + 0.15);
  };

  // Ship sunk — dramatic descending horn
  sounds.sunk = function () {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    var g = c.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.25 * volume, now + 0.05);
    g.gain.setValueAtTime(0.25 * volume, now + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    g.connect(c.destination);
    var o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, now);
    o.frequency.linearRampToValueAtTime(220, now + 0.6);
    var filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1200, now);
    filt.frequency.linearRampToValueAtTime(400, now + 0.6);
    o.connect(filt);
    filt.connect(g);
    o.start(now);
    o.stop(now + 0.85);
  };

  // Fire / shot — percussive pop
  sounds.fire = function () {
    playNoise(0.08, 0.25, 1500);
    playTone(200, 0.06, 'sine', 0.2);
  };

  // Hit — impact thud
  sounds.hit = function () {
    playNoise(0.1, 0.2, 600);
    playTone(150, 0.1, 'triangle', 0.15);
  };

  // Miss — water splash (filtered noise)
  sounds.miss = function () {
    playNoise(0.15, 0.12, 2500);
  };

  // Win — victory fanfare with harmonic richness
  sounds.win = function () {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    var melody = [
      { f: 523.25, t: 0, d: 0.15 },    // C5
      { f: 659.25, t: 0.12, d: 0.15 },  // E5
      { f: 783.99, t: 0.24, d: 0.15 },  // G5
      { f: 1046.50, t: 0.36, d: 0.6 },  // C6 (held)
    ];
    melody.forEach(function (n) {
      var t = now + n.t;
      // Main tone
      var g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22 * volume, t + 0.01);
      g.gain.setValueAtTime(0.22 * volume, t + n.d * 0.7);
      g.gain.exponentialRampToValueAtTime(0.001, t + n.d + 0.2);
      g.connect(c.destination);
      var o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(n.f, t);
      o.connect(g);
      o.start(t);
      o.stop(t + n.d + 0.25);

      // Fifth harmony on the final note
      if (n.t > 0.3) {
        var g2 = c.createGain();
        g2.gain.setValueAtTime(0, t);
        g2.gain.linearRampToValueAtTime(0.12 * volume, t + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.001, t + n.d + 0.15);
        g2.connect(c.destination);
        var o2 = c.createOscillator();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(n.f * 0.75, t); // Fifth below
        o2.connect(g2);
        o2.start(t);
        o2.stop(t + n.d + 0.2);
      }
    });
  };

  // Lose — sad descending
  sounds.lose = function () {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    [392, 349.23, 329.63, 261.63].forEach(function (freq, i) { // G4 F4 E4 C4
      var t = now + i * 0.2;
      var g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18 * volume, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      g.connect(c.destination);
      var o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.45);
    });
  };

  // Streak — quick ascending sparkle (for 3+ streaks)
  sounds.streak = function (count) {
    var c = ensureResumed();
    if (!c || !enabled) return;
    var now = c.currentTime;
    var base = 800 + Math.min((count || 3) - 3, 7) * 80;
    for (var i = 0; i < 3; i++) {
      var t = now + i * 0.04;
      var g = c.createGain();
      g.gain.setValueAtTime(0.15 * volume, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      g.connect(c.destination);
      var o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base + i * 200, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.18);
    }
  };

  // Skip — short neutral blip
  sounds.skip = function () {
    playTone(600, 0.06, 'triangle', 0.12);
  };

  // Countdown tick
  sounds.tick = function () {
    playTone(1000, 0.03, 'sine', 0.15);
  };

  // ---- Public API ----

  window.SoundFX = {
    play: function (name, arg) {
      if (!enabled) return;
      try { if (sounds[name]) sounds[name](arg); } catch (e) {}
    },
    setEnabled: function (on) {
      enabled = !!on;
      try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch (e) {}
    },
    isEnabled: function () { return enabled; },
    toggle: function () {
      this.setEnabled(!enabled);
      return enabled;
    },
    setVolume: function (v) {
      volume = Math.max(0, Math.min(1, v));
    },
    sounds: sounds
  };
})();
