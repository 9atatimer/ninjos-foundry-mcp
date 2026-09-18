---
id: task-023
kind: task
title: Decide how generate-map picks an engine, now that alternatives are measured
issue: https://github.com/9atatimer/ninjos-foundry-mcp/issues/8
created: 2026-09-18
---

## Why now

`workflows/battlemap/` holds the production graph and five alternatives, all
run on one prompt and seed, with costs and outcomes in
`docs/battlemap-model-comparison.md`. The measurement says the current
default is the fastest and the weakest at content: it renders bare sand for
a prompt full of specific objects, which is exactly what failed in play on
the caravan map.

## The decision

- Keep one hardcoded graph, or give `generate-map` an optional `workflow`
  parameter naming a file in `workflows/battlemap/`, default unchanged?
  The graphs already carry `_meta.title` markers so a caller can find the
  prompt and sampler nodes; `scripts/battlemap-render.mjs` does this.
- Does a layout-driven path (ControlNet from a GM sketch or a Dungeon Scrawl
  export) belong in the tool, or stay out-of-band?
- Does gridless-by-default stand, given the AC5e range-check cost and that
  the battlemap LoRA draws grids?

Blocked on #8, and therefore on task-020: that task asks whether map
generation needs a design record; this one is the first concrete decision
such a record would have to contain. #4 (no quality knob) collapses into
whatever is decided here.

## Not in scope

Swapping the default silently. Nothing about map generation has a design
record, which is the point of #8.
