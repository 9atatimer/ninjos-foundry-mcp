#!/usr/bin/env node
// Resumable bulk asset downloader.
//
// Pulls every URL in a manifest into an output tree, and is built to be killed
// and restarted at any point: completed files are skipped, half-written files
// resume from their byte offset via an HTTP Range request.
//
// Concurrency is not configured, it is discovered. The pool starts small and
// walks up while throughput keeps improving, and backs off multiplicatively the
// moment the server pushes back (429, 5xx, timeouts). The request rate adapts
// the same way.
//
//   node scripts/backup-assets.mjs --manifest <file> [options]
//
//   --manifest <f>   one URL per line; blank lines and # comments ignored
//   --out <dir>      output root (default: backup-<today>)
//   --max <n>        hard ceiling on concurrency (default 32)
//   --start <n>      initial concurrency (default 4)
//   --limit <n>      only process the first n URLs (smoke test)
//   --host <substr>  only URLs whose host contains this substring
//   --retries <n>    attempts per URL before parking it (default 5)
//   --dry-run        plan and show path mapping, no network
//
// State lives in <out>/.state/ : done.jsonl, failed.jsonl, index.jsonl.
// Deleting .state/ forces a re-verify; files already on disk at non-zero size
// are still skipped, so that is cheap.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const has = (name) => argv.includes(`--${name}`);

const today = new Date().toISOString().slice(0, 10);
const MANIFEST = flag('manifest');
const OUT = path.resolve(String(flag('out', `backup-${today}`)));
const MAX_CONC = Number(flag('max', 32));
const START_CONC = Number(flag('start', 4));
const LIMIT = flag('limit') ? Number(flag('limit')) : Infinity;
const HOST_FILTER = flag('host');
const MAX_RETRIES = Number(flag('retries', 5));
const DRY = has('dry-run');

if (!MANIFEST || MANIFEST === true) {
  console.error('need --manifest <file>. See the header of this file for options.');
  process.exit(2);
}

// ------------------------------------------------------------ path mapping

// A URL becomes <out>/<host>/<decoded path>. Segments get sanitised because
// this asset library is full of spaces, pipes and parentheses, and any segment
// over 200 bytes is truncated with a hash so the name stays unique and the
// filesystem stays happy.
const CONTROL = /[\x00-\x1f\x7f]/g;

function sanitiseSegment(s) {
  let out = s.replace(CONTROL, '').replace(/[/\\:]/g, '_').trim();
  if (out === '' || out === '.' || out === '..') out = '_';
  if (Buffer.byteLength(out) > 200) {
    const h = crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
    const ext = path.extname(out).slice(0, 12);
    const head = Buffer.from(out).subarray(0, 180).toString('utf8').replace(/\uFFFD+$/, '');
    out = `${head}~${h}${ext}`;
  }
  return out;
}

function localPathFor(urlStr) {
  const u = new URL(urlStr);
  const parts = u.pathname
    .split('/')
    .filter(Boolean)
    .map((p) => {
      let d;
      try {
        d = decodeURIComponent(p);
      } catch {
        d = p;
      }
      return sanitiseSegment(d);
    });
  if (!parts.length) parts.push('index');
  return path.join(OUT, sanitiseSegment(u.host), ...parts);
}

// Manifest URLs arrive already percent-encoded, but may also carry raw spaces
// and pipes. The WHATWG parser escapes what is illegal and leaves valid escapes
// alone, which is the only behaviour that is correct for both.
//
// Do NOT reach for encodeURI(decodeURI(u)) here: decodeURI deliberately
// preserves encoded RESERVED characters, so a "%2C" survives the decode and
// then encodeURI escapes its percent sign, yielding "%252C" and a 404.
function normaliseUrl(u) {
  try {
    return new URL(u).href;
  } catch {
    return u;
  }
}

// ------------------------------------------------------------------- state

const STATE = path.join(OUT, '.state');
const DONE_LOG = path.join(STATE, 'done.jsonl');
const FAIL_LOG = path.join(STATE, 'failed.jsonl');
const INDEX_LOG = path.join(STATE, 'index.jsonl');

function readLog(file) {
  const m = new Map();
  if (!fs.existsSync(file)) return m;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      m.set(o.url, o);
    } catch {
      /* a torn last line after a kill is expected; skip it */
    }
  }
  return m;
}

const append = (stream, obj) => stream.write(`${JSON.stringify(obj)}\n`);

// ------------------------------------------------------- adaptive controller

// AIMD on both concurrency and request rate, plus a throughput memory so the
// pool stops climbing once extra workers buy nothing. Pushback is any 429, any
// 5xx, or a transport error.
class Governor {
  constructor(start, max) {
    this.conc = Math.max(1, Math.min(start, max));
    this.max = max;
    this.rps = 8;
    this.tokens = this.rps;
    this.okStreak = 0;
    this.bestRate = 0;
    this.bestConc = this.conc;
    this.windowBytes = 0;
    this.windowStart = Date.now();
    this.pushbacks = 0;
    this.ticker = setInterval(() => this.refill(), 100);
    this.ticker.unref();
  }

  refill() {
    this.tokens = Math.min(this.rps, this.tokens + this.rps / 10);
  }

  async take() {
    while (this.tokens < 1) await sleep(25);
    this.tokens -= 1;
  }

  success(bytes) {
    this.windowBytes += bytes;
    this.okStreak += 1;
    // Additive increase: one more worker per clean run of 12.
    if (this.okStreak >= 12 && this.conc < this.max) {
      this.conc += 1;
      this.rps = Math.min(64, this.rps + 2);
      this.okStreak = 0;
    }
    this.evaluate();
  }

  pushback(hard) {
    this.pushbacks += 1;
    this.okStreak = 0;
    const before = this.conc;
    this.conc = Math.max(1, hard ? Math.floor(this.conc / 2) : this.conc - 1);
    this.rps = Math.max(2, hard ? Math.floor(this.rps / 2) : this.rps - 1);
    // Let the remembered ceiling decay so it can re-probe upward later.
    if (this.conc < before) this.bestRate *= 0.9;
  }

  // Every few seconds compare achieved throughput against the best seen. If
  // more workers are not producing more bytes, settle back to what did work.
  evaluate() {
    const now = Date.now();
    const elapsed = (now - this.windowStart) / 1000;
    if (elapsed < 5) return;
    const rate = this.windowBytes / elapsed;
    if (rate > this.bestRate * 1.05) {
      this.bestRate = rate;
      this.bestConc = this.conc;
    } else if (rate < this.bestRate * 0.75 && this.conc > this.bestConc) {
      this.conc = this.bestConc;
    }
    this.windowBytes = 0;
    this.windowStart = now;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backoff(attempt, retryAfter) {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (!Number.isNaN(secs)) return Math.min(secs * 1000, 120_000);
    const when = Date.parse(retryAfter);
    if (!Number.isNaN(when)) return Math.min(Math.max(0, when - Date.now()), 120_000);
  }
  const base = Math.min(1000 * 2 ** attempt, 60_000);
  return base / 2 + Math.random() * (base / 2); // full jitter on the top half
}

// ------------------------------------------------------------ the transfer

// Resolves to { status: 'done' | 'missing' | 'retry' | 'fatal', ... }
async function fetchOne(url, gov, attempt) {
  const dest = localPathFor(url);
  const part = `${dest}.part`;
  await fsp.mkdir(path.dirname(dest), { recursive: true });

  let offset = 0;
  try {
    offset = (await fsp.stat(part)).size;
  } catch {
    /* no partial file, start at zero */
  }

  const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120_000);

  let res;
  try {
    await gov.take();
    res = await fetch(normaliseUrl(url), { headers, signal: ctl.signal, redirect: 'follow' });
  } catch (e) {
    clearTimeout(timer);
    gov.pushback(false);
    const why = e.name === 'AbortError' ? 'timeout' : e.message;
    return { status: 'retry', reason: `transport: ${why}` };
  }
  clearTimeout(timer);

  const code = res.status;
  const drop = () => res.body?.cancel?.().catch(() => {});

  if (code === 416) {
    // Range past end of file: what we have is already complete.
    try {
      await fsp.rename(part, dest);
    } catch {
      /* nothing to promote */
    }
    drop();
    return { status: 'done', bytes: offset, code };
  }
  if (code === 404 || code === 410) {
    drop();
    return { status: 'missing', code };
  }
  if (code === 401 || code === 403) {
    drop();
    return { status: 'fatal', code };
  }
  if (code === 429 || code >= 500) {
    drop();
    gov.pushback(true);
    await sleep(backoff(attempt, res.headers.get('retry-after')));
    return { status: 'retry', reason: String(code), code };
  }
  if (code !== 200 && code !== 206) {
    drop();
    return { status: 'retry', reason: `unexpected ${code}`, code };
  }

  // A 200 in reply to a Range request means the server ignored it: start over.
  const appending = code === 206 && offset > 0;
  if (!appending) offset = 0;

  let written = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      written += chunk.length;
      cb(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(res.body),
      counter,
      fs.createWriteStream(part, { flags: appending ? 'a' : 'w' })
    );
  } catch (e) {
    gov.pushback(false);
    return { status: 'retry', reason: `stream: ${e.message}` };
  }

  const expected = Number(res.headers.get('content-length') || 0);
  if (expected && written < expected) {
    // Truncated mid-flight. The .part file stays, so the retry resumes.
    return { status: 'retry', reason: `short read ${written}/${expected}` };
  }

  await fsp.rename(part, dest);
  gov.success(written);
  return { status: 'done', bytes: offset + written, code };
}

// ------------------------------------------------------------------ display

function fmt(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i ? 1 : 0)}${units[i]}`;
}

function hms(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--:--:--';
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((x) => String(x).padStart(2, '0'))
    .join(':');
}

// ------------------------------------------------------------------- driver

async function main() {
  const raw = fs
    .readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  let urls = [...new Set(raw)].filter((u) => {
    try {
      const parsed = new URL(u);
      return !HOST_FILTER || parsed.host.includes(String(HOST_FILTER));
    } catch {
      return false;
    }
  });
  if (urls.length > LIMIT) urls = urls.slice(0, LIMIT);

  await fsp.mkdir(STATE, { recursive: true });
  const alreadyDone = readLog(DONE_LOG);
  const priorFailures = readLog(FAIL_LOG);

  // Anything already on disk at non-zero size counts as done even with no log.
  const todo = [];
  let skipped = 0;
  for (const u of urls) {
    if (alreadyDone.has(u)) {
      skipped += 1;
      continue;
    }
    const dest = localPathFor(u);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      skipped += 1;
      continue;
    }
    todo.push(u);
  }

  console.log(`manifest       ${urls.length} urls`);
  console.log(`already have   ${skipped}`);
  console.log(`to fetch       ${todo.length}`);
  if (priorFailures.size) console.log(`prior failures ${priorFailures.size} (retried)`);
  console.log(`output         ${OUT}`);

  if (DRY) {
    console.log('\n--dry-run. sample mapping:');
    for (const u of todo.slice(0, 6)) {
      console.log(`  ${u}\n    -> ${path.relative(OUT, localPathFor(u))}`);
    }
    return;
  }
  if (!todo.length) {
    console.log('\nnothing to do.');
    return;
  }

  const doneLog = fs.createWriteStream(DONE_LOG, { flags: 'a' });
  const failLog = fs.createWriteStream(FAIL_LOG, { flags: 'a' });
  const indexLog = fs.createWriteStream(INDEX_LOG, { flags: 'a' });

  const gov = new Governor(START_CONC, MAX_CONC);
  const stats = { done: 0, missing: 0, failed: 0, bytes: 0, retries: 0, total: todo.length };
  const t0 = Date.now();
  let cursor = 0;
  let stopping = false;

  process.on('SIGINT', () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log('\ninterrupt: finishing in-flight transfers. State is on disk; re-run to resume.');
  });

  const report = setInterval(() => {
    const settled = stats.done + stats.missing + stats.failed;
    const elapsed = Date.now() - t0;
    const pct = ((settled / stats.total) * 100).toFixed(1);
    const left = stats.total - settled;
    const eta = settled > 0 ? hms((left / settled) * elapsed) : '--:--:--';
    process.stdout.write(
      `\r${pct}%  ok ${stats.done}  miss ${stats.missing}  fail ${stats.failed}  ` +
        `retry ${stats.retries}  ${fmt(stats.bytes)} @ ${fmt(stats.bytes / (elapsed / 1000))}/s  ` +
        `conc ${gov.conc}  rps ${gov.rps}  eta ${eta}    `
    );
  }, 1000);
  report.unref();

  async function worker() {
    while (!stopping) {
      const i = cursor;
      cursor += 1;
      if (i >= todo.length) return;
      const url = todo[i];

      let attempt = 0;
      let result = { status: 'retry', reason: 'not attempted' };
      while (attempt < MAX_RETRIES) {
        result = await fetchOne(url, gov, attempt);
        if (result.status !== 'retry') break;
        stats.retries += 1;
        attempt += 1;
        if (attempt < MAX_RETRIES) await sleep(backoff(attempt));
      }

      if (result.status === 'done') {
        stats.done += 1;
        stats.bytes += result.bytes || 0;
        append(doneLog, { url, bytes: result.bytes, code: result.code });
        append(indexLog, { url, path: path.relative(OUT, localPathFor(url)) });
      } else if (result.status === 'missing') {
        stats.missing += 1;
        append(failLog, { url, kind: 'missing', code: result.code });
      } else {
        stats.failed += 1;
        append(failLog, {
          url,
          kind: result.status,
          code: result.code ?? null,
          reason: result.reason ?? null,
        });
      }
    }
  }

  // Pool size tracks gov.conc: top workers up as it rises, let them drain as it falls.
  const running = new Set();
  while ((cursor < todo.length || running.size > 0) && !stopping) {
    while (running.size < gov.conc && cursor < todo.length) {
      const p = worker().finally(() => running.delete(p));
      running.add(p);
    }
    await Promise.race([...running, sleep(250)]);
  }
  await Promise.allSettled([...running]);

  clearInterval(report);
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\n\ndone in ${elapsed.toFixed(0)}s`);
  console.log(`  fetched  ${stats.done}  (${fmt(stats.bytes)})`);
  console.log(`  missing  ${stats.missing}  (404/410, logged)`);
  console.log(`  failed   ${stats.failed}  (see ${path.relative(process.cwd(), FAIL_LOG)})`);
  console.log(`  retries  ${stats.retries}`);
  console.log(`  settled at concurrency ${gov.conc}, ${gov.rps} rps, ${gov.pushbacks} pushbacks`);
  for (const s of [doneLog, failLog, indexLog]) s.end();
}

main().catch((e) => {
  console.error('\nfatal:', e);
  process.exit(1);
});
