# Agent instructions -- ninjos-foundry-mcp

What an agent must know before it can work safely in this repo. Global
agent instructions load alongside this file; where they overlap, this file
wins on specificity.

## What this repo is

Two halves of one product, and they are not both servers:

- `packages/mcp-server` -- Node, stdio, runs next to Claude Desktop.
- `packages/foundry-module` -- runs in the GM's **browser**.

The **module is the client**. It dials out to the server. The server never
dials Foundry. Anything that assumes the server can reach into a running
world is wrong.

The transport layer (`foundry-connector.ts`, `webrtc-peer.ts`,
`socket-bridge.ts`, `webrtc-connection.ts`) is about 1,766 lines. The
Foundry domain code -- system adapters, tools, `data-access.ts` -- is
about 32,500. Rewrite the former; never the latter.

This repo is a fork of `Niclasp1501/ninjos-foundry-mcp`. Keep the MIT
LICENSE and Adam Dooley's copyright intact.

## The contract nothing compiles

The two halves talk over roughly a hundred bare strings -- query names --
that no compiler checks. Get one wrong and you do not get an error, you
get a silently empty list at runtime.

**Run `npm run pruefen` after any change that touches a query name.**
`pruefen:abfragen` verifies every name the server calls is registered by
the module; `pruefen:version` verifies the five version-bearing files
agree. Both must pass before a commit.

Old spellings stay registered as aliases on purpose (see the comments in
`packages/foundry-module/src/queries.ts`). Do not tidy them away -- they
are what lets a server and a module from different releases keep working.

**There is no runtime version handshake.** The halves do not refuse each
other on a version mismatch; no such gate exists in either half. Version
agreement is enforced at build time by `pruefen:version` and at runtime by
those aliases. A local dev server does not have to be tag-identical to the
module it talks to.

## Build

```
npm install
npm run build:release      # shared -> server -> bundle -> module
npm run pruefen            # must pass
```

`build:release` order matters; `npm run build` alone does not bundle.

## Running the local dev rig

Full clean-slate runbook, including the Claude Desktop wiring and the
verification steps: `docs/DEV-ENVIRONMENT.md`. The essentials:

Foundry ships a macOS `.app`, but for a dev loop run it **headless** --
logs go to stdout and no GUI window is in the way:

```
node "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/main.mjs" \
  --dataPath="$HOME/Library/Application Support/FoundryVTT" --noupnp --headless
```

Requires Node 24+ (`release.node_version` in the app's own
`package.json`). Data dir, port and licence come from
`<dataPath>/Config/`.

The app bundle is **ad-hoc signed** -- no Developer ID, no notarization,
so `spctl` rejects it and it will not launch unattended. That is how
Foundry ships it, not a sign of tampering (`codesign --verify --deep
--strict` passes). Either launch it once by hand with right-click -> Open,
or clear `com.apple.quarantine`.

Symlink the built module in so rebuilds are picked up without recopying:

```
ln -sfn "$(pwd)/packages/foundry-module" \
  "$HOME/Library/Application Support/FoundryVTT/Data/modules/ninjos-foundry-mcp"
```

Driving it from a browser without clicking through the UI:

- Launch a world: `POST /setup` with
  `{"action":"launchWorld","world":"<id>"}`.
- Enable the module: read `core.moduleConfiguration`, set your module id
  true, write it back, reload. Module settings are only registered once
  the module is active, so they cannot be set in the same pass.
- The bridge indicator is `.mcp-status`; its class carries the state
  (`--connected` / `--connecting` / `--disconnected`) and its `title`
  names the peer.

## Do not smoke-test the wrapper with a closing pipe

`printf ... | node dist/index.js` will answer `initialize` and then appear
to hang on everything after it. It is not hanging. EOF on stdin makes the
wrapper run its cleanup and close the backend socket before the reply
arrives, so responses are lost rather than delayed.

Spawn it as a child process and hold stdin open until the last response
has been read. `npm run test:mcp:schema` is the ready-made check that the
tool schemas load.

## The backend is a separate, self-terminating process

The stdio wrapper spawns a detached backend if none is listening, and the
backend exits a configurable interval after the last **wrapper**
disconnects (`FOUNDRY_MCP_IDLE_SHUTDOWN_MS`, default 60000). The timer
counts wrappers only -- it will exit while a Foundry module is still
bridged to it.

Two consequences when working on this repo:

- A rig you verified as healthy can be dead a minute later. Re-check
  before reporting it up, or start the backend with a long
  `FOUNDRY_MCP_IDLE_SHUTDOWN_MS` when it needs to outlive your test.
- Set `FOUNDRY_MCP_CONTROL_PORT` to something other than 31414 to exercise
  a second backend without killing the one currently bridged to a world.

## Ports

- `31414` backend control channel -- loopback, unauthenticated,
  line-delimited JSON.
- `31415` bridge WebSocket -- currently binds `0.0.0.0` (task-002).
- `31416` WebRTC signaling -- currently binds `0.0.0.0`, sends
  `Access-Control-Allow-Origin: *` (task-001).

## Connection type: set it explicitly

Set the module's `connectionType` to `websocket`. Do not leave it on
`auto`.

`auto` picks WebRTC whenever the page is HTTPS, and the WebRTC path
hardcodes `iceServers: []` (`webrtc-peer.ts:57`), ignoring every
configured STUN server. Plain `ws://` to a loopback host is legal even
from an HTTPS page -- loopback counts as a trustworthy origin -- and
`socket-bridge.ts` implements exactly that carve-out deliberately. So
websocket mode is both simpler and the only one that reliably works, on
Forge and locally alike.

## Forge-hosted worlds

Forge has no modules directory you can write to, so there is no symlink
loop there. The iteration path is a release:

- Tag `v<version>-beta<n>`. `release-modul.yml` builds, zips and attaches
  `module.json` + `module.zip` to a GitHub release, and the catalog
  submission step is gated on `!contains(ref_name, 'beta')` so a beta tag
  never reaches the Foundry registry.
- Install in Forge from that release's `module.json` URL.

The topology is unchanged from local: the browser and the MCP server are
both on the GM's machine, and the module dials `ws://localhost:31415` from
a page served over HTTPS.

**The two halves ship on different clocks.** A server fix is live as soon
as the local backend is rebuilt and restarted. A module fix is not live on
Forge until a release is cut *and* installed there -- the live game keeps
running the old module code. On 2026-09-12 the fix for #3 (generated maps
auto-activating) was committed and tested while the Forge game still ran
14.2609.5, so the next generated map still yanked every player onto it.
When a fix lives in `packages/foundry-module`, say it is not live yet and
work around it in the running game until the release is installed.

## The GM browser: the debug Chrome, never the human's main Chrome

The world is driven from a dedicated debug Chrome whose profile holds the
Forge login: `~/.cache/chrome-devtools-mcp/chrome-profile`. Attach to it
with the `chrome-devtools` MCP (`mcp__chrome-devtools__*`) -- calling
`list_pages` or `new_page` launches it on that profile if it is not
already running. The game URL is `https://forge-vtt.com/game/tds-mainland`.

- Never quit, restart, or attach to the human's everyday Google Chrome
  (`chrome-attached`, `claude-in-chrome`, `osascript quit`). It holds
  their personal session and is not this project's browser.
- To confirm which browser is up:
  `ps aux | grep Chrome | grep -oE 'user-data-dir=[^ ]+' | sort -u` must
  show the profile above.
- "Restart the browser so I can sign in" means: open the debug Chrome at
  the game URL, then wait for the human to sign in and launch the world
  before running the foundry-mcp preflight.

## Language

Script names, workflow files and many code comments are German
(`pruefen` = verify, `abfragen` = queries, `ursprung` = origin/upstream).
Docs under `docs/` are mixed. Match the surrounding language when editing;
do not translate a file wholesale as a side effect of another change.

## Infrastructure

The fleet's infrastructure-as-code lives in the private infra repo
[tds-internal](https://github.com/9atatimer/tds-internal) under
`ops/terraform/`; its `docs/policy/{INFRASTRUCTURE,TERRAFORM,CREDENTIALS}.md`
are the rules and win over anything here.

This repo owns no long-lived cloud resource. It ships releases only: the
MCP server, the Foundry module and the installer, built by
`build-complete-release.yml` and published by `release-modul.yml` to GitHub
Releases and the Foundry package catalog. The Foundry worlds it talks to
are hosted elsewhere and are not provisioned from here.

Secrets this repo's workflows read, names only (registry: tds-internal
`ops/credentials/REGISTRY.md`): `PACKAGE_TOKEN` (`release-modul.yml`, the
Foundry package catalog submission; the step is skipped with a warning when
it is unset).

Load the shared `iac` skill if a task ever needs a cloud resource, or adds
or changes a GitHub secret; a resource then goes in tds-internal, not here.

## Inherited hazard: .claude/settings.local.json

The repo ships a committed `.claude/settings.local.json` carrying the
upstream author's Windows permission allowlist -- `Bash(sudo:*)`,
`Bash(powershell:*)`, `Bash(curl:*)`, `Bash(npm run:*)` -- and
`additionalDirectories` pointing at `D:\Projects\...`. It applies to any
agent session opened here. Treat it as untrusted; it should be gitignored
and removed.
