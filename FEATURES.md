# FEATURES.md — Mr. A's Math Tools

Authoritative inventory of what the project has built. Update when major features are added.

---

## User-Facing Features

### Student
- 7 game modes (Coordinate Plane, Line Graph, Battleship, Meme Wars, Meme Dash, Ratios, Subitize)
- Arcade-style home page (`/`) with skills progress card and game tiles
- Personal dashboard: per-mode stats, XP/level, streak, daily goal ring, achievements, standards mastery
- Shop: cosmetics (titles, board themes, avatar frames) purchased with coins
- Daily quests (3 rotating from 13 templates, deterministic per day)
- Leaderboard (global top XP, with custom titles + avatar frames)
- Standards toast after each game (shows skill practiced)
- Coin toast (animated notification on game completion)
- Real-time multiplayer in coord plane + battleship + meme wars + meme dash

### Teacher
- Class system (create class, manage memberships, per-class display names)
- Teacher-only access to private student names (audit-logged)
- Dashboard analytics (per-mode aggregates) — heatmap NOT yet built (G6 pending)

---

## Page Routes

| Route | Handler | Template | Purpose |
|---|---|---|---|
| `/` | `home()` | `home.html` | Arcade lobby |
| `/plane` | `plane()` | `index.html` | Coordinate plane mode |
| `/line-mode` | `line_mode()` | `line_mode.html` | Line graphing |
| `/battleship` | `battleship()` | `battleship.html` | Battleship game |
| `/meme-wars` | `meme_wars()` | `meme_wars.html` | Battleship variant |
| `/meme-dash` | `meme_dash()` | `meme_dash.html` | Platformer |
| `/ratios` | `ratios()` | `ratios.html` | Ratio puzzles |
| `/subitize` | `subitize_mode()` | `subitize.html` | Subitize number sense |
| `/shop` | `shop_page()` | `shop.html` | Cosmetics store |
| `/dashboard` | `dashboard_page()` | `dashboard.html` | Stats + mastery |

---

## API Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/new-session` | Create new session for activity tracking |
| POST | `/auth/google` | Google OAuth login → JWT issuance |
| POST | `/api/results` | Submit game result → validates (mode whitelist, outcome canonical set, score per-mode cap, finiteness, 16KB details_json cap, 1.5s/user rate limit) → updates DB, achievements, mastery |
| GET | `/api/dashboard` | Aggregated dashboard payload (per_mode, recent, achievements, xp, streak, quests, coins, equipped, standards, strands) |
| GET | `/api/leaderboard` | Global top XP with titles/frames; 60s in-memory cache, eager-invalidated by record_result |
| GET | `/api/shop` | List shop items + ownership status |
| POST | `/api/shop/buy` | Atomic coin decrement (`UPDATE WHERE coins>=price`) → grant item; race-safe |
| POST | `/api/shop/equip` | Equip/unequip cosmetic |
| GET | `/api/me/theme` | Lightweight CSS vars for board theme |

---

## Socket.IO Events

| Event | Direction | Purpose |
|---|---|---|
| `connect` | C→S | Connection handshake |
| `disconnect` | C→S | Cleanup on disconnect |
| `join` | C→S | Join PIN-based room |
| `leave` | C→S | Leave room |
| `request_state` | C→S | Request authoritative room state |
| `state_update` | C↔S | Owner broadcasts state at 20Hz |
| `input_update` | C→S | Client input (Meme Dash) |
| `memedash_win` | C→S | Meme Dash win event |

---

## Database Models (19)

| Model | Key Fields | Purpose |
|---|---|---|
| `User` | id, email, display_name, role, coins, total_xp | Auth + identity + currency + denormalized XP |
| `Class` | id, name, owner_id | Teacher class container |
| `ClassMembership` | class_id, user_id, role | Student↔class linkage |
| `Skill` | code, name, strand, grade, difficulty | 24 CC standards |
| `Activity` | id, name, mode | Activity catalog |
| `Assignment` | id, class_id, activity_id | Teacher assignments |
| `Submission` | id, user_id, assignment_id | Student work submissions |
| `SessionModel` | id, user_id, started_at | Play session tracking |
| `Event` | id, user_id, type, details_json | Granular event log |
| `MasterySnapshot` | id (BigInt), user_id, skill_id, mastery | Bayesian mastery per skill |
| `ErrorType` | id, code, name | Error categorization |
| `Strand` | id, code, name | Standard strand grouping |
| `TeacherPrivateName` | class_id, user_id, real_name | Real-name lookup (audit-logged) |
| `AccessLog` | id, user_id, action, target | Privacy audit trail |
| `GameResult` | id, user_id, mode, score, success, details_json | Per-game outcome |
| `Achievement` | id, code, name, criteria_json | Achievement catalog |
| `UserAchievement` | user_id, achievement_id, earned_at | Earned achievements |
| `ShopItem` | code, name, category, rarity, price, data_json | 22 seed items |
| `UserItem` | user_id, item_id, equipped | Owned cosmetics |

---

## Game Mode Inventory

### Coordinate Plane (`/plane`, main.js ~3901 LOC)
- 6 challenge types: vertex, quadrant, reflect, midpoint, line (equation), twopoints
- Adaptive difficulty (4 levels: Beginner/Developing/Proficient/Advanced, streak-based)
- Persistent challenge bar UI (replaced collapsed details panel)
- Pooled selectors: `pickVertexChallenge()`, `pickLineChallenge()`
- Multiplayer-capable (PIN rooms, owner authority, 20Hz broadcast)

### Line Graph (`/line-mode`, line_mode.js ~1564 LOC)
- Data tables → Chart.js → slope/equation calculation

### Battleship (`/battleship`, battleship.js ~974 LOC)
- 10×10 grid, turn-based 2-player, bot AI fallback
- Meme skin support

### Meme Wars (`/meme-wars`, meme_wars.js ~799 LOC)
- Battleship variant with meme collection mechanic

### Meme Dash (`/meme-dash`, meme_dash.js ~1650 LOC)
- Platformer with meme collection, power-ups, Terminator bot

### Ratios (`/ratios`, ratios_mode.js ~642 LOC)
- Drag-and-drop visual puzzles
- Multiple ratio types (equivalent ratios reworked recently)
- Adaptive difficulty (same 4-level system as coord plane)

---

## Standards & Mastery System

- **24 Common Core standards** seeded in `skills` table (grades 5–8, 5 domains)
- `STANDARDS_CATALOG` — list of dicts (code, name, strand, grade, difficulty, description)
- `CHALLENGE_STANDARD_MAP` — `(mode, challenge_type)` → list of standard codes
- `resolve_standards_for_result()` — resolves standards from mode + details_json
- `update_mastery_for_result()` — Bayesian update per standard (learn=0.15, slip=0.10, prior=0.3)
- `ensure_standards_seed()` — idempotent seed
- Standards mapping highlights:
  - `quadrant` → 5.G.A.1, 5.G.A.2
  - `reflect` → 8.G.A.1, 8.G.A.3
  - `midpoint` → 5.G.A.1, 6.NS.C.8
  - `twopoints` → 8.EE.B.5, 8.EE.B.6, 8.F.A.3

---

## Gamification System

### XP / Levels
- XP = `compute_xp_earned(outcome, score)` per game (10 base + 15 success + score×2)
- Denormalized on `User.total_xp`, incremented in `record_result` (Session 9). Backfills from full scan on first read if NULL.
- Triangular leveling curve, 16 titles

### Coins
- Stored on `User.coins`
- Earned: 5 base + 10 success + score×0.5 per game
- Spent: shop

### Streaks
- Consecutive day tracking, fire animation
- `best_streak` not yet historically tracked

### Daily Quests
- 3 rotating quests/day from 13 templates
- Deterministic via SHA-256 hash of date

### Achievements
- Milestone-based (10/50/200 completions)

### Shop (22 items)
- 10 titles, 7 board themes (CSS vars on `:root`), 5 avatar frames
- 4 rarity tiers (common, rare, epic, legendary)

---

## CSS Architecture

- `static/css/theme.css` — design tokens (--bg, --surface, --text, --accent)
- `static/css/game.css` (~2599 LOC) — unified game-mode stylesheet, per-mode accent via `--mode`
- Body class pattern: `mode-game mode-{name}` for scoping
- `static/style.css` — **deleted Session 8** (was orphaned 417 LOC, contradicted dark theme)

## Shared Frontend Helpers

- `static/adaptive_difficulty.js` — shared adaptive-difficulty engine for coord plane + ratios. Tracks per-mode level + posStreak/negStreak; persists to localStorage under `adaptive_difficulty` key. Exposes `window.AdaptiveDifficulty.{getLevel, recordResult, updateBadges, getBadgeText}`.
- Modal a11y controller in `templates/base.html` — `MutationObserver` on `.modal[role="dialog"]` `[hidden]` toggles. Adds Escape-to-close, Tab focus-trap, return-focus-to-opener. Covers QR modal, shop modal, any future modal.
- `window.recordResult(payload)` in `templates/base.html` — POSTs to `/api/results`, dispatches `app:result` event, fires coin/standards toasts on success.
- `window.showCoinToast(earned, total)` and `window.showStandardsToast(standards)` — `role="status" aria-live="polite"`, mobile-clamped, reduced-motion aware.
- Touch-drag pattern in `ratios_mode.js` (Session 11): touchstart/move/end/cancel handlers with floating ghost image + `document.elementFromPoint` landing check + `e.preventDefault()` on touchmove to suppress page scroll. Reusable pattern for future touch-drag UIs.

---

## Multiplayer Architecture

- PIN-based rooms via Socket.IO
- 20Hz state broadcast
- 2.5s failover (owner reassign on disconnect; raised from 0.8s in Session 10 to ride out school Wi-Fi jitter without spurious takeovers)
- LocalStorage-cached auth tokens carry across rooms
- **Authority model is currently client-side last-writer-wins** (audit Session 8). Documentation has historically claimed "owner authority"; that's the target, not the reality. Hits/wins/ship-placement are forgeable from a modified client. G8 backlog: server-side adjudication + term/epoch counter for owner failover.
- **Battleship + Meme Wars turn-lock** (Session 11): `state.shotSeq` monotonic counter on shared state. `tryFireAt` increments before broadcast; client-local `_pendingFireUntil` 800ms blocks rapid double-clicks; `applyRemoteState` rejects snapshots with `remoteSeq < localSeq` so turn can no longer rewind via stale echo. Concurrent fire from teammates still both register but turn doesn't double-flip.
- **Opponent-disconnect banner** (Session 11, Battleship + Meme Wars): lazy-injected fixed-position banner with Forfeit / Solo-vs-Bot actions when phase==='playing' AND opponent's turn AND presence≤1 AND turn-stale>12s.
- `memedash_win` socket has Session 8 hardening: sender-must-be-in-room, 5s per-room cooldown, score clamp, length caps on names/ids
- `bot_ai.js` (Session 10): aligned multi-cell clusters return only line extensions (no perpendicular-neighbor pursuit of cells that can't be part of an axis-aligned ship)
- **Meme Dash physics** (Session 11): fixed-substep simulation (`PHYSICS_SUBSTEP = 1/120`) makes physics frame-rate-independent up to dt = 50ms; ceiling collision blocks wall-climb; tab-out blur clears held keys; win celebration preserves scores until owner closes the overlay then resets-and-broadcasts.

---

## Security & Privacy

- Google OAuth 2.0 → JWT (12hr expiry)
- Minimal PII collected
- Per-class display names (real names hidden from students)
- Teacher-only private name access via `TeacherPrivateName` table
- All private name lookups logged to `AccessLog`
- **Session 8 hardening:**
  - `SECRET_KEY` hard-fails on boot in production (detected via `RENDER` env); ephemeral random key in dev with warning
  - Socket.IO CORS: env-driven via `ALLOWED_ORIGINS`; `*` fallback warns in prod
  - `/api/results` validates: mode whitelist, canonical outcome set, per-mode score cap, score finiteness, 16KB `details_json` cap, 1.5s/user rate limit
  - Shop `coins` decrement is atomic (UPDATE-WHERE-coins>=price), race-safe against double-click / multi-tab
  - Leaderboard rendering escapes user-supplied `display_name`/`title` and validates frame colors against a regex (closes stored-XSS sink)
  - `Skill.standard_code` is `unique=True`; seeding is idempotent per code (eliminates duplicate-row race on cold start)
  - `MasterySnapshot.id` uses cross-DB BigInt with proper autoincrement; integrity-error retry on concurrent (user, skill) inserts

---

## Infrastructure

- **Dev:** SQLite, Flask debug, eventlet
- **Prod:** PostgreSQL on Render, Gunicorn + eventlet, `render.yaml` deploy config
- **Migrations:** Alembic via `migrations/` (latest: `e6c37f7b89ac_sync_models_results_achievements_`)
- **Auto-migration pattern:** try `SELECT column`, except → `ALTER TABLE ADD COLUMN`

---

## Known Tech Debt

See **G8** in goals.md for the full audit-driven backlog. Highlights:
1. ~~XP recomputed live~~ FIXED Session 9 (User.total_xp denormalized + 60s leaderboard cache)
2. No dark-mode toggle yet
3. Coordinate plane stacks two headers (~150px chrome before canvas)
4. `best_streak` returns current streak (not historical max)
5. Shop items emoji-only (no meme-image cosmetics)
6. ~~Inconsistent outcome strings~~ DOCUMENTED Session 9 (two-vocabulary contract); typo fixed; full canonicalization still optional
7. Migrations out of sync with models (auto ALTER TABLE shim covers `users` columns only); `flask db migrate` overdue
8. Multiplayer is client-authoritative (last-writer-wins) — audit Session 8 documented; full owner-authority is G8 multi-day work
9. ~~Adaptive difficulty resets on refresh; streak math evaporates~~ FIXED Session 9 (extracted to adaptive_difficulty.js with localStorage)
10. ~70% duplicate logic between `battleship.js` and `meme_wars.js` (extract to `static/grid_battle.js`)
11. `app.py` is ~2000-LOC monolith; `main.js` is a 4129-LOC IIFE
12. ~~QR/shop modals lack focus trap and Escape handler~~ FIXED Session 9 (shared MutationObserver-based controller in base.html)
13. Bayesian mastery formula: asymmetric learn/slip rates drift mastery monotonically upward
14. **NEW** Line Mode (`line_mode.js`) never calls `recordResult` — plays don't register at all (Session 9 finding)
15. CSS animations in `game.css` (XP shimmer, fire flicker, legendary pulse, win confetti) ignore `prefers-reduced-motion` — toast layer fixed Session 9, full sweep pending
7. Teacher per-student standards heatmap not built (G6 pending)
8. `MasterySnapshot.id` requires explicit ID assignment on SQLite (BigInteger gotcha)
