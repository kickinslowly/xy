# FEATURES.md — Mr. A's Math Tools

Authoritative inventory of what the project has built. Updated 2026-05-26.

---

## User-Facing Features

### Student
- 7 game modes: Coordinate Plane, Line Graph, Battleship, Meme Wars, Meme Dash, Ratios, Subitize
- Arcade-style home page with animated game cards, player stats (streak/XP/daily goal/coins/skills)
- Personal dashboard: per-mode stats (7 modes), XP/level, streak, daily goal, achievements, standards mastery by strand
- Shop: 22 cosmetics (titles, board themes, avatar frames) purchased with coins
- Daily quests (3 rotating from 13 templates)
- Leaderboard (global top XP with custom titles + avatar frames)
- Sound system: 15 synthesized Web Audio effects (success, fail, coin, achievement, jump, collect, hit, miss, sunk, etc.)
- Achievement toast, coin toast, standards toast after game results
- 30 achievements: 21 per-mode (7 modes x 3 tiers) + 9 cross-mode (exploration, totals, first-game, subitize)
- Welcome banner for unauthenticated users with sign-in CTA
- First-visit tooltip tour on home page
- Animated XP/coin counters (easeInOutCubic)
- PWA manifest (installable on Chromebooks)
- Real-time multiplayer in coord plane + battleship + meme wars + meme dash

### Teacher
- Class system (schema ready — routes not yet built)
- Dashboard analytics (per-mode aggregates) — heatmap NOT yet built (G6 pending)

---

## Page Routes

| Route | Handler | Template | CSS | Purpose |
|---|---|---|---|---|
| `/` | `home()` | `home.html` | `home.css` | Arcade lobby |
| `/plane` | `plane()` | `index.html` | `game.css` | Coordinate plane |
| `/line-mode` | `line_mode()` | `line_mode.html` | `game.css` | Line graphing |
| `/battleship` | `battleship()` | `battleship.html` | `game.css` | Battleship |
| `/meme-wars` | `meme_wars()` | `meme_wars.html` | `game.css` | Meme Wars |
| `/meme-dash` | `meme_dash()` | `meme_dash.html` | `game.css` | Platformer |
| `/ratios` | `ratios_mode()` | `ratios.html` | `game.css` | Ratios |
| `/subitize` | `subitize_mode()` | `subitize.html` | `game.css` | Subitize |
| `/shop` | `shop_page()` | `shop.html` | `shop.css` | Shop |
| `/dashboard` | `dashboard_page()` | `dashboard.html` | `dashboard.css` | Stats |

---

## Game Mode Inventory

### Coordinate Plane (`main.js`)
- **8 challenge types**: vertex, quadrant, reflect, midpoint, distance (typed), twopoints, line (equation), slopegraph (typed)
- Adaptive difficulty (4 levels, streak-based)
- Touch/pointer events: pinch-to-zoom, two-finger pan
- Dark-mode canvas (reads CSS custom properties)
- Challenge session summary modal (correct/attempted/accuracy/difficulty)
- In-session score counter
- Challenge answer input for typed challenges (distance, slope-from-graph)

### Line Graph (`line_mode.js`)
- **3 challenge types**: Slope Finder, Equation Builder, Point Predictor ("Line Detective")
- Slope explorer: interactive m/b sliders with live dashed line on chart
- 4 pre-loaded sample datasets (Plant Growth, Temperature, Pizza Sales, Distance)
- CSV paste import (tab/comma/semicolon from any spreadsheet)
- Dark-mode chart (Chart.js colors adapt to theme)
- Adaptive difficulty, recordResult integration

### Battleship (`battleship.js`)
- Manual ship placement phase: click to place 5 ships, orientation toggle (H/V + R key), hover preview, coordinate practice toast, undo, randomize fallback
- Ship sunk callout notification
- 45-second turn timer with auto-fire
- Turn-lock system (shotSeq monotonic counter + 800ms guard)
- Bot AI with BFS-like targeting

### Meme Wars (`meme_wars.js`)
- Team join buttons + roster display
- 45-second turn timer with auto-fire
- Hit/miss/sunk sound effects
- Turn-lock system (matches Battleship)

### Meme Dash (`meme_dash.js`)
- Math gates: speed-math popup on meme collection (add/sub/multiply, 5s timer)
- Touch controls: left/mid/right screen thirds
- Coyote time (80ms) + jump buffer (100ms)
- Procedural level generation (seeded from room PIN, 7-10 platforms per game)
- Responsive canvas (width: 100%, height: auto)
- Touch zone hint overlay on first touch

### Ratios (`ratios_mode.js`)
- **9 challenge types**: create, partpart, partwhole, equiv, unitrate, table, scale, simplify, master
- Unit Rate: "How many per 1?" (6.RP.A.2)
- Ratio Table: fill blanks in 4-row proportional table (6.RP.A.3a)
- Scale: "If 3:5, what is ?:15?" (7.RP.A.2)
- Simplify: reduce to lowest terms using gcd (6.RP.A.1)
- Live board counter ("3 : 4")
- Touch drag-and-drop with ghost element
- Adaptive difficulty

### Subitize (`subitize.js`)
- 5 operations: multiply, add, subtract, divide, mixed
- Flash mode: timed reveal (3s→1s by difficulty), blur overlay, forces subitizing over counting
- Ten-frame mode: 2x5 grid visualization
- Structured dot patterns for 1-9 (dice/domino layouts)
- Speed tracking: response time per problem, Lightning (<2s) / Quick (<3s) / Steady badges
- Victory stats: avg time, fastest time, speed tier

---

## Standards & Mastery (32 mappings, 24 unique standards)

| Mode | Challenge Types | Standards |
|---|---|---|
| Coord Plane | vertex, quadrant | 5.G.A.1, 5.G.A.2, 6.NS.C.6b, 6.NS.C.8 |
| Coord Plane | reflect | 8.G.A.1, 8.G.A.3 |
| Coord Plane | midpoint | 5.G.A.1, 6.NS.C.8 |
| Coord Plane | line, twopoints, slopegraph | 8.EE.B.5, 8.EE.B.6, 8.F.A.3 |
| Coord Plane | distance | 8.G.B.8, 6.NS.C.8 |
| Line Graph | slope, equation, predict | 8.EE.B.5, 8.F.A.1, 8.F.A.3, 8.F.B.4 |
| Battleship | battleship | 5.G.A.1, 6.NS.C.6b |
| Meme Wars | memewars | 5.G.A.1, 6.NS.C.6b |
| Meme Dash | memedash | 5.OA.A.1, 5.NBT.B.5 |
| Ratios | create, partpart, equiv, master | 6.RP.A.1, 6.RP.A.3 |
| Ratios | partwhole | 6.RP.A.1, 6.RP.A.3 |
| Ratios | unitrate | 6.RP.A.2, 6.RP.A.3 |
| Ratios | table | 6.RP.A.3, 6.RP.A.3a |
| Ratios | scale | 7.RP.A.2, 6.RP.A.3 |
| Ratios | simplify | 6.RP.A.1 |
| Subitize | multiply | 5.NBT.B.5, 5.OA.A.1 |
| Subitize | add, subtract | 5.OA.A.1 |
| Subitize | divide | 6.NS.B.2, 5.NBT.B.6 |

---

## Shared Systems

### Sound (`sound.js`)
- Web Audio API synthesis, zero file dependencies
- 15 effects: success, fail, click, coin, levelup, achievement, turn, collect, jump, sunk, fire, hit, miss, win, lose, streak, skip, tick
- Mute toggle in nav bar (localStorage persisted)
- Lazy init on first user interaction (autoplay policy)

### Adaptive Difficulty (`adaptive_difficulty.js`)
- 4 levels: Beginner, Developing, Proficient, Advanced
- Streak-based: 3 correct → level up, 2 incorrect → level down
- Per-mode localStorage persistence
- Used by: coord plane, line graph, ratios, subitize

### CSS Architecture
- `theme.css` — design tokens, skip-to-content, sound toggle, nav
- `game.css` (~3400 LOC) — all game modes, per-mode accent via `--mode`
- `home.css`, `dashboard.css`, `shop.css` — page-specific (extracted from inline)
- `prefers-reduced-motion` support (disables all animations + hides particles)
- Dark mode canvas: grid/axes/labels read CSS custom properties

### PWA
- `manifest.json`: standalone, purple theme, 192+512 icons
- `theme-color` meta tag

### Accessibility
- Skip-to-content link
- Modal controller: Escape + focus trap + return-focus (MutationObserver)
- `aria-live` on toasts, score bars, challenge prompts
- `prefers-reduced-motion` respected
- `touch-action: none` on canvases

---

## Infrastructure

- **Backend**: Flask + SQLAlchemy + Flask-SocketIO (~2150 LOC `app.py`)
- **Dev**: SQLite, Flask debug, eventlet
- **Prod**: PostgreSQL on Render, Gunicorn + eventlet
- **Auth**: Google OAuth 2.0 → JWT (12hr), SECRET_KEY hard-fail in prod
- **Modes whitelist**: 7 canonical modes in `MODE_SYNONYMS`
- **Migrations**: Alembic + auto-ALTER shims for dev

---

## Known Remaining Work

See `goals.md` for full backlog. Key items:
- Teacher dashboard (class-wide mastery heatmap, per-student view)
- Backend Flask Blueprints (split app.py into modules)
- Four-quadrant Battleship grid (negative coordinates)
- Ratios tape diagrams (proportional SVG bars)
- Extract shared battleship/meme_wars code (~600 LOC duplicated)
- Bayesian mastery rebalance (learn/slip asymmetry)
- Server-side multiplayer adjudication
