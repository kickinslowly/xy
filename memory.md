# Memory - Session Continuity Log

## Current State

### Last Action
- **Date**: 2026-05-26
- **Action**: Sessions 12-14 marathon. Built subitize mode, ran 7-agent product audit, executed Phases 1-4 of development plan. Key deliverables: sound system (15 effects), Line Detective challenges, Battleship ship placement, coord plane touch support, ratios unit rates + tables, subitize flash + ten-frame, Meme Dash math gates + touch controls + coyote time, dark-mode canvases, PWA manifest, onboarding welcome banner, mobile nav fix, reduced-motion a11y, pre-loaded datasets, achievement toast.
- **Status**: 7 game modes live. 11 critical bugs fixed. All modes have sound, standards, adaptive difficulty. Ratios has 7 challenge types. Line Graph has 3 challenge types. Phase 5 (teacher dashboard, backend blueprints, inline CSS extraction) remains.

### What Exists
- Full Flask app with 6 game modes + dashboard + shop + arcade lobby home page
- **Standards system** - 24 Common Core standards (grades 5-8) seeded in skills table, mapped to challenges
- **Mastery tracking** - Bayesian-inspired updates on every game result, per-student per-standard
- **XP/Level system** - computed from game_results, displayed on home + dashboard
- **Coins currency** - earned from gameplay (5 base + 10 win + score bonus), stored on User model
- **Shop system** - 22 items across 3 categories (titles, board themes, avatar frames), 4 rarity tiers
- **Streak system** - consecutive day tracking with fire animation
- **Daily goal** - 5 games/day target with ring progress indicator
- **Leaderboard** - global top XP earners with medals, custom titles, avatar frames
- **Daily Quests** - 3 rotating quests per day from 13 templates, deterministic via SHA-256
- **Coin toast** - animated notification on every game completion showing coins earned
- **Standards toast** - notification showing what skill was practiced after each game
- **User display_name** - stored in DB from Google auth for leaderboard
- Real-time multiplayer via Socket.IO
- Google OAuth authentication
- Achievement system (milestone-based)
- Unified CSS: theme.css (design tokens) + game.css (all game modes, dark theme) — style.css retired
- **Adaptive difficulty** - 4-level system for coordinate plane + ratios challenges, streak-based progression
- **Challenge bar** - always-visible CTA between toolbar and canvas (replaced buried details panel)
- PostgreSQL production deploy on Render

### Project Assessment (Post-Session 7)
| Goal | Status | Notes |
|------|--------|-------|
| G1 Standards | **v1 COMPLETE** | 24 standards seeded, challenge mapping, dashboard + home UI |
| G2 Mastery | **v2 COMPLETE** | Bayesian updates + adaptive difficulty for coord plane + ratios |
| G3 Gamification | **v2 COMPLETE** | XP + levels + streaks + goals + leaderboard + quests + shop/cosmetics |
| G4 UI/UX | **COMPLETE** | Home page, nav, unified game.css, per-mode UX redesign all done |
| G5 Content | **v1 PROGRESS** | 6 challenge types for coord plane (vertex, line, quadrant, reflect, midpoint, twopoints) |
| G6 Teacher | Unchanged | Class system exists |
| G7 Multiplayer | Unchanged | Working |

### Known Issues / Tech Debt
1. ~~Two competing CSS systems~~ **RESOLVED Session 3**
2. ~~Inline style blocks in game templates~~ **RESOLVED Session 3**
3. ~~XP computed on every dashboard/leaderboard load~~ **RESOLVED Session 9** (User.total_xp denormalized + 60s leaderboard cache)
4. No dark mode toggle yet
5. Coordinate plane still uses its own header/toolbar (not base.html nav) — **G8 backlog** (also stacks two headers)
6. ~~Leaderboard computes XP for ALL users on each request~~ **RESOLVED Session 9** (60s in-memory cache; eager-invalidated on record_result)
7. `best_streak` not tracked historically — **G8 backlog**
8. ~~Board themes purchased but not yet visually applied~~ **RESOLVED Session 5** (CSS vars on :root)
9. Shop items don't include meme-image-based cosmetics yet (just emoji icons)
10. Standards not yet fully tagged in client-side JS — **partial Session 8** (Meme Dash now sends details_json; remaining: outcome contract canonicalization)
11. Teacher dashboard doesn't show per-student standards mastery heatmap yet (G6 future)
12. ~~No adaptive difficulty based on mastery yet~~ **RESOLVED Session 7** (coord plane + ratios, session-based)
13. ~~MasterySnapshot.id uses db.BigInteger not BigInt~~ **RESOLVED Session 8** (cross-DB BigInt, no manual ID assignment)
14. ~~static/style.css orphan (417 LOC)~~ **RESOLVED Session 8** (deleted)
15. ~~Battleship lobby DOM missing — 2-player blocked~~ **RESOLVED Session 8**
16. ~~`/api/results` forgeable (no validation, no rate limit)~~ **RESOLVED Session 8** (validation + 1.5s rate limit + score clamp + 16KB details cap)
17. ~~Default `SECRET_KEY='dev-insecure'` shippable~~ **RESOLVED Session 8** (hard-fail in prod via RENDER env)
18. ~~`cors_allowed_origins='*'`~~ **RESOLVED Session 8** (ALLOWED_ORIGINS env-driven)
19. ~~Shop double-spend race~~ **RESOLVED Session 8** (atomic UPDATE WHERE coins>=price)
20. ~~Line Mode PDF export silently zeroed negative Y~~ **RESOLVED Session 8**
21. ~~Meme Wars echo guard missing — silent state corruption~~ **RESOLVED Session 8**
22. ~~Ratios partwhole rejected mathematically equivalent answers~~ **RESOLVED Session 8**
23. ~~Skill.standard_code not unique — race-creates duplicates~~ **RESOLVED Session 8** (unique=True + idempotent per-code seeding + cache invalidation)
24. ~~clearAllSilently broadcasts during wrong-answer reveal~~ **RESOLVED Session 8** (3s peer flicker eliminated)
25. ~~Coord plane challenges generate unreachable coords when gridStep≠1~~ **RESOLVED Session 8** (forces step=1 on challenge start)
26. ~~Stored-XSS sink in home.html leaderboard display_name rendering~~ **RESOLVED Session 8** (escapeHtml + safe color regex)
27. ~~Meme Dash never sent details_json (mastery never updated)~~ **RESOLVED Session 8**
28. ~~memedash_win trusted from any client~~ **PARTIAL Session 8** (sender-in-room + 5s cooldown + score clamp; full owner-authority is G8)
29. Multiplayer is client-authoritative everywhere despite docs (hit/miss, win, ship placement all forgeable) — **G8 backlog** (high-effort architectural fix)
30. Meme Dash: no ceiling/wall collision, win resets ALL players, owner-failover races — **G8 backlog**
31. ~~Adaptive difficulty: streak math evaporates progress on alternation; no localStorage persistence~~ **RESOLVED Session 9** (extracted to static/adaptive_difficulty.js with posStreak/negStreak; persists to localStorage)
32. Migrations out of sync with models (try/except ALTER TABLE shim covers User.coins/display_name and now total_xp; rest still drift) — **G8 backlog**
33. ~~Three competing modal CSS systems, no focus-trap, no aria-live on toasts~~ **PARTIAL Session 9** — focus-trap + Escape + return-focus controller in base.html; toasts have role=status aria-live=polite + reduced-motion guard. CSS-system consolidation still pending.
34. ~70% duplicate logic between battleship.js and meme_wars.js — **G8 backlog**
35. main.js is a 4129-LOC IIFE; app.py is a 1868-LOC monolith — **G8 backlog**
36. Outcome contract: was inconsistent across modes; **Session 9 documented** the two-vocabulary system in app.py and fixed Meme Dash 'loss' typo + missing details_json on offline-fallback path
37. Line Mode (line_mode.js) never calls recordResult — plays don't record at all (NEW finding Session 9) — **G8 backlog**

### Next Steps (Priority Order)
1. ~~**G4**: Unify game mode styling~~ **DONE Session 3**
2. ~~**G3**: Unlockables / cosmetics~~ **DONE Session 5**
3. ~~**G3**: Wire board themes~~ **DONE Session 5**
4. ~~**G1**: Standards DB + tagging~~ **DONE Session 6**
5. ~~**G2**: Bayesian mastery tracking~~ **DONE Session 6**
6. ~~**G4**: Challenge bar UI rework~~ **DONE Session 7**
7. ~~**G2**: Adaptive difficulty~~ **DONE Session 7** (coord plane + ratios)
8. ~~**G8**: Top-15 audit punch list~~ **DONE Session 8**
9. ~~**G8**: Outcome string contract canonicalization~~ **DONE Session 9** (documented; typo fixed)
10. ~~**G8**: Perf — denormalize total_xp + leaderboard cache + dashboard GROUP BY~~ **DONE Session 9**
11. ~~**G8**: Adaptive difficulty fixes (streak math + localStorage persistence + shared helper)~~ **DONE Session 9**
12. ~~**G8**: Modal focus-trap controller~~ **DONE Session 9** (covers QR + shop modals)
13. ~~**G8**: Coord plane / ratios / battleship-family content polish~~ **DONE Session 10** (11 fixes)
14. ~~**G8**: Meme Dash physics fixes~~ **DONE Session 11** (substep, ceiling, tab-blur, win-resets-loser, power-up leak)
15. ~~**G8**: Ratios touch-event fallback~~ **DONE Session 11**
16. ~~**G8**: Battleship/Meme Wars turn-lock seq + opponent-disconnect UI~~ **DONE Session 11**
17. **G8**: Line Mode recordResult plumbing (needs design decision on what triggers "completion")
18. **G8**: Meme Dash magnet-through-platforms (still pending; physics substep doesn't fix this)
19. **G8**: Multiplayer owner-authority (term/epoch counter, server-side adjudication for hits/wins) — biggest remaining architectural
20. **G8**: Generate Alembic migration to sync schema
21. **G8**: prefers-reduced-motion sweep across game.css infinite animations
22. **G2**: Fetch initial difficulty from server-side mastery
23. **G6**: Teacher standards heatmap
24. **G5**: Add new challenge types to existing modes

---

## Session History

### Session 1 - 2026-02-14
- **Goal**: Project onboarding, first G4/G3 improvements
- **Emotion Flow**: Curiosity -> Excitement -> Deep Build -> Satisfaction -> Consolidation -> Jealousy -> Deep Build -> Satisfaction -> Consolidation
- **Work Done**:
  - Full codebase exploration and documentation
  - Fixed style.css duplication
  - Built arcade lobby home page (7 game cards, responsive, animated)
  - Restructured routing (/ = home, /plane = coordinate plane)
  - Redesigned global navigation (mobile hamburger, cleaner links)
  - Extracted shared image helper in app.py
  - Added per-mode stats to home page cards
  - Built complete XP/level system (computed from game_results)
  - Added XP display to home page (progress bar in hero)
  - Added XP banner to dashboard page
  - Dynamic footer year
- **Files Changed**: app.py, style.css, theme.css, base.html, dashboard.html
- **Files Created**: home.html, CLAUDE.md, goals.md, skills.md, memory.md
- **Tests**: All routes verified rendering 200 OK. XP formula tested.
- **Outcome**: Ship-ready home page + XP system. Major G4 + G3 progress.

### Session 2 - 2026-02-14
- **Goal**: Continue G3 gamification — streaks, daily goals, leaderboard
- **Emotion Flow**: Jealousy (Duolingo streaks) -> Competitive Refinement -> Deep Build -> Satisfaction
- **Work Done**:
  - Built `compute_streak_and_daily(user_id)` — consecutive day streak from game_results
  - Added streak fire animation + daily goal ring to home page hero
  - Added streak + daily goal to dashboard XP banner
  - Added `display_name` column to User model with auto-migration
  - Persisted Google auth `given_name` as display_name
  - Built `/api/leaderboard` endpoint — top XP earners with rank, level, title, streak
  - Added leaderboard section to home page — medals for top 3, "is-me" highlight, streak badges
  - Leaderboard shows "You are #X of Y" if user is outside top 10
  - Mobile responsive (hides level pill on small screens)
  - Built daily quest system — 13 quest templates, 3 per day via SHA-256 seed
  - Quest types: play_mode, win_mode, play_modes (variety), total_games
  - Quest progress computed from today's game_results
  - Quest UI: card row between hero and game cards, progress bars, checkmarks
  - Quest data included in `/api/dashboard` response
  - 14 unique quest combos verified over 14 days
- **Files Changed**: app.py, templates/home.html, templates/dashboard.html
- **Tests**: All routes 200 OK. Leaderboard API correct shape. display_name column verified. Quest rotation verified.
- **Outcome**: Full G3 gamification suite live — XP, levels, streaks, daily goals, leaderboard, daily quests.

### Session 3 - 2026-02-14
- **Goal**: G4 UX modernization — unify styling, eliminate dual CSS, modernize all 6 game mode templates
- **Emotion Flow**: Curiosity (competitor research) -> Jealousy (Duolingo/Kahoot polish) -> Deep Build -> Satisfaction
- **Work Done**:
  - Deep research: analyzed 13 competitors (Duolingo, Kahoot, Blooket, Desmos, IXL, etc.) for UX patterns
  - Codebase audit: identified 8 critical issues (dual CSS, inline styles, code duplication, etc.)
  - Created `static/css/game.css` (1705 LOC) — unified game mode stylesheet replacing ALL inline styles + old style.css
  - Per-mode accent colors via `--mode` CSS property (6 unique colors)
  - Glass-morphism toolbar, 3D Duolingo-style buttons, shared layout grid
  - Created `templates/_qr_modal.html` — extracted QR modal from 6 copy-pasted instances
  - Rewrote all 6 game templates: battleship (336→181), meme_wars (287→186), ratios (236→105), meme_dash (127→73), line_mode (170→132), index/plane (246→229)
  - Eliminated 600+ lines of duplicated inline CSS
  - Fixed Jinja2 infinite recursion bug ({% include %} inside HTML comments is still executed!)
- **Files Created**: static/css/game.css, templates/_qr_modal.html
- **Files Changed**: templates/battleship.html, meme_wars.html, ratios.html, meme_dash.html, line_mode.html, index.html
- **Tests**: All 7 routes verified 200 OK. Body classes, game.css loading, QR modal inclusion all verified.
- **Outcome**: Unified dark theme across all game modes. style.css no longer loaded anywhere. Major G4 milestone.

### Session 4 - 2026-02-14
- **Goal**: Per-mode UX redesign (G4-M) — redesign every game mode layout for classroom readability
- **Work Done**:
  - **Ratios** (completed prev session): mode-pill buttons, score progress bar, larger meme palette/placed items
  - **Battleship + Meme Wars** (completed prev session): click-to-fire enabled, larger fire controls, stat cards, removed noobMode
  - **Line Graph**: 3-column toolbar (Add Series | Axes & Legend collapsed | Session), empty state hint, row numbers in data tables, bigger cell inputs (15px font), del-row as × button, line-info-card with accent border, `updateEmptyHint()` wired to all series add/remove/undo
  - **Coordinate Plane**: 3-column toolbar (Settings gear with View+Session | Draw tools | Challenge), bigger action buttons with action-btn/action-btn-half classes, challenge-summary accent styling, vertex-tools section, line-info-card reuse, group-label uppercase headers
  - **Meme Dash**: 2-zone toolbar (Terminator | Session), larger scoreboard (32px meme icons, 16px count), larger powerup pill with ⚡ icon, dismissible instructions with localStorage persistence
  - game.css grew from 1705 to 2322 LOC with new shared utilities (.btn-sm, .btn-icon, .lbl-sm, .input-med, .input-xs, .empty-hint, .line-info-card)
- **Files Changed**: templates/line_mode.html, index.html, meme_dash.html; static/line_mode.js; static/css/game.css
- **Tests**: All 7 routes 200 OK. CSS balanced (506 braces). All 23 new CSS classes verified present.
- **Outcome**: G4-M complete. All 6 game modes redesigned with progressive disclosure, larger text/buttons, better empty states.

### Session 5 - 2026-02-15
- **Goal**: G3 Unlockables — Shop & Cosmetics system
- **Emotion Flow**: Jealousy (Blooket's collectibles) -> Competitive Refinement -> Deep Build -> Satisfaction -> Consolidation
- **Work Done**:
  - Added `coins` column to User model with auto-migration
  - Created `ShopItem` model (code, name, description, category, rarity, price, icon, data_json)
  - Created `UserItem` model (user_id, item_id, equipped, acquired_at)
  - Coin economy: 5 base + 10 success bonus + score-based (0.5x) per game
  - Seeded 22 shop items: 10 titles, 7 board themes, 5 avatar frames across 4 rarity tiers
  - Built `/api/shop` (browse), `/api/shop/buy` (purchase), `/api/shop/equip` (equip/unequip) endpoints
  - Added coins + equipped items to `/api/dashboard` response
  - Custom equipped titles shown on leaderboard (overrides level-based title)
  - Avatar frame data sent in leaderboard API (border-left + glow on rows)
  - Built shop.html: tab filtering, rarity-colored cards, purchase modal, equip toggle
  - Added coin balance card to home page player stats
  - Added shop card to arcade grid
  - Added Shop link to nav in base.html
  - Added coin toast notification (animated slide-in) on every game completion
  - Rarity tiers: common (50-100), rare (200-300), epic (800-1000), legendary (2000-3000)
- **Files Created**: templates/shop.html
- **Files Changed**: app.py, templates/base.html, templates/home.html
- **Tests**: All 9 routes 200 OK. Full buy/equip/unequip flow tested. Double-buy and insufficient coins errors verified.
- **Outcome**: Complete shop & cosmetics system. Students earn coins from games, spend on titles/themes/frames.

### Session 6 - 2026-02-15
- **Goal**: G1 Standards Alignment + G2 Mastery Tracking
- **Emotion Flow**: Curiosity (unexplored territory) -> Excitement (clear plan) -> Deep Build -> Satisfaction -> Consolidation
- **Work Done**:
  - Defined STANDARDS_CATALOG: 24 Common Core standards spanning 5 domains across grades 5-8
  - Domains covered: Geometry (8), Ratios & Proportional Relationships (8), The Number System (2), Expressions & Equations (2), Functions (4)
  - Built `ensure_standards_seed()` to populate skills table idempotently
  - Created CHALLENGE_STANDARD_MAP: 14 entries mapping (mode, challenge_type) to standard codes
  - Built `resolve_standards_for_result()` with fallback logic (ratio_mode > challenge_type > mode)
  - Built `update_mastery_for_result()` — Bayesian-inspired mastery updates per standard
  - Mastery params: learn_rate=0.15, slip_rate=0.10, prior=0.3, se decreases with evidence
  - Wired into `record_result()` — every game completion now updates mastery snapshots
  - Added `standards` and `strands` to `/api/dashboard` response
  - Dashboard UI: standards mastery card with strand summary cards, collapsible individual standards list
  - Strand cards show icon, attempted/total skills count, mastery bar, percentage
  - Individual standards grouped by grade with color-coded mastery bars (green >70%, amber >40%)
  - Home page: skills progress card in player stats row (X/24 skills explored, mini progress bar)
  - Standards toast in base.html: shows skill name after each game completion (slides in after coin toast)
  - Added standards_practiced to record_result API response
  - Fixed MasterySnapshot SQLite autoincrement issue (explicit ID assignment + no_autoflush block)
- **Files Changed**: app.py, templates/dashboard.html, templates/home.html, templates/base.html
- **Tests**: 9 routes 200 OK. Standards seed (24). Challenge mapping (14 entries). Mastery update flow (correct/incorrect). Dashboard API returns standards+strands. All HTML elements verified present.
- **Outcome**: Complete standards alignment + mastery tracking. Every game result now maps to Common Core standards and updates per-student mastery.

### Session 7 - 2026-02-15
- **Goal**: G4 Challenge Bar UX + G2 Adaptive Difficulty + G5 New Challenge Types
- **Emotion Flow**: (User request) -> Deep Build -> Satisfaction -> Excitement -> Deep Build -> Excitement -> Deep Build -> Consolidation
- **Work Done**:
  - **Challenge Bar Rework** (user-requested): Pulled coordinate plane challenge out of buried `<details>` panel into always-visible challenge bar between toolbar and canvas
  - Challenge bar: idle state (two large CTA buttons with icons) → active state (type badge + difficulty badge + prompt + skip/end)
  - Removed `.plane-toolbar-right`, changed toolbar from 3 to 2 columns
  - **Adaptive Difficulty System**: 4-level progression (Beginner/Developing/Proficient/Advanced)
  - Streak-based: 3 correct → level up, 2 incorrect → level down
  - Coord plane vertex: Q1 only → all quadrants → wider → full range + axis points
  - Coord plane line: positive slopes → integer slopes → some fractions → frequent fractions
  - Ratios: numbers 1-3 → 1-5 → 1-8 → 2-12
  - Difficulty badge (color-coded), pulse animation on level change
  - **4 New Challenge Types** for coordinate plane (G5):
    - **Quadrant**: "Plot any point in Quadrant II" — region validation (x<0, y>0)
    - **Reflection**: "Reflect (3, 2) over the y-axis" — generates reflected target coordinate
    - **Midpoint**: "Plot the midpoint of (2, 4) and (6, 8)" — generates integer midpoints via offset method
    - **Two-Point Line**: "Graph the line through (1, 2) and (3, 6)" — generates two integer points, student finds slope/intercept
  - Pooled challenge selectors: pickVertexChallenge() randomly mixes vertex/quadrant/reflect/midpoint, pickLineChallenge() mixes equation/twopoints
  - Per-subtype UI: badge labels (VERTEX/QUADRANT/REFLECT/MIDPOINT/LINE/TWO POINTS), prompt text, game names
  - **Standards mapping** added for new types in CHALLENGE_STANDARD_MAP (4 new entries)
  - All recordResult calls include subtype-aware challenge_type + difficulty for analytics
- **Files Changed**: templates/index.html, templates/ratios.html, static/main.js, static/ratios_mode.js, static/css/game.css, app.py
- **Tests**: All 9 routes 200 OK. CSS balanced (536 braces). JS syntax valid. All 10 new functions verified. 4 new CHALLENGE_STANDARD_MAP entries verified.
- **Outcome**: Coordinate plane now has 6 challenge types (up from 2), adaptive difficulty across 2 modes, and impossible-to-miss challenge bar UI.

### Session 8 - 2026-04-29
- **Goal**: Full audit of buggy student experiences + first round of fixes
- **Method**: Spun up 5 parallel audit agents (backend, coord plane + line, battleship family, meme dash + ratios, frontend shell + CSS); ~8000 LOC reviewed; ~140 findings (25 critical, 50 high, 50 medium, 15 low); synthesized into AUDIT.md punch list
- **Top-15 punch list — all shipped**:
  - **Tier 1 — deploy/security**: deleted orphan style.css (417 LOC); added `'line'` to dashboard order; SECRET_KEY hard-fail in prod (RENDER env); CORS lockdown via ALLOWED_ORIGINS env
  - **Tier 2 — single-line correctness**: removed negative-Y PDF clamp; added meme_wars echo guard; Skill.standard_code unique=True + idempotent per-code seed + cache invalidation; escapeHtml leaderboard rendering (closes XSS sink); Meme Dash now sends details_json (mastery actually updates); Ratios partwhole accepts equivalent ratios
  - **Tier 3 — small targeted**: atomic UPDATE for shop coin decrement (no double-spend); clearAllSilently no longer broadcasts (no peer flicker on wrong-answer); challenge mode forces gridStep=1 (challenges always reachable on snap grid)
  - **Tier 4 — bigger**: restored Battleship lobby DOM (joinA/joinB/teamAList/teamBList/countA/countB) — 2-player works again; /api/results validation pipeline (mode whitelist + outcome canonical set + per-mode score cap + finiteness check + 16KB details cap + 1.5s rate limit); memedash_win sender-in-room check + 5s per-room cooldown + score clamp + length caps
  - **Tier 5 — additional CRIT**: MasterySnapshot.id now uses cross-DB BigInt with proper autoincrement; removed manual max+1 race; integrity-error retry on concurrent (user, skill) inserts
- **Discovered work logged under new G8** (Stability, Security & Performance) — see goals.md for backlog: leaderboard caching, denormalized total_xp, multiplayer term/epoch counter, schema migration sync, modal focus-trap controller, accessibility fixes, code-splitting CSS, extracting shared engines (grid_battle.js, math_utils.js), monolith splits (app.py, main.js)
- **Files Changed**: app.py (+~150 LOC validation/security/MasterySnapshot/Skill), static/main.js (clearAllSilently + setChallengeActive gridStep guard), static/line_mode.js (PDF clamp), static/meme_wars.js (echo guard), static/meme_dash.js (details_json), static/ratios_mode.js (partwhole equiv), templates/dashboard.html (line key), templates/home.html (escapeHtml + safe color regex), templates/battleship.html (lobby DOM)
- **Files Created**: AUDIT.md (full audit report ~340 LOC), WORKSTYLE.md (replaces emotions.md), FEATURES.md (authoritative inventory)
- **Files Deleted**: static/style.css (417 LOC orphan)
- **Tests**: app.py AST parse OK; all edited JS files `node --check` OK; app.py boot test 20 routes registered; dev mode (no env) ephemeral key; prod-sim (RENDER=true) ALLOWED_ORIGINS warning fires
- **Not yet done**: User browser smoke-test before next round; Tier 6 (perf/cache, schema migration, multiplayer authority) blocked on smoke confirmation

### Session 9 - 2026-04-29
- **Goal**: G8 second wave — outcome contract, adaptive difficulty refactor, perf, frontend a11y
- **Work Done**:
  - **Outcome contract canonicalization**: doc-comment block in `app.py` formalizes the two-vocabulary system (success/incorrect for skill challenges, win/lose for multiplayer game outcomes); fixed `'loss'` typo → `'lose'` in Meme Dash offline-fallback path (line 1236) and added details_json to that path so it records mastery
  - **Adaptive difficulty refactor**: created `static/adaptive_difficulty.js` (~110 LOC shared helper) using `posStreak`/`negStreak` semantics — eliminates the `Math.max(0,x)+1` evaporation bug; persists per-mode level to localStorage under `adaptive_difficulty` key. Replaced ~70 LOC duplicated in main.js + ratios_mode.js. Templates index.html and ratios.html now load helper before mode JS.
  - **Backend perf — total_xp denormalization**: added `User.total_xp` column with auto-shim ALTER TABLE; `compute_xp_earned()` extracted as canonical helper; `compute_xp_and_level()` reads denormalized total_xp first and backfills from full scan only when NULL; `record_result` increments total_xp inline (kills the full-table-scan-per-dashboard-load).
  - **Backend perf — leaderboard cache**: 60s in-memory cache `_leaderboard_cache`; `_build_leaderboard_entries` extracted; `record_result` invalidates eagerly on each new play. Was ~1200 queries/request, now amortized to one full compute per minute.
  - **Backend perf — dashboard GROUP BY**: `progress_counts` rewritten as a single `GROUP BY mode` query (was 6+ separate COUNTs).
  - **Frontend a11y — modal controller**: shared `MutationObserver`-based controller in base.html watches `.modal[role="dialog"]` `[hidden]` toggles. Adds Escape-to-close, Tab focus-trap, return-focus-to-opener. Single 40-LOC controller covers QR modal, shop modal, and any future modal.
  - **Frontend a11y — toasts**: coin-toast and standards-toast now have `role="status"` + `aria-live="polite"`; rebuilt with safe DOM nodes (no innerHTML for user data); `right: clamp(8px, 4vw, 20px)` + `max-width: calc(100vw - 32px)` for mobile clipping; `@media (prefers-reduced-motion: reduce)` disables slide animations.
  - **Frontend a11y — hamburger**: `aria-controls="mainNav"` on `#navToggle`; decorative bars marked `aria-hidden`.
  - **Frontend a11y — QR modal**: `aria-modal="true"`, `aria-labelledby` (replacing redundant `aria-label`), `tabindex="-1"`, `<img src="">` (eliminates broken-icon flash), Copy-link button next to share-link input.
  - **Frontend a11y — shop modal**: added `class="modal"`, `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `tabindex="-1"` so the controller picks it up; modal status message gets `role="status" aria-live="polite"`.
- **Files Changed**: app.py (User.total_xp + auto-shim + compute_xp_earned + compute_xp_and_level rewrite + record_result XP increment + leaderboard cache + GROUP BY); static/main.js + static/ratios_mode.js (use AdaptiveDifficulty helper); static/meme_dash.js (typo + details_json); templates/index.html + templates/ratios.html (load adaptive_difficulty.js); templates/base.html (aria-controls, modal controller, toast aria-live + reduced-motion + mobile clamp); templates/_qr_modal.html (aria-modal + labelledby + img src + copy button); templates/shop.html (modal class + role + aria-modal)
- **Files Created**: static/adaptive_difficulty.js
- **Tests**: app.py AST parse OK; node --check on all edited JS OK; boot test 20 routes
- **Discovered**: line_mode.js never calls recordResult — Line Mode plays don't register at all. Logged in G8.

### Session 10 - 2026-04-30
- **Goal**: G8 polish wave — content-quality fixes across coord plane, ratios, and battleship-family
- **Work Done**:
  - **Coord plane content polish**: pickReflectChallenge gets explicit case-2 range (Proficient ≠ Advanced); pickRandomLine forces m≠0 at Developing+Proficient (no more "y=3" horizontal prompts); toFractionApprox rewritten as smallest-denominator rational approximation (1/3 stays 1/3, not 333333/1000000); formatEquationFromMB passes raw m (skips round2 that was flattening 1/3 → 33/100); afterAddInfiniteLine vertical-line path now shows hint toast ("Vertical lines have undefined slope. Try y = mx + b form.") instead of silent reject — doesn't decrement difficulty; showFailToast/hideFailToast support optional custom message with default-restore semantics
  - **Ratios content polish**: pick2 hardened against null/length<2; generateChallenge requires memes.length≥2; master mode anti-repeat (re-rolls once if same kind would fire twice in a row, tracks _lastMasterKind); equiv enforces a≠b (no degenerate 1:1 prompts); nextChallengeBtn Skip counts as adjustDifficulty(false) at level≥Proficient (kills grind-for-easy-prompt exploit)
  - **Battleship/Meme Wars polish**: bot_ai.js candidatesFromCluster — aligned multi-cell clusters now return ONLY line extensions (was also returning perpendicular neighbors, wasting shots on already-dead ships' sides); cleaned up confusing while...break pseudo-loops; OWNER_TAKEOVER_SEC bumped 0.8s → 2.5s server-side; OWNER_TAKEOVER_MS bumped 800 → 2500 in meme_dash.js (school Wi-Fi jitter no longer triggers spurious takeovers); fireFromInputs in battleship + meme_wars now require Number.isInteger (rejects 1.5/-3.7 with clear message — was silently failing); Meme Wars enemy-stats panel "remaining" now correctly shows enemy's remaining memes (was showing my own) — also fixed spectator A/B swap
- **Files Changed**: static/main.js (toFractionApprox + formatEquationFromMB + pickRandomLine + pickReflectChallenge + afterAddInfiniteLine + showFailToast/hideFailToast), static/ratios_mode.js (pick2 + generateChallenge + nextChallengeBtn), static/bot_ai.js (candidatesFromCluster), app.py (OWNER_TAKEOVER_SEC), static/meme_dash.js (OWNER_TAKEOVER_MS), static/battleship.js (fireFromInputs), static/meme_wars.js (fireFromInputs + Enemy Stats panel)
- **Tests**: All 6 edited JS files node --check OK; app.py AST parse OK; boot test 20 routes

### Session 11 - 2026-05-01
- **Goal**: Continue G8 — Meme Dash physics + lifecycle, Ratios touch fallback, Battleship/Meme Wars turn-lock + opponent-disconnect UI; then self-audit and fix any bugs introduced.
- **Work Done (Round 1)**:
  - **Meme Dash**: tab-out (`window.blur` + `visibilitychange`) clears held keys → no perpetual walking on tab-return; ceiling collision (wasBelow + willUnder + vy<0) blocks wall-climb exploit; `announceWin` no longer wipes counts — reset moved to `hideCelebration` and runs only on owner client (broadcasts fresh state); single shared `_powerupCountdownIv` replaces 3 separate setIntervals (no leak when stacking pickups); fixed-substep physics (`PHYSICS_SUBSTEP = 1/120`, `steppedSimulate` wrapper) makes physics frame-rate-independent (low-FPS Chromebooks no longer reach platforms 60fps players can't)
  - **Ratios touch drag-drop**: `touchstart`/`touchmove`/`touchend`/`touchcancel` handlers on each `.meme` card; floating ghost image follows finger; `document.elementFromPoint` checks landing on the board; `data-dragover` highlights board on hover; `e.preventDefault()` on touchmove suppresses page scroll. Click-to-add still works as backup. iPad/touch-Chromebook students can finally drag.
  - **Battleship + Meme Wars turn-lock**: added `state.shotSeq` monotonic counter; tryFireAt increments before broadcasting; `_pendingFireUntil = now+800ms` blocks rapid double-clicks ("One shot at a time…"); `applyRemoteState` rejects snapshots with `remoteSeq < localSeq` so turn can no longer rewind via stale broadcast. Lock cleared as soon as ANY state with seq ≥ ours arrives.
  - **Battleship + Meme Wars opponent-disconnect banner**: lazy-injected fixed-position banner with **Forfeit** (sets state.winner=enemy, gameover, broadcasts → triggers normal lose-overlay flow + records as loss) and **Solo vs Bot** (programmatically toggles `#singlePlayerToggle`); shows when phase==='playing' AND opponent's turn AND presence ≤ 1 AND turn-stale > 12s AND not solo-bot; 2s setInterval polling.
- **Self-Audit + Fixes (Round 2)**: reviewed Session 11 implementations and found two bugs:
  - **Bug A**: vertical-line hint in `afterAddInfiniteLine` fires before the wrongTimer guard, so during the 3-second wrong-answer reveal a vertical-line attempt clobbered the toast text and a 2.2s setTimeout hid it prematurely. **Fix**: skip vertical-line path entirely when `wrongTimer` is active; setTimeout-hide only fires if `wrongTimer` is still inactive when it executes.
  - **Bug B**: opponent-disconnect banner fires immediately at first 2s tick because `_lastTurnChangeAt = 0` makes `(now - 0) > 12000` always true. **Fix**: initialize `_lastTurnChangeAt = Date.now()` and track `_lastSeenPhase`; bump timer on phase transitions (not just shotSeq changes). Applied to both battleship.js and meme_wars.js.
- **Files Changed**: static/meme_dash.js (substep, ceiling, tab-blur, hideCelebration reset, _powerupCountdownIv), static/ratios_mode.js (touch handlers), static/battleship.js (shotSeq + lock + banner + fix B), static/meme_wars.js (same), static/main.js (vertical-line bug A fix)
- **Tests**: All edited JS `node --check` OK; app.py AST + boot OK with 20 routes both pre- and post-audit-fixes
- **Discovered**: nothing new this round; the self-audit pass cleaned up its own work
