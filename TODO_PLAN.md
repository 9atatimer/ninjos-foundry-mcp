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

The bridge works against the owner's real campaign, on **both** Foundry
generations. `mainland` -- exported from The Forge, 752 actors, 1888 items, 51
scenes, 18 world compendiums including a 23281-entry monster pack -- runs
locally twice over:

|                         | Foundry 14.359, port 30000 | Foundry 13.348, port 30001 |
| ----------------------- | -------------------------- | -------------------------- |
| world                   | migrated from the export   | restored fresh, still v13  |
| system                  | dnd5e 5.3.0                | dnd5e 5.1.10               |
| modules installed of 44 | 34                         | 42                         |
| MCP bridge              | connected                  | connected                  |

13.348 matches the live Forge game exactly and keeps the whole midi-qol
automation chain, so it is the rig that matters. The v14 copy migrated one-way
and can no longer be opened by a v13 server.

The module's `minimum: 13` is verified rather than assumed: `CONFIG.queries`
and `User#query` both exist on 13.348, 114 queries register, 79 tools are
exposed, and `get-world-info` returns live data from the same build.

The 8.3 GB Forge asset library (53,261 files) is mirrored under
`backup-2026-09-12/` and symlinked into both rigs. Every local account shares a
development password; see `.env`, mode 600 and gitignored.

Not yet done for a self-contained snapshot: the world still references
`assets.forge-vtt.com` URLs and ten settings still name the Forge-only
`[forgevtt]` file source. Both need a rewrite pass over the world DB.

The module now runs on the live Forge instance: `v14.2609.5-beta1` installed
and was activated 2026-09-12. Getting there needed two fixes -- pointing
`manifest`/`download`/etc. at this fork instead of upstream (task-007), and
then discovering `download` still used `/releases/latest/download/`, which
404s until a non-prerelease exists (task-013, now in `done/`).

Surfaced by that install: Forge's Bazaar nests the fork under Ninjo's own
listing rather than showing it as a separate package, because `module.json`
still ships the upstream `id`. See task-014 -- blocked on a name.

`HOWTO.md` carries what all of that taught us.
`docs/concepts/npc-dialog/` holds an unfunded idea captured this session.

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

- **task-014 needs a name.** The new module id/title, to stop Forge's Bazaar
  from nesting this fork under Ninjo's own catalog listing. Unblock: owner
  picks a name.
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

The backend exits after the last wrapper disconnects, counting wrappers only
and ignoring a still-bridged module. The module is built as if the bridge were
permanent: bounded retries, then a manual click. Ordinary use of Claude Desktop
triggers the collision.

Unsettled because task-004 as filed may be too narrow. Candidates: unbounded
backoff on the module side; the backend declining to exit while a module is
bridged; or an explicit lifecycle contract making one side authoritative. It is
a contract between the halves, so it wants a design record, not a constant.

### 2. Tools written this session were not built test-first, and it showed

about: wip

`backup-assets.mjs` was smoke-tested on 40 URLs, looked fine, and was
committed. An adversarial review then found six defects that silently corrupt
files, five reproducible end to end. Law 5 exists for this and was not
followed.

Unsettled because "write tests next time" is not the right correction. The
defects were all in I/O edge cases -- content encoding, partial responses,
case-folding filesystems -- that a unit test by the same author would likely
have missed too. What caught them was an adversarial pass with a local HTTP
harness. Whether that becomes a standing requirement for network-facing tools
is the open question.

### 3. Verify a compatibility claim by running it, not by reading the manifest

about: wip

Most of a day went into reasoning about whether the module would work on
Foundry 13 -- reading declared ranges, scraping package pages, installing
typings as evidence. Installing 13.348 and looking settled it in minutes, and
also produced the number that actually mattered: 42 of 44 modules available
versus 34 on v14.

Unsettled as to how far it generalises. Standing up a whole second environment
is not always cheap, and here it was only cheap because the licence, the
export and the asset library were already in hand. The narrower and probably
correct version: when a decision is one-way -- and a world migration is -- the
cost of testing it is almost always less than the cost of being wrong.
