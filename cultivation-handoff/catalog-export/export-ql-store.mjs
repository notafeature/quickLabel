#!/usr/bin/env node
/**
 * Export the real QuickLabel catalog data out of Supabase's `ql_store` table
 * so it can be imported into Cultivation Suite's Postgres/Prisma schema.
 *
 * WHY THIS SCRIPT EXISTS (read this first)
 * -----------------------------------------
 * `ql_store` is a per-user, per-slot key/value table (see ../source/db.js):
 *   { user_id: uuid, slot: text, data: jsonb, updated_at: timestamptz }
 * Slots per user: cfg, counters, genetics, lots, lineage. (`form` is
 * device-local and intentionally never synced — skip it.)
 *
 * Row-Level Security is keyed on `auth.uid()`, so the publishable/anon key
 * baked into db.js (`sb_publishable_4qj90ZGOBTpU6bVcEiuulQ_05qyRsHN`) can only
 * read/write the ROW OWNED BY WHOEVER'S JWT YOU PASS. It cannot enumerate or
 * read other users' rows. To do a real one-shot export of every user's data,
 * you need ONE of:
 *
 *   (a) The Supabase project's SERVICE ROLE key (Project Settings → API →
 *       service_role). This bypasses RLS entirely and can read every row in
 *       one query. This is the easiest path if you're an admin on the
 *       Supabase project `lunkqtvndjdntuaidhyv`. Set SUPABASE_SERVICE_ROLE_KEY.
 *
 *   (b) A live user's access token (log in as that user in the QuickLabel
 *       app, then in devtools: JSON.parse(localStorage.ql_sb_token).access_token)
 *       plus their `uid` (same object, `.uid`). This only lets you export
 *       THAT ONE USER's rows, via RLS. Set SUPABASE_USER_ACCESS_TOKEN and
 *       SUPABASE_USER_ID.
 *
 * This sandbox's outbound network policy blocks lunkqtvndjdntuaidhyv.supabase.co
 * (confirmed: CONNECT to that host was rejected with 403 by the environment's
 * egress proxy), so this script could not be run from here and no data was
 * fetched. Run it from a machine with unrestricted network access, e.g. your
 * own laptop or a CI runner with real internet access.
 *
 * USAGE
 * -----
 *   # Admin path (all users, one shot):
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...  node export-ql-store.mjs
 *
 *   # Single-user path:
 *   SUPABASE_USER_ACCESS_TOKEN=eyJ... SUPABASE_USER_ID=<uuid> node export-ql-store.mjs
 *
 * Either mode writes, per user_id, one JSON file per slot into ./out/<user_id>/
 * (genetics.json, lots.json, lineage.json, cfg.json, counters.json) plus
 * genetics.csv / lots.csv flattened for spreadsheet use, and updates README.md
 * with record counts. Requires Node 18+ (global fetch).
 */

import fs from 'node:fs';
import path from 'node:path';

const SUPA_URL = 'https://lunkqtvndjdntuaidhyv.supabase.co';
const ANON_KEY = 'sb_publishable_4qj90ZGOBTpU6bVcEiuulQ_05qyRsHN'; // same one baked into db.js — public by design, RLS-gated
const TABLE = 'ql_store';
const OUT_DIR = path.join(process.cwd(), 'out');

// slot -> local file name used by this exporter's output (mirrors db.js's KEYS)
const SLOT_FILES = {
  genetics: 'genetics',
  lots: 'lots',          // lot RECORDS (db.lots) — not to be confused with the `counters` slot
  lineage: 'lineage',
  cfg: 'cfg',
  counters: 'counters',
};

function csvEscape(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => csvEscape(r[c])).join(','));
  return lines.join('\n');
}

async function fetchAllRows(headers) {
  const url = `${SUPA_URL}/rest/v1/${TABLE}?select=user_id,slot,data,updated_at`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Supabase REST returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userToken = process.env.SUPABASE_USER_ACCESS_TOKEN;
  const userId = process.env.SUPABASE_USER_ID;

  let headers;
  let scopeNote;
  if (serviceKey) {
    headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    scopeNote = 'service_role (all users)';
  } else if (userToken && userId) {
    headers = { apikey: ANON_KEY, Authorization: `Bearer ${userToken}` };
    scopeNote = `single user via RLS (uid=${userId})`;
  } else {
    console.error(
      'Missing credentials. Set SUPABASE_SERVICE_ROLE_KEY, or both ' +
      'SUPABASE_USER_ACCESS_TOKEN and SUPABASE_USER_ID. See the header comment ' +
      'in this file for how to obtain either.'
    );
    process.exit(1);
  }

  console.log(`Fetching ${TABLE} (${scopeNote})...`);
  let rows = await fetchAllRows(headers);
  if (userId) rows = rows.filter(r => r.user_id === userId);
  console.log(`Fetched ${rows.length} rows.`);

  const byUser = {};
  for (const row of rows) {
    (byUser[row.user_id] ||= {})[row.slot] = row.data;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const summary = [];

  for (const [uid, slots] of Object.entries(byUser)) {
    const dir = path.join(OUT_DIR, uid);
    fs.mkdirSync(dir, { recursive: true });

    for (const [slot, file] of Object.entries(SLOT_FILES)) {
      const data = slots[slot];
      if (data === undefined) continue;
      fs.writeFileSync(path.join(dir, `${file}.json`), JSON.stringify(data, null, 2));
    }

    const genetics = Array.isArray(slots.genetics) ? slots.genetics : [];
    const lots = Array.isArray(slots.lots) ? slots.lots : [];
    const lineage = Array.isArray(slots.lineage) ? slots.lineage : [];

    if (genetics.length) fs.writeFileSync(path.join(dir, 'genetics.csv'), toCsv(genetics));
    if (lots.length) fs.writeFileSync(path.join(dir, 'lots.csv'), toCsv(lots));

    summary.push({
      user_id: uid,
      genetics: genetics.length,
      lots: lots.length,
      lineage: lineage.length,
      hasCfg: slots.cfg != null,
      hasCounters: slots.counters != null,
    });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('Done. Per-user record counts:');
  console.table(summary);
  console.log(`Output written to ${OUT_DIR}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
