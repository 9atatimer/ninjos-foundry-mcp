#!/usr/bin/env node
// Install the modules a world expects, into a locally running Foundry.
//
// A world exported from a hosted platform arrives with no modules and, in the
// Forge case, an empty `relationships` block -- so it does not declare its own
// dependencies. The list it actually used survives as the `core.moduleConfiguration`
// setting stored inside the world's own database. This reads that, matches it
// against the package registry the running Foundry exposes, and installs what
// it can.
//
//   node scripts/install-world-modules.mjs --world <path to world dir> [options]
//
//   --world <dir>    e.g. ~/Library/Application Support/FoundryVTT/Data/worlds/mainland
//   --url <base>     Foundry base URL (default http://localhost:30000)
//   --skip <a,b>     module ids to leave out (default: forge-vtt)
//   --dry-run        report the plan without installing
//
// FOUNDRY MUST BE RUNNING WITH NO WORLD ACTIVE. Every /setup action is refused
// with "You lack server administrator permission" while a world is launched,
// even when no admin password is set. Restart the server to clear it.
//
// Modules whose declared compatibility excludes the running core version are
// simply absent from the registry response, so they show up here as
// unavailable. That is a free and authoritative compatibility check -- better
// than reading version ranges off the website.

import fs from 'node:fs';
import path from 'node:path';
import { ClassicLevel } from 'classic-level';

const argv = process.argv.slice(2);
function flag(name, dflt = null) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const has = (n) => argv.includes(`--${n}`);

const WORLD = flag('world');
const BASE = String(flag('url', 'http://localhost:30000'));
const SKIP = new Set(
  String(flag('skip', 'forge-vtt'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const DRY = has('dry-run');

if (!WORLD || WORLD === true) {
  console.error('need --world <path to world directory>');
  process.exit(2);
}

const settingsDir = path.join(String(WORLD), 'data', 'settings');
if (!fs.existsSync(settingsDir)) {
  console.error(`no settings database at ${settingsDir}`);
  process.exit(1);
}

// --------------------------------------------- what the world says it wants

async function readModuleConfiguration(dir) {
  const db = new ClassicLevel(dir, { valueEncoding: 'json' });
  try {
    await db.open();
  } catch (e) {
    // LevelDB takes an exclusive lock, so a launched world makes this
    // unreadable. That is the single most likely reason to land here.
    console.error(`\ncannot open ${dir}`);
    console.error(`  ${e.code || e.name}: ${e.message.split('\n')[0]}`);
    console.error('\nIs the world currently launched? Foundry holds an exclusive lock on it.');
    console.error('Restart the server so it comes up with no world active, then retry.');
    process.exit(1);
  }
  let cfg = null;
  const it = db.iterator();
  try {
    for await (const [, v] of it) {
      if (v?.key === 'core.moduleConfiguration') {
        cfg = typeof v.value === 'string' ? JSON.parse(v.value) : v.value;
        break;
      }
    }
  } finally {
    await it.close().catch(() => {});
    await db.close().catch(() => {});
  }
  return cfg;
}

const cfg = await readModuleConfiguration(settingsDir);
if (!cfg) {
  console.error('core.moduleConfiguration not found in this world');
  process.exit(1);
}
const wanted = Object.entries(cfg)
  .filter(([, on]) => on)
  .map(([id]) => id)
  .sort();
console.log(`world declares ${Object.keys(cfg).length} modules, ${wanted.length} enabled`);

// ------------------------------------------------ what this Foundry can give

const setup = async (body) => {
  const r = await fetch(`${BASE}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
};

const registry = await setup({ action: 'getPackages', type: 'module' });
if (registry.error) {
  console.error(`\nregistry query failed: ${registry.error}`);
  console.error('Is a world currently active? /setup is admin-gated while one is launched.');
  process.exit(1);
}
const byId = new Map((registry.packages || []).map((p) => [p.id, p]));
console.log(`registry offers ${byId.size} modules for this core version`);

const plan = [];
const unavailable = [];
const skipped = [];
for (const id of wanted) {
  if (SKIP.has(id)) {
    skipped.push(id);
    continue;
  }
  const p = byId.get(id);
  if (!p) {
    unavailable.push(id);
    continue;
  }
  if (p.protected && !p.owned) {
    unavailable.push(`${id} (paid, not owned)`);
    continue;
  }
  plan.push(p);
}

console.log(`\nwill install   ${plan.length}`);
console.log(`unavailable    ${unavailable.length}`);
for (const u of unavailable) console.log(`   ${u}`);
if (skipped.length) console.log(`skipped        ${skipped.join(', ')}`);

if (DRY) {
  console.log('\n--dry-run. plan:');
  for (const p of plan) console.log(`   ${p.id.padEnd(36)} ${p.version}`);
  process.exit(0);
}
if (!plan.length) process.exit(0);

// ------------------------------------------------------------------ install

const modulesDir = path.resolve(String(WORLD), '..', '..', 'modules');
console.log(`\ninstalling into ${modulesDir}\n`);

let ok = 0;
let bad = 0;
for (const [i, p] of plan.entries()) {
  const res = await setup({
    action: 'installPackage',
    type: 'module',
    id: p.id,
    manifest: p.manifest,
  });
  // installPackage answers on accept, not on completion: the download runs
  // asynchronously server-side. Poll the filesystem for the real outcome.
  let landed = false;
  const target = path.join(modulesDir, p.id, 'module.json');
  for (let t = 0; t < 180; t += 1) {
    if (fs.existsSync(target)) {
      landed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (landed) ok += 1;
  else bad += 1;
  const note = res.error ? ` (${String(res.error).slice(0, 60)})` : '';
  console.log(
    `[${String(i + 1).padStart(2)}/${plan.length}] ${p.id.padEnd(36)} ${landed ? 'OK' : 'TIMEOUT'}${note}`
  );
}

console.log(`\ninstalled ${ok}, failed ${bad}, unavailable ${unavailable.length}`);
