# Battlemap workflows -- the production graph and five alternatives

The MCP server does not read these files. `generate-map` builds its graph in
code (`packages/mcp-server/src/comfyui-client.ts`, `buildWorkflow()`), and
`01-sdxl-battlemap-baseline.api.json` is that graph written out so it can be
opened, diffed and compared. The other five are alternatives to evaluate
before any of them is wired into the tool.

All five are ComfyUI **API-format** graphs: POST them to `/prompt`, or run
them with the helper, which never touches Foundry:

```
node scripts/battlemap-render.mjs \
  --workflow workflows/battlemap/02-sdxl-lora-modular.api.json \
  --prompt "a sacked desert caravan, dead camels, scattered cargo" \
  --seed 42 --out /tmp/maps
```

Nodes carry `_meta.title` (`POSITIVE`, `NEGATIVE`, `LATENT`, `SAMPLER`,
`SAVE`, ...), which is how the runner overrides prompt, seed, steps, cfg and
size across graphs that are otherwise shaped differently. Keep those titles
if you edit a graph.

## The six

| # | Graph | Model | Speed (M1 Max, 1024px) | Why you would pick it |
| - | ----- | ----- | ---------------------- | --------------------- |
| 01 | baseline | D&D Battlemaps SDXL 1.0 | 40 s | what ships today; battlemap look out of the box |
| 02 | modular | RealVisXL V5.0 + battlemap LoRA | 80 s | swap the base model to change art style |
| 03 | controlnet | D&D Battlemaps SDXL + ControlNet union | 65 s | you need *these* rooms, not random terrain |
| 04 | flux | FLUX.1-schnell Q4 GGUF | 105 s | best prompt following for complex terrain |
| 05 | sd15 | DnD Map Generator v3 + 4x ESRGAN | 50 s | fastest iteration; cheap candidate sweeps |
| 06 | flux + lora | FLUX.1-dev Q8 + map LoRA | 405 s | richest scenes; slow, and dev is non-commercial |

Measured times are in `docs/battlemap-model-comparison.md` alongside the
sample renders.

## Model notes

- **D&D Battlemaps SDXL 1.0** (`dDBattlemapsSDXL10_upscaleV10.safetensors`,
  6.9 GB). Trigger: `2d DnD battlemap of ...`. Calibrated around 1024x1024 =
  roughly 24x24 squares. **Very sensitive to CFG**: above about 3.0 it burns
  in and oversaturates, hence cfg 2.0-2.5 with 8-20 steps. License:
  CreativeML Open RAIL++-M plus a no-selling-generated-images rider.
- **Battlemap LoRA** (`sdxl-battlemaps-v1.safetensors`, 1.7 GB, Civitai
  613017 v1.0). Trigger word: `battlemap`. Pair with any SDXL base:
  RealVisXL V5.0 (installed) for grit, DreamShaperXL Turbo (installed) for
  painterly -- turbo wants cfg ~2 and 6-8 steps, not the 25/5.0 in graph 02.
  A second, tiny LoRA (`dnd-battlemap-sdxl-fixedbot.safetensors`, 22 MB) is
  installed and has no trigger word. Civitai 401s on it without a token; the
  author's Hugging Face mirror `Fixedbot/sdxl_dnd_battlemap_lora` is the same
  file (identical SHA-256) under Apache-2.0, so fetch it there.
  **Graph 02 draws a square grid** with the big LoRA at strength 0.9 -- put
  `grid` in the negative prompt, or drop the strength, since scenes are
  created gridless.
- **ControlNet union promax** (`diffusion_pytorch_model_promax.safetensors`)
  was already installed. Graph 03 feeds it a black-on-white floor plan
  through `Canny` with `SetUnionControlNetType: canny/lineart/...`. Draw the
  plan by hand, or export one from Dungeon Scrawl or Watabou;
  `assets/battlemap-layout.png` is a throwaway example.
- **FLUX.1-schnell Q4_K_S GGUF** (6.3 GB) with the T5 Q8 GGUF and clip_l
  encoders already on disk. Apache-2.0, so unlike FLUX.1-dev it carries no
  non-commercial restriction; `flux1-dev-Q8_0.gguf` is also installed if you
  want dev quality (20 steps, guidance 3.0-3.5) and accept its licence.
  Flux runs at cfg 1.0 with a `FluxGuidance` node instead. Graph 06 pairs
  dev with `flux-dnd-map-world.safetensors` (trigger `Dnd_maps`);
  `flux-envy-handdrawn-rpg-map.safetensors` is installed as a hand-drawn
  alternative and needs no trigger.
- **DnD Map Generator v3** (SD 1.5, 2.2 GB, Civitai 5012). Trigger:
  `2d dnd battlemap` -- the same phrase the MCP server prepends, which is
  where that convention comes from. Renders at 768 then upscales 4x with
  `4x_NMKD-Siax_200k`.

## Sizes

SDXL buckets keep about one megapixel: 1024x1024 (~24x24 squares at the
model's calibration), 1536x1024 for a 36x24 landscape map, 1024x1536 for a
vertical one. Going much above that with SDXL costs coherence, which is why
the Eyrie map was grown by img2img rather than rendered large. At the
default 70px Foundry grid, a 1024px map is only ~14 squares across -- see
the size note in `.claude/skills/foundry-battlemap/SKILL.md`.

## Measured, not guessed

`docs/battlemap-model-comparison.md` has the contact sheet, the timings above
and what each model actually produced from one shared prompt and seed.
