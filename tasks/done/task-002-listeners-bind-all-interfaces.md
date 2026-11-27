---
id: task-002
kind: bug
title: The bridge and signaling listeners bind 0.0.0.0, not loopback
created: 2026-09-12
---

## Symptom

The bridge (31415) and the WebRTC signaling server (31416) listen on all
interfaces. `foundry-connector.ts:220` calls
`this.httpServer.listen(this.config.port, ...)` with no host argument, so
Node binds the wildcard address.

The control channel does it correctly by contrast --
`backend.ts:2155` passes `CONTROL_HOST` and lands on `127.0.0.1`.

## Impact

Both ports are reachable from anywhere on the LAN. Combined with task-001
-- no origin check on one, `Access-Control-Allow-Origin: *` on the other
-- nothing on the path from a machine on the same network to a tool call
requires authentication.

Nothing needs off-box reach. In both supported topologies the browser and
the MCP server are on the same machine: the module dials
`ws://localhost:31415` from the GM's browser, whether Foundry is served
from `localhost:30000` or from Forge over HTTPS.

## Evidence

`lsof` against a running backend on 2026-09-12, showing the wildcard bind
on two of three ports and the correct loopback bind on the third:

```
node  6037  TCP *:31416 (LISTEN)
node  6037  TCP 127.0.0.1:31414 (LISTEN)
node  6037  TCP *:31415 (LISTEN)
```
