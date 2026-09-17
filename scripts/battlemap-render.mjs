#!/usr/bin/env node
/**
 * Render a battlemap with one of the workflows in `workflows/battlemap/`.
 *
 * These are ComfyUI API-format graphs. Nodes carry `_meta.title`, so this
 * runner can find the prompt, latent, sampler and save nodes without knowing
 * each graph's numbering -- the graphs differ (SDXL, Flux, SD1.5 + upscale).
 *
 *   node scripts/battlemap-render.mjs --workflow workflows/battlemap/01-*.json \
 *     --prompt "a ruined desert shrine" --seed 42 --size 1024 --out ./maps
 *
 * It talks to ComfyUI directly and does NOT touch Foundry: nothing is
 * uploaded and no scene is created. That is the point -- try alternatives
 * without disturbing a live game.
 */

import fs from 'node:fs';
import path from 'node:path';

const TRIGGER_SUFFIX = 'top-down view, overhead perspective, aerial';

function parseArgs(argv) {
  const out = { host: '127.0.0.1', port: 8000 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (!key) continue;
    out[key] = argv[i + 1];
  }
  return out;
}

function nodeByTitle(workflow, title) {
  const hit = Object.entries(workflow).find(([, n]) => n._meta?.title === title);
  return hit ? hit[0] : null;
}

function applyOverrides(workflow, args) {
  const set = (title, field, value) => {
    if (value === undefined) return;
    const id = nodeByTitle(workflow, title);
    if (!id) return;
    workflow[id].inputs[field] = value;
  };

  if (args.prompt) {
    const id = nodeByTitle(workflow, 'POSITIVE');
    const existing = workflow[id].inputs.text;
    // Keep any leading trigger words the graph ships with (e.g. "battlemap, ").
    const trigger = existing.split(/2d DnD battlemap of |a narrow rocky/)[0] ?? '';
    workflow[id].inputs.text = `${trigger}${args.prompt}, ${TRIGGER_SUFFIX}`;
  }
  set('NEGATIVE', 'text', args.negative);
  set('SAMPLER', 'seed', args.seed !== undefined ? Number(args.seed) : undefined);
  set('SAMPLER', 'steps', args.steps !== undefined ? Number(args.steps) : undefined);
  set('SAMPLER', 'cfg', args.cfg !== undefined ? Number(args.cfg) : undefined);
  if (args.size) {
    set('LATENT', 'width', Number(args.size));
    set('LATENT', 'height', Number(args.size));
  }
  return workflow;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.workflow) {
    console.error('usage: battlemap-render.mjs --workflow <file> [--prompt ...] [--seed n]');
    console.error('       [--steps n] [--cfg n] [--size n] [--negative ...] [--out dir]');
    process.exit(2);
  }
  const base = `http://${args.host}:${args.port}`;
  const workflow = applyOverrides(
    JSON.parse(fs.readFileSync(args.workflow, 'utf8')),
    args
  );

  const submit = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!submit.ok) {
    console.error(`ComfyUI rejected the graph (${submit.status}):`, await submit.text());
    process.exit(1);
  }
  const { prompt_id: promptId } = await submit.json();
  console.log(`submitted ${promptId} (${path.basename(args.workflow)})`);

  const started = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 5000));
    const history = await (await fetch(`${base}/history/${promptId}`)).json();
    const entry = history[promptId];
    if (!entry) continue;

    const errors = (entry.status?.messages ?? []).filter(m => m[0] === 'execution_error');
    if (errors.length) {
      console.error('failed:', JSON.stringify(errors[0][1], null, 1));
      process.exit(1);
    }
    const images = Object.values(entry.outputs ?? {}).flatMap(o => o.images ?? []);
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`${entry.status?.status_str} in ${secs}s: ${images.map(i => i.filename).join(', ')}`);

    if (args.out) {
      fs.mkdirSync(args.out, { recursive: true });
      for (const img of images) {
        const url = `${base}/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder ?? '')}`;
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
        const dest = path.join(args.out, img.filename);
        fs.writeFileSync(dest, buf);
        console.log(`saved ${dest}`);
      }
    }
    return;
  }
}

main();
