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

| Reference               | Where                         |
| ----------------------- | ----------------------------- |
| Repo agent instructions | `AGENT.md`                    |
| Design records          | `docs/design/` (empty)        |
| As-built                | `docs/arch/` (empty)          |
| Concepts                | `docs/concepts/` (empty)      |
| Adding a game system    | `ADDING_NEW_SYSTEMS.md`       |
| Ninjo's own extensions  | `docs/NINJO-ERWEITERUNGEN.md` |

## Where Things Stand

A fork of `Niclasp1501/ninjos-foundry-mcp` at `14.2609.3`, cloned
2026-09-12 and never modified before that date. Upstream of the fork's
upstream is Adam Dooley's `foundry-vtt-mcp`.

The thing works. On 2026-09-12 a full round trip was verified on a local
rig: Foundry 14.359 headless serving a dnd5e 5.3.0 world, the module
active off a symlink with all 114 queries registered, the bridge green
over websocket, and `get-world-info` returning live world data through the
same stdio wrapper Claude Desktop spawns. 79 tools are exposed. Build and
`pruefen` are clean from a fresh clone.

What is not done is everything around it. The bridge authenticates
nobody (task-001), two of three ports are on `0.0.0.0` (task-002), and the
module gives up reconnecting in a situation the backend's own lifecycle
creates (task-004). There is no design record for any of it, so the first
piece of real work needs one written before it can start.

The owner runs Foundry on **The Forge**, not locally. A local Foundry is
installed anyway, purely as a dev-debug rig -- Forge has no writable
modules directory, so iterating there means a release per change. See
`AGENT.md` for both loops.

## Now

- **task-001** -- the bridge accepts any origin. Everything else is
  cosmetic next to an unauthenticated local port that drives 79 tools.
  Needs a design record first: the legitimate origin is not a constant
  (Forge world vs `localhost:30000`), so this adds a setting and a seam,
  and law 1 applies.
- **task-002** -- bind 31415 and 31416 to loopback. Independent of
  task-001 and far smaller; a same-host browser page defeats it alone,
  which is why it is not a substitute. Do it in the same pass if the
  design record covers both.
- **task-008** -- lockfile version drift. Trivial, already reproduced, and
  it makes every future `git status` honest. Cheap to clear before the
  larger work starts.
- **task-004** -- the reconnect defect. Real and user-visible, but see the
  lesson below: point-fixing the retry budget may be the wrong shape.
- **task-005** -- dependency advisories, four critical. `axios` and `ws`
  are runtime deps of the server.

Deliberately not in Now: task-003 (no container yet), task-006 (large,
no deadline), task-007 (latent until someone publishes).

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

The backend is built to come and go -- it exits 60s after the last wrapper
disconnects, by design, counting wrappers only and ignoring a still-bridged
module. The module is built as if the bridge were permanent: bounded
retries, then a manual click. Ordinary use of Claude Desktop triggers the
collision every time.

Unsettled because the fix is not obvious and task-004 as filed may be too
narrow. Candidates: unbounded backoff on the module side; the backend
declining to exit while a module is bridged; or an explicit lifecycle
contract making one side authoritative. Do not point-fix the retry
constant until that is decided -- record the decision as a design record,
because it is a contract between the halves, not an implementation detail.
