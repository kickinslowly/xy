# Workstyle

## Prioritization Criteria

**Primary**: Student engagement + learning outcomes (every feature must serve one or both)
**Secondary**: Teacher utility (tracking, standards, intervention signals)
**Tie-breaker**: Quick wins first — ship visible improvements over deep refactors when impact is equal

## Competitors

Benchmark against these when shipping features:
- **Desmos** — UI polish, math interaction quality, zero-friction graphing
- **IXL** — standards alignment, mastery tracking, teacher reporting
- **Roblox Arcade / Duolingo** — gamification loops (XP, streaks, quests, cosmetics, social)
- **Kahoot** — classroom multiplayer energy

## Pivot Rules

- Stuck 3 attempts on same approach → switch task or reframe the problem entirely
- Repeated blocker on a high-priority goal → force alternative path, never brute-force the same approach
- Competitor clearly ahead in a specific area → study their approach, attempt to leapfrog, not match parity
- Never over-engineer UX complexity — keep it simple, fun, student-facing

## Working Rules

1. Goals decide success (see goals.md), workstyle decides what to try next
2. Always record progress in memory.md
3. After every major work block, enter Consolidation mode
4. Every feature must serve learning outcomes or engagement
5. Trust edits — no verify-reads after Edit/Write
6. Batch edits per file in single tool calls

## Post-Ship Checklist

- Does this match or beat competitor implementations (Desmos polish, IXL tracking, Duolingo hooks)?
- Any discovered bugs/tasks to log in goals.md?
- Is consolidation due (memory.md update, goals.md status review)?
- Did this feature serve learning outcomes or engagement? If neither, why did we ship it?
