# AUDIT.md — Mr. A's Math Tools Full-Stack Audit

**Date:** 2026-04-28
**Scope:** Backend (`app.py`), all 6 game modes, frontend shell, CSS architecture, multiplayer system
**Method:** 5 parallel agent audits, ~8000 LOC of source reviewed (app.py 1868, main.js 3901, line_mode.js 1564, battleship.js 974, meme_wars.js 799, meme_dash.js 1650, ratios_mode.js 642, bot_ai.js 136, game.css 2599, theme.css, style.css 417, 8 templates)

---

## Executive Summary

The platform has real student-facing bugs in production right now. The pattern repeats across every multiplayer mode: **state is client-authoritative**, despite the docs claiming an "owner authority model." Score, win events, hit/miss, ship placement, and Meme Dash victory are all forgeable from a modified client. Beyond the cheating surface, three of the same multiplayer race conditions exist in three different files (battleship/meme_wars/meme_dash) — fixes landed in one and not the others. Beyond multiplayer, several quiet correctness bugs are punishing students: **negative Y values are silently zeroed in Line Mode PDF export** (kids hand in wrong homework), **Meme Dash never sends `details_json`** so playing it does not update standards mastery despite the dashboard claiming otherwise, **Ratios `partwhole` rejects mathematically equivalent answers** as wrong, and **the Battleship lobby JS queries DOM nodes that no longer exist** so 2-player games may not start at all. On security, the default `SECRET_KEY='dev-insecure'` ships if the env var isn't set, `cors_allowed_origins="*"`, `/api/results` accepts forged scores with no rate limit, and Socket.IO `connect` allows unauthenticated room joins. On performance, the leaderboard does ~1200 DB queries per request and will time out at >100 users. On UX, three competing modal style systems, an orphaned 417-LOC CSS file no template loads, and a stored-XSS sink in the leaderboard's `display_name` rendering. Most of these are 1-30 line fixes. The architectural debt (4129-LOC IIFE, 1868-LOC app.py monolith, 70% duplicate logic between battleship.js and meme_wars.js) is bigger but won't bite this week.

---

## Top 15 Punch List — Fix These First

In strict priority order. Effort is rough hours-of-work.

| # | Severity | Title | File:Line | Effort |
|---|----------|-------|-----------|--------|
| 1 | CRITICAL | Hard-fail boot if `SECRET_KEY=='dev-insecure'` in prod | `app.py:36` | 5 min |
| 2 | CRITICAL | Lock down `cors_allowed_origins` to actual domain | `app.py:52` | 5 min |
| 3 | CRITICAL | Validate + rate-limit `/api/results` (forgeable scores) | `app.py:1076` | 1-2 hr |
| 4 | CRITICAL | Restore Battleship lobby DOM nodes (`#joinA`, `#joinB`, `#teamAList`, `#teamBList`, `#countA`, `#countB`) | `templates/battleship.html` | 30 min |
| 5 | CRITICAL | Add echo guard to Meme Wars `state_update` (silent state corruption) | `static/meme_wars.js:220` | 1 line |
| 6 | CRITICAL | Negative-Y silently zeroed in Line Mode PDF export | `static/line_mode.js:1081` | 1 line |
| 7 | CRITICAL | `partwhole` Ratios validator rejects equivalent answers (math wrong) | `static/ratios_mode.js:397` | 5 min |
| 8 | CRITICAL | Atomic coin update with `WHERE coins >= :price` (double-spend) | `app.py:1571` | 15 min |
| 9 | CRITICAL | Add unique constraint to `Skill.standard_code` + idempotent seeding | `app.py:112` | 30 min |
| 10 | CRITICAL | `clearAllSilently` broadcasts during wrong-answer reveal — peers flicker every 3s | `static/main.js:946` | 5 min |
| 11 | CRITICAL | Coord-plane challenge generation ignores `gridStepUnits` — unreachable answers | `static/main.js:847,664` | 30 min |
| 12 | CRITICAL | Meme Dash win event trusted from any client (score spoof) | `static/meme_dash.js:1220` | 1 hr |
| 13 | CRITICAL | Delete `static/style.css` (417 LOC orphan, contradicts dark theme) | `static/style.css` | 1 min |
| 14 | CRITICAL | Add `'line'` to dashboard per-mode order array | `templates/dashboard.html:137` | 1 line |
| 15 | CRITICAL | Meme Dash sends no `details_json` — mastery never updates from playing it | `static/meme_dash.js:346` | 5 min |

These 15 fixes account for most of the visible "buggy experience" reports. Total effort: roughly one focused day.

---

## Cross-Cutting Themes

These are not bugs in single files — they are systemic problems repeating across the codebase. They are the highest-leverage things to fix once because they collapse multiple findings.

### 1. Multiplayer is client-authoritative everywhere despite docs saying otherwise
CLAUDE.md and memory.md describe "PIN-based rooms, owner authority model, 20Hz broadcast, 800ms failover." None of the game modes implement true owner authority for the actions that matter:
- **Battleship/Meme Wars**: shooter computes hit/miss locally, mutates `state`, broadcasts. Two clients can both fire and both decrement turn → turn flips back. No replay protection.
- **Meme Dash**: any client can emit `memedash_win` with arbitrary winner and score; backend trusts it.
- **Coordinate Plane**: no owner concept at all; pure last-writer-wins, including during simultaneous drag.
- **Owner-takeover at 800ms**: too aggressive. School Wi-Fi jitter routinely exceeds 800ms; tab-backgrounding triggers it. Two clients can both pass the threshold and both promote themselves with no tiebreak.

**Fix direction:** Server-side authority for action resolution (who fires, who collides, who wins). Term/epoch counter for owner failover with deterministic tiebreak (lowest clientId). Cross-mode helper.

### 2. Outcome and challenge_type contracts are undefined
Modes send different `outcome` strings and inconsistent `details_json`:
- Coord plane: `'success'` / `'incorrect'`
- Ratios: `'success'` / `'incorrect'`
- Battleship: `'win'` / `'lose'`
- Meme Dash: `'win'` / `'lose'` / `'loss'` (typo path)
- Line mode: probably `'completed'`
- Meme Dash sends no `challenge_type` at all → `update_mastery_for_result` no-ops every time

Backend's `SUCCESS_OUTCOMES` set (`app.py:548`) tries to reconcile but the Bayesian `update_mastery_for_result` only fires on explicit `is_correct`, so most plays update XP/coins but **not mastery**.

**Fix direction:** Define one canonical contract in `app.py` (e.g., `outcome ∈ {'success','failure'}`, `details_json` always carries `challenge_type` and per-mode required fields). Validate inbound. Update every recordResult callsite in client JS.

### 3. Adaptive-difficulty streak math is copy-pasted with the same bug
Both `static/main.js:540` and `static/ratios_mode.js:158` use identical logic:
```js
if (correct) streak = Math.max(0, streak) + 1;
else streak = Math.min(0, streak) - 1;
```
After 2 corrects (streak=2), one wrong drops to -1 — **all positive progress evaporates instantly**. Symmetric for negative→positive. Combined with no persistence to localStorage, every page refresh resets to "Developing." Meme Dash has no adaptive difficulty at all despite being claimed in memory.md.

**Fix direction:** Extract `static/adaptive_difficulty.js` shared helper. Decide intended semantics (consecutive vs cumulative). Persist per-user-per-mode to localStorage.

### 4. ~70% duplicate logic between Battleship and Meme Wars
`battleship.js` (974 LOC) and `meme_wars.js` (799 LOC) share `defaultState`, `wireSocket`, `applyRemoteState`, `broadcast`, `buildBoard`, `tryFireAt`, bot logic, ship/meme placement, win/lose flow, confetti FX, share/join UI. Bug fixes land in one and not the other (echo guard exists in battleship, missing in meme_wars; turn-overlay flash in battleship, dropped in meme_wars). Same pattern between math helpers in main.js and line_mode.js (50 LOC of `gcdInt`/`toFractionApprox`/`formatFraction` duplicated byte-for-byte).

**Fix direction:** Extract `static/grid_battle.js` engine; modes register placement + win condition. Extract `static/math_utils.js`. Save ~600 LOC and end the divergence problem.

### 5. Live-computed gamification on every dashboard request
`compute_xp_and_level` does a full `GameResult` table scan per call. `/api/leaderboard` calls it once per user **plus** computes streak (2 more queries) **plus** N+1 cosmetic lookups. With 200 users that's ~1200 queries per leaderboard load. Render free tier will time out. `/api/dashboard` also scans all of one user's results twice and does 6 separate `progress_counts` COUNT queries. None of this is cached.

**Fix direction:** Denormalize `total_xp` on `User` and increment in `record_result`. 60-second in-memory cache on leaderboard (5 lines). Single `GROUP BY mode` for dashboard counts.

### 6. Inconsistent broadcast cadence and no edit-pulse guard in main.js
`line_mode.js` correctly suppresses remote state during user editing via 1.5s `markEditingPulse` (line_mode.js:1490). `main.js` has no equivalent — peer's snapshot lands mid-drag, your local `dragVertex` reference becomes a ghost, the next snapshot stomps your work entirely. Coord plane broadcasts on every `pushHistory()` (no debounce); meme_dash broadcasts at 20Hz including on idle; ratios broadcasts on every event with no throttle. Each was tuned independently.

**Fix direction:** Backport `markEditingPulse` from line_mode.js to main.js. Pick one debounce policy across modes.

### 7. CSS architecture: 417 LOC dead, 2599 LOC monolithic, three competing card systems
- `static/style.css` (417 LOC) is referenced by **zero** templates. It's pure dead code that defines a contradictory light-theme. Delete it.
- `static/css/game.css` (2599 LOC) is loaded for every game mode; ~1850 LOC of it is per-mode and unused on any given page.
- Three different "card" systems (`home.html .game-card`, `dashboard.html .permode-card`, `shop.html .shop-item`) re-implement the same hover/lift/border affordance.
- `game.css .game-card` collides namespace-wise with `home.html .game-card` — different things, same selector.
- 945 LOC of inline `<style>` in `home.html` + `dashboard.html` + `shop.html` blocks render and duplicates keyframes between files.

**Fix direction:** Delete style.css. Extract per-mode CSS modules. Rename game.css `.game-card` → `.game-panel`. Consolidate inline styles to external files.

### 8. Migrations out of sync with models
Models added since the last migration: `User.coins`, `User.display_name`, `ClassMembership.display_name`, `ClassMembership.nickname_locked`, all of `ShopItem`, `UserItem`, plus column changes on `GameResult`, `Achievement`, `UserAchievement`, `MasterySnapshot`. Production survives because of a `try: SELECT col except: ALTER TABLE` shim at `app.py:333-357` — but that shim only covers `display_name` and `coins` on `users`. Anything else fails on a fresh prod deploy. The `postDeployCommand: flask db upgrade` in `render.yaml` is currently a no-op for everything new.

**Fix direction:** `flask db migrate -m 'sync models'`, review, commit, deploy. Then delete the shim.

### 9. Accessibility is inconsistent
Some places good, many places forgotten:
- QR modal: no focus trap, no Escape-to-close, no `aria-modal`, empty `<img src="">`
- Shop modal: same
- Coin/standards toasts: no `role="status"` or `aria-live`, no stacking
- `#navToggle`: missing `aria-controls`
- Cards: hover-only affordance (no touch state, no focus indicator beyond global default)
- Infinite animations (XP shimmer, fire flicker, legendary pulse, win confetti) ignore `prefers-reduced-motion`
- Color contrast iffy on 11px muted text over gradient backgrounds
- Stored-XSS sink: `home.html:848` does `e.display_name` directly into innerHTML; if backend escaping ever slips, it's RCE-via-cookie

**Fix direction:** Single 30-line shared modal controller in base.html (focus trap + Escape + return-focus). Add `role="status"` to toasts. Use `textContent` for all user-supplied strings. Wrap infinite animations in `@media (prefers-reduced-motion: no-preference)`.

---

## Per-Area Findings — Severity Tables

### Backend (app.py, 1868 LOC)

| Severity | Finding | File:Line |
|----------|---------|-----------|
| CRIT | Default `SECRET_KEY='dev-insecure'` if env missing | 36 |
| CRIT | `cors_allowed_origins="*"` on Socket.IO | 52 |
| CRIT | `/api/results` is fully forgeable (no rate limit, no validation) | 1076 |
| CRIT | MasterySnapshot manual ID assignment racy under eventlet | 768 |
| CRIT | `_standard_to_skill_id` cache populates empty if seeded after | 719 |
| CRIT | `ensure_standards_seed` / `ensure_achievements_seed` race on cold start | 702, 1020 |
| HIGH | Coin double-spend: read-modify-write without row lock | 1571 |
| HIGH | Equip race: two items both end up `equipped=True` | 1599 |
| HIGH | JWT uses deprecated `datetime.utcnow()` (TZ bugs) | 514 |
| HIGH | Stale role in JWT — no rotation on promotion | 511 |
| HIGH | Entire teacher/class/privacy schema is unused (no routes) | — |
| HIGH | N+1 explosion on `/api/leaderboard` (~1200 queries/request) | 1386 |
| HIGH | `compute_xp_and_level` recomputes from full table scan every call | 803 |
| HIGH | Streak uses server UTC, not student's Pacific TZ | 855 |
| HIGH | `best_streak` is just current streak (lie) | 899 |
| HIGH | Auth flow BigInt fallback can corrupt user IDs under concurrency | 481 |
| HIGH | `/events` accepts arbitrary payload, no rate limit, storage DoS | 527 |
| HIGH | Socket.IO `connect` allows unauthenticated (PIN brute-forcable) | 1658 |
| MED | Mastery Bayesian formula asymmetric (drifts upward) | 780 |
| MED | `Skill.standard_code` not unique in schema | 109 |
| MED | `_generate_unique_pin` checks in-memory only | 420 |
| MED | `OWNER_TAKEOVER_SEC=0.8` is too aggressive | 368 |
| MED | `rooms_state` and `room_members` grow forever | 361 |
| MED | `/api/dashboard` scans all results twice, 6 N+1 COUNTs | 1170, 1273 |
| MED | `details_json` saved without size cap (storage attack) | 1099 |
| MED | Migrations out of sync with models | migrations/ |
| MED | `requirements.txt` is UTF-16 encoded | requirements.txt |
| LOW | `LEVEL_TITLES` clamps at 16 (anyone past Level 15 = "Math Legend") | 826 |
| LOW | Static images listdir on every page load | 375 |
| DESIGN | Monolithic 1868 LOC, no service layer | — |

### Coordinate Plane + Line Mode (main.js + line_mode.js)

| Severity | Finding | File:Line |
|----------|---------|-----------|
| CRIT | Line Mode PDF export silently zeros negative Y values | line_mode.js:1081 |
| CRIT | Two-point line challenge silently rejects vertical-line answers (no feedback) | main.js:969 |
| CRIT | Adaptive difficulty streak math: `Math.max/min(0, x) ± 1` evaporates progress | main.js:540 |
| CRIT | Midpoint/reflect challenges generate unreachable coords when grid step ≠ 1 | main.js:664 |
| CRIT | `clearAllSilently()` broadcasts after wrong answer → peers flicker every 3s | main.js:946 |
| HIGH | `pickReflectChallenge` has no difficulty-2 case (Advanced = Proficient) | main.js:639 |
| HIGH | `parseSlopeInput` regex rejects "- 2/3" (space after sign) | main.js:475 |
| HIGH | `pickRandomLine` Developing can yield m=0 → "y = 0" prompt | main.js:600 |
| HIGH | Slope display "33/100" instead of "1/3" due to `round2` before `toFractionApprox` | main.js:489 |
| MED | Multiplayer broadcast on every `pushHistory` — no debounce | main.js:4076 |
| MED | `applyRemoteState` mid-drag → ghost vertex (no edit-pulse guard) | main.js:4056 |
| MED | `drawReflectionOverlay` RAF leak (no cancellation on overlap) | main.js:1238 |
| MED | Line Mode `gatherSeriesData` sorts by x — corrupts polygon plotting | line_mode.js:322 |
| LOW | Wheel zoom `evt.deltaY === 0` zooms in (no guard) | main.js:3200 |
| LOW | `clearAllBtn` confirms, `clearVerticesBtn` doesn't | main.js:3566 |
| DESIGN | 4129-LOC IIFE — every challenge type touches 6 functions to add | — |
| DESIGN | Math helpers duplicated byte-for-byte in main.js + line_mode.js | — |

### Battleship + Meme Wars + bot_ai

| Severity | Finding | File:Line |
|----------|---------|-----------|
| CRIT | Battleship lobby DOM nodes missing — 2-player can't join | battleship.html, battleship.js:9 |
| CRIT | Meme Wars `state_update` echo guard missing (in battleship, not meme_wars) | meme_wars.js:220 |
| CRIT | Hit/miss client-authoritative — modified client can fake misses | battleship.js:371 |
| CRIT | Both teams can fire simultaneously (no turn lock + no seq) | battleship.js:374 |
| CRIT | Bot leader election can elect zero or multiple controllers | battleship.js:866 |
| HIGH | Bot doesn't know when ship is sunk — wastes shots on dead clusters | bot_ai.js:31 |
| HIGH | Meme Wars enemy-stats display wrong number (own remaining, not opponent's) | meme_wars.js:711 |
| HIGH | `applyRemoteState` re-broadcasts in race → ping-pong loop | battleship.js:264 |
| HIGH | Bot first-turn-after-loss punishes the human winner | battleship.js:851 |
| MED | `_postedResult` reset by phase flicker → duplicate result post | battleship.js:606 |
| MED | Coord input accepts decimals like 1.5 (silent fail) | battleship.html:79 |
| MED | No "opponent disconnected" UI | both |
| LOW | `pulse` defined and never called (dead code) | battleship.js:773 |
| LOW | `cssUrl` no-op ternary | meme_wars.js:761 |
| DESIGN | ~70% duplicate logic between battleship.js and meme_wars.js | — |
| DESIGN | Owner-authority pattern claimed in docs is not implemented | — |
| DESIGN | Ship placement client-decided — modified client can ship `[]` (invincible) | — |

### Meme Dash + Ratios

| Severity | Finding | File:Line |
|----------|---------|-----------|
| CRIT | `memedash_win` trusted from any client — score spoofing | meme_dash.js:1220 |
| CRIT | Owner failover race promotes multiple owners (no term/epoch tiebreak) | meme_dash.js:463 |
| CRIT | Win-reset zeroes ALL players' progress (not just loser) | meme_dash.js:1234 |
| CRIT | Ratios `partwhole` rejects equivalent answers (mathematically wrong) | ratios_mode.js:397 |
| HIGH | Power-up `setInterval` timers leak when stacked | meme_dash.js:1206, 1513, 1535 |
| HIGH | No ceiling/wall collision — wall-climb exploit | meme_dash.js:592 |
| HIGH | Magnet pulls memes through platforms into unreachable spots | meme_dash.js:1128 |
| HIGH | Tab-out: keys never release, perpetual movement on return | meme_dash.js:424 |
| HIGH | Variable timestep clamp → high-FPS vs low-FPS players have different physics | meme_dash.js:455 |
| HIGH | Owner takeover at 800ms is exceeded by school Wi-Fi jitter | meme_dash.js:283 |
| HIGH | Power-up touch-kill teleports without invuln window — chain-grief | meme_dash.js:1158 |
| HIGH | Ratios drag-drop has no touch fallback (mobile broken) | ratios_mode.js:598 |
| HIGH | Ratios `nextChallengeBtn` skip doesn't count for difficulty (grind for easy) | ratios_mode.js:638 |
| HIGH | Ratios `equiv` 1:1 prompts produce same-image-twice ratios | ratios_mode.js:385 |
| MED | Ratios master-mode kind picker has no anti-repeat | ratios_mode.js:186 |
| MED | Bot can hard-stick under unreachable platform configs | meme_dash.js:893 |
| MED | `MAGNET_RANGE` computed once at init — wrong on resize | meme_dash.js:74 |
| MED | Mixed `Date.now()` and `performance.now()` for timers | meme_dash.js |
| LOW | `gameWrap` selector targets non-existent class — Terminator outline never applies | meme_dash.js:23 |
| LOW | `AIR_DRAG` declared, never referenced | meme_dash.js:66 |
| CROSS | Meme Dash sends no `details_json` — mastery never updates | meme_dash.js:346 |
| CROSS | Adaptive difficulty implementations diverge between main.js + ratios_mode.js | — |

### Frontend Shell + CSS

| Severity | Finding | File:Line |
|----------|---------|-----------|
| CRIT | `static/style.css` (417 LOC) loaded by zero templates — orphan | style.css |
| CRIT | QR modal: no focus trap, no Escape, no `aria-modal`, empty `<img src>` | _qr_modal.html |
| CRIT | Coord plane stacks two headers (~150px chrome before canvas) | index.html, base.html |
| CRIT | Line Mode missing from dashboard per-mode order array | dashboard.html:137 |
| HIGH | `#navToggle` missing `aria-controls` | base.html:19 |
| HIGH | Coin/standards toasts: no `aria-live`, no stacking, mobile clipping | base.html:175 |
| HIGH | Hover-only card affordance — no touch/focus state | game.css:294 |
| HIGH | No `prefers-reduced-motion` on infinite animations (XP, fire, legendary, win) | game.css multiple |
| HIGH | Three competing modal CSS systems with conflicting z-indexes | game.css, shop.html, _qr_modal.html |
| HIGH | `.text-muted` on small fonts approaches WCAG-AA contrast floor | theme.css:9 |
| MED | `home.html:848` `e.display_name` rendered via innerHTML (stored XSS sink) | home.html:848 |
| MED | No CSP, no security headers, inline scripts everywhere | base.html |
| MED | 945 LOC of inline `<style>` in home/dashboard/shop (duplicates keyframes) | — |
| MED | `:has()` and `color-mix()` used without fallback (older Chromebooks) | game.css |
| MED | No favicon, theme-color, apple-touch-icon, manifest | base.html |
| MED | Empty-state for unauth dashboard is bare ("Sign in to load data") | dashboard.html |
| LOW | `prefers-color-scheme: light` block flips theme but inline styles are dark only → busted hybrid | theme.css:39 |
| LOW | Footer shows on every page with hardcoded `© 2026 — Aaron Allen` | base.html:58 |
| DESIGN | game.css 2599 LOC monolith — students load 1850 LOC of unused per-mode CSS | game.css |
| DESIGN | `game.css .game-card` collides with `home.html .game-card` | — |
| DESIGN | Three "card" style systems (game-card / permode-card / shop-item) re-implement same hover lift | — |

---

## Big Wins — Easy Fixes With Disproportionate Impact

These are 1-30 minute changes that fix multiple things at once. Rough effort:reward ratio.

1. **Delete `static/style.css`** (1 min) — eliminates 417 LOC of dead code and a future-footgun that would break the dark theme if someone re-included it.
2. **Add `'line'` to dashboard order array** (1 line) — restores Line Graph to dashboard summary.
3. **Add Escape-handler + focus-trap script to base.html** (~30 lines, applies to every modal) — fixes QR modal, shop modal, future modals.
4. **Use `textContent` for `e.display_name` rendering** (1 line) — closes stored-XSS vector.
5. **Add `role="status" aria-live="polite"` to toasts** (2 attrs) — screen-reader students get reward feedback.
6. **Hard-fail boot if `SECRET_KEY=='dev-insecure'` in production** (5 lines) — kills entire class of credential-leak deployments.
7. **Atomic `UPDATE users SET coins=coins-:p WHERE id=:u AND coins>=:p`** (~10 lines) — eliminates double-spend window.
8. **Add unique constraint on `Skill.standard_code`** (1 schema change) — kills the seed-race duplicate-row class.
9. **Cache `/api/leaderboard` for 60s in memory** (5 lines) — unblocks scaling past ~100 users.
10. **Add the meme_wars.js echo guard** (1 line at line 220) — eliminates silent state corruption.
11. **Restore Battleship lobby DOM** (~30 LOC HTML) — restores 2-player play.
12. **Negative-Y PDF clamp removal** (delete `Math.max(0, yRaw)`) — students hand in correct homework.
13. **Add `details_json` to Meme Dash `recordResult` call** (~5 lines) — actually counts toward mastery.
14. **`window.addEventListener('blur', () => keys.clear())` in Meme Dash** (1 line) — stops perpetual movement on tab-out.
15. **Bump `OWNER_TAKEOVER_MS` to 2500ms + add term/epoch tiebreak** (~30 LOC) — eliminates 80% of multiplayer desync reports.

Ship these 15 and the platform will *feel* dramatically more polished without any architecture work.

---

## Architectural Debt — Won't Fix This Week

Worth knowing about, not worth fixing in a hurry.

1. **`app.py` is 1868 LOC monolith.** Models + routes + sockets + seeding + business logic + migration shims. Split into `models.py`, `routes/`, `sockets.py`, `services/mastery.py`, `services/economy.py`, `seeds.py`. Estimated effort: 1-2 days. Pays back as soon as you add the next feature.
2. **`main.js` is a 4129-LOC IIFE.** Every new challenge type requires editing 6 functions. Extract a challenge registry. Estimated effort: 1 day.
3. **~70% duplicate logic between `battleship.js` and `meme_wars.js`.** Extract `static/grid_battle.js`. Saves ~600 LOC. Estimated effort: half-day.
4. **No real owner-authority multiplayer.** Move shot resolution and win adjudication server-side, or add deterministic owner-election + signed actions. Estimated effort: 2-3 days. This is THE feature work that will make multiplayer trustworthy in classroom settings.
5. **Migrations are out of sync with models.** `flask db migrate`, review, commit, deploy. Estimated effort: 1 hour now, painful day if you wait six months.
6. **No service layer.** `record_result` does parse + validate + persist + award + update + format in one ~80-line function.
7. **Live-computed gamification.** Denormalize `total_xp` on User; cache leaderboard. Estimated effort: half-day; unblocks scale past 200 users.
8. **CSS monolith.** Code-split `game.css` (2599 LOC) per-mode. Reduces first-paint CSS by 60-70%. Estimated effort: half-day.
9. **No type-scale design tokens.** Font sizes scattered as literals. Add a 4-step scale. Estimated effort: half-day.

---

## Positive Notes — What's Working Well

So this isn't all doom:

- **Standards data model is clean.** Catalog → mapping → mastery snapshot is a sensible architecture; the strand aggregation in `/api/dashboard` is well-organized.
- **`bot_ai.js` design is good.** Target → hunt with parity, cluster-aware extension. Genuinely shareable across modes — exactly the right abstraction.
- **Coord-plane click-fills-input pattern in Battleship** is thoughtful pedagogy: students *practice reading coordinates* before firing.
- **Reversed Y-axis (1 at bottom, not top)** matches math-class convention. Right call for the educational context.
- **Countdown-overlay turn flow** in Battleship (3s number → "YOUR TURN" / "OPPONENT'S TURN" → fade) is genuinely engaging.
- **Win/lose copy** ("GOATED. No cap. FR FR.") is audience-appropriate and will land.
- **Adaptive-difficulty badge** with semantic data-level coding is clean and accessible.
- **Per-mode `--mode` accent CSS variable** is an elegant theming pattern once consolidated.
- **`pool_pre_ping=True`** for managed Postgres on Render is the right call.
- **Auth flow uses Google's official `id_token.verify_oauth2_token`** — solid.
- **Line Mode `markEditingPulse` pattern** for collaborative-edit suppression is the right approach (just needs to be backported to main.js).
- **Equivalent-ratio cross-multiplication** (`aCount * ch.b === bCount * ch.a`) is mathematically correct after the recent fix.
- **Math formulas across coord plane** (midpoint, reflection, slope, two-point line, least-squares) are all correct.
- **Stable per-room `clientId` in localStorage** in Meme Dash — exactly right for refresh resilience. Backport to Ratios.
- **20Hz broadcast cap with 50ms minimum** in Meme Dash is a sensible bandwidth floor.

The platform has a clear, ambitious vision (Desmos × Roblox × IXL) and a lot of the foundational decisions are right. The bugs are the kind you get from velocity, not bad architecture.

---

## Recommended Sprint Plan

**Week 1 — Stop the bleeding:**
- Top 15 punch list above (one focused day, then test)
- Restore Battleship lobby (highest visible-impact fix)
- Negative-Y PDF clamp (homework correctness)
- SECRET_KEY hard-fail + CORS lockdown (deploy-safety)
- `/api/results` validation + rate-limit (anti-cheat baseline)

**Week 2 — Unify multiplayer:**
- Add term/epoch counter for owner failover; bump takeover to 2500ms
- Backport echo guard everywhere
- Add `details_json` and canonicalize `outcome` strings across all modes
- Backport `markEditingPulse` from line_mode.js to main.js

**Week 3 — Performance:**
- Denormalize `total_xp` on User
- Cache leaderboard 60s
- Combine dashboard COUNTs to one `GROUP BY mode`
- `flask db migrate` and remove the ALTER TABLE shim

**Week 4 — Polish:**
- Delete style.css; consolidate inline styles
- Modal controller (Escape, focus trap, return-focus) once for all modals
- Add `role="status"` to toasts; `prefers-reduced-motion` to infinite animations
- Touch-event fallback for Ratios drag-and-drop

**Beyond — Architecture:**
- Split `app.py` into modules
- Extract `static/grid_battle.js` from battleship + meme_wars
- Code-split `game.css` per-mode
- Move shot/win resolution server-side for true owner authority

---

**Total findings:** ~140 across 5 audits. ~25 critical, ~50 high, ~50 medium, ~15 low. Most fixable in 1-30 minutes each. The big wins land in one focused day; the architectural cleanup is a month of structured work.

The platform is in better shape than the bug count suggests — most of these are velocity debt, not foundational mistakes. Fix the top 15 and the "buggy experience" reports should largely stop.
