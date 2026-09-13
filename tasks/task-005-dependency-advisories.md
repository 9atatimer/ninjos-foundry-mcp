---
id: task-005
kind: task
title: Clear the npm advisories, starting with the four critical ones
created: 2026-09-12
---

`npm install` on a clean clone reports 42 advisories -- 1 low, 9 moderate,
28 high, 4 critical (observed 2026-09-12, npm 11.16.0, node 24.18.0).

`axios` and `ws` are runtime dependencies of the server, so these are not
all confined to the build. `npm audit fix` is reported to clear most of
them without breaking changes; the remainder need reading one at a time.

Run `npm audit` for the current list rather than trusting the counts
above -- they are a snapshot, and the advisory database moves.
