# Getting the development environment working, from a clean slate

Written 2026-09-12 from a session that did exactly this on a bare macOS
machine. Every command here was run; every output quoted is real.

The goal state is a **local** Foundry serving a scratch world, the MCP
backend bridged to it, and Claude Desktop able to call tools against it.
Local Foundry is the dev rig even if you play on Forge -- Forge has no
writable modules directory, so iterating there costs a release per change.
The Forge path is at the bottom.

## What you need first

- **Node 24 or newer.** Foundry 14's own `package.json` declares
  `release.node_version: 24` and refuses to start on less. `node -v`.
- **A Foundry licence and the macOS DMG.** The binary is behind your
  licensed account at foundryvtt.com; it cannot be fetched without
  logging in as you. Download `FoundryVTT-<version>.dmg` yourself.
- **Claude Desktop**, if you want the bridge wired to a real client.

## Clone and build

```
git clone https://github.com/9atatimer/ninjos-foundry-mcp
cd ninjos-foundry-mcp
npm install
npm run build:release      # shared -> server -> bundle -> module
npm run pruefen            # must pass
```

`npm run build` alone does **not** bundle the server. Use
`build:release`.

A clean `npm install` currently reports 42 advisories (task-005) and warns
that five packages have install scripts not covered by allowScripts. The
build works regardless; esbuild resolves its platform binary through
optional dependencies.

`pruefen` passing looks like this -- the counts are the server/module
contract, and 114 is also what you should see registered in the browser
later:

```
Im Modul registriert:  114
Vom Server aufgerufen: 98
Nur registriert:       16 (Aliase, in Ordnung)
Vertrag in Ordnung: jede aufgerufene Abfrage ist im Modul registriert.
Versionen in Ordnung.
```

## Install Foundry

Mount the DMG and copy the app out. Two copies are kept on this machine:
one in `/Applications` for normal use, one in `vendor/` inside the repo so
the rig travels with the checkout. `vendor/` is gitignored -- the binary
is licensed and must never be committed.

```
hdiutil attach ~/Downloads/FoundryVTT-14.359.dmg -nobrowse -readonly
cp -R "/Volumes/Foundry Virtual Tabletop 14.359.0-universal/Foundry Virtual Tabletop.app" /Applications/
cp -R "/Volumes/Foundry Virtual Tabletop 14.359.0-universal/Foundry Virtual Tabletop.app" ./vendor/
hdiutil detach "/Volumes/Foundry Virtual Tabletop 14.359.0-universal"
```

**Gatekeeper will refuse it.** The app is ad-hoc signed -- no Developer
ID, `TeamIdentifier=not set`, not notarized -- so `spctl -a` returns
`rejected`. That is how Foundry ships their macOS build, not a sign of
tampering; `codesign --verify --deep --strict` passes clean. Either launch
it once by hand with right-click -> Open and confirm, or clear the flag:

```
xattr -dr com.apple.quarantine "/Applications/Foundry Virtual Tabletop.app"
```

Foundry's data lives **outside** the app, at
`~/Library/Application Support/FoundryVTT/` (`Config/`, `Data/`, `Logs/`).
Your licence lands in `Config/license.json` on first run and persists
across reinstalls, so a second install does not re-prompt.

## Symlink the module in

So a rebuild is picked up without recopying anything:

```
ln -sfn "$(pwd)/packages/foundry-module" \
  ~/Library/"Application Support"/FoundryVTT/Data/modules/ninjos-foundry-mcp
```

Confirm the target exists in Foundry's own Configuration screen if you
have moved your data path -- it is user-settable, and `Config/options.json`
holds the truth (`dataPath`, `port`).

## Wire the server to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and
**merge** this into the existing `mcpServers` object. Do not overwrite the
file -- it holds your other MCP servers, and on this machine several of
them carry live API tokens in plaintext.

```json
"foundry-mcp": {
  "command": "node",
  "args": ["/ABSOLUTE/PATH/TO/ninjos-foundry-mcp/packages/mcp-server/dist/index.js"]
}
```

Back it up first: `cp claude_desktop_config.json claude_desktop_config.json.bak`.

Point at `dist/index.js` -- the thin stdio wrapper -- never at
`backend.js`. Restart Claude Desktop. The wrapper spawns a detached
backend if none is listening.

## Start the rig

**Foundry, headless.** Better than the GUI for development: logs go to
stdout and no window is in the way.

```
node "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/main.mjs" \
  --dataPath="$HOME/Library/Application Support/FoundryVTT" --noupnp --headless
```

Wait for `Server started and listening on port 30000`.

**The MCP backend.** Claude Desktop will spawn one for you, but for a
standing rig start it yourself, and raise the idle timeout or it will exit
out from under you (see the warning below):

```
FOUNDRY_MCP_IDLE_SHUTDOWN_MS=86400000 node packages/mcp-server/dist/backend.js
```

Set `FOUNDRY_MCP_CONTROL_PORT` to something other than 31414 to run a
second backend without killing the one currently bridged to a world.

> **The backend exits on its own.** Its idle timer counts _wrapper_
> connections only, default 60000ms after the last one leaves -- and it
> will exit while a Foundry module is still bridged to it on 31415. A rig
> you just verified as healthy can be dead a minute later. This is
> task-004 territory; the module does not recover on its own when the
> backend comes back.

## Bring up the world

Open `http://localhost:30000`, or drive it from a browser console:

```js
// launch the world
await fetch('/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'launchWorld', world: 'test-world' }),
});
// then go to /join, pick Gamemaster, join
```

Once in the game as GM, enable the module. Module settings are only
registered while the module is active, so this takes two passes with a
reload between them:

```js
const cfg = foundry.utils.deepClone(game.settings.get('core', 'moduleConfiguration'));
cfg['ninjos-foundry-mcp'] = true;
await game.settings.set('core', 'moduleConfiguration', cfg);
location.reload();
```

Then set the connection settings and reload once more:

```js
await game.settings.set('ninjos-foundry-mcp', 'serverHost', 'localhost');
await game.settings.set('ninjos-foundry-mcp', 'serverPort', 31415);
await game.settings.set('ninjos-foundry-mcp', 'connectionType', 'websocket');
location.reload();
```

**Set `connectionType` explicitly.** On `auto` the module picks WebRTC
whenever the page is HTTPS, and the WebRTC path hardcodes
`iceServers: []` (`webrtc-peer.ts:57`), ignoring every configured STUN
server. Plain `ws://` to loopback is legal even from an HTTPS page --
loopback counts as a trustworthy origin, and `socket-bridge.ts` implements
that carve-out deliberately -- so websocket is both simpler and the only
mode that reliably works.

## Verify

Four checks, cheapest first.

**The indicator.** Bottom-left in game, or from the console:

```js
const el = document.querySelector('.mcp-status');
({ text: el.textContent.trim(), title: el.getAttribute('title'), cls: el.className });
```

Healthy:

```
{"text":"MCP: connected",
 "title":"Bridge to localhost:31415 (websocket)",
 "cls":"mcp-status mcp-status--connected"}
```

If it reads `MCP: disconnected`, click it -- the module gives up after
about five attempts and will not retry on its own.

**Queries registered.** Should equal `pruefen`'s count of 114:

```js
Object.keys(CONFIG.queries).filter(k => k.startsWith('ninjos-foundry-mcp.')).length;
```

**Sockets.**

```
lsof -nP -iTCP:30000 -iTCP:31414 -iTCP:31415 -iTCP:31416 -sTCP:LISTEN
lsof -nP -iTCP:31415 | grep ESTAB      # browser <-> backend
```

Note in passing that 31415 and 31416 come up on `*` rather than
`127.0.0.1` -- that is task-002, not a misconfiguration on your side.

**The whole path, the way Claude Desktop walks it:**

```
node scripts/e2e-smoke.mjs
```

Healthy output:

```
serverInfo: {"name":"ninjos-foundry-mcp","version":"14.2609.3"}
tools exposed: 79
get-world-info -> {"id":"test-world","title":"Test World",
                   "system":{"id":"dnd5e","version":"5.3.0"},
                   "foundry":{"version":"14.359"}, ...}
```

Do **not** try to replace that script with a shell pipeline.
`printf ... | node dist/index.js` answers `initialize` and then looks like
it hangs -- EOF on stdin makes the wrapper run its cleanup and close the
backend socket before the replies arrive, so everything after the first
response is lost. Hold stdin open, as the script does.

`npm run test:mcp:schema` is a lighter check that needs no Foundry at all;
it only proves the tool schemas load.

## Iterating

- Change module code -> `npm run build:foundry` -> hard-refresh the
  browser. The symlink means nothing needs recopying.
- Change server code -> `npm run build:release` -> restart the backend ->
  click the indicator to reconnect.
- Change a query name on either side -> `npm run pruefen` before you
  commit. Nothing else checks those hundred-odd strings.

## Tearing down

```
pkill -f 'main.mjs --dataPath'          # Foundry
pkill -f 'mcp-server/dist/backend.js'   # backend
```

The world's state persists in `~/Library/Application Support/FoundryVTT/Data/`.

## Full recovery from nothing

Everything below is reproducible from two artefacts plus this repo: the world
export zip, and a Forge API key. Budget about an hour, most of it downloading.

Nothing in this section is in git -- the world is licensed content and the
asset library is 8.3GB -- so keep the zip somewhere you trust.

**Restore the world.** The export is the ground truth; `unzip -t` it first.

```
unzip -q ForgeVTT-export-<world>-<date>.zip -d /tmp/restore
cp -R /tmp/restore/<world> ~/Library/"Application Support"/FoundryVTT/Data/worlds/
```

**Reset the GM password**, with Foundry stopped. A world exported from Forge
carries a password nobody has ever typed; see HOWTO.md.

```
node scripts/reset-user-password.mjs \
  ~/Library/"Application Support"/FoundryVTT/Data/worlds/<world>/data/users <GM name> <password>
```

Role 4 is the Gamemaster. Run it with no password argument to list the users,
or pass `--all <password>` to set every account at once, which is usually what
a local copy wants.

### Two Foundry versions side by side

Worth doing when the export came from an older core version than the one
installed -- HOWTO.md covers why that choice is expensive to reverse.

- Install the second app under a **distinct name**; both bundles ship as
  `Foundry Virtual Tabletop.app` and the copy will otherwise overwrite the
  first.
- Give each its own `--dataPath` and its own `port` in `Config/options.json`.
  Copy `license.json` across -- one licence activates both.
- Symlink the same asset library into both `Data/` directories rather than
  syncing it twice.
- One MCP backend serves whichever rig currently has a GM connected. The module
  dials out, so switching between them needs no reconfiguration.

**Install the modules the world expects.** Start Foundry with **no world
active** -- `/setup` is admin-gated while one is launched -- then:

```
node scripts/install-world-modules.mjs \
  --world ~/Library/"Application Support"/FoundryVTT/Data/worlds/<world> --dry-run
```

Drop `--dry-run` to install. Anything it reports as unavailable is a module
whose declared compatibility excludes your core version, or a paid one this
account does not own. That list is worth reading before you launch the world.

**Sync the assets.** The key lives in `.env` at the repo root, mode 600 and
gitignored.

```
node scripts/forge-asset-sync.mjs --key-file <(grep -o 'ey.*' .env) \
  --out backup-<date>/forge-library --on-collision suffix
```

`--on-collision suffix` is required on macOS: case-insensitive volumes fold
distinct assets together, and the run refuses to start rather than corrupt
them silently. Resumable -- re-run it after an interruption and it skips
whatever already matches the inventory's size.

**Expose the library to Foundry.** Assets outside the data directory are
invisible to the FilePicker, so link them in:

```
ln -sfn "$(pwd)/backup-<date>/forge-library" \
  ~/Library/"Application Support"/FoundryVTT/Data/forge-library
```

Scene backgrounds and token art then resolve as `forge-library/...`.

**Launch, join, enable the bridge.** As above in this document: launch the
world, join as the GM, enable `ninjos-foundry-mcp`, set `connectionType` to
`websocket`, reload, and confirm the indicator reads connected.

**Verify.** `node scripts/e2e-smoke.mjs` should report the restored world's id
and system through the same stdio wrapper Claude Desktop uses.

### What this does not restore

- Anything created locally since the export -- the export is a point in time.
- `ddb-importer`'s Forge-bound settings: ten settings still name the
  `[forgevtt]` file source, which does not exist locally. They need repointing
  at `[data]` before any import or upload works.
- The world's `assets.forge-vtt.com` URLs. Files are on disk, but documents
  still reference them remotely, so the snapshot works only while Forge is up.
  Rewriting those references is outstanding work.

## The Forge variant

The topology is the same -- browser and MCP server both on your machine,
module dialling `ws://localhost:31415` -- but the module has to get onto
Forge's server, and there is no directory to symlink into.

- Tag `v<version>-beta<n>` and push it. `release-modul.yml` builds, zips
  and attaches `module.json` + `module.zip` to a GitHub release. The
  catalog-submission step is gated on `!contains(ref_name, 'beta')`, so a
  beta tag never reaches the Foundry registry.
- In Forge, install the module from that release's `module.json` URL.
- Settings are the same: `serverHost` `localhost`, `serverPort` `31415`,
  `connectionType` `websocket`.

Before your first non-beta tag, read task-007 -- the submission step
currently points at the upstream repository's release URL, not this fork's.
