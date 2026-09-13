# HOWTO -- things that cost us time

Hard-won findings from standing this project up locally against a real,
Forge-hosted campaign. `docs/DEV-ENVIRONMENT.md` is the runbook: follow it to
get a rig running. This file is the other thing -- why several of those steps
are the way they are, and what to do when they are not enough.

Everything here was verified on this machine on 2026-09-12, against Foundry
14.359 and 13.348, dnd5e 5.3.0 and 5.1.10, and a live Forge account.

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

### Choose the core version before you import, not after

This is the decision that is expensive to reverse, and it is easy to make by
accident simply by importing into whatever Foundry happens to be installed.

Measured on this campaign, same world, same script:

|                                        | Foundry 14.359 | Foundry 13.348 |
| -------------------------------------- | -------------- | -------------- |
| of 44 enabled modules, installable     | 34             | **42**         |
| hard-blocked by declared compatibility | 8              | 0              |
| unobtainable (Patreon / paid)          | 2              | 2              |

The eight that 14 refuses are `chris-premades`, `times-up`, `ActiveAuras`,
`region-attacher`, `gambits-premades`, `seasons-and-stars`,
`seasons-and-stars-fantasy` and `foundryvtt-simple-calendar-compat` -- several
of them the core of a midi-qol automation chain. They are absent from Foundry
14's own package registry, so this is not a warning you can click past.

**Launching the world migrates it, and the core migration is one-way.** After
opening the export on 14, the world records `compatibility.minimum: 14` and a
v13 server will no longer touch it. Re-importing from the zip is the only way
back, which is one more reason to keep the zip.

Staying on the version the export came from also keeps the migration small: on
13.348 the world only migrated dnd5e 5.1.4 -> 5.1.10, a patch bump, with no
core migration at all.

### The module does run on Foundry 13 -- verified, not assumed

`module.json` declares `minimum: 13`, and that turns out to be true rather than
aspirational. Confirmed by running it: on 13.348 the bridge reports
`MCP: connected`, 114 queries register, 79 tools are exposed and
`get-world-info` returns live data -- from the same `14.2609.3` build that runs
on 14.

The thing to check if you ever doubt it is `CONFIG.queries`, since the entire
transport is 124 call sites against it:

```js
typeof CONFIG.queries; // "object" on 13.348 and on 14.359
typeof game.user.query; // "function" on both
```

The rest of the module's Foundry surface is `ApplicationV2`,
`foundry.applications.api.DialogV2`, `foundry.applications.apps.FilePicker.implementation`
and `foundry.utils.*` -- all v12/v13-era namespaced forms. There is no v14-only
API in it and no version guards, because it does not need any.

Note the cap, though: `compatibility.maximum: 14`. The module stops loading on
Foundry 15 until someone bumps it.

### Running two Foundry versions side by side

Useful, and only fiddly in three places.

- **Both app bundles are named `Foundry Virtual Tabletop.app`.** Install the
  second under a distinct name (`Foundry Virtual Tabletop 13.app`) or the copy
  silently overwrites the first.
- **Separate data paths and ports**, set in each `Config/options.json`. Copy
  `license.json` across; the same licence activates both.
- **Node versions differ.** 13.348 wants Node 20+, 14.359 wants Node 24+. One
  Node 24 satisfies both.

The 8.3GB asset library is symlinked into both data directories rather than
duplicated, and one MCP backend serves whichever rig currently has a GM
connected -- the module dials out, so nothing needs reconfiguring to switch.

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

### The Forge bazaar is a separate namespace from your asset library

`/api/assets` lists what _you_ uploaded. Module content that Forge caches for
everyone lives under a `/bazaar/` path prefix on the same CDN host and is not
in that inventory at all.

Individual bazaar files are fetchable -- which is why a world referencing
jb2a effects renders on a machine that does not have jb2a installed -- but
there is no manifest and no directory index there:

```
assets.forge-vtt.com/bazaar/modules/<mod>-<hash>/<file>   200
assets.forge-vtt.com/bazaar/modules/<mod>-<hash>/module.json   404
```

So the bazaar is not an install route. A paid module still has to come from its
own distributor. Note also that a patron build may ship `manifest: null` and a
direct `download` URL, which Foundry's `installPackage` cannot consume -- fetch
the zip and unpack it into `Data/modules/` instead.

Installing the module still matters even when its assets resolve remotely: what
the module registers is the Sequencer _database_, the named lookups that
`autoanimations` and `chris-premades` resolve against. Those fail without it,
files present or not.

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

## Releasing the module

### `releases/latest/download/...` 404s until a non-prerelease exists

GitHub's `/releases/latest/` alias explicitly excludes prereleases. A repo
whose only tag is a `-beta` prerelease has no "latest" for that alias to
resolve to -- `curl` on it 404s, and so does Foundry (or Forge's Bazaar)
when it fetches `download` out of the manifest to get the zip. The install
looks like it should work (the manifest itself downloads fine) and then
fails one step later on the zip, which reads as a Foundry/Forge bug rather
than a URL problem.

Fixed in `release-modul.yml`'s packaging step: it now rewrites the shipped
`module.json`'s `manifest`/`download` to the concrete `github.ref_name`
before zipping, and `scripts/paket-pruefen.mjs` fails the release if that
rewrite didn't happen. See `tasks/done/task-013-*.md`. This means every
release, beta or not, is self-consistent regardless of whether a
non-prerelease tag exists yet -- don't revert to `/latest/` for
"simplicity," it silently breaks the first beta of any new repo/fork.

## Running a live session as GM

### Resolving a player's dice roll requires the system's Activities API, not the module's tools

The module's own `use-item` tool only opens a UI dialog for a human to
click through -- it never resolves anything by itself. To actually roll and
apply damage on a player's behalf (e.g. answering "I attack with my
dagger" in chat), go through dnd5e's Activities API directly:

```js
const actor = game.actors.getName('<name>');
const activity = actor.items.get('<itemId>').system.activities.get('<activityId>');
const attackRoll = await activity.rollAttack({}, { configure: false }, {});
const damageRoll = await activity.rollDamage(...);
```

This is the only path that produces a real, resolvable die result
programmatically; anything else is narration without a mechanical result
behind it.

### Watching chat during a live combat is a poll, not a subscription

There is no long-running process holding a `Hooks.on('createChatMessage')`
listener between agent turns -- each check-in is a fresh tool call. The
formula that worked: each tick, read `game.messages` since the last
message id/timestamp you've already handled, filter to the player(s) in
play, resolve any requested roll via the Activities API above, apply the
result to HP with an `actor.update()`/token update, post the in-character
reply with `ChatMessage.create()`, and advance the turn with
`game.combat.nextTurn()` -- then re-check `game.combat.combatant?.name`
afterward, because `nextTurn()` can return before the tracker's `combatant`
getter reflects it, and narrating past that mismatch silently desyncs the
turn tracker from what you just said happened.
