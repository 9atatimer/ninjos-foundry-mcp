---
id: task-004
kind: bug
title: The module stops retrying the bridge, and the backend's own lifecycle triggers it
created: 2026-09-12
---

## Symptom

When the backend goes away, the module retries a bounded number of times,
then parks permanently at `MCP: disconnected` -- "No bridge to
localhost:31415. Is the MCP server running on the PC? Click to try
again." It does not recover when the backend returns. A human must click
the indicator.

## Impact

This is not an edge case, because the backend is _designed_ to exit: it
shuts down a configurable interval after the last wrapper disconnects
(`FOUNDRY_MCP_IDLE_SHUTDOWN_MS`, default 60000). So the ordinary act of
closing Claude Desktop and reopening it later kills the backend, burns the
module's retry budget while it is gone, and leaves the bridge down after
it comes back.

The two halves' lifecycles disagree. One is built to come and go; the
other gives up permanently the first time it does.

Note also that the idle timer counts _wrapper_ connections only -- the
backend exits while a Foundry module is still bridged to it on 31415.

## Evidence

Observed 2026-09-12, unprompted, on the local rig.

- Backend PID 4877 started, module connected, round trip verified.
- An MCP wrapper connected for a tool call, then disconnected.
- ~60s later the backend exited on its own with code 0, sole log line
  `Acquired backend lock with PID 4877`. Foundry and the module were still
  running and still bridged.
- Module indicator during the outage:
  `{"text":"MCP: connecting...","title":"Attempt 5","cls":"mcp-status mcp-status--connecting"}`
- Backend restarted as PID 6037, listening on 31415 again.
- Module indicator 40s after the backend was back, having never
  reconnected:
  `{"text":"MCP: disconnected","title":"No bridge to localhost:31415. Is the MCP server running on the PC? Click to try again.","cls":"mcp-status mcp-status--disconnected"}`
- Clicking the indicator reconnected immediately, and the end-to-end tool
  call succeeded again.

The reconnect scheduler is `scheduleReconnect` in
`packages/foundry-module/src/socket-bridge.ts`, driven by
`this.reconnectAttempts`.
