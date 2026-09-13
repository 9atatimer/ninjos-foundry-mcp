---
name: foundry-battlemap
description: 'Generating a battlemap with ComfyUI and importing it into a live Foundry world (local or Forge) as a new scene via the generate-map tool -- prerequisites, the workflow the server builds, verifying the result, and the failure modes met so far. Load whenever asked to make, generate, or draw a map or scene from a description. Skip for assigning existing art (foundry-artwork) or driving a world in general (foundry-mcp).'
---

# SKILL: Battlemaps via ComfyUI

> **Purpose:** Turn a prose description ("intimate desert camp at night") into
> a Foundry scene with generated background art.
> **When to use:** Any request to make, generate, or draw a map or scene.

## The path, end to end

```
generate-map (MCP tool)
  -> backend builds a ComfyUI API workflow   comfyui-client.ts buildWorkflow()
  -> ComfyUI renders, SaveImage battlemap_*.png
  -> backend uploads the PNG through the module to
     worlds/<world>/ai-generated-maps/        (Forge: assets.forge-vtt.com)
  -> backend broadcasts job-completed with   map-scene.ts buildMapSceneData()
  -> module Scene.create()s it in the "AI Generated Maps" folder
```

The module is the client (see the repo `CLAUDE.md`). Nothing lands in the VTT
unless a GM browser is bridged to the backend at the moment the job completes.

## Preflight

- **Bridge up:** `lsof -nP -iTCP:31415 | grep ESTAB` must show the GM browser.
  Check with `get-world-info`, not the in-game indicator (see failure modes).
- **ComfyUI up:** find its port -- the Comfy Desktop app on this machine
  listens on `127.0.0.1:8000`, not the code default `31411`:
  `lsof -nP -iTCP -sTCP:LISTEN | grep -i python`.
- **Backend has map generation on.** It needs, in the _backend's_ env:
  `COMFYUI_ENABLED=true COMFYUI_HOST=127.0.0.1 COMFYUI_PORT=8000`.
  Read it with `ps eww -p <backend pid> | tr ' ' '\n' | grep COMFYUI`.
- **Checkpoint present:** `dDBattlemapsSDXL10_upscaleV10.safetensors` (D&D
  Battlemaps SDXL 1.0, 6.9 GB) in ComfyUI's `models/checkpoints/`. Source:
  `https://huggingface.co/AdamDooley/dnd-battlemaps-sdxl-1.0-mirror`
  (`resolve/main/<file>`). License is CreativeML Open RAIL++-M plus
  Attachment B: no selling or licensing generated images.

## Making the map

```
generate-map
  prompt       scene description; the server wraps it in
               "2d DnD battlemap of ..., top-down view, overhead perspective"
  scene_name   short, evocative
  size         small=1024 | medium=1536 | large=2048
  grid_size    px per 5 ft (default 70)
```

**Pick size for play space, not render speed.** At the default 70px grid,
`small` (1024) is only ~14x14 squares (~73 ft across) -- the human called it
fairly small for The Gorge Path, and a Gargantuan roc (4x4) eats a big share
of it. Default to `medium` (1536, ~22 squares) or `large` (2048, ~29 squares);
tiled decode makes both safe on MPS (#2). 1536 came out softer than 1024 with
this checkpoint, so for a sharp large map render at 1024-ish detail and grow
it (img2img/upscale) rather than dropping the size.

Write the prompt as a top-down inventory of what is on the ground: centre
feature, what rings it, terrain, edges, light. Do not describe creatures --
the negative prompt strips people and monsters anyway.

The call returns a job id at once. Progress shows in Foundry. Do not poll
`check-map-status`; wait for the human or the scene.

## The workflow is code, not a file

There is no checked-in ComfyUI `.json`. The graph is built in
`packages/mcp-server/src/comfyui-client.ts` `buildWorkflow()`:

```
CheckpointLoaderSimple (dDBattlemapsSDXL10) -> CLIPTextEncode (+/-) -> EmptyLatentImage
  -> KSampler (8 steps, cfg 2.5, dpmpp_2m_sde, karras)
  -> VAEDecodeTiled (512 tile, 64 overlap) -> SaveImage "battlemap"
```

Every PNG ComfyUI saves embeds the exact graph it ran, so "what produced this
image" is answerable from the file (`tEXt` chunk `prompt`):

```python
import json, struct, sys
d = open(sys.argv[1], 'rb').read(); i = 8
while i < len(d):
    n = struct.unpack('>I', d[i:i+4])[0]; t = d[i+4:i+8]
    if t == b'tEXt':
        k, v = d[i+8:i+8+n].split(b'\0', 1)
        if k == b'prompt':
            for nid, node in json.loads(v).items():
                print(nid, node['class_type'], node['inputs'])
    i += 12 + n
```

ComfyUI output on this machine lives under `~/workplace/OSS/comfyui/output/`.

## Iterating on a map outside the tool

`generate-map` always samples at 8 steps from scratch, which settles layout
but not detail. What worked for "The Roc's Eyrie":

- Render candidates straight to ComfyUI (`POST :8000/prompt`, batch of 2-4)
  so nothing touches the live game, and show the human a contact sheet.
- When one candidate has the right layout but mush detail, run img2img from
  it: copy it into ComfyUI's `input/`, then `LoadImage -> VAEEncode ->
RepeatLatentBatch(4) -> KSampler (30 steps, cfg 2.5, denoise 0.55)`. Layout
  survives; props and edges resolve.
- Prompt by position the model can see: "sheer drop on the left into a dark
  chasm", "cliff wall on the right with a small cave entrance". Film
  references ("like Cliffhanger") mean nothing to a top-down map model.
- Put the chosen PNG on an existing scene without the tool: serve it from a
  one-shot loopback HTTP server with `Access-Control-Allow-Origin` set to the
  game origin, `fetch` it in the GM tab, `FilePicker.upload('data',
'worlds/<world>/ai-generated-maps', file)`, then `scene.update({ img,
'background.src' })` and refresh the thumbnail with `createThumbnail()`.
  Loopback fetch is allowed from the HTTPS Forge page.

## Scene rules (truisms)

- **Grid lines off. Snap-to-grid off.** Generated art has no grid, so the
  scene is created **gridless** (`grid.type: 0`), which gives both at once.
  `grid.size` and `grid.distance` are kept so measurement and token size
  still scale. Enforced in `map-scene.ts` and pinned by `map-scene.test.ts`.
- To fix an older scene in place:
  `game.scenes.get(id).update({ 'grid.type': 0 })`.

## Verifying

Read the scene from the client, do not trust the job's "Complete":

```js
game.scenes
  .filter(s => s.name === '<scene_name>')
  .map(s => ({ id: s.id, grid: s.grid.type, bg: s.background?.src, w: s.width }));
```

`grid: 0`, a `bg` under `ai-generated-maps/`, and `w` equal to the size's
pixels means it landed.

## Failure modes met so far

- **Generated scene became the active scene** (#3). Module releases up to
  14.2609.5 call `scene.activate()` on every import, yanking connected
  players onto an unprepared map. Fixed in source, but Forge runs the
  _released_ module, so until a release ships: before generating with
  players online, note `game.scenes.active.id`, and right after import
  re-activate it and set the new scene `navigation: false`.

- **"Can't be indexed using 32-bit iterator"** (#2). Apple MPS, plain
  `VAEDecode` at 1536px+: the VAE's mid-block attention over the whole latent
  overflows 32-bit indexing. Sampling finishes, decode dies. Fixed by
  `VAEDecodeTiled`. 1024px never hit it, which is why the first map worked.
  Traceback is in ComfyUI's log: `~/workplace/OSS/comfyui/user/comfyui_8000.log`.
- **Wrong checkpoint renders empty sand.** The fork once swapped in
  `juggernautXL_ragnarokBy` (photoreal). It ignores the "2d DnD battlemap"
  trigger, and 8 steps at cfg 2.5 are too few for it: a dense 600-word
  caravan prompt came back as bare sand, and asking for "illustration" made
  it a flat texture. The sampler settings belong to D&D Battlemaps SDXL; keep
  model and settings together.
- **Long prompts and negations.** CLIP reads ~75 tokens per window, so a
  600-word brief is diluted. "No wagons", "no text" in the positive prompt
  tend to add wagons and text. Condense to a ground-level inventory and move
  exclusions to the negative prompt.
- **Card-art settings are not battlemap settings.** Other ComfyUI workflows
  on this machine (e.g. GammaGo `card_gen_workflow_api.json`: 768px, 25 steps,
  cfg 7, then upscale) solve a different problem. Do not port their sampler
  settings here; the human rejected that. Change the decode, not the look.
- **Testing ComfyUI directly bypasses the VTT.** POSTing a workflow to
  `:8000/prompt` is a fine way to prove a graph renders, but it produces a PNG
  only -- no upload, no scene. Say so before the human goes looking for it.
- **A restarted backend loses map generation.** The stdio wrapper does not
  carry the `COMFYUI_*` vars, so a backend it respawns starts with map
  generation off. When restarting by hand, relaunch `dist/backend.js` with the
  old backend's env (read it with `ps eww` first) and a long
  `FOUNDRY_MCP_IDLE_SHUTDOWN_MS`.
- **The in-game indicator lies after a backend restart on WebRTC.** With
  `connectionType: auto` on HTTPS (Forge) the module picked WebRTC, and after
  the backend restarted it still showed `mcp-status--connected` while the
  backend had no peer; a stale 100% progress bar sat in the UI. Fix: set
  `connectionType` to `websocket` and reload the game tab. Then confirm with
  `lsof ... 31415 | grep ESTAB` and `get-world-info`.
- **Rebuild before restart.** The backend runs `dist/`; `npm run build:release`
  first, then `grep` the dist file for the change before restarting.
