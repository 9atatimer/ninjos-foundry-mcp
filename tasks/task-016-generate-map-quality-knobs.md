---
id: task-016
kind: bug
title: generate-map exposes no quality/steps knob
issue: https://github.com/9atatimer/ninjos-foundry-mcp/issues/4
created: 2026-09-13
---

`buildWorkflow()` supports `quality` (8 / 20 / 35 steps) but the tool
schema never passes it, so every map is an 8-step txt2img. That settles
layout, not detail. The usable Roc's Eyrie map needed a 30-step img2img
run outside the tool. Details and intended fix in #4.

Interacts with #8: whether a two-stage mode belongs in the tool is a
design call.
