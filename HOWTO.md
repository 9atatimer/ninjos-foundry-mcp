# HOWTO -- things that cost us time

Hard-won findings from standing this project up locally against a real,
Forge-hosted campaign. `docs/DEV-ENVIRONMENT.md` is the runbook: follow it to
get a rig running. This file is the other thing -- why several of those steps
are the way they are, and what to do when they are not enough.

Everything here was verified on this machine on 2026-09-12 against Foundry
14.359, dnd5e 5.3.0, and a live Forge account.

## Getting a Forge world onto your laptop

### The export contains no modules, and does not say which it needs

A Forge world export is the world and nothing else -- `world.json`, `data/`,
`packs/`, `assets/`, `scenes/`. There is no `modules/` directory in it, and
`world.json`'s `relationships` block is **empty**, so it does not declare its
dependencies either.

The module list does survive, in an unobvious place: Foundry stores
`core.moduleConfiguration` as a setting _inside the world_, so it is in
`data/settings`. Read it out of the LevelDB:

```
strings <world>/data/settings/*.log | grep '"core.moduleConfiguration"'
```

That is a JSON map of module id -> enabled. On this campaign: 99 known, 44
enabled.

### Let Foundry's registry tell you what is compatible

Do not hand-check module compatibility against the website. A running Foundry
exposes its whole package registry, filtered for the core version it is running:

```
curl -X POST http://localhost:30000/setup \
  -H 'Content-Type: application/json' -d '{"action":"getPackages","type":"module"}'
```

5199 packages come back, each with `manifest`, `version`, `compatibility`,
`protected` and `owned`. Modules whose declared maximum excludes your core
version are simply absent -- which is a compatibility check you get for free,
and it agreed exactly with a scrape of the package pages.

Install with the manifest from that same response:

```
{"action":"installPackage","type":"module","id":"<id>","manifest":"<manifest url>"}
```

**`installPackage` returns `{}` on accept, not on completion.** The download
happens asynchronously server-side. Poll for `modules/<id>/module.json` on disk
rather than trusting the response.

### /setup is admin-gated whenever a world is active

Every `/setup` action answers `You lack server administrator permission` while a
world is running, even with no admin password set. There is no way around it
from the API -- `shutdown` is refused for the same reason. Restart the process:

```
pkill -f "main.mjs --dataPath"
node "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/main.mjs" \
  --dataPath="$HOME/Library/Application Support/FoundryVTT" --noupnp --headless
```

It comes back with no world active and `/setup` works again.

### v13-capped modules are a hard stop, not a warning

Eight of this campaign's 44 declare a maximum of Foundry 13 and will not load on
14 at all: `chris-premades`, `times-up`, `ActiveAuras`, `region-attacher`,
`gambits-premades`, `seasons-and-stars`, `seasons-and-stars-fantasy`,
`foundryvtt-simple-calendar-compat`. Several are the core of a midi-qol
automation chain.

If that matters, the rig has to be Foundry 13.348 rather than 14, and that is a
licensed download nobody can make on your behalf. Decide this before importing,
because the world migration is one-way.

## Logging in to an imported world

### The stored password is one you have never typed

On Forge, players authenticate against their Forge account and Forge brokers the
world login. The evidence is on the user document itself -- the GM record
carries a `flags["forge-vtt"]` block with its own `password`, `passwordSalt` and
`"name": "Gamemaster"`. Locally there is no broker, the join form checks the
value stored on the document, and no password the owner knows will match it.

Reset it. `scripts/reset-user-password.mjs` does this, and the scheme it mirrors
is worth recording because it is not documented anywhere outside the bundle:

- `dist/core/auth.mjs` -- `pbkdf2Sync(pw, salt, 1000, 64, 'sha512').toString('hex')`,
  salt is `randomString(64)`.
- `dist/sessions.mjs` -- validates with `testPassword(pw, user.password, user.passwordSalt)`.

The salt that matters is **the one on the user document**, not the global
`passwordSalt` in `Config/options.json`; that global is only for the admin
password. So `password` and `passwordSalt` must be written together.

Foundry must be stopped first -- LevelDB holds an exclusive lock.

Find the GM before you start: role 4 is Gamemaster, and the account is not
necessarily called anything obvious.

## Assets

### Do not scrape URLs out of the world. Use the Forge API.

The tempting approach -- walk the world DB, collect every
`https://assets.forge-vtt.com/...` reference, fetch them -- is worse than it
looks. It only finds assets some document already points at, it gives you no way
to verify what you downloaded, and Forge serves no directory index so there is
nothing to enumerate against.

A Forge API key with `read-assets` opens the real thing:

```
GET  https://forge-vtt.com/api/assets           Access-Key: <key>
POST https://forge-vtt.com/api/assets/browse    {"path": "/"}
```

`/api/assets` returns the entire library with a **size and an S3 ETag for every
file**. On this account: 55,480 entries, 53,261 files, 8.31 GB. `scripts/forge-asset-sync.mjs`
consumes that inventory. Full pull took 34 minutes with zero failures.

That out-of-band size is the whole point -- see below.

### Asset Sync is client-side, which is why the API matters

The Forge module ships an Asset Sync tool and it is the officially recommended
route, but it is a `FormApplication`: client-side UI that only exists once a
browser has loaded `/game` and authenticated. The server cannot invoke it, so it
cannot be scripted or run headless. It is also built on `appv1` classes that
Foundry has marked `@deprecated since v13 until v16`, so it works today and
breaks at 16.

Going at the same REST API directly needs no browser, no GM session, and no
deprecated UI layer.

### Verify against a size you were told, never against the transfer

This is the single most important lesson here, and it generalises well beyond
Foundry.

Node's `fetch` (undici) sends `Accept-Encoding: gzip, deflate` unconditionally
and decodes transparently. So a resume offset counted in **decoded** bytes, sent
back as `Range: bytes=<n>-`, addresses the **compressed** representation -- a
different coordinate space. The offset overshoots, the server correctly answers
`416`, and code that treats 416 as "already complete" promotes a truncated file
and records it as done forever.

Send `accept-encoding: identity` on anything doing ranged resume.

Three more ways a transfer looks fine and is not:

- A `206` whose body is the whole object, not the requested range. Appending it
  to an existing prefix produces a file longer than the original, and a
  `Content-Length` check passes because the body really was that long.
- A chunked response with no `Content-Length` at all, cleanly terminated early.
  Any guard written as `if (expected && ...)` is dead code for these.
- A `416` on an object that merely shrank.

None of them survive comparing the finished file against a size obtained
out-of-band. Get the expected length from an inventory, not from the response
you are trying to validate.

### Case-insensitive filesystems collide asset libraries

macOS APFS folds case by default. This campaign's library contains
`ddb-images/other/ddb/item/Armor.webp` and `.../armor.webp` as distinct objects
-- 25 such pairs. Two downloads targeting one inode race, and one file's bytes
end up recorded under both names.

Assert your path mapping is injective, case-folded, across the whole manifest
_before_ transferring anything. `forge-asset-sync.mjs` refuses to start
otherwise, and `--on-collision suffix` disambiguates with a hash.

### `encodeURI(decodeURI(u))` corrupts already-encoded URLs

`decodeURI` deliberately preserves encoded **reserved** characters, so `%2C`
survives the decode; `encodeURI` then escapes its percent sign into `%252C`.
Files fetch fine by hand and 404 in your script. Use `new URL(u).href` -- the
WHATWG parser escapes what is illegal and leaves valid escapes alone.

### `[forgevtt]` paths do not resolve locally

Foundry FilePicker paths carry a source prefix. Forge registers a `forgevtt`
source at runtime; a local install has no such source, so every path bound to it
fails. Ten settings in this world are affected, seven of them ddb-importer
upload directories, plus `SoundBoard.source` and `moulinette.sources`. They need
repointing at `[data]` before any import or upload will work locally.

Related: ddb-importer's `persistent-storage-location` points at
`modules/ddb-importer/storage` in the Forge library. Its own README says the
directory caches images from DDB. It is outside the world export and cannot be
reached by URL guessing -- another thing only the assets API gets you.

## Working on this project

### The wrapper cannot be smoke-tested with a shell pipeline

`printf ... | node dist/index.js` answers `initialize` and then appears to hang.
It is not hanging: EOF on stdin makes the wrapper run cleanup and close the
backend socket before replies arrive. Hold stdin open. `scripts/e2e-smoke.mjs`
does.

### The backend exits while you are still using it

The backend shuts down a configurable interval after the last **wrapper**
disconnects -- default 60s, counting wrappers only. It will exit while a Foundry
module is still bridged to it on 31415. A rig verified healthy can be dead a
minute later.

Worse, the module's reconnect is bounded: it gives up after about five attempts
and parks at `MCP: disconnected` until a human clicks the indicator. Since the
backend is _designed_ to come and go, ordinary use of Claude Desktop triggers
this. Start a standing rig with a long `FOUNDRY_MCP_IDLE_SHUTDOWN_MS`. See
`tasks/task-004`.

### The bridge needs a GM in a browser

The module is the client and it only dials out when a GM has the game open.
There is no server-side bridge. If `lsof -nP -iTCP:31415 | grep ESTAB` is empty,
that is why -- nothing is broken, nobody is logged in.

### Foundry ships an ad-hoc signed macOS app

No Developer ID, `TeamIdentifier=not set`, so `spctl` rejects it outright. That
is how Foundry ships it, not tampering -- `codesign --verify --deep --strict`
passes. Right-click -> Open once, or clear `com.apple.quarantine`.

Run it headless for development; logs go to stdout and no window is in the way.
It needs Node 24+.
