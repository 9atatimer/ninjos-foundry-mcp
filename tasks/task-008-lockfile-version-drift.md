---
id: task-008
kind: bug
title: The committed lockfile records a stale version
created: 2026-09-12
---

## Symptom

`package-lock.json` at `e4bfb5e` records `14.2608.1` in the root package
entry and in all three workspace entries, while every `package.json` and
`module.json` in the tree says `14.2609.3`. A plain `npm install`
rewrites five lines to close the gap.

## Impact

Small but real: the lockfile was not regenerated when 14.2609.3 was cut,
so the repo cannot produce a clean `git status` after an install, and
`npm ci` in CI runs against a manifest that disagrees with the
package files it is locking.

`scripts/version-pruefen.mjs` checks the five version-bearing files and
the tag; `package-lock.json` is not among them, which is why the drift
was not caught.

## Evidence

```
$ npm install && git diff --stat package-lock.json
 package-lock.json | 10 +++++-----
 1 file changed, 5 insertions(+), 5 deletions(-)

-      "version": "14.2608.1",
+      "version": "14.2609.3",
```

Observed 2026-09-12 on a fresh clone of `main`.
