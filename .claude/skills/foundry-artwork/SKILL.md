---
name: foundry-artwork
description: 'Finding and assigning artwork in a Foundry VTT world over the MCP bridge -- searching a local asset library fast, and setting token art, portraits and scene backgrounds for NPCs, player characters and compendium-spawned creatures. Load whenever a task involves how something LOOKS in Foundry. Skip for rules, stats, or scene logic.'
---

# SKILL: Foundry Artwork over MCP

> **Purpose:** Change what things look like in a Foundry world -- token art,
> portraits, scene backgrounds -- without clicking through the UI.
> **When to use:** Any request of the form "give X a picture", "find art for
> Y", "these tokens are blank".

## Before anything: is the bridge up?

Nothing here works unless a GM has the world open in a browser. The module is
the client; it dials out. There is no server-side bridge.

```
lsof -nP -iTCP:31415 | grep ESTAB     # empty means nobody is logged in
```

An empty result is not a fault. It means log in as a GM, or the indicator in
game has given up and needs a click. See the repo's HOWTO.md.

## Finding art fast

The slow way is browsing Foundry's FilePicker. The fast way is `find` over the
data directory, because art libraries are named, not tagged.

```
D=~/Library/"Application Support"/FoundryVTT/Data
find "$D" -type f \( -iname "*.webp" -o -iname "*.png" \) | grep -iE "bandit|thug|rogue"
```

Three habits that make this quick:

- **Search several synonyms at once.** `grep -iE "bandit|thug|brigand|outlaw|ruffian"`.
  Art packs disagree about vocabulary, and one term usually finds nothing.
- **Let the directory tree do the filtering.** Token packs are organised by
  taxonomy, not by keyword. Listing `Characters/Adventurers/` to discover
  `Archer`, `Two-Handed-Blade`, `Shield-Axe` is faster than guessing filenames.
  A poacher is found under `Archer`, never under "poacher".
- **Filter by size for backgrounds.** `-size +2M` separates battlemaps from
  icons far more reliably than any name pattern.

Naming conventions worth recognising:

| Pattern                                      | What it is                                               |
| -------------------------------------------- | -------------------------------------------------------- |
| `M_Human_Fighter.png`, `F_Elf_Ranger_hi.png` | character token packs; `_hi` is the high-res variant     |
| `NPC_M_Traveler_02_hi.png`                   | townsfolk sets, `_02` is a pose or variant index         |
| `<name>.Token-world.<pack>.webp`             | ddb-importer / tokenizer output, already circular-framed |
| `*_thumb.webp`                               | a thumbnail. Never assign one as token art               |

**Paths must be relative to the Foundry data directory**, with no leading
slash: `forge-library/Tokens/M_Human_Fighter.png`. An absolute filesystem path
will be accepted by the tool and then fail to load in the client.

Art outside the data directory is invisible to Foundry. Symlinking a library in
works and is how a synced asset library is exposed:

```
ln -sfn /path/to/library "$D/forge-library"
```

## Assigning it

One tool covers actors of every kind -- NPC, player character, or a creature
spawned from a compendium. There is no separate call per actor type.

```
actor-set-token
  actorIdentifier   name or id
  tokenImg          token art, data-dir-relative
  portraitImg       optional; the sheet portrait (actor.img)
  tokenName         optional; without it tokens keep the compendium name
  ring              dynamic token ring (dnd5e / v12+)
  ringColor         omit to colour by disposition automatically
```

Set `portraitImg` as well as `tokenImg` unless you have a reason not to. A
token with art and a blank sheet portrait looks half-finished.

**Set `tokenName` when the actor was renamed.** Actors created from a
compendium keep the compendium's name on their prototype token, so four actors
renamed Grell, Vane, Mox and Skint will all still place as "Bandit".

### The ordering trap

`actor-set-token` writes the **prototype** token. Tokens already on a scene do
not update -- they were stamped from the prototype when they were placed.

So the order is: create actors, set art, _then_ place. If tokens are already
down with the wrong art, replace them:

```
delete-tokens   { tokenIds: [...] }        # ids from get-current-scene
manage-actors   { action: "place", actorIds: [...], placement: "random" }
```

Verify by reading the token, not the actor -- a placed token's
`texture.src` of `null` is the tell that it predates the prototype:

```js
game.scenes.get(id).tokens.map(t => ({ name: t.name, src: t.texture?.src }));
```

## Scene backgrounds

```
create-scene   name, background (data-dir-relative), folderPath,
               gridSize, navigation, activate
```

Dimensions are measured from the file, so do not pass `width`/`height` unless
deliberately overriding. Do pass `gridSize` -- battlemap filenames often encode
it (`hideout_34x34_poachers150DPI` is 34x34 squares at 150 DPI, so `gridSize:
150`), and getting it wrong makes every token the wrong size.

`update-scene` changes the background of an existing scene;
`refresh-scene-thumb` regenerates the navigation thumbnail afterwards.

## Bulk work

For many actors, drive the MCP wrapper from a script rather than one call at a
time. Hold stdin open -- a shell pipeline closes it and the wrapper tears down
before replies arrive. `scripts/e2e-smoke.mjs` is the working pattern.

When picking art for a group, vary it deliberately: four identical bandits are
worse than four distinct ones, and the taxonomy directories make that cheap
(one from `Archer`, one from `One-Handed-Blade`, and so on).

## Checking your work

Do not trust `"success": true`. The tool reports that it wrote a path, not that
the path resolves. Confirm in the client:

```js
game.scenes.get(sceneId).tokens.map(t => ({
  name: t.name,
  src: t.texture?.src,
  ring: t.ring?.enabled,
}));
```

A `src` that is set but renders blank means the path is wrong relative to the
data directory -- almost always a leading slash or a missing symlink.
