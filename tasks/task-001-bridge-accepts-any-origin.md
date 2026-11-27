---
id: task-001
kind: bug
title: The bridge WebSocket and the signaling server accept any origin
created: 2026-09-12
---

## Symptom

`ws://localhost:31415` accepts a handshake from any page in any browser
tab. The WebSocket upgrade handler checks only the request path, never
`Origin`:

- `packages/mcp-server/src/foundry-connector.ts:157` -- the `upgrade`
  listener matches `pathname` against the namespace and upgrades. There is
  no `Origin` read anywhere in the file.

The WebRTC signaling server on 31416 actively grants every origin:

- `packages/mcp-server/src/foundry-connector.ts:89` --
  `res.setHeader('Access-Control-Allow-Origin', '*')` on every request.

## Impact

WebSockets have no same-origin policy, so any page the GM has open can
open the bridge and drive every tool the module exposes -- 79 of them as
built, including scene, actor and journal writes.

Two things make it worse than a plain race:

- `handleWebRTCOfferHTTP` (`foundry-connector.ts:402`) _preempts_ a
  healthy WebSocket peer rather than losing to it. The in-game indicator
  keeps reading `MCP: connected` while traffic routes to the attacker.
- The control channel on 31414 is reachable from a browser by
  cross-protocol POST. Its parser is line-delimited JSON and skips
  unparseable lines, so the HTTP request line and headers are discarded
  and the body line executes as `call_tool`.

## Evidence

Observed live on 2026-09-12 with the rig up (Foundry 14.359, backend
PID 6037):

```
node  6037  TCP 127.0.0.1:31414 (LISTEN)
node  6037  TCP *:31415 (LISTEN)
node  6037  TCP *:31416 (LISTEN)
```

A browser page reached the bridge and completed the handshake with no
origin challenge:

```
TCP [::1]:55769->[::1]:31415 (ESTABLISHED)   Google Chrome
TCP [::1]:31415->[::1]:55769 (ESTABLISHED)   node 6037
```

## Notes on scope

Browsers always send `Origin` on a WebSocket handshake and a page cannot
forge it, so the origin is a trustworthy discriminator here.

The legitimate origin is not a constant -- it is
`https://<world>.forge-vtt.com` for a Forge-hosted world and
`http://localhost:30000` for a local one. Both are in use on this machine.

## What the legacy upstream merge covered

The merge of `Niclasp1501/ninjos-foundry-mcp-legacy` at `5e63007`
(`connection-guards.ts`) closes most of the attack surface above:

- The bridge upgrade and the signaling offer both check `Origin`; the
  `Access-Control-Allow-Origin: *` is gone.
- The control channel on 31414 refuses input that looks like an HTTP
  request, which closes the cross-protocol POST.

What is still open, and why this task stays:

- With `FOUNDRY_ALLOWED_ORIGINS` unset, the guard trusts the first
  browser origin it sees and remembers it in `allowed-origins.json`. A
  hostile page that reaches the bridge before Foundry does is remembered
  instead. Both origins in use here (Forge and `localhost:30000`) cannot
  share one learned entry, so this rig needs the variable set anyway.
- A handshake with no `Origin` is accepted, on the reasoning that only a
  local program omits it.
- Whether the signaling offer still preempts a healthy WebSocket peer is
  not yet checked against the merged code.
- The design record this task asked for still does not exist.
