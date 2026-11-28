---
id: task-026
kind: bug
title: "Over WebRTC a lost chunk of a large message ends in a generic timeout, with no error saying data was lost"
issue: https://github.com/9atatimer/tedious-gm-mcp/issues/35
created: 2026-11-27
---

Found by auditing upstream commits (`adambdooley/foundry-vtt-mcp`, MIT) against this code at `2c62ae0`. The issue holds the evidence and the done-when; fix it test-first.
