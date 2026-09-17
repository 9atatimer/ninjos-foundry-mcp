---
id: task-021
kind: task
title: Evaluate and install Docling as an MCP tool for campaign documents
created: 2026-09-17
---

## Why

Campaign material arrives as PDFs and Word files -- published adventures,
statblock appendices, handouts, maps with keyed room text. Getting that into
Foundry today means reading a PDF page by page in-session and retyping.
Docling (IBM) converts PDF/DOCX/PPTX/HTML into structured Markdown with
tables, headings and reading order preserved, and ships an MCP server, so an
agent connected to Foundry could go document -> journal entry / compendium
entry directly.

## Scope

- Tech radar first: Docling is not on it. Propose a row (adopt/trial/hold)
  before adding the dependency -- the architecture skill owns that.
- Install through a package manager only (`uv`/`pipx`). Never a fetched shell
  script.
- Decide where the server is configured: this repo's `.mcp.json` (available
  whenever the Foundry bridge is), the user scope, or the campaign tree.
- Check what it needs at runtime: model weights for OCR/layout, offline use,
  memory, and whether scanned PDFs need OCR enabled.
- Prove it on one real document end to end: PDF -> Markdown -> a Foundry
  journal entry via `journal-page-from-file` or `journal-create`.

## Open questions

- Does the output need a cleanup pass before it is Foundry-ready (HTML vs
  Markdown, image extraction, link rewriting)?
- Licence and offline behaviour of any downloaded models.
