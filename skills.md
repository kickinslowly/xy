# Skills - Repeatable Task Patterns

## S1: Add a New Game Mode

### Steps
1. Create route in `app.py` (e.g., `@app.route('/new-mode')`)
2. Create template in `templates/new_mode.html` (extend `base.html`)
3. Create JS file in `static/new_mode.js` (IIFE pattern)
4. Add navigation link in `templates/base.html` nav bar
5. Wire up Socket.IO events if multiplayer (join, leave, state_update, input_update)
6. Implement `window.recordResult()` calls for all completable actions
7. Add corresponding challenge types to achievements system
8. Add CSS (prefer extending `style.css` or `theme.css`, new file only if heavy)
9. Test: single-player flow, multiplayer sync, result recording, dashboard display

### Template (JS IIFE)
```javascript
(function() {
    'use strict';
    // State
    let state = {};
    // Socket
    const socket = io();
    // DOM refs
    // Init
    function init() {}
    // Game loop
    // Challenge generation
    // Answer checking
    // Result recording: window.recordResult({mode, game_name, outcome, score, duration_ms, details_json})
    // Socket handlers
    // Start
    document.addEventListener('DOMContentLoaded', init);
})();
```

---

## S2: Add a New Challenge Type to Existing Mode

### Steps
1. Define challenge generation logic (random parameters within difficulty bounds)
2. Define answer validation logic (tolerance-based for numeric, exact for categorical)
3. Add UI elements for the challenge (prompt display, input method, feedback)
4. Wire into existing challenge rotation system
5. Add `recordResult()` call with appropriate `game_name` and `details_json`
6. Tag with standards (update skills table or standards mapping)
7. Test edge cases: min/max values, negative numbers, zero, fractions

---

## S3: Implement Mastery Tracking for a Skill

### Steps
1. Ensure skill exists in `skills` table with proper strand/standard tags
2. On result submission (`/api/results`), update `mastery_snapshots`:
   - Fetch current mastery estimate (p_mastery)
   - Apply Bayesian update based on correctness and difficulty
   - Save new snapshot with timestamp
3. Expose mastery data via `/api/dashboard` or new endpoint
4. Display mastery indicator in student-facing UI (progress bar, percentage, level)
5. Use mastery level to adapt difficulty on next challenge

### Bayesian Update (simplified)
```python
# Prior: p_mastery (current estimate, 0.0-1.0)
# Likelihood: P(correct | mastered) ~0.95, P(correct | not mastered) ~0.25
# Update after correct answer:
p_new = (0.95 * p_mastery) / (0.95 * p_mastery + 0.25 * (1 - p_mastery))
# Update after incorrect answer:
p_new = (0.05 * p_mastery) / (0.05 * p_mastery + 0.75 * (1 - p_mastery))
```

---

## S4: Add an Achievement

### Steps
1. Define achievement in `achievements` table: mode, name, description, threshold
2. In `/api/results` handler, after saving result, count relevant results
3. If count >= threshold, create `user_achievements` entry
4. Return unlocked achievements in API response
5. Client-side: show unlock toast/animation on `app:result` event
6. Dashboard: display in achievements section with progress bar

---

## S5: Add a New API Endpoint

### Steps
1. Define route in `app.py` with appropriate method (GET/POST)
2. Add `@require_auth` decorator if authenticated
3. Parse request (JSON body or query params)
4. Database operations via SQLAlchemy
5. Return JSON response with appropriate status codes
6. Handle errors gracefully (try/except, meaningful error messages)
7. Test with curl or browser dev tools

---

## S6: CSS Component Pattern

### Design System Tokens
```css
/* Use existing CSS variables from style.css */
--accent: #ff6f91;
--accent2: #845ef7;
--bg: #23243a;
--card: #2d2e4a;
--text: #fff;
--radius: 18px;
--shadow: 0 4px 24px #0004;
```

### Component Pattern
```css
.component {
    background: var(--card);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 1.2em 1.5em;
    color: var(--text);
    /* Glassmorphism if overlay */
    backdrop-filter: blur(8px);
}
```

---

## S7: Socket.IO Event Pattern

### Server-side (app.py)
```python
@socketio.on('event_name')
def handle_event(data):
    room = data.get('room')
    # Process
    emit('event_response', response_data, room=room)
```

### Client-side
```javascript
socket.emit('event_name', { room: currentRoom, ...data });
socket.on('event_response', (data) => { /* handle */ });
```

---

## S8: Full Project Assessment (Emotion Loop Entry)

### Steps
1. Read `goals.md` - refresh on G1-G7 targets
2. Read `memory.md` - what was done last, what's in progress
3. Run the app mentally or actually: check each mode works
4. Assess each goal:
   - Current state vs target state
   - Progress delta since last assessment
   - Blockers or unknowns
5. Compare against competitors (Desmos, IXL, Duolingo)
6. Derive emotion signal (see emotions.md trigger map)
7. Select mode based on dominant emotion
8. Generate next task within mode constraints
9. Execute task
10. Update memory.md with what changed
11. Reassess (loop back to step 1)

---

## S9: Database Migration

### Steps
1. Modify models in `app.py`
2. Run: `flask db migrate -m "description"`
3. Review generated migration in `migrations/versions/`
4. Run: `flask db upgrade`
5. Verify with: `flask shell` -> query new table/columns

---

## S10: Test a Game Mode End-to-End

### Steps
1. Load the page in browser / verify template renders
2. Start a game/challenge
3. Complete the challenge (correct answer)
4. Verify result recorded (check `/api/dashboard` or DB)
5. Fail a challenge (incorrect answer)
6. Verify failure recorded
7. Check multiplayer: join from second client, verify sync
8. Check edge cases: refresh mid-game, disconnect/reconnect
9. Check responsive: resize to tablet/phone widths
10. Check achievements: verify unlock at thresholds
