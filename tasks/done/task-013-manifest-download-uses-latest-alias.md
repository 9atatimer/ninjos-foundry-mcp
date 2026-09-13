---
id: task-013
kind: bug
title: module.json manifest/download use /releases/latest/ which 404s on prerelease-only repo
created: 2026-09-12
implements: .github/workflows/release-modul.yml
---

Installing the module into a real Foundry instance (on The Forge) failed.
Forge's Bazaar install-job endpoint (`api/task/status/<id>`) returned HTTP
500 while processing the install.

## Evidence

- `curl -I https://github.com/9atatimer/ninjos-foundry-mcp/releases/latest/download/module.zip`
  returns 404.
- The shipped `module.json` (both the source at
  `packages/foundry-module/module.json` and the artifact attached to the
  `v14.2609.4-beta1` release) has:
  ```
  "manifest": ".../releases/latest/download/module.json",
  "download": ".../releases/latest/download/module.zip",
  ```
- This repo currently has only a prerelease tag. GitHub's `/releases/latest/`
  alias explicitly excludes prereleases, so it resolves to nothing until a
  non-prerelease release exists.
- Foundry (and Forge's Bazaar) fetch the manifest, then fetch the `download`
  URL from inside it to get the zip. That second fetch 404s, which is the
  most likely proximate cause of the Forge install-job 500.

## Mechanism

`release-modul.yml`'s "Modulpaket schnueren" step copies
`packages/foundry-module/module.json` verbatim into the release artifact.
Nothing rewrites `manifest`/`download` to point at the specific tag being
released, so every release -- beta or not -- ships URLs that only work once
a non-prerelease release exists on the repo.
