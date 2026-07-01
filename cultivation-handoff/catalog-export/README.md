# Catalog export — BLOCKED, not fabricated

**Status: no data was exported.** This session's outbound network policy
rejects connections to Supabase:

```
$ curl -sSI https://lunkqtvndjdntuaidhyv.supabase.co/rest/v1/ql_store
curl: (56) CONNECT tunnel failed, response 403
```

Confirmed via the environment's proxy status endpoint — the CONNECT to
`lunkqtvndjdntuaidhyv.supabase.co:443` was rejected by the egress gateway
(policy denial), not a Supabase-side auth failure. No credentials were even
attempted; the network path itself is closed from this sandbox.

Per the handoff instructions: **do not fabricate data.** Nothing in this
folder is invented or sampled — `export-ql-store.mjs` is a real, ready-to-run
script and this README documents exactly what's needed to run it somewhere
that *can* reach Supabase.

## What's here

| File | Contents |
|---|---|
| `export-ql-store.mjs` | Ready-to-run Node 18+ script. Pulls every row from the `ql_store` table and writes one JSON file per (user, slot) — `genetics.json`, `lots.json`, `lineage.json`, `cfg.json`, `counters.json` — plus `genetics.csv` / `lots.csv` flattened, under `out/<user_id>/`. See the header comment in the script for full details. |
| `README.md` | This file. |

There is no `out/` directory yet — it's created the first time the script
runs successfully.

## How to actually get the data

Run the script from a machine with normal internet access (your laptop, a
CI runner, anywhere that isn't this sandbox). It needs **one of two**
credential sets:

### Option A — Supabase service_role key (recommended, gets every user in one shot)

1. Log into the Supabase dashboard for project `lunkqtvndjdntuaidhyv`
   (the project referenced in `db.js`).
2. Project Settings → API → copy the **`service_role`** secret key (NOT the
   publishable/anon key already in `db.js` — that one is RLS-gated and can't
   enumerate other users' rows).
3. Run:
   ```bash
   SUPABASE_SERVICE_ROLE_KEY=eyJ...  node export-ql-store.mjs
   ```
4. This reads every row in `ql_store` regardless of owner (service_role
   bypasses RLS) and writes one directory per `user_id` under `out/`.

**Who can do this:** whoever owns/administers the Supabase project. If
that's you (the person running the Cultivation Suite merge), this is a
five-minute task. If you're not a project admin, use Option B for the one
real production user instead.

### Option B — a live user's own access token (gets just that one user)

1. Open `quicklabel.html` in a browser, log in as the real production user.
2. Open devtools console and run:
   ```js
   JSON.parse(localStorage.getItem('ql_sb_token'))
   ```
   This prints `{ access_token, refresh_token, username, uid, expires_at }`.
3. Run:
   ```bash
   SUPABASE_USER_ACCESS_TOKEN=<access_token> SUPABASE_USER_ID=<uid> node export-ql-store.mjs
   ```
   RLS (`auth.uid()`) restricts this token to that one user's row per slot,
   which is exactly what you want for a single-user export.

Access tokens are short-lived (`expires_at`, typically ~1 hour from issue);
if it's expired, log in again to mint a fresh one.

## Which user is "the real one"

`FUNCTIONALITY.md` and the app itself are effectively single-tenant in
practice — there is one working grower using the tool day to day. The repo's
`.gitignore` has an ignore rule for `cricket-genetics-*.csv` (added in commit
`015f712`, "ignore one-off genetics import CSVs — per-user data deliverables
generated during onboarding"), which is the strongest available signal in
the repo about a real username, but it was **never confirmed against a live
`ql_store` row** in this session (the network block prevented that lookup).
Don't assume it — verify by inspecting `summary.json` after running the
script; it lists every `user_id` actually present with its record counts, so
the real (non-empty) user will be obvious.

## After the export

Once you have `out/<user_id>/*.json` and `*.csv`, replace this README's
"Status" line and move the files into this `catalog-export/` folder (or point
Cultivation Suite's importer straight at `out/`). Map fields using
`../HANDOFF.md` §C (exact data-model shapes) — genetics rows become Genetics
Catalog records, lot records become Lot rows keyed by `lotId`, lineage edges
become parent/child rows, `cfg` registries seed the equivalent lookup tables.
