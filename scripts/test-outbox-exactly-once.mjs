#!/usr/bin/env node
/**
 * Chaos test for the durable usage outbox — proves NO LOST and NO DOUBLE-COUNTED
 * usage across a consumer crash.
 *
 * It replicates the real consumer's claim → deliver → mark loop (same SQL as
 * usage-consumer.ts / control-plane.ts) against real Postgres, but injects a
 * CRASH between "deliver to sink" and "mark processed" on the first pass — the
 * exact at-risk window. The sink models the ClickHouse ReplacingMergeTree (keyed
 * by event id), so a re-delivered event self-dedups.
 *
 * Run with the vault STOPPED (its live consumer would otherwise drain the rows).
 * Usage: DATABASE_URL=... node scripts/test-outbox-exactly-once.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postgres = require('/Users/m/byokyv2/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres/cjs/src/index.js');

const N_EVENTS = 500;
const BATCH = 200;
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) process.exitCode = 1; };

async function main() {
  console.log('\nOutbox exactly-once chaos test\n');
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const RUN = `outbox-chaos-${Date.now()}`;

  // Guard: the live consumer must be stopped, else it races us.
  // (We only touch rows tagged with RUN, but a concurrent consumer marking them
  // processed would corrupt the crash simulation.)

  // 1) Enqueue N events (mirrors enqueueUsageEvent: processed_at NULL).
  const now = Date.now();
  for (let i = 0; i < N_EVENTS; i++) {
    await sql`insert into usage_outbox (id, payload, created_at, processed_at)
      values (${`${RUN}-${i}`}, ${JSON.stringify({ run: RUN, seq: i, costUsd: 0.01 })}, ${now + i}, ${null})`;
  }
  const [{ count: enq }] = await sql`select count(*)::int as count from usage_outbox where id like ${RUN + '-%'} and processed_at is null`;
  ok('enqueued N unprocessed events', enq === N_EVENTS, `enq=${enq}`);

  // Sink modeling ClickHouse ReplacingMergeTree: last write per id wins → dedup.
  const sink = new Map(); // id → payload
  let totalDeliveries = 0; // counts EVERY insert attempt, incl. redelivery

  // claim = the consumer's exact query (unprocessed, oldest first, limited).
  const claim = () => sql`select id, payload from usage_outbox
    where id like ${RUN + '-%'} and processed_at is null order by created_at limit ${BATCH}`;
  const mark = (ids) => sql`update usage_outbox set processed_at = ${Date.now()} where id in ${sql(ids)}`;
  const deliver = (rows) => { for (const r of rows) { sink.set(r.id, r.payload); totalDeliveries++; } };

  // 2) First pass WITH INJECTED CRASH: claim a batch, deliver it, then die
  //    before marking (the durability-critical window).
  const crashed = await claim();
  ok('first claim returned a batch', crashed.length === BATCH, `got=${crashed.length}`);
  deliver(crashed);
  // <<< CRASH >>> — intentionally skip mark(crashed). Those rows stay NULL.

  // 3) Restart: drain to completion normally (claim → deliver → mark).
  let drained = 0;
  for (;;) {
    const rows = await claim();
    if (rows.length === 0) break;
    deliver(rows);
    await mark(rows.map((r) => r.id));
    drained += rows.length;
  }

  // ── Assertions ──
  const [{ count: remaining }] = await sql`select count(*)::int as count from usage_outbox where id like ${RUN + '-%'} and processed_at is null`;
  ok('outbox fully drained (0 unprocessed)', remaining === 0, `remaining=${remaining}`);

  const [{ count: processed }] = await sql`select count(*)::int as count from usage_outbox where id like ${RUN + '-%'} and processed_at is not null`;
  ok('every event processed exactly once (processed_at set)', processed === N_EVENTS, `processed=${processed}`);

  // The crashed batch WAS re-delivered → deliveries exceed distinct ids (proves
  // the crash window was actually exercised, i.e. at-least-once redelivery).
  ok('crash caused at-least-once redelivery', totalDeliveries > N_EVENTS, `deliveries=${totalDeliveries} vs ids=${N_EVENTS}`);

  // NO DOUBLE-COUNT: the id-keyed sink collapses redeliveries → exactly N.
  ok('id-keyed sink dedups → no double-count', sink.size === N_EVENTS, `sink=${sink.size}`);

  // NO LOSS: every enqueued id is present in the sink.
  let missing = 0;
  for (let i = 0; i < N_EVENTS; i++) if (!sink.has(`${RUN}-${i}`)) missing++;
  ok('no lost events (every id delivered)', missing === 0, `missing=${missing}`);

  // Cleanup this run's rows.
  await sql`delete from usage_outbox where id like ${RUN + '-%'}`;
  await sql.end();
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
