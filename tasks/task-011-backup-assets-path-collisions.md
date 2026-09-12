---
id: task-011
kind: bug
title: backup-assets.mjs maps distinct URLs to one path and dies on the race
created: 2026-09-12
---

## Symptom

`localPathFor` in `scripts/backup-assets.mjs` is not injective, and nothing
checks that it is.

- The query string is discarded (`u.pathname` only), so `icon.png?v=1` and
  `icon.png?v=2` map to one file. Both survive manifest dedup, which is on the
  full URL.
- `[/\\:]` collapse to `_`, so `a:b/x.png` and `a_b/x.png` collide.
- macOS APFS folds case, so `Sword.webp` and `sword.webp` are one inode.
- `.trim()` and the control-character strip fold further pairs together.

When two workers hit one path they open independent write streams on it. The
faster renames and logs done; the slower keeps writing into the renamed inode,
so one URL's bytes are recorded under the other's name. The slower worker's
`rename` then fails ENOENT.

## Impact

Corrupt content recorded as complete, plus a crash. `fsp.mkdir` and `fsp.rename`
are unguarded, so that ENOENT propagates out of `worker`, out of `Promise.race`,
into `main().catch` and `process.exit(1)` -- which does not flush the three
buffered log streams, discarding up to 64KB of already-earned `done.jsonl`.

A single filesystem error therefore aborts an entire multi-hour run and loses
progress that was already paid for. The same happens for `EEXIST` when a CDN
tree contains both a leaf and a directory of that name.

## Evidence

Reproduced 2026-09-12 in review: two workers on one path produced a 300,000-byte
file containing entirely `v=1`'s content, logged in `done.jsonl` against `v=2`.

Not hypothetical at scale -- `forge-asset-sync.mjs` ran the equivalent
injectivity assertion over the real 53,261-file library and found **25 genuine
case-collisions** in the DDB icon set (`Armor.webp` / `armor.webp` and similar).

The check belongs before any transfer starts: assert the mapping is injective
case-folded across the whole manifest, and refuse rather than discover it later.
