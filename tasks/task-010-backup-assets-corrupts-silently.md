---
id: task-010
kind: bug
title: backup-assets.mjs can record a truncated file as complete
created: 2026-09-12
---

## Symptom

`scripts/backup-assets.mjs` accepts and permanently records files that are not
what the server sent. An adversarial review reproduced four distinct routes to
it against a local HTTP harness.

- **Gzip vs Range coordinate mismatch.** undici sends
  `Accept-Encoding: gzip, deflate` unconditionally and decodes transparently, so
  `.part` holds decoded bytes while `Range: bytes=<n>-` addresses the compressed
  representation. The offset overshoots, the server answers 416, and the 416
  branch renames the truncated `.part` to its final name and returns `done`.
  Reproduced: a 198,026-byte object left on disk as 160,484 bytes, logged done.
- **416 treated as proof of completeness.** It only means "start >= length". The
  `Content-Range: bytes */N` the server supplies is never read.
- **206 trusted on status code alone.** `appending = code === 206 && offset > 0`
  does not check `Content-Range`, so a 206 carrying the whole object is appended
  onto the existing prefix. Reproduced: 1400-byte file for a 1000-byte object.
- **No length check for chunked responses.** `expected = Number(... || 0)` and
  `if (expected && ...)` make the short-read guard dead whenever
  `Content-Length` is absent -- which is how the Forge CDN serves. Reproduced: a
  1000-byte object terminated at 300 bytes, renamed and logged done.

Every one of these is skipped by all future runs, because the URL is in
`done.jsonl` and the file exists at non-zero size.

## Impact

This is a backup tool. A file that is wrong but recorded as complete is the
worst outcome it has, and it is silent -- nothing in the summary, the logs or a
re-run will reveal it.

## Evidence

Reported by an adversarial review on 2026-09-12, reproduced end to end against a
local harness (not the live CDN). The tool had been smoke-tested on 40 URLs only
and had never run at scale.

`scripts/forge-asset-sync.mjs`, written afterwards, avoids the whole class by
verifying each finished file against a size and hash obtained out-of-band from
the Forge inventory API, and by sending `accept-encoding: identity`. That is the
shape the fix should take: never validate a transfer against metadata carried by
the same response.
