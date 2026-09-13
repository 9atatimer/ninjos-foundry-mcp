---
id: task-018
kind: bug
title: Wrapper-spawned backend starts with map generation off
issue: https://github.com/9atatimer/ninjos-foundry-mcp/issues/6
created: 2026-09-13
---

The backend inherits the wrapper's environment, and the MCP server config
sets no `COMFYUI_*` variables. A backend the wrapper spawns therefore has
map generation disabled and points at port 31411 rather than the Comfy
Desktop port 8000. Only a hand-launched backend worked. Details in #6.
