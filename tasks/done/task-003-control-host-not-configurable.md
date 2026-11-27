---
id: task-003
kind: task
title: Make CONTROL_HOST environment-configurable the way CONTROL_PORT is
created: 2026-09-12
---

`CONTROL_HOST` is a hardcoded `'127.0.0.1'` in both halves of the server
-- `packages/mcp-server/src/backend.ts:54` and
`packages/mcp-server/src/index.ts:23` -- while the port beside it already
reads `process.env.FOUNDRY_MCP_CONTROL_PORT` at
`backend.ts:58` and `index.ts:27`.

This blocks running the backend in a container: a process bound to
loopback inside a container is unreachable through `-p`.

Follow the shape `CONTROL_PORT` already uses, so the two settings stay
symmetrical, and keep `127.0.0.1` as the default -- task-002 is moving the
other listeners toward loopback, not away from it.
