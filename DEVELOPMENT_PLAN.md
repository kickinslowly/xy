# Development Plan — Mr. A's Math Tools

Full product audit completed 2025-05-25 by 7 parallel agents reading every line of code.
This document captures all findings and organizes them into an actionable development plan.

---

## Part 1: Critical Bugs (Fix Immediately)

These are broken right now and silently degrading the product.

| # | Bug | Location | Impact | Fix Effort |
|---|-----|----------|--------|------------|
| B1 | `adaptive_difficulty.js` not loaded in Coordinate Plane — difficulty is permanently stuck at Developing | `templates/index.html` (missing script tag) | Flagship mode has no difficulty progression | 1 line |
| B2 | `DIFF_LABELS` undefined in Ratios — difficulty data silently lost on every `recordResult` call | `static/ratios_mode.js:432,455` | Difficulty analytics broken for all ratio plays | 5 lines |
| B3 | Line Graph mode never calls `recordResult` — zero XP, coins, mastery, or dashboard tracking | `static/line_mode.js` (missing entirely) | Mode is invisible to the entire backend | New code needed |
| B4 | Meme Wars lobby has no Join Team A/B buttons — players can get stuck as spectators | `templates/meme_wars.html` | Multiplayer broken if server role event doesn't fire | 10 min |
| B5 | Bot `performBotMove` doesn't increment `shotSeq` — desync risk in Battleship/Meme Wars | `battleship.js:1056`, `meme_wars.js:487` | Stale echoes can rewind game state during bot turns | 2 lines |
| B6 | Meme Wars bot shots logged under human's clientId — personal stats include bot actions | `meme_wars.js:547` | "Your Stats" panel shows inflated numbers | 5 min |
| B7 | `toFractionApprox` in Line Graph is stale copy — displays ugly fractions like 333333/1000000 | `line_mode.js:674-687` | Students see nonsensical fraction displays | Copy fix from main.js |
| B8 | Chart.js `stepSize: 1` hardcoded in Line Graph — breaks at large data ranges | `line_mode.js:641,644` | 1000+ tick marks when students enter large values | Remove or use autoSkip |
| B9 | Subitize `streak` not reset on operation switch — carries over between modes | `subitize.js:36-44` | False "4 in a row!" messages after switching tabs | 1 line |
| B10 | Ratios submit has no debounce — fast double-click can increment score twice | `ratios_mode.js:689` | Score inflation | 5 lines |
| B11 | Achievement unlock notifications never shown to user — earned silently in API response | `base.html` / all mode JS | Students never know they unlocked achievements | New toast code |

---

## Part 2: Cross-Cutting Gaps

Issues that affect the entire platform, not just one mode.

### 2A. Zero Sound Anywhere
No audio in any mode. No click feedback, no success chime, no failure buzz, no music. This is the single biggest "juice" gap across the entire product. Middle schoolers expect audio feedback.

**Recommendation**: Add Howler.js (7KB gzipped). Define a shared sound manifest in base.html:
- `click.mp3` — vertex placed, cell clicked, button press
- `success.mp3` — correct answer
- `fail.mp3` — wrong answer (soft buzz)
- `coins.mp3` — coins earned
- `levelup.mp3` — level up / achievement
- `turn.mp3` — turn change (battleship)
- `collect.mp3` — meme collected (meme dash)

Load lazily on first user interaction to avoid autoplay policy. Add a mute toggle in nav.

### 2B. No Touch Support on Canvas Modes
Coordinate Plane and Meme Dash use mouse events only. On iPads and Chromebooks (primary student hardware), drag, pan, zoom, and transform interactions are broken.

**Recommendation**: Migrate to Pointer Events (`pointerdown`, `pointermove`, `pointerup`) which unify mouse + touch + pen. Add `touch-action: none` on canvases. For Meme Dash, add virtual joystick or left/right half-screen touch zones.

### 2C. No Onboarding Flow
New students see game cards and a tiny sign-in button. No tutorial, no guided first experience, no explanation of why signing in matters. No first-game celebration.

**Recommendation**: 
- Unauthenticated hero CTA: "Sign in to save your progress, earn XP, and unlock rewards"
- First-visit tooltip tour (3-4 steps) on whichever mode they enter first
- First-game-ever celebration with special achievement

### 2D. Mobile Layout Gaps
- Nav bar overflows at 768-1100px with 9 links (now including Subitize)
- Game sidebars hidden or cramped on mobile (28vh cap)
- Battleship/Meme Wars 240px sidebar doesn't collapse
- Coordinate Plane sidebars completely vanish on mobile (no undo, no vertex list, no line info)

**Recommendation**: Responsive audit across all templates. Convert sidebars to bottom sheets or collapsible panels on mobile. Group nav links (Games | Tools) or use icons.

### 2E. Inline CSS Sprawl
~900 lines of CSS inline across home.html (~400), dashboard.html (~250), shop.html (~280). Not cached, duplicated patterns (XP shimmer animation defined twice), and style collision risk.

**Recommendation**: Extract to `static/css/pages.css` or per-page files. Deduplicate shared patterns into game.css or theme.css.

### 2F. Achievement System is One-Dimensional
18 achievements total, all "Complete N challenges" at 10/50/200 thresholds. No variety.

**Recommendation**: Add achievement types:
- **Accuracy**: "Sharp Shooter — 90% accuracy in 20 games"
- **Streak**: "On Fire — 10 correct in a row"  
- **Speed**: "Lightning — answer in under 2 seconds"
- **Exploration**: "Renaissance — play all 7 modes"
- **Social**: "Rival — beat a friend in Battleship"
- **Mastery**: "Standards Scholar — reach 80% mastery in 5 standards"

### 2G. `prefers-reduced-motion` Missing from game.css
2689 lines of game styles with no motion preference support. Home/dashboard handle it individually but game animations (board pops, turn cues, cell transitions) don't respect the preference.

### 2H. Light Mode is Broken
theme.css defines light-mode overrides but hardcoded dark colors in inline styles and game.css make it unusable. Either finish it or remove the incomplete media query.

### 2I. Teacher Tools Are Schema Ghosts
7 database models (Class, ClassMembership, Assignment, Submission, Activity, TeacherPrivateName, AccessLog) with zero routes or UI. Either build the teacher dashboard or remove dead code.

---

## Part 3: Per-Mode Assessments

### Coordinate Plane (Flagship — `main.js` ~3900 LOC)

**Current State**: Powerful graphing sandbox with 6 challenge types. Strong challenge bar design. Good collaboration infrastructure.

**Critical Issues**:
- Adaptive difficulty not loading (B1)
- Zero touch support — broken on tablets
- No in-session score/streak counter during challenges
- No hints system when students get answers wrong
- Canvas background hardcoded white against dark UI theme
- Sidebars vanish on mobile (no undo, no vertex list)

**Missing Challenge Types**:
- Distance between two points (8.G.B.8)
- Slope from graph (inverse of current line challenge)
- Identify equation from graph
- Plot from data table (8.F.A.1)
- Parallel/perpendicular lines
- Systems of equations — find intersection (8.EE.C.8)

**Forward-Looking Ideas**:
- **Expression input bar**: Type `y = 2x + 3` directly (Desmos-style)
- **Animated equation building**: Show rise/run triangle, sweep the line
- **Challenge "worlds"**: Themed tracks (Quadrant Explorer, Mirror Master, Slope Surfer) with unlock progression
- **Real-time competitive challenges**: Teacher shares PIN, all students race same challenge
- **Step-by-step visual hints**: Highlight y-intercept, draw rise/run arrows
- **Celebration effects**: canvas-confetti (6KB) for correct answers, bigger bursts on streaks
- **Challenge session summary modal**: Total/correct/accuracy/difficulty/standards/coins after ending

**Priority**: Fix B1, add touch support, add score counter, add hints, add canvas dark mode.

---

### Line Graph (`line_mode.js` ~1564 LOC)

**Current State**: Solid graphing calculator sandbox. Good collaboration, PDF export, undo system. But it's a sandbox with zero gamification — no challenges, no scoring, no adaptive difficulty.

**Critical Issues**:
- No `recordResult` at all (B3) — mode is invisible to backend
- No challenge mode — no learning game loop
- No adaptive difficulty (script not even loaded)
- Stale `toFractionApprox` copy (B7)
- Chart colors hardcoded to light theme (clashes with dark UI)
- Mobile sidebar at 28vh — data tables unusable

**Proposed Challenge System ("Line Detective")**:
1. **Slope Finder**: Given two points, type the slope (8.EE.B.5, 8.EE.B.6)
2. **Equation Builder**: Given a visual line, enter y = mx + b (8.F.A.3, 8.F.B.4)
3. **Point Predictor**: Given equation and x, predict y (8.F.B.5)
4. **Data Match**: Given a scenario, build the matching data table (8.F.B.4)
5. **Best Fit**: Adjust m and b sliders to fit scatter data (8.SP.A.2)
6. **Rate of Change**: Identify steepest/shallowest interval (8.F.B.5)

**Forward-Looking Ideas**:
- **Pre-loaded real-world datasets**: NBA heights vs points, temperature over a month, plant growth
- **Interactive m/b sliders**: Drag to dynamically explore what slope and intercept "mean"
- **Comparison mode**: Two series side-by-side, "which is steeper?", "where do they intersect?"
- **CSV paste/import**: Paste from Google Sheets
- **Chart.js plugins**: `chartjs-plugin-annotation` for reference lines, `chartjs-plugin-datalabels` for point labels

**Priority**: This mode needs the most work. Add challenge system + recordResult, load adaptive difficulty, fix fraction display, add dark-theme chart colors.

---

### Battleship + Meme Wars (`battleship.js` ~974, `meme_wars.js` ~799, `bot_ai.js` ~136 LOC)

**Current State**: Functional grid games with solid turn-lock system, good visual feedback (5 redundant turn indicators!), working bot AI with BFS-like targeting. ~600 lines of duplicated code between the two files.

**Critical Issues**:
- Missing team join buttons in Meme Wars (B4)
- Bot shotSeq desync (B5)
- Bot shots logged as human's stats (B6)
- No "ship sunk" callout in Battleship
- Mobile sidebar doesn't collapse — board unplayably small on phones
- No sound effects

**Missing Features**:
- **Manual ship/meme placement** — This is the #1 missed math opportunity. Dragging ships to grid coordinates = direct coordinate practice. Currently all placement is random.
- **Shot log / game history** — "You fired at (3, 7) — Miss!" reinforces coordinate notation
- **Ship sunk tracking on board** — Sunk cells should visually change
- **Turn timer** — Students can stall indefinitely
- **Rematch with score tracking** — "Best of 3: You 1 - Opponent 0"
- **Grid cell ARIA labels** — No screen reader support

**Forward-Looking Ideas**:
- **Math-problem shields**: Hit a cell → solve a math problem to confirm the hit. Wrong = deflected as miss. Turns every shot into practice.
- **Four-quadrant grid**: Extend to negative coordinates (-5 to 5). Directly teaches 6.NS.C.6.
- **Variable grid sizes**: 5x5 for younger students, 15x15 for advanced
- **Coordinate notation training**: Force typing `(x, y)` format to fire
- **Post-game data analysis**: Hit rate heatmap, shot distribution, accuracy over time (ties to 6.SP standards)
- **Shared base module**: Extract ~600 lines of common code into `gridGameBase.js`

**Priority**: Fix B4/B5/B6, add ship sunk callout, add manual placement, extract shared base module.

---

### Meme Dash (`meme_dash.js` ~1650 LOC)

**Current State**: Functional platformer with impressive BFS bot pathfinding, good physics substep system, nice win celebration. But zero math content, no touch controls, single static level, and visually bare (3/10 polish).

**Critical Issues**:
- **Zero math content** — Students run around collecting images. No equations, no puzzles, no calculation. The mode teaches nothing.
- No touch controls (unplayable on phones/tablets)
- No responsive canvas (hardcoded 1100x640)
- Single static level with 6 platforms — every game is identical
- No sound at all
- Players are 20x40px rectangles with no animation

**Game Feel Gaps**:
- No coyote time (can't jump after walking off edge)
- No jump buffering (pressing jump slightly before landing does nothing)
- No variable jump height (hold vs tap produces same arc)
- No squash-and-stretch on landing
- No particle effects on collection
- No screen shake
- No opponent scoreboard

**Math Integration Ideas (pick one or more)**:
- **Math Gates**: Barriers between platforms with equations to solve. Wrong = bounce back.
- **Collectible Equations**: Collect terms (3x, +, 7, =, 22) to complete equations
- **Coordinate Checkpoints**: Platforms labeled with (x, y) coordinates, challenge says "Jump to (4, 7)"
- **Speed Math**: Memes only collectible after solving a quick mental math popup
- **Ratio Collection**: Win by collecting memes in a specific ratio (3 red : 2 blue)

**Visual Upgrade Ideas**:
- **Pixi.js** for sprite rendering, texture atlases, particle systems, filters (glow/blur) — drops into existing architecture
- **Howler.js** for jump/collect/power-up sounds
- **Procedural level generation**: Place platforms in a staircase pattern, seed from room PIN so all players see the same level
- **Animated sprites**: Walk cycle, jump pose, directional facing, landing squash

**Quick Wins (low effort, high impact)**:
1. Responsive canvas via ResizeObserver (~15 lines)
2. Coyote time + jump buffer (~20 lines)
3. Opponent progress bars above heads (~30 lines)
4. Touch controls (left/right half-screen zones, ~40 lines)
5. Player facing direction (track last input, flip eye, ~5 lines)
6. Landing squash animation (~10 lines)
7. Disconnect cleanup (remove ghost players after 15s, ~10 lines)

**Priority**: Add math content (gates or speed-math), add touch controls, responsive canvas, add sound, procedural levels.

---

### Ratios (`ratios_mode.js` ~642 LOC)

**Current State**: Drag-and-drop meme ratio builder with 5 challenge modes. Touch support added. Adaptive difficulty works. Good visual prompt design.

**Critical Issues**:
- DIFF_LABELS bug (B2) — difficulty never recorded
- Submit debounce missing (B10)
- No visual grouping on board — 7 memes in a row with no A/B separation
- No running count of placed memes (updateBoardCountsUI is a no-op)
- `.meme.dragging` CSS class set but has no visual rule
- Part-to-whole mode has extensive inline styles (should be in CSS)
- Create and Part:Part modes are functionally identical

**Missing Ratio Concepts**:
- **Unit Rates** (6.RP.A.2) — "How many fish per cat?" — completely absent
- **Ratio Tables** — Partially-filled table with blanks to fill in
- **Tape Diagrams / Bar Models** — Proportional bars showing relative magnitude
- **Scaling** (7.RP.A.2) — "If 3:5, what is ?:15?"
- **Simplifying Ratios** — `gcd()` function exists but is dead code
- **Comparing Ratios** — "Which ratio is greater?"
- **Real-World Contexts** — Recipes, maps, unit pricing
- **Percent as Ratio** (6.RP.A.3c)

**Forward-Looking Ideas**:
- **Animated tape/bar diagrams**: SVG bars that grow as memes are added. Target ratio shown as ghost bar.
- **Proportional scaling animation**: After correct equiv answer, animate both ratios to same unit rate
- **Interactive ratio table**: New challenge type with partially-filled tables
- **Recipe mode**: "2 cups flour : 3 eggs. Make it for 15 people instead of 5."
- **Grouped drop zones**: Split board into "Side A" / "Side B" with running count badges
- **interact.js**: Replace ~80 lines of custom touch code with ~20 lines of config. Adds snap-to-grid, drag cloning, keyboard drag.

**Priority**: Fix B2/B10, add board counter, add grouped drop zones, add unit rate challenges, add ratio tables.

---

### Subitize (`subitize.js` ~337 LOC)

**Current State**: Just built. Functional dot-group arithmetic with 5 operation modes, adaptive difficulty, canvas rendering with DPR awareness. Clean, compact code.

**Critical Issues**:
- **No timed flash mode** — THE critical missing feature. Without time-limited dot exposure, students count instead of subitize. This is counting practice, not subitizing.
- Question text gives away the math fact: "(4 groups x 3 each)" spoils the visual exercise
- Circular dot layout for 7+ defeats subitizing (research: structured patterns required above 5)
- Cross-out X size doesn't scale with dot radius
- No duplicate problem prevention

**Missing Features**:
- **Ten-frame representation** — THE most researched subitizing scaffold (2x5 grid)
- Number bonds / decomposition hints on wrong answers
- Array model for multiplication (rows x columns, not just groups)
- No sound effects
- No problem history / review at victory
- Victory screen doesn't show accuracy stats
- No timer / speed tracking (speed = key indicator of subitizing vs counting)

**Forward-Looking Ideas**:
- **Flash mode** (P0): Show dots for 1-3s, blur/cover, then ask. Duration adapts with difficulty (3s beginner → 1s advanced). This is ~20 lines of JS + 5 lines of CSS.
- **Perceptual vs Conceptual toggle**: "Quick See" (1-5, no grouping) vs "Group See" (6-12, composite patterns like dice-5 + dice-2 for 7)
- **Animated regrouping**: After addition, animate dots flowing into merged group
- **Number line connection**: Show where the answer falls on a number line
- **Speed badges**: Track response time, award "Lightning" for under 2s answers
- **Composite dot patterns for 7-9**: Use domino/dice layouts instead of circular fallback

**Priority**: Add flash mode (essential for actual subitizing), remove parenthetical spoilers from questions, add structured 7-9 dot patterns, add ten-frame option.

---

### Shared Systems (Home, Dashboard, Shop, Nav, Backend)

**Current State**: Home page is inviting with animated game cards. Dashboard has good standards visualization. Shop has clean purchase flow with atomic coin transactions. Backend is functional but growing past single-file comfort.

**Critical Issues**:
- Achievement unlock notifications never shown (B11)
- No onboarding for new users
- Nav overflow at 9+ links on mid-width screens
- Leaderboard query is O(N) per user — scales poorly
- `ensure_achievements_seed()` called on every POST — wasteful after first call

**Backend Architecture**:
- app.py at 2124 lines could benefit from Flask Blueprints: models, standards/mastery, shop, socket handlers, achievements could each be extracted
- `datetime.utcnow()` deprecated in Python 3.12+ — use `datetime.now(timezone.utc)`
- No token refresh — 12hr JWT expires silently
- Dead models: Class, ClassMembership, Assignment, Submission, Activity, TeacherPrivateName, AccessLog — defined but no routes

**Forward-Looking Ideas**:
- **PWA**: Service worker for offline shell caching + `manifest.json` for Chromebook installation. Huge for school Wi-Fi.
- **Page transitions**: View Transitions API for smooth cross-fades between modes
- **Loading skeletons**: Replace hidden/blank states with shimmer skeletons while APIs resolve
- **Number animations**: countUp.js or rAF counter for XP/coins/level changes
- **Mascot character**: Illustrated math character in hero section (owl with glasses, calculator robot)
- **Skip-to-content link**: Missing for keyboard accessibility
- **Class competitions**: Leverage existing Class models — "Our class earned 15,000 XP this week!"
- **Open Props**: Replace hand-rolled token system with battle-tested CSS custom properties library

---

## Part 4: Unified Development Plan

### Phase 1: Bug Fixes & Quick Wins (1-2 sessions)
*Fix what's broken. Highest ROI per line of code.*

1. Fix B1: Add adaptive_difficulty.js to index.html (1 line)
2. Fix B2: Add DIFF_LABELS fallback to ratios_mode.js (5 lines)
3. Fix B4: Add team join buttons to meme_wars.html (10 min)
4. Fix B5: Increment shotSeq in bot performBotMove (2 lines)
5. Fix B6: Use bot clientId for bot shot logging (5 min)
6. Fix B7: Port toFractionApprox fix to line_mode.js (copy)
7. Fix B8: Remove stepSize hardcoding in line_mode.js (1 line)
8. Fix B9: Reset streak on operation switch in subitize.js (1 line)
9. Fix B10: Add submit debounce to ratios_mode.js (5 lines)
10. Fix B11: Add achievement unlock toast in base.html (30 min)
11. Subitize: Remove parenthetical spoilers from question text
12. Subitize: Add structured dot patterns for 7-9 (replace circular)
13. Battleship: Add "Ship sunk!" callout notification
14. Ratios: Add `.meme.dragging` CSS rule
15. Ratios: Fill in `updateBoardCountsUI()` with live counter

### Phase 2: Core UX Upgrades (2-3 sessions)
*Make every mode feel polished and complete.*

1. **Sound system**: Add Howler.js + shared sound manifest across all modes
2. **Subitize flash mode**: Timed reveal (show dots briefly, then blur) — essential for real subitizing
3. **Touch support**: Migrate coord plane + meme dash to pointer events; add virtual controls
4. **Mobile layout audit**: Fix sidebar collapse, nav overflow, canvas responsiveness across all modes
5. **Line Graph challenges**: Build "Line Detective" challenge system with 4-6 challenge types + recordResult
6. **Canvas dark mode**: Coord plane + line graph canvases match dark theme
7. **In-session score counter**: Add to coord plane challenge bar (correct/streak display)
8. **Subitize ten-frame mode**: Alternative visualization option
9. **Extract inline CSS**: Move ~900 lines from templates to cacheable CSS files
10. **Ratios grouped drop zones**: Split board into Side A / Side B with counters

### Phase 3: Math Depth (2-3 sessions)
*Expand pedagogical coverage. Fill standards gaps.*

1. **Coord plane new challenges**: Distance, slope-from-graph, parallel/perpendicular, plot-from-table
2. **Ratios new challenges**: Unit rates, ratio tables, scaling, simplifying, real-world contexts (recipes, maps)
3. **Battleship manual placement**: Drag ships to coordinates — direct coordinate practice
4. **Meme Dash math integration**: Add math gates or speed-math popups before meme collection
5. **Subitize array model**: Rectangular grid view for multiplication alongside groups view
6. **Line Graph pre-loaded datasets**: Real-world data for immediate engagement
7. **Coord plane step-by-step hints**: Visual guides (rise/run arrows, y-intercept highlight)
8. **Challenge standards mapping**: Ensure all new challenge types map to CHALLENGE_STANDARD_MAP
9. **Adaptive difficulty for Line Graph**: Load script, wire up difficulty progression

### Phase 4: Engagement & Polish (2-3 sessions)
*Make it addictive. Compete with Duolingo/Roblox hooks.*

1. **Celebration effects**: canvas-confetti for correct answers, bigger bursts on streaks
2. **Achievement overhaul**: Add accuracy, streak, speed, exploration, social, mastery achievement types
3. **Meme Dash visual upgrade**: Responsive canvas, coyote time, jump buffer, squash-stretch, opponent scoreboard
4. **Meme Dash procedural levels**: Seeded from room PIN, staircase platform placement
5. **Battleship/Meme Wars math shields**: Solve problem to confirm hits
6. **Subitize speed badges**: Track response time, "Lightning" for under 2s
7. **Challenge session summaries**: End-of-session modal with stats/accuracy/difficulty/standards/coins
8. **Number animations**: Animated XP/coin counters on change
9. **Loading skeletons**: Replace hidden states with shimmer screens
10. **Coord plane expression bar**: Type `y = 2x + 3` directly (Desmos-style)

### Phase 5: Platform Growth (3-4 sessions)
*Scale the platform. Build for teachers and retention.*

1. **Onboarding flow**: Welcome state for new users, sign-in CTA, first-game celebration, tooltip tour
2. **Teacher dashboard**: Class-wide mastery heatmap, per-student view, struggling student alerts
3. **PWA**: Service worker + manifest.json for Chromebook installation + offline support
4. **Shared grid base module**: Extract ~600 lines from battleship/meme_wars into gridGameBase.js
5. **Backend Blueprints**: Split app.py into models, standards, shop, sockets, achievements modules
6. **Four-quadrant battleship**: Grid extends to negative coordinates
7. **Ratio animated tape diagrams**: SVG proportional bars with animation
8. **Coord plane challenge worlds**: Themed tracks with unlock progression
9. **Social features**: Class competitions, friend challenges, achievement sharing
10. **Token refresh**: Silent JWT refresh before expiry

---

## Part 5: Library Recommendations

| Library | Size | Purpose | Where |
|---------|------|---------|-------|
| **Howler.js** | 7KB gz | Sound effects across all modes | Phase 2 — all modes |
| **canvas-confetti** | 3KB gz | Celebration particle effects | Phase 4 — all modes |
| **interact.js** | 25KB gz | Better drag-drop (snap, clone, keyboard) | Phase 3 — Ratios |
| **Pixi.js** | 45KB gz | Sprite rendering, particles, filters | Phase 4 — Meme Dash only |
| **anime.js** | 17KB gz | Timeline animations, equation building | Phase 4 — Coord Plane |
| **chartjs-plugin-datalabels** | 8KB gz | Point labels on Line Graph charts | Phase 3 — Line Graph |
| **chartjs-plugin-annotation** | 12KB gz | Reference lines on charts | Phase 3 — Line Graph |
| **Open Props** | 5KB gz | Battle-tested CSS custom properties | Phase 5 — design system |

**Not recommended** (overkill for current scope):
- D3.js — Chart.js is sufficient; D3 migration cost too high
- matter.js — Custom physics in Meme Dash is adequate
- React — Vanilla JS IIFE pattern is clean at current scale; migration cost > benefit
- GSAP — anime.js is lighter and sufficient; GSAP licensing is commercial
- Phaser — Would require full Meme Dash rewrite; Pixi.js adds visuals without restructuring

---

## Part 6: Standards Coverage Gaps

Currently mapped standards cover Geometry (5.G), Ratios (6.RP, 7.RP), Number System (6.NS), Expressions & Equations (8.EE), Functions (8.F), and Geometry Transformations (8.G).

**Not yet covered by any mode**:
- **Operations & Algebraic Thinking** (5.OA) — Partially covered by new Subitize mode
- **Number & Operations in Base Ten** (5.NBT) — Partially covered by Subitize
- **Expressions & Equations** (6.EE) — Meme Dash math gates could cover
- **Statistics & Probability** (6.SP, 7.SP, 8.SP) — Line Graph best-fit challenges could cover
- **Geometry** (7.G) — Area, surface area, volume — no mode covers this
- **Number System** (7.NS) — Operations with rational numbers — potential Subitize extension

---

*Generated 2025-05-25 from comprehensive code audit across 7 parallel agents reviewing ~13,000 LOC.*
