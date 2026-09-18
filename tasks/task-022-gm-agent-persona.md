---
id: task-022
kind: task
title: Build a GM agent persona for running the table
created: 2026-09-17
---

## Why

Driving a live table needs a different posture from product work: act inside
one world, keep players' view in mind, never surprise the table. The
2026-09-12 session showed the gap. Its friction list lives with the campaign
material, outside this repo (`campaigns/new-undead/sessions/2026-09-12/
timeline.md`, a sibling checkout -- campaign material is deliberately not
vendored here): a generated map
activated itself and yanked every player onto it, tokens were moved from
stale coordinates, and standing preferences (no grid, daylight) had to be
repeated.

## Scope

- An agent definition (`.claude/agents/`) for "GM", with a tool set scoped to
  what a live table needs: the Foundry MCP tools, the CDP/debug-Chrome
  browser, ComfyUI, and the campaign tree -- and without the repo's build and
  release tooling.
- The skills it loads by default: `foundry-mcp`, `foundry-artwork`,
  `foundry-battlemap`, `cdp-browser`, plus the campaign's own
  `players.md` and scene notes.
- New skills to write, one per recurring job, rather than one large persona:
  - encounter prep: actors from compendiums, per-CR stat blocks, folders,
    tokens, placement on a gridless map;
  - running combat: tracker hygiene, initiative from D&D Beyond chat,
    damage/conditions, defeated and orphan combatants;
  - scene dressing: lights, ambient sound, tiles, weather, reveal control.
- Standing table rules the persona must encode: confirm before anything the
  players see (activation, pulling users, revealing tokens); re-read world
  state before acting on it; a character name means that character's player.
- Decide where it lives: this repo, the campaign tree, or the global agent
  set. It is not MCP product code, so the repo may be the wrong home.

## Open questions

- Does a persona want its own memory of the table (recurring NPCs, house
  rules), and where does that sit relative to `campaigns/<campaign>/`?
- How much may it do unattended mid-session before checking in?
