// Shared adaptive-difficulty engine used by coord plane (main.js) and ratios (ratios_mode.js).
// Tracks per-mode level + consecutive-correct/incorrect streaks, persists per-mode to localStorage
// under the key 'adaptive_difficulty' as { [mode]: { level, posStreak, negStreak } }.
//
// Levels: 0=Beginner, 1=Developing, 2=Proficient, 3=Advanced (default 1).
// Promotion: 3 consecutive corrects -> level up. Demotion: 2 consecutive incorrects -> level down.
// A correct answer always resets the incorrect streak; an incorrect always resets the correct streak.
//
// Exposes window.AdaptiveDifficulty with getLevel/getBadgeText/recordResult/updateBadges.

(function(){
  const STORAGE_KEY = 'adaptive_difficulty';
  const DIFF_LABELS = ['Beginner', 'Developing', 'Proficient', 'Advanced'];
  const DIFF_STARS = ['⭐', '⭐⭐', '⭐⭐⭐', '🌟'];
  const UP_THRESHOLD = 3;
  const DOWN_THRESHOLD = 2;
  const DEFAULT_LEVEL = 1;
  const MAX_LEVEL = 3;
  const MIN_LEVEL = 0;

  function clampLevel(v){
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return DEFAULT_LEVEL;
    return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, n));
  }

  function loadAll(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }
  function saveAll(data){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function getState(mode){
    const all = loadAll();
    const s = all[mode];
    if (!s || typeof s !== 'object') return { level: DEFAULT_LEVEL, posStreak: 0, negStreak: 0 };
    return {
      level: clampLevel(s.level),
      posStreak: Math.max(0, s.posStreak | 0),
      negStreak: Math.max(0, s.negStreak | 0),
    };
  }
  function setState(mode, state){
    const all = loadAll();
    all[mode] = state;
    saveAll(all);
  }

  function recordResult(mode, correct){
    const s = getState(mode);
    const prevLevel = s.level;
    if (correct) {
      s.posStreak += 1;
      s.negStreak = 0;
      if (s.posStreak >= UP_THRESHOLD && s.level < MAX_LEVEL) {
        s.level++;
        s.posStreak = 0;
      }
    } else {
      s.negStreak += 1;
      s.posStreak = 0;
      if (s.negStreak >= DOWN_THRESHOLD && s.level > MIN_LEVEL) {
        s.level--;
        s.negStreak = 0;
      }
    }
    setState(mode, s);
    return {
      level: s.level,
      levelChanged: s.level !== prevLevel,
      increased: s.level > prevLevel,
    };
  }

  function getLevel(mode){ return getState(mode).level; }
  function getLabel(level){ return DIFF_LABELS[clampLevel(level)]; }
  function getStars(level){ return DIFF_STARS[clampLevel(level)]; }
  function getBadgeText(level){ return getStars(level) + ' ' + getLabel(level); }

  function updateBadges(level){
    const lv = clampLevel(level);
    const txt = getBadgeText(lv);
    document.querySelectorAll('.difficulty-badge').forEach(function(el){
      el.textContent = txt;
      el.dataset.level = String(lv);
    });
  }

  window.AdaptiveDifficulty = {
    getLevel: getLevel,
    getLabel: getLabel,
    getStars: getStars,
    getBadgeText: getBadgeText,
    recordResult: recordResult,
    updateBadges: updateBadges,
    LABELS: DIFF_LABELS.slice(),
    LEVELS: { BEGINNER: 0, DEVELOPING: 1, PROFICIENT: 2, ADVANCED: 3 },
  };
})();
