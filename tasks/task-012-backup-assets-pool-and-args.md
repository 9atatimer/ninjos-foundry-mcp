---
id: task-012
kind: bug
title: backup-assets.mjs concurrency backoff is inert and bad flags hang the run
created: 2026-09-12
---

## Symptom

**The worker pool never shrinks.** `worker()` loops until the queue is drained,
so the supervisor's `while (running.size < gov.conc)` is the only lever and it
is monotone. Lowering `gov.conc` retires nobody. Multiplicative decrease -- half
of the AIMD -- therefore does nothing, and only the rps token bucket throttles.

Instrumented during a forced 503 episode: pool held at 8 while `conc` read 1,
for 90 consecutive seconds. The reported `conc` is not the actual parallelism,
so the final summary line is also wrong.

**The governor latches.** `gov.success(written)` credits a whole file at
completion, so `windowBytes / elapsed` measures a completion burst, not a rate.
Several large transfers landing in one 5s window inflate it several-fold, that
becomes `bestRate`, and since it only decays on pushback, `rate > bestRate*1.05`
never holds again and every later `evaluate()` snaps `conc` back. `evaluate()`
is also only reachable from `success()`, so a window with no successes never
closes.

**Unvalidated numeric flags.** `--max abc` yields `conc = NaN`, so
`running.size < NaN` is false, zero workers spawn and the supervisor spins
forever printing `conc NaN`. `--retries 0` makes `while (attempt < 0)` never
execute, logging every URL as `not attempted` with no request sent. `--limit` as
the final argument returns `true`, and `Number(true)` is 1 -- silently
downloading exactly one file.

**Body transfers are unbounded.** The 120s abort timer is cleared when _headers_
arrive, before the pipeline, so a slow-drip body holds a worker indefinitely.

**Double backoff.** `fetchOne` sleeps for 429/5xx and the worker then sleeps
again with an incremented attempt, roughly 3x the intended delay; a
`Retry-After: 120` becomes 120s plus up to 32s.

## Impact

Ranges from wasted time to a silently hung job. The NaN case is the worst: a
typo produces no error and no progress, forever.

## Evidence

All confirmed by an adversarial review on 2026-09-12; the pool divergence and
the argument cases were reproduced by running the tool.

`scripts/forge-asset-sync.mjs` shows the corrected shapes: workers hold a slot
index and retire when `slot >= gov.conc`, and `posInt()` rejects anything that
is not a positive integer.
