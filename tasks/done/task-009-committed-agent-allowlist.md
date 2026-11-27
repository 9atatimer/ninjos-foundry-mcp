---
id: task-009
kind: bug
title: A committed Claude permission allowlist grants broad execution in this repo
created: 2026-09-12
---

## Symptom

`.claude/settings.local.json` is committed and carries the upstream
author's permission allowlist, which applies to any agent session opened
in this repo. Among the entries:

- `Bash(sudo:*)`, `Bash(powershell:*)`, `Bash(curl:*)`, `Bash(npm run:*)`,
  `Bash(kill:*)`, `Bash(pkill:*)`, `Bash(xattr:*)`
- `Read(//Users/Adam/**)`, `Read(//tmp/**)`, `Read(//Applications/**)`
- `additionalDirectories`: `D:\Projects\foundry-vtt-mcp`,
  `D:\d\Projects\FVTTMCP\installer`

## Impact

A `.local.json` file is by convention machine-local and untracked;
committing one silently hands every future clone a pre-approved execution
surface its owner never chose. The paths show it was written on someone
else's Windows machine, so nothing in it reflects a decision anyone here
made.

`Bash(sudo:*)` and `Bash(curl:*)` on their own are enough to make the
allowlist worth removing rather than editing down.

## Evidence

Flagged by clone-audit on a fresh clone, 2026-09-12:

```
[WARN] AGENT-EXEC    .claude/settings.local.json -- ships a permission allowlist
```

Present at `e4bfb5e`. Full contents readable in the file; the entries
above are a sample, not the whole list.
