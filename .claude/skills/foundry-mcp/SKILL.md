---
name: foundry-mcp
description: "Driving a Foundry VTT world through this repo's MCP bridge -- preflight checks, the tool surface, the permission model, and the failure modes that look like success. Load before any task that reads or changes a live Foundry world. Skip when working on the server or module source itself (that is the coding skill)."
---

# SKILL: Driving Foundry over the MCP bridge

> **Purpose:** Operate a live Foundry world through the MCP server.
> **When to use:** Any task that touches world content -- scenes, actors,
> journals, compendiums, tokens.

## The shape of the thing

Two processes and a browser:

```
Claude Desktop / a script
        |  stdio (JSON-RPC)
   dist/index.js          thin wrapper, one per client session
        |  TCP 127.0.0.1:31414
   dist/backend.js        one shared backend, owns the Foundry connection
        |  WebSocket :31415   <-- the MODULE dials this, not the other way
   the GM's browser       module code running inside a loaded world
        |
   Foundry server :30000
```

**The module is the client.** Nothing works unless a GM has the world open in
a browser. There is no headless path, no server-side bridge, no way to make
Foundry connect on demand.

## Preflight, every time

In order, because each answer explains the next:

```
lsof -nP -iTCP:31415 -sTCP:LISTEN     # is the backend up?
lsof -nP -iTCP:31415 | grep ESTAB     # is a GM actually connected?
```

An empty ESTAB line is the single most common cause of "the tools are not
working", and it is not a fault -- nobody is logged in, or the module gave up
reconnecting and the in-game indicator needs a click.

In the client, the indicator carries the truth:

```js
const el = document.querySelector('.mcp-status');
({ text: el.textContent.trim(), title: el.getAttribute('title'), cls: el.className });
```

`mcp-status--connected` is the only good state. `--connecting` with a rising
"Attempt N" means the backend is down. `--disconnected` means it has given up
permanently and will not recover on its own.

**The backend exits on its own.** It shuts down a configurable interval after
the last _wrapper_ disconnects (default 60s) and does not care that a module is
still bridged. For a standing rig, start it with a long
`FOUNDRY_MCP_IDLE_SHUTDOWN_MS`. Use `FOUNDRY_MCP_CONTROL_PORT` to run a second
backend without disturbing the one currently bridged.

## Calling tools

There is no CLI. Spawn the wrapper and speak JSON-RPC, holding stdin open --
a shell pipeline closes it and the wrapper runs cleanup before replies arrive,
which reads as a hang. `scripts/e2e-smoke.mjs` is the working pattern; copy it.

Discover before you guess:

```
tools/list      79 tools, each with a full inputSchema
```

Read the `inputSchema` rather than inferring argument names. Several tools are
system-specific (`dnd5e-create-npc`, `wfrp4e-update-actor`,
`create-dsa5-character-from-archetype`) and will not apply to the world in
front of you.

## Failure modes that look like success

- **`"success": true` means the write was accepted, not that it is correct.**
  A path that does not resolve, an id that does not exist downstream -- both
  can return success. Verify by reading state back, ideally from the client.
- **An empty list is the signature of a query-name mismatch.** The two halves
  communicate over roughly a hundred bare strings that no compiler checks. If a
  tool returns nothing where content plainly exists, suspect drift before
  suspecting the world. `npm run pruefen` checks the contract.
- **Prototype versus instance.** Several tools write an actor's prototype;
  already-placed tokens are unaffected. See the foundry-artwork skill.

## Permissions

The module gates writes per document type -- scenes, playlists, journals, roll
tables, actors, folders -- at three levels: read only, create and update, or
additionally delete. **Deleting is off everywhere by default** and players get
no access at all.

When an action is refused, do not work around it. Call the permissions tool to
see which switch is off, and tell the human which one to flip; the setting is
theirs to change, in the module settings.

## Working in someone's real campaign

Assume the world is live data unless told otherwise. Name test artefacts
obviously (`MCP Test -- ...`), keep them in their own folder, and offer to
clean up. `delete-scene` and `manage-actors` with `action: "delete"` do that.

Ask before mutating anything that existed before you arrived.

## The mainland table (Forge world `mainland`)

**A character name means the player.** "Move Eden to the Eyrie" means pull
Eden's _player_ to that scene (`game.socket.emit('pullToScene', sceneId,
userId)`), giving them Observer on the scene first if its default is None.
Move tokens only when tokens are named explicitly.

**Players roll initiative in D&D Beyond, not the tracker.** Their rolls
land in chat as "Initiative (+N)" cards without the core `initiativeRoll`
flag, so combatants show no initiative. When the GM says "take their
initiative rolls", copy each total from chat onto the combatant. Only
monsters rolled from the tracker carry the flag.

**Live-world scripting gotchas met here** (GM tab, `evaluate_script`):

- `game.actors.importFromCompendium(pack, id, updateData, options)` takes an
  object as its third argument. Passing a folder id string throws
  "One of original or other are not Objects!". Use `{ folder, name }`.
- Swapping a token for one of a different actor (delete, then create) drops
  its combatant and any effects on its synthetic actor. Capture both first,
  then recreate them. The tracker can briefly list stale combatants.
- `scene.tokens` is a Collection: use `.contents.every(...)`, not `.every`.
- Custom CR stats: follow the DMG per-CR guideline row (AC, HP, attack bonus,
  damage per round). Build attacks by cloning an existing attack item and
  rewriting its activity's `damage.parts`, and verify with
  `activity.labels.toHit` / `labels.damage`.

| Foundry user  | Person                                                         | Character           |
| ------------- | -------------------------------------------------------------- | ------------------- |
| Troll         | the GM                                                         | --                  |
| Don           | Don                                                            | Tomur               |
| Gabe          | Gabe                                                           | Eden Rathgar        |
| Tim           | Tim                                                            | Fletch              |
| garyh         | Gary                                                           | Rogart Blackweasel  |
| airshipwright | **Justin** (not obvious from the handle -- the GM enjoys that) | Zin                 |
| str009        | ?                                                              | Tholgrim Silverbrow |
| tedr          | ? (owns Tennin; not set as assigned character)                 | Tennin Verterion    |

## Related

- `HOWTO.md` -- the findings behind these rules.
- `docs/DEV-ENVIRONMENT.md` -- getting a rig running from nothing.
- the foundry-artwork skill -- token art, portraits, scene backgrounds.
