---
id: task-006
kind: task
title: Foundry typings are pinned to v9 for a v14 module
created: 2026-09-12
---

`packages/foundry-module/package.json:19` pins
`@league-of-foundry-developers/foundry-vtt-types` at `^9.280.0` -- v9
typings for a module whose `module.json` declares `minimum: 13`,
`verified: 14`, running against Foundry 14.359. Four majors stale.

The gap is papered over with 175 `as any` casts in `data-access.ts` alone,
plus a hand-rolled 65-line shim at
`packages/foundry-module/types/foundry-extensions.d.ts`.

The current typings install as
`@league-of-foundry-developers/foundry-vtt-types@beta`, resolving to
14.366.0-beta.\*. Replacing the pin and deleting the shim is the intended
end state; expect a large one-time breakage surface, and note there is no
official v13 -> v14 migration guide to work from.

The Foundry client API reference itself is generated from closed source
and published only at https://foundryvtt.com/api/. The installed typings
are the machine-readable equivalent and the better daily reference -- read
the declaration tree under `node_modules/`, do not scrape the HTML.
