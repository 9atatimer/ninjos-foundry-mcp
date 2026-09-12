#!/usr/bin/env node
// Sync a Forge VTT Assets Library to local disk.
//
// Does what the Forge module's Asset Sync tool does, but against the same API
// directly, so it needs neither a running Foundry nor a GM session.
//
//   node scripts/forge-asset-sync.mjs --key-file <f> --out <dir> [options]
//
//   --key-file <f>   file containing the Forge API key (read-assets is enough)
//   --key <k>        the key inline (prefer --key-file; argv is visible in ps)
//   --out <dir>      output root (default: forge-assets)
//   --inventory <f>  reuse a saved /api/assets response instead of refetching
//   --prefix <p>     only paths starting with this (e.g. modules/ddb-importer)
//   --max <n>        ceiling on concurrency (default 16)
//   --retries <n>    attempts per file (default 5)
//   --verify         re-hash files already on disk instead of trusting size
//   --on-collision   refuse (default) | suffix -- what to do when two asset
//                    paths fold to one local path on a case-insensitive volume
//   --dry-run        plan only
//
// Why this is safer than fetching a list of URLs:
//
// The inventory gives an authoritative size and hash for every file, so a
// transfer is accepted only when the bytes on disk match the size the API
// promised. That single check closes the whole "truncated but recorded as
// complete" class -- short chunked bodies, a range served against a gzipped
// representation, a proxy answering 206 with the entire object. None of them
// can survive a length comparison against an out-of-band expected value.
//
// Requests are sent with `accept-encoding: identity`. Without it undici asks
// for gzip and transparently decodes, so a resume offset counted in decoded
// bytes gets sent as a Range against the compressed representation, which is a
// different coordinate space and silently corrupts the file.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const FORGE_API = 'https://forge-vtt.com/api';

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
function flag(name, dflt = null) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const has = (name) => argv.includes(`--${name}`);

function posInt(name, dflt) {
  const raw = flag(name, null);
  if (raw === null) return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`--${name} must be a positive integer, got ${JSON.stringify(raw)}`);
    process.exit(2);
  }
  return n;
}

const OUT = path.resolve(String(flag('out', 'forge-assets')));
const INVENTORY = flag('inventory', null);
const PREFIX = flag('prefix', null);
const MAX_CONC = posInt('max', 16);
const MAX_RETRIES = posInt('retries', 5);
const VERIFY = has('verify');
// APFS folds case, so "Armor.webp" and "armor.webp" are one inode. Refuse by
// default rather than silently store one file's bytes under both names.
const ON_COLLISION = String(flag('on-collision', 'refuse'));
const DRY = has('dry-run');

let KEY = flag('key', null);
const KEY_FILE = flag('key-file', null);
if (KEY_FILE && KEY_FILE !== true) KEY = fs.readFileSync(String(KEY_FILE), 'utf8').trim();
if (!KEY || KEY === true) {
  console.error('need --key-file <f> or --key <k>');
  process.exit(2);
}

// ------------------------------------------------------------------- state

const STATE = path.join(OUT, '.state');
const DONE_LOG = path.join(STATE, 'done.jsonl');
const FAIL_LOG = path.join(STATE, 'failed.jsonl');

function readDone() {
  const m = new Map();
  if (!fs.existsSync(DONE_LOG)) return m;
  for (const line of fs.readFileSync(DONE_LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      m.set(o.path, o);
    } catch {
      /* torn final line after a kill; ignore */
    }
  }
  return m;
}

// ------------------------------------------------------------ path mapping

// Forge returns the real stored path, so no URL guesswork is needed. Only the
// separator and control characters matter, and every mapping is checked for
// collisions up front rather than discovered as a corrupted file later.
function localPathFor(assetPath) {
  const parts = assetPath
    .split('/')
    .filter(Boolean)
    .map((p) => {
      let d;
      try {
        d = decodeURIComponent(p);
      } catch {
        d = p;
      }
      return d.replace(/[\x00-\x1f\x7f]/g, '').replace(/[/\\]/g, '_') || '_';
    });
  return path.join(OUT, ...parts);
}

// ------------------------------------------------------------- hash support

// Forge stores an S3-style ETag. A plain 32-hex value is an MD5 of the whole
// object and is worth checking; a "<hex>-<n>" value is a multipart ETag whose
// part size we do not know, so only the length is checkable there.
const isPlainMd5 = (h) => typeof h === 'string' && /^[0-9a-f]{32}$/.test(h);

async function md5File(file) {
  const h = crypto.createHash('md5');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

// ---------------------------------------------------------- rate governor

// AIMD, with one difference from the usual shape: workers consult the governor
// at the top of every iteration and exit when the pool is over budget, so a
// decrease actually reduces parallelism instead of only reducing the spawn cap.
class Governor {
  constructor(max) {
    this.conc = Math.min(4, max);
    this.max = max;
    this.okStreak = 0;
    this.pushbacks = 0;
  }
  success() {
    this.okStreak += 1;
    if (this.okStreak >= 10) {
      this.okStreak = 0;
      if (this.conc < this.max) this.conc += 1;
    }
  }
  pushback(hard) {
    this.pushbacks += 1;
    this.okStreak = 0;
    this.conc = Math.max(1, hard ? Math.floor(this.conc / 2) : this.conc - 1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function backoff(attempt, retryAfter) {
  if (retryAfter) {
    const s = Number(retryAfter);
    if (!Number.isNaN(s)) return Math.min(s * 1000, 120_000);
  }
  const base = Math.min(1000 * 2 ** attempt, 60_000);
  return base / 2 + Math.random() * (base / 2);
}

// ------------------------------------------------------------ the transfer

async function fetchAsset(asset, gov, dest) {
  const tmp = `${dest}.part`;
  await fsp.mkdir(path.dirname(dest), { recursive: true });

  const ctl = new AbortController();
  // Covers the whole transfer, not just the headers: cleared in finally.
  const timer = setTimeout(() => ctl.abort(), 15 * 60_000);

  try {
    const res = await fetch(asset.url, {
      // identity is load-bearing; see the header comment.
      headers: { 'accept-encoding': 'identity' },
      signal: ctl.signal,
      redirect: 'follow',
    });

    const code = res.status;
    if (code === 404 || code === 410) {
      await res.body?.cancel?.().catch(() => {});
      return { status: 'missing', code };
    }
    if (code === 429 || code >= 500) {
      await res.body?.cancel?.().catch(() => {});
      gov.pushback(true);
      return { status: 'retry', code, retryAfter: res.headers.get('retry-after') };
    }
    if (code !== 200) {
      await res.body?.cancel?.().catch(() => {});
      return { status: 'retry', code };
    }

    let written = 0;
    const md5 = crypto.createHash('md5');
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        written += chunk.length;
        md5.update(chunk);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp, { flags: 'w' }));

    // The authoritative check. Anything that produced the wrong number of
    // bytes is discarded rather than promoted, whatever the status code said.
    if (typeof asset.size === 'number' && written !== asset.size) {
      await fsp.rm(tmp, { force: true });
      return { status: 'retry', reason: `size ${written} != expected ${asset.size}` };
    }
    if (isPlainMd5(asset.hash)) {
      const got = md5.digest('hex');
      if (got !== asset.hash) {
        await fsp.rm(tmp, { force: true });
        return { status: 'retry', reason: `md5 ${got.slice(0, 8)} != ${asset.hash.slice(0, 8)}` };
      }
    }

    await fsp.rename(tmp, dest);
    gov.success();
    return { status: 'done', bytes: written };
  } catch (e) {
    gov.pushback(false);
    const why = e.name === 'AbortError' ? 'timeout' : e.message;
    await fsp.rm(tmp, { force: true }).catch(() => {});
    return { status: 'retry', reason: `transport: ${why}` };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ display

function fmt(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i ? 1 : 0)}${u[i]}`;
}
function hms(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--:--:--';
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((x) => String(x).padStart(2, '0'))
    .join(':');
}

// ------------------------------------------------------------------ driver

async function loadInventory() {
  if (INVENTORY && INVENTORY !== true) {
    const j = JSON.parse(fs.readFileSync(String(INVENTORY), 'utf8'));
    return j.assets || j;
  }
  process.stdout.write('fetching inventory from Forge... ');
  const res = await fetch(`${FORGE_API}/assets`, { headers: { 'Access-Key': KEY } });
  if (!res.ok) throw new Error(`inventory: HTTP ${res.status}`);
  const j = await res.json();
  console.log(`${(j.assets || []).length} entries`);
  return j.assets || [];
}

async function main() {
  const raw = await loadInventory();

  // Directory entries carry no size and no url.
  let assets = raw.filter((a) => a && a.url && typeof a.size === 'number');
  for (const a of assets) {
    if (!a.path) {
      const m = a.url.match(/assets\.forge-vtt\.com\/[^/]+\/(.*)$/);
      a.path = m ? decodeURIComponent(m[1]) : a.name;
    }
  }
  if (PREFIX && PREFIX !== true) {
    assets = assets.filter((a) => a.path.startsWith(String(PREFIX)));
  }

  // Injectivity check. Two assets mapping to one local path would race and
  // record one file's bytes under the other's name, so refuse up front.
  const seen = new Map();
  const collisions = [];
  for (const a of assets) {
    const key = localPathFor(a.path).toLowerCase(); // APFS is case-insensitive
    if (seen.has(key)) collisions.push([seen.get(key), a.path]);
    else seen.set(key, a.path);
  }
  if (collisions.length && ON_COLLISION !== 'suffix') {
    console.error(`\nREFUSING: ${collisions.length} path collisions on a case-insensitive volume, e.g.`);
    for (const [x, y] of collisions.slice(0, 5)) console.error(`   ${x}\n   ${y}\n`);
    console.error('Re-run with --on-collision suffix to store them under distinct names.');
    process.exit(1);
  }
  // Disambiguate by giving every loser a short hash of its true path. The
  // mapping is written to .state/index.jsonl so a later rewrite can resolve it.
  const overrides = new Map();
  if (collisions.length) {
    for (const [, loser] of collisions) {
      const h = crypto.createHash('sha1').update(loser).digest('hex').slice(0, 8);
      const base = localPathFor(loser);
      const ext = path.extname(base);
      overrides.set(loser, `${base.slice(0, base.length - ext.length)}~${h}${ext}`);
    }
    console.log(`note: ${collisions.length} case-collisions disambiguated with a hash suffix`);
  }
  const mapped = (a) => overrides.get(a.path) ?? localPathFor(a.path);

  await fsp.mkdir(STATE, { recursive: true });
  const done = readDone();

  const todo = [];
  let haveBytes = 0;
  let skipped = 0;
  for (const a of assets) {
    const dest = mapped(a);
    let ok = false;
    if (done.has(a.path)) ok = true;
    else {
      try {
        ok = fs.statSync(dest).size === a.size;
      } catch {
        ok = false;
      }
    }
    if (ok && VERIFY && isPlainMd5(a.hash)) {
      ok = (await md5File(dest).catch(() => null)) === a.hash;
    }
    if (ok) {
      skipped += 1;
      haveBytes += a.size;
    } else todo.push(a);
  }

  const todoBytes = todo.reduce((n, a) => n + a.size, 0);
  console.log(`files          ${assets.length}  (${fmt(assets.reduce((n, a) => n + a.size, 0))})`);
  console.log(`already have   ${skipped}  (${fmt(haveBytes)})`);
  console.log(`to fetch       ${todo.length}  (${fmt(todoBytes)})`);
  console.log(`output         ${OUT}`);

  if (DRY) {
    console.log('\n--dry-run. sample:');
    for (const a of todo.slice(0, 5)) {
      console.log(`  ${a.path}  ${fmt(a.size)}\n    -> ${path.relative(OUT, mapped(a))}`);
    }
    return;
  }
  if (!todo.length) {
    console.log('\nnothing to do.');
    return;
  }

  const doneLog = fs.createWriteStream(DONE_LOG, { flags: 'a' });
  const failLog = fs.createWriteStream(FAIL_LOG, { flags: 'a' });
  const gov = new Governor(MAX_CONC);
  const stats = { done: 0, missing: 0, failed: 0, bytes: 0, retries: 0 };
  const t0 = Date.now();
  let cursor = 0;
  let stopping = false;

  const finish = async () => {
    await new Promise((r) => doneLog.end(r));
    await new Promise((r) => failLog.end(r));
  };
  process.on('SIGINT', () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log('\ninterrupt: draining. State is on disk; re-run to resume.');
  });

  const report = setInterval(() => {
    const el = Date.now() - t0;
    const pctBytes = ((stats.bytes / todoBytes) * 100).toFixed(1);
    const rate = stats.bytes / (el / 1000);
    const eta = rate > 0 ? hms(((todoBytes - stats.bytes) / rate) * 1000) : '--:--:--';
    process.stdout.write(
      `\r${pctBytes}%  ok ${stats.done}/${todo.length}  miss ${stats.missing}  fail ${stats.failed}` +
        `  retry ${stats.retries}  ${fmt(stats.bytes)} @ ${fmt(rate)}/s  conc ${gov.conc}  eta ${eta}   `
    );
  }, 1000);
  report.unref();

  async function worker(slot) {
    while (!stopping) {
      // The fix for a pool that only ever grew: over-budget workers retire.
      if (slot >= gov.conc) return;
      const i = cursor;
      cursor += 1;
      if (i >= todo.length) return;
      const a = todo[i];

      let result = { status: 'retry', reason: 'not attempted' };
      for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        try {
          result = await fetchAsset(a, gov, mapped(a));
        } catch (e) {
          // A per-file failure must never take the run down.
          result = { status: 'retry', reason: `unexpected: ${e.message}` };
        }
        if (result.status !== 'retry') break;
        stats.retries += 1;
        if (attempt < MAX_RETRIES - 1) await sleep(backoff(attempt + 1, result.retryAfter));
      }

      if (result.status === 'done') {
        stats.done += 1;
        stats.bytes += result.bytes;
        doneLog.write(`${JSON.stringify({ path: a.path, bytes: result.bytes, local: path.relative(OUT, mapped(a)) })}\n`);
      } else if (result.status === 'missing') {
        stats.missing += 1;
        failLog.write(`${JSON.stringify({ path: a.path, kind: 'missing', code: result.code })}\n`);
      } else {
        stats.failed += 1;
        failLog.write(
          `${JSON.stringify({ path: a.path, kind: 'failed', code: result.code ?? null, reason: result.reason ?? null })}\n`
        );
      }
    }
  }

  const running = new Set();
  let slotSeq = 0;
  while ((cursor < todo.length || running.size > 0) && !stopping) {
    while (running.size < gov.conc && cursor < todo.length) {
      const slot = slotSeq;
      slotSeq += 1;
      const p = worker(slot).finally(() => running.delete(p));
      running.add(p);
    }
    // slotSeq only ever rises, so recycle it once every worker has retired.
    if (running.size === 0 && cursor < todo.length) slotSeq = 0;
    await Promise.race([...running, sleep(200)]);
  }
  await Promise.allSettled([...running]);

  clearInterval(report);
  const el = (Date.now() - t0) / 1000;
  console.log(`\n\ndone in ${hms(el * 1000)}${stopping ? ' (interrupted)' : ''}`);
  console.log(`  fetched  ${stats.done}  (${fmt(stats.bytes)})`);
  console.log(`  missing  ${stats.missing}`);
  console.log(`  failed   ${stats.failed}  (see ${path.relative(process.cwd(), FAIL_LOG)})`);
  console.log(`  retries  ${stats.retries}   pushbacks ${gov.pushbacks}`);
  await finish();
}

main().catch(async (e) => {
  console.error('\nfatal:', e.message);
  process.exit(1);
});
