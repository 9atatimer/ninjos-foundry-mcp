---
id: task-015
kind: task
title: Release the module so the #3 fix reaches the Forge game
issue: https://github.com/9atatimer/ninjos-foundry-mcp/issues/3
created: 2026-09-13
---

The fix for #3 (generated maps auto-activating and pulling players onto
them) lives in `packages/foundry-module` -- `generated-scene.ts` and
`socket-bridge.ts`, commit 2dc2ab5 on `claude/youthful-meitner-5ohkar`.
Forge runs the released module (14.2609.5), so until a release is cut and
installed there, every `generate-map` still activates the new scene.

Blocked by the feature branch reaching `main` through a PR; the branch
was unpushed at retrospective time.

Done when: a `v<version>-beta<n>` release containing 2dc2ab5 is installed
on the Forge world, and a `generate-map` run leaves the active scene
unchanged.
