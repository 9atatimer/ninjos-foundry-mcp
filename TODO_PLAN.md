# ninjos-foundry-mcp -- TODO Plan

> **Status:** Active
> **Updated:** 2026-09-12
> **Design:** none yet -- no design record exists for the transport layer,
> which is where all current work sits.

## How to Use This File

- Repo conventions, the build, the dev rig, and the unchecked query-name
  contract are in `AGENT.md`. Read it before working here.
- Branch off `main`; never commit to it. Feature branch -> PR.
- Every unit of work is a file in `tasks/`. This file holds only order and
  reasoning. Closing a task moves the file to `tasks/done/`.
- Task IDs are tier-0 `task-NNN` -- this repo ships no task tool. Mint one
  past the highest under `tasks/` (including `done/`).
- `npm run pruefen` must pass before any commit that touches query names.

| Reference                    | Where                         |
| ---------------------------- | ----------------------------- |
| Repo agent instructions      | `AGENT.md`                    |
| Dev environment, clean slate | `docs/DEV-ENVIRONMENT.md`     |
| Design records               | `docs/design/` (empty)        |
| As-built                     | `docs/arch/` (empty)          |
| Concepts                     | `docs/concepts/` (empty)      |
| Adding a game system         | `ADDING_NEW_SYSTEMS.md`       |
| Ninjo's own extensions       | `docs/NINJO-ERWEITERUNGEN.md` |

## Where Things Stand

A fork of `Niclasp1501/ninjos-foundry-mcp` at `14.2609.3`, cloned 2026-09-12.
Upstream of the fork's upstream is Adam Dooley's `foundry-vtt-mcp`.

The bridge works against the owner's real campaign. `mainland` -- exported from
The Forge, 752 actors, 1888 items, 51 scenes, 18 world compendiums including a
23281-entry monster pack -- is imported locally, migrated to Foundry 14.359 /
dnd5e 5.3.0, running with 27 modules active and 34 of its original 44 installed.
The MCP indicator reads connected and `scripts/e2e-smoke.mjs` returns live world
data through the same stdio wrapper Claude Desktop spawns. 79 tools exposed.

The 8.3 GB Forge asset library (53,261 files) is mirrored locally under
`backup-2026-09-12/`, pulled through the Forge REST API rather than the
deprecated in-browser Asset Sync tool. Zero failures.

Not yet done for a genuinely self-contained snapshot: the world still references
`assets.forge-vtt.com` URLs and ten settings still name the Forge-only
`[forgevtt]` file source. Both need a rewrite pass over the world DB.

Ten of the original 44 modules are absent. Eight declare a hard maximum of
Foundry 13 and cannot run on 14 at all -- including `chris-premades` and
`times-up`, which are load-bearing for this campaign's automation. Recovering
them means a Foundry 13.348 rig.

`HOWTO.md` carries what all of that taught us.

## Now

- **task-010** -- `backup-assets.mjs` records truncated files as complete. It is
  committed and it is a backup tool, which is the worst combination. Either fix
  it test-first or delete it; it must not be run at scale meanwhile.
- **task-001** -- the bridge accepts any origin. Needs a design record first:
  the legitimate origin is not a constant, so this adds a setting and a seam.
- **task-002** -- bind 31415 and 31416 to loopback. Small, independent of 001,
  and not a substitute for it.
- **task-011 / task-012** -- the rest of the downloader defects. Only worth
  doing if 010 is fixed rather than deleted.
- **task-004** -- the reconnect defect. Now hit routinely on the real rig.

Deliberately not in Now: task-003 (no container yet), task-005, task-006
(large, no deadline), task-007 and task-009 (latent).

## Blockers

- **Issues are disabled on this fork** (`gh issue list` refuses;
  `viewerPermission: ADMIN`, so it is one settings change). Until they are
  enabled, `issue:` stays empty on every task and the defect-first
  workflow has no remote half. Unblock: enable Issues in repo settings, or
  decide the local `tasks/` store is the whole record for this fork.
  Raised 2026-09-12.
- **No design record exists for the transport layer.** task-001 cannot
  start under law 1 until one is written and approved. Unblock: write
  `docs/design/DESIGN.transport-auth.md`, run the panel, get a human to
  mark it APPROVED.

## Lessons Learned

### 1. The two halves disagree about whether the connection is permanent

about: wip

The backend is built to come and go -- it exits after the last wrapper
disconnects, by design, counting wrappers only and ignoring a still-bridged
module. The module is built as if the bridge were permanent: bounded retries,
then a manual click. Ordinary use of Claude Desktop triggers the collision.

Unsettled because the fix is not obvious and task-004 as filed may be too
narrow. Candidates: unbounded backoff on the module side; the backend declining
to exit while a module is bridged; or an explicit lifecycle contract making one
side authoritative. Do not point-fix the retry constant until that is decided --
it is a contract between the halves, so it wants a design record.

### 2. Tools written this session were not built test-first, and it showed

about: wip

`backup-assets.mjs` was smoke-tested on 40 URLs, looked fine, and was committed.
An adversarial review then found six defects that silently corrupt files, four
reproducible end to end. Law 5 exists for this and was not followed.

Unsettled because the right correction is not just "write tests next time" --
the defects were all in I/O edge cases (content encoding, partial responses,
case-folding filesystems) that a unit test written by the same author would
likely have missed too. What actually caught them was an adversarial pass with a
local HTTP harness. Whether that belongs in the gates skill as a standing
requirement for any network-facing tool is the open question.
