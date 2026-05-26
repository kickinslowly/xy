# Project Goals

## Vision

**Mr. A's Math Tools** is the love child of Desmos, Roblox Arcade, and IXL. It's a math platform where students don't realize they're learning because they're too busy having fun. Teachers get the tracking and standards alignment they need. Students get games, competition, memes, and dopamine loops that happen to teach them math.

---

## G1: Standards-Aligned Content Engine

**The IXL Standard**: Every interaction maps to a real math standard.

### Completed
- ✅ 28 Common Core standards seeded (grades 5-8, 7 domains) with CHALLENGE_STANDARD_MAP
- ✅ Standards toast after each game showing skill practiced
- ✅ Dashboard strand cards + individual standards list with mastery %
- ✅ Subitize mode mapped to 5.OA.A.1, 5.NBT.B.5, 5.NBT.B.6, 6.NS.B.2

### Active Tasks
- ✅ **Line Graph has zero standards tracking** — never calls recordResult (B3). Build challenge system + wire to standards pipeline
- 🔲 **Meme Dash maps to no standards** — `('memedash', 'memedash'): []`. Add math content first (G5), then map
- 🔲 **Uncovered standard domains**: 6.EE (Expressions & Equations), 7.G (Geometry — area/volume), 7.SP/8.SP (Statistics), 7.NS (Rational number operations)
- 🔲 Standards coverage dashboard for teachers (G6 dependency)

---

## G2: Adaptive Mastery Tracking

**The Intelligence Layer**: Know what each student knows, and what they need next.

### Completed
- ✅ Bayesian mastery updates per standard per student
- ✅ Adaptive difficulty system (4 levels, streak-based) for coord plane + ratios + subitize
- ✅ Extracted to `adaptive_difficulty.js` with localStorage persistence

### Active Tasks — Bugs
- ✅ **BUG B1**: `adaptive_difficulty.js` not loaded in coord plane `index.html` — difficulty stuck at Developing forever
- ✅ **BUG B2**: `DIFF_LABELS` undefined in `ratios_mode.js:432,455` — difficulty data silently lost on every recordResult
- ✅ **BUG B3**: Line Graph mode never calls `recordResult` — zero XP/coins/mastery/dashboard tracking

### Active Tasks — Features
- ✅ Load adaptive difficulty in Line Graph mode (script not even included)
- 🔲 Spaced repetition: resurface decaying skills
- 🔲 Smart recommendations: "Try Ratio Master next — you're close to mastering equivalent ratios!"
- 🔲 Teacher mastery heatmap: class-wide view (G6 dependency)
- 🔲 Rebalance Bayesian learn/slip rates (current asymmetry drifts mastery monotonically upward)

---

## G3: Gamification & Engagement System

**The Roblox/Duolingo Standard**: Make it addictive in the way that serves learning.

### Completed
- ✅ XP/Level system (16 titles, triangular scale)
- ✅ Coins + Shop (22 items, 3 categories, 4 rarity tiers)
- ✅ Daily streaks with fire animation
- ✅ Daily quests (3 rotating from 13 templates)
- ✅ Leaderboard with custom titles + avatar frames
- ✅ Coin/standards toasts on game completion

### Active Tasks — Bugs
- ✅ **BUG B11**: Achievement unlock notifications never shown — earned silently in API response, no toast/celebration
- ✅ **BUG B9**: Subitize streak not reset on operation switch

### Active Tasks — Sound System (NEW — affects all modes)
- ✅ Web Audio API synthesis sound system (sound.js), 15 effects, mute toggle, all modes integrated

### Active Tasks — Celebration Effects (NEW)
- 🔲 Add canvas-confetti (3KB gz) for correct answers, bigger bursts on streaks
- 🔲 Number animations for XP/coin counters (countUp on change)
- 🔲 Loading skeleton screens (replace hidden/blank states while APIs resolve)

### Active Tasks — Achievement Overhaul (NEW)
- 🔲 Current: 18 identical "Complete N challenges" achievements. Needs variety:
  - Accuracy: "Sharp Shooter — 90% accuracy in 20 games"
  - Streak: "On Fire — 10 correct in a row"
  - Speed: "Lightning — answer in under 2 seconds"
  - Exploration: "Renaissance — play all 7 modes"
  - Social: "Rival — beat a friend in Battleship"
  - Mastery: "Standards Scholar — reach 80% mastery in 5 standards"
- 🔲 Subitize speed badges: track response time, "Lightning" for under 2s answers
- 🔲 Challenge session summary modal: stats/accuracy/difficulty/standards/coins after ending

---

## G4: Modern, Polished UI/UX

**The Desmos Standard**: Beautiful, intuitive, zero-friction.

### Completed
- ✅ Unified dark theme (theme.css tokens + game.css per-mode accents)
- ✅ Challenge bar on coord plane (always-visible CTA)
- ✅ Arcade lobby home page with animated game cards
- ✅ Modal a11y controller (Escape + focus trap + return-focus)
- ✅ Per-mode layout redesigns (G4-M1 through G4-M5)

### Active Tasks — Touch Support (NEW — Critical)
- ✅ **Coord Plane**: Touch/pointer events + pinch-to-zoom + two-finger pan. Enables iPad/Chromebook.
- ✅ **Meme Dash**: Touch controls added.
- ✅ **Meme Dash**: Responsive canvas added.

### Active Tasks — Mobile Layout (NEW)
- ✅ Mobile nav horizontal scroll.
- 🔲 Coord Plane sidebars completely vanish on mobile (no undo, vertex list, line info). Replace with bottom sheet/FAB.
- 🔲 Battleship/Meme Wars 240px sidebar doesn't collapse — board unplayably small on phones.
- 🔲 Line Graph sidebar at 28vh — data tables unusable on tablets.
- 🔲 Subitize: 5 operation pills overflow on 320px screens.

### Active Tasks — Onboarding (NEW)
- 🔲 New user welcome state: "Sign in to save progress, earn XP, unlock rewards" CTA
- 🔲 First-visit tooltip tour (3-4 steps) on first mode entered
- 🔲 First-game-ever celebration with special achievement
- 🔲 Empty states should be motivating: "Play your first game to start earning achievements!"

### Active Tasks — Visual Polish (NEW)
- ✅ Canvas dark mode: Coord plane canvas dark mode
- ✅ Line Graph dark theme chart
- ✅ `prefers-reduced-motion` in game.css
- 🔲 Light mode is broken: token overrides exist but hardcoded dark colors everywhere
- 🔲 Extract ~900 lines of inline CSS from home/dashboard/shop templates to cacheable files
- 🔲 Page transitions via View Transitions API (smooth cross-fades between modes)
- 🔲 Skip-to-content link missing for keyboard a11y
- 🔲 Mascot character for hero section (illustrated math character)

---

## G5: Expanded Math Content

**Breadth + Depth**: More math, more ways to practice, more game modes.

### Completed
- ✅ 7 game modes: Coord Plane (6 challenge types), Line Graph (sandbox), Battleship, Meme Wars, Meme Dash, Ratios (5 types), Subitize (5 ops)

### Active Tasks — Subitize Upgrades (NEW — Session 12)
- ✅ **Flash mode**: Show dots for 1-3s, blur/cover, then ask.
- ✅ Remove parenthetical spoilers from question text ("4 groups x 3 each" gives away the answer)
- ✅ Structured dot patterns for 7-9 (replace circular fallback that defeats subitizing)
- ✅ Ten-frame visualization mode (2x5 grid — most researched subitizing scaffold)
- 🔲 Array model for multiplication (rows x columns alongside groups view)
- 🔲 Perceptual vs Conceptual toggle: "Quick See" (1-5) vs "Group See" (6-12, composite patterns)
- 🔲 Animated regrouping: dots flow into merged group after correct addition
- 🔲 Number line connection: show where answer falls on number line

### Active Tasks — Line Graph "Line Detective" (NEW)
- ✅ Build challenge system with recordResult integration:
  1. ✅ Slope Finder: Given two points, type the slope (8.EE.B.5)
  2. ✅ Equation Builder: Given a visual line, enter y = mx + b (8.F.A.3)
  3. ✅ Point Predictor: Given equation + x, predict y (8.F.B.5)
  4. Data Match: Given scenario, build matching data table (8.F.B.4)
  5. Best Fit: Adjust m/b sliders to fit scatter data (8.SP.A.2)
  6. Rate of Change: Identify steepest interval (8.F.B.5)
- 🔲 Pre-loaded real-world datasets (NBA stats, temperature, plant growth)
- 🔲 Interactive m/b sliders for slope/intercept exploration
- 🔲 CSV paste/import from Google Sheets
- 🔲 Comparison mode: two series, "which is steeper?", "where do they intersect?"

### Active Tasks — Ratios Depth (NEW)
- ✅ **Unit Rates** (6.RP.A.2): "How many fish per cat?" — biggest standards gap
- ✅ **Ratio Tables**: Partially-filled table with blanks to fill in
- 🔲 **Tape Diagrams**: SVG proportional bars showing relative magnitude
- 🔲 **Scaling** (7.RP.A.2): "If 3:5, what is ?:15?"
- 🔲 **Simplifying Ratios**: Use existing dead `gcd()` function
- 🔲 **Comparing Ratios**: "Which ratio is greater?"
- 🔲 **Real-World Contexts**: Recipes, maps, unit pricing, speed/distance/time
- ✅ **Grouped drop zones**: Split board into Side A / Side B with running count badges (board counter with live "3 : 4" display)
- 🔲 **Animated proportional scaling**: After correct equiv, animate both ratios to unit rate

### Active Tasks — Coord Plane New Challenges (NEW)
- 🔲 Distance between two points (8.G.B.8)
- 🔲 Slope from graph (inverse of current line challenge)
- 🔲 Identify equation from graph (multiple choice)
- 🔲 Plot from data table (8.F.A.1)
- 🔲 Parallel/perpendicular lines
- 🔲 Systems of equations — find intersection (8.EE.C.8)
- 🔲 Expression input bar: type `y = 2x + 3` directly (Desmos-style)
- 🔲 Step-by-step visual hints: highlight y-intercept, draw rise/run arrows
- 🔲 Challenge "worlds": Themed tracks (Quadrant Explorer, Mirror Master, Slope Surfer) with progression

### Active Tasks — Battleship/Meme Wars Math (NEW)
- ✅ **Manual ship/meme placement**: Battleship ship placement phase added.
- 🔲 **Math-problem shields**: Hit a cell → solve problem to confirm hit. Wrong = deflected.
- 🔲 **Four-quadrant grid**: Extend to (-5,-5)→(5,5). Teaches 6.NS.C.6 negative coordinates.
- 🔲 **Coordinate notation training**: Force typing (x, y) format to fire
- 🔲 **Shot log**: "You fired at (3, 7) — Miss!" reinforces coordinate notation
- 🔲 **Variable grid sizes**: 5x5 for younger, 15x15 for advanced
- 🔲 **Post-game data analysis**: Hit rate heatmap, accuracy over time (6.SP standards)

### Active Tasks — Meme Dash Math Integration (NEW)
- 🔲 **Math Gates**: Barriers with equations to solve. Wrong = bounce back. (6.EE standards)
- 🔲 **Speed Math**: Memes only collectible after quick mental math popup
- 🔲 **Coordinate Checkpoints**: Platforms labeled with (x,y), "Jump to (4, 7)"
- 🔲 **Ratio Collection**: Win by collecting memes in specific ratio (3 red : 2 blue)
- 🔲 **Procedural level generation**: Seeded from room PIN, staircase placement

---

## G6: Teacher Tools & Classroom Management

**The Teacher's Best Friend**: Easy setup, powerful insights, zero hassle.

### Current State
- 7 DB models defined (Class, ClassMembership, Assignment, Submission, Activity, TeacherPrivateName, AccessLog) with zero routes or UI. Schema ghosts.

### Active Tasks
- 🔲 Teacher dashboard: class-wide mastery heatmap, per-student view, struggling student alerts
- 🔲 Class competitions: "Our class earned 15,000 XP this week!" (leverage existing Class models)
- 🔲 Assignment system: target specific skills/standards, set due dates
- 🔲 Content control: enable/disable modes, set difficulty ranges per class
- 🔲 Exportable reports (CSV, PDF)
- 🔲 Google Classroom integration / Clever SSO
- 🔲 Either build teacher routes or remove dead model code

---

## G7: Multiplayer & Social Experience

**The Arcade**: Math is more fun with friends.

### Completed
- ✅ PIN-based rooms with QR sharing
- ✅ Turn-lock system (shotSeq monotonic counter + 800ms guard)
- ✅ Opponent-disconnect banner with Forfeit + Solo-vs-Bot
- ✅ Coord plane collaborative drawing

### Active Tasks — Bugs
- ✅ **BUG B4**: Meme Wars lobby missing Join Team A/B buttons — players stuck as spectators
- ✅ **BUG B5**: Bot `performBotMove` doesn't increment `shotSeq` — desync risk
- ✅ **BUG B6**: Meme Wars bot shots logged under human's clientId — inflated personal stats

### Active Tasks — Features
- ✅ Ship sunk callout in Battleship ("You sunk the Cruiser!")
- 🔲 Turn timer (30/60/90s) with auto-skip — prevents stalling
- 🔲 Rematch with score tracking ("Best of 3: You 1 - Opponent 0")
- 🔲 Meme Dash opponent scoreboard (can't see others' progress)
- 🔲 Meme Dash ghost player cleanup (disconnected players persist forever)
- 🔲 Coord plane real-time competitive challenges (teacher shares PIN, students race)
- 🔲 Friend challenge links (pre-filled room code)
- ✅ Meme Wars team rosters wired / spectator team labels

---

## G8: Stability, Security & Performance

**The Trustworthy Standard**: Boringly reliable.

### Completed (Sessions 8-11)
- ✅ ~40 audit findings resolved (SECRET_KEY, CORS, /api/results validation, MasterySnapshot race, atomic shop, etc.)
- ✅ Meme Dash physics substep, ceiling collision, tab-out, win-reset, power-up leak
- ✅ Battleship/Meme Wars turn-lock, bot AI fix, enemy stats display
- ✅ Ratios touch drag-drop, equiv/master hardening
- ✅ Coord plane fraction display, vertical line hint, reflect/line fixes
- ✅ Backend perf: User.total_xp, leaderboard cache, dashboard GROUP BY

### Active Tasks — Bugs (from Session 12 audit)
- ✅ **BUG B7**: Line Graph `toFractionApprox` is stale copy — displays 333333/1000000 instead of 1/3
- ✅ **BUG B8**: Line Graph `stepSize: 1` hardcoded — breaks at large ranges
- ✅ **BUG B10**: Ratios submit has no debounce — fast double-click double-scores
- 🔲 Meme Wars `cssUrl` dead code (both branches return empty string, `meme_wars.js:876`)
- 🔲 Battleship dead variables (`before` at line 551, `letters` at line 773)
- 🔲 Meme Dash power-up kill hitbox doesn't account for 1.6x rendered scale
- 🔲 Coord plane `draw()` called on every mousemove — no rAF batching

### Active Tasks — Architecture
- 🔲 Extract shared Battleship/Meme Wars code (~600 LOC duplicated) into `gridGameBase.js`
- 🔲 Split `app.py` (2124 LOC) into Flask Blueprints: models, standards, shop, sockets, achievements
- 🔲 Extract shared `math_utils.js` (toFractionApprox, etc.) between main.js and line_mode.js
- 🔲 `ensure_achievements_seed()` called on every POST — cache after first seed
- 🔲 Leaderboard `_build_leaderboard_entries()` is O(N queries per user) — needs joined query
- 🔲 JWT: replace `datetime.utcnow()` with `datetime.now(timezone.utc)`
- 🔲 No token refresh — 12hr JWT expires silently
- 🔲 Coord plane history array unbounded — no GC/compaction
- 🔲 Main.js O(n) vertex lookups everywhere — use Map
- 🔲 `flask db migrate` to sync schema with models (remove ALTER TABLE shims)

### Active Tasks — Remaining from Sessions 8-11
- 🔲 Server-side adjudication for multiplayer (replace client-authoritative model)
- 🔲 details_json contract: validate inbound `challenge_type` + required fields at /api/results
- 🔲 Meme Dash magnet-through-platforms (pull doesn't respect geometry)
- 🔲 Socket.IO connect should require authenticated uid
- 🔲 `/events` body validation + size cap + rate limit
- 🔲 Equip race: atomic partial unique index for equipped items
- 🔲 Streak computation: use student's local TZ, track `best_streak` historically

### Active Tasks — New (Session 12)
- ✅ Meme Dash: coyote time (80ms grace after leaving edge) + jump buffer (100ms before landing)
- 🔲 Meme Dash: variable jump height (cut velocity on button release)
- 🔲 PWA: Service worker + manifest.json for Chromebook install + offline shell cache
- 🔲 Add favicon, theme-color meta, apple-touch-icon

---

## Priority Order

1. **Phase 1 — Bug Fixes**: B1-B11 (critical bugs from audit). 1-2 sessions.
2. **Phase 2 — Core UX**: Sound, touch support, mobile layout, subitize flash, line graph challenges. 2-3 sessions.
3. **Phase 3 — Math Depth**: New challenge types across all modes, standards coverage. 2-3 sessions.
4. **Phase 4 — Engagement Polish**: Celebrations, achievement overhaul, Meme Dash upgrade. 2-3 sessions.
5. **Phase 5 — Platform Growth**: Onboarding, teacher dashboard, PWA, architecture. 3-4 sessions.

Full details in `DEVELOPMENT_PLAN.md`.

---

## North Star

> A student opens the app, sees their streak counter, checks the daily quest, jumps into a ratio battle with their classmate, levels up, unlocks a new meme skin, and walks away having practiced 30 math problems without ever feeling like they did homework.

> A teacher opens the dashboard, sees that 3 students are struggling with equivalent ratios, assigns them a targeted practice set, and watches their mastery scores climb in real-time.

That's the product we're building.
