---
id: task-007
kind: bug
title: The module release workflow submits upstream's manifest URL
created: 2026-09-12
---

## Symptom

`.github/workflows/release-modul.yml`, in the "Beim Foundry-Katalog
einreichen" step, hardcodes the manifest URL to the upstream repository:

```
manifest-url: https://github.com/Niclasp1501/ninjos-foundry-mcp/releases/download/${{ github.ref_name }}/module.json
```

This fork is `9atatimer/ninjos-foundry-mcp`. A release cut here would
submit a URL pointing at a tag in someone else's repository.

## Impact

Latent rather than active: the step is gated on
`env.PACKAGE_TOKEN != '' && !contains(github.ref_name, 'beta')`, and no
`PACKAGE_TOKEN` is configured on the fork. It fires the moment both change
-- which is exactly the moment someone publishes for the first time and is
least likely to be reading the workflow.

The beta gate is the reason the Forge development loop is safe to run:
a `v*-beta*` tag builds, zips, and attaches `module.json` + `module.zip`
to a GitHub release without touching the catalog. That URL is what Forge
installs from.

## Evidence

Read from the workflow at `e4bfb5e` on 2026-09-12. The repository is a
fork of `Niclasp1501/ninjos-foundry-mcp`; `gh repo view` reports
`isFork: true` with that parent.

Related: `packages/foundry-module/module.json:2` sets `id` to
`ninjos-foundry-mcp`, which is the upstream id in the Foundry registry and
is what Foundry keys world settings off.
