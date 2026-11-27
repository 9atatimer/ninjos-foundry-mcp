---
id: task-014
kind: task
title: module id collides with Ninjo's official Foundry catalog listing
created: 2026-09-12
---

Forge's Bazaar showed the just-installed fork nested under Ninjo's own
listing/version history rather than as its own package, after
`v14.2609.5-beta1` installed successfully.

Root cause: `module.json`'s `id` is still the literal `ninjos-foundry-mcp`,
unchanged from the upstream fork. Foundry (and Forge's package browser) key
everything by `id`, so a differently-built zip shipped under the same id is
treated as just another version of the one canonical package -- not a
distinct, independently-branded module.

The id string is not confined to `module.json`: it is hardcoded (not via
the shared `MODULE_ID` constant) in ~25 files under `packages/mcp-server`
as the query-name prefix (`'ninjos-foundry-mcp.<queryName>'`), and via the
`MODULE_ID` constant in `packages/foundry-module` (3 files use the literal
string directly instead). A rename touches:

- `module.json`: `id`, `title`
- `package.json` (root): `name`
- `shared/src/constants.ts` and `packages/foundry-module/src/constants.ts`:
  `MODULE_ID`
- every literal `'ninjos-foundry-mcp.` query-name prefix in
  `packages/mcp-server/src/**` (client side has no shared import of
  `MODULE_ID` today)

Blocked on: what the new id/title should be. Owner has not yet chosen a
name.
