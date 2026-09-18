---
id: task-017
kind: bug
title: No CI runs tests; the module package has no test script
issue: https://github.com/9atatimer/ninjos-foundry-mcp/issues/5
created: 2026-09-13
---

No workflow runs `npm test` or `npm run pruefen`, and
`packages/foundry-module` has no `test` script, so the root
`npm test --workspaces --if-present` skips it. The regression tests for
#2 and #3 guard nothing once merged. Details in #5.
