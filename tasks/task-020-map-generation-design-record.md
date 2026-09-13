---
id: task-020
kind: task
title: Decide whether map generation needs a design record
issue: https://github.com/9atatimer/ninjos-foundry-mcp/issues/8
created: 2026-09-13
---

Map generation was changed in-session on 2026-09-12 without a design
record: tiled VAE decode (#2), the battlemap checkpoint restored,
generated scenes gridless, lit, inactive and out of the nav bar (#3). The
changes are recorded as fact in `.claude/skills/foundry-battlemap/`, but
nobody has reviewed them as design. Gridless has a known cost: it trips
`automated-conditions-5e` range checks.

Blocked on a human decision (#8). Once decided, #4 and #7 follow from it.
