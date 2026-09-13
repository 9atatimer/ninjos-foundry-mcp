---
id: task-019
kind: bug
title: Generated scenes send a dead 'permission' key; decide the ownership default
issue: https://github.com/9atatimer/ninjos-foundry-mcp/issues/7
created: 2026-09-13
---

`map-scene.ts` sends `permission: { default: 2 }`, which Foundry v13
ignores, so generated scenes are created with `ownership.default: 0`.
Players could not see The Roc's Eyrie until it was granted per user.
Needs a human decision on the intended default; details in #7.
