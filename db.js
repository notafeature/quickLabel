/* QuickLabel — data layer.
 *
 * Async API over localStorage. Swap the storage adapter to IndexedDB or a
 * real backend later without changing callers. All methods return Promises.
 *
 * Per-user namespacing: every storage key is prefixed with the active user
 * (`ql_u:<user>:<slot>`). Switching users gives a blank slate; the prior
 * user's data is preserved untouched under their namespace. The pre-login
 * legacy keys (`ql_cfg` etc.) are auto-imported into the first user's
 * namespace on initial login and then left alone as a one-way backup.
 *
 * Surface:
 *   db.session.{login, logout, currentUser, isLoggedIn, hasLegacyData, purgeLegacy}
 *   db.genetics.{list, get, create, update, remove, archive}
 *   db.lots.{list, get, create, byPrefix, nextNumber}
 *   db.lineage.{addEdge, parentsOf, childrenOf, tree}
 *   db.config.{get, set}
 *   db.form.{save, restore}
 *
 * Active key set (per user `u`):
 *   ql_active_user           the active user name
 *   ql_u:<u>:cfg             settings blob
 *   ql_u:<u>:lots            counters dict
 *   ql_u:<u>:form            form restoration snapshot
 *   ql_u:<u>:genetics        array of genetic records
 *   ql_u:<u>:lot_records     array of printed lot records
 *   ql_u:<u>:lineage         array of {parent, child, createdAt}
 */
(function () {
  'use strict';

  // Per-user storage. The active user's name namespaces every key.
  // Legacy unnamespaced keys (ql_cfg, ql_lots, ql_form) are migrated into the
  // first user's namespace on initial login, then ignored thereafter.
  const USER_KEY = 'ql_active_user';

  const LEGACY_KEYS = {
    cfg: 'ql_cfg', counters: 'ql_lots', form: 'ql_form',
    genetics: 'ql_genetics', lots: 'ql_lot_records', lineage: 'ql_lineage',
  };

  function currentUser() {
    try { return localStorage.getItem(USER_KEY) || ''; } catch (_) { return ''; }
  }

  // Build the namespaced key set for a given user.
  function keysFor(user) {
    const p = `ql_u:${user}:`;
    return {
      cfg:      p + 'cfg',
      counters: p + 'lots',
      form:     p + 'form',
      genetics: p + 'genetics',
      lots:     p + 'lot_records',
      lineage:  p + 'lineage',
    };
  }

  // Compatibility shim: KEYS is a getter that always reflects the active user.
  const KEYS = new Proxy({}, {
    get(_t, prop) {
      const u = currentUser();
      if (!u) return LEGACY_KEYS[prop];   // pre-login: only used by sync helper
      return keysFor(u)[prop];
    },
  });

  // ─── adapter ────────────────────────────────────────────────────────────────
  const storage = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        const pk = parseKey(key);
        if (pk) queuePush(pk.slot, value);   // mirror to Supabase
        return true;
      } catch (_) {
        return false;
      }
    },
  };

  // ─── Supabase sync (open-mode key/value store, one row per user+slot) ────────
  const SUPA = {
    url:   'https://lunkqtvndjdntuaidhyv.supabase.co',
    key:   'sb_publishable_4qj90ZGOBTpU6bVcEiuulQ_05qyRsHN',
    table: 'ql_store',
  };
  // Slots synced across devices. `form` is device-local UX and never synced.
  const SYNC_SLOTS = ['cfg', 'counters', 'genetics', 'lots', 'lineage'];
  const _canFetch = (typeof fetch === 'function');
  function supaHeaders(extra) {
    const tok = accessToken() || SUPA.key;   // user's JWT when signed in (RLS uses it)
    return Object.assign({ apikey: SUPA.key, Authorization: 'Bearer ' + tok }, extra || {});
  }
  // Map a namespaced localStorage key back to its slot.
  function parseKey(fullKey) {
    const u = currentUser();
    if (!u) return null;
    const K = keysFor(u);
    for (const slot of Object.keys(K)) if (K[slot] === fullKey) return { slot: slot };
    return null;
  }
  // Cloud rows are keyed by the auth user id (auth.uid) — stable + secure (RLS).
  async function pushRemote(slot, value) {
    const uid = cloudId();
    if (!_canFetch || !uid || SYNC_SLOTS.indexOf(slot) < 0) return;
    const body = JSON.stringify([{ user_id: uid, slot: slot, data: value, updated_at: new Date().toISOString() }]);
    const send = () => fetch(SUPA.url + '/rest/v1/' + SUPA.table + '?on_conflict=user_id,slot', {
      method: 'POST',
      headers: supaHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
      body: body,
    });
    try {
      let res = await send();
      if (res.status === 401 && await refreshSession()) await send();   // token expired → refresh + retry
    } catch (_) { /* offline — local cache still holds it */ }
  }
  const _pushTimers = {};
  function queuePush(slot, value) {
    if (SYNC_SLOTS.indexOf(slot) < 0) return;     // skip form + anything off-list
    const k = (cloudId() || '') + '|' + slot;
    clearTimeout(_pushTimers[k]);
    _pushTimers[k] = setTimeout(function () { pushRemote(slot, value); }, 600);
  }
  // Pull this user's cloud rows into the local cache; seed cloud with local-only slots.
  async function pullRemote() {
    const uid = cloudId();
    if (!_canFetch || !uid) return;
    const url = SUPA.url + '/rest/v1/' + SUPA.table + '?user_id=eq.' + encodeURIComponent(uid) + '&select=slot,data';
    let rows = [];
    try {
      let res = await fetch(url, { headers: supaHeaders() });
      if (res.status === 401 && await refreshSession()) res = await fetch(url, { headers: supaHeaders() });
      if (!res.ok) return;
      rows = await res.json();
    } catch (_) { return; }
    const K = keysFor(currentUser());
    const got = {};
    for (const row of rows) {
      if (K[row.slot] && row.data != null) {
        try { localStorage.setItem(K[row.slot], JSON.stringify(row.data)); got[row.slot] = true; } catch (_) {}
      }
    }
    // First-time upload: push any local slots the cloud doesn't have yet.
    for (const slot of SYNC_SLOTS) {
      if (!got[slot]) {
        const local = storage.read(K[slot], null);
        if (local != null) pushRemote(slot, local);
      }
    }
  }
  const sync = {
    pull: function () { return pullRemote(); },
    push: function (slot, value) { return pushRemote(slot, value); },
  };

  // ─── username + password via Supabase Auth (synthetic email, no real email) ──
  // Real auth → each request carries a verified JWT → RLS enforces per-user walls.
  const AUTH_DOMAIN = 'quicklabel.app';
  const TOKEN_KEY = 'ql_sb_token';
  // Usernames may contain anything (e.g. "pSi:L"), which isn't a valid email
  // local-part. Map each username to a deterministic *valid* synthetic email via
  // a hash; the real username rides in user_metadata and drives the RLS wall.
  function hashStr(s) {
    let h = 2166136261 >>> 0; s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  // Simple usernames keep a readable, stable email (e.g. cricket@…); only
  // usernames with characters illegal in an email local-part get hashed.
  function emailFor(u) {
    u = String(u);
    return /^[a-z0-9._-]+$/i.test(u) ? (u.toLowerCase() + '@' + AUTH_DOMAIN) : ('u' + hashStr(u) + '@' + AUTH_DOMAIN);
  }
  function loadToken() { try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch (_) { return null; } }
  function saveToken(t) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch (_) {} }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (_) {} }
  function accessToken() { const t = loadToken(); return t && t.access_token; }
  function cloudId()    { const t = loadToken(); return t && t.uid; }   // auth.uid — the RLS/storage key
  // Decode the `sub` (user id) claim from a JWT, as a fallback for the uid.
  function jwtSub(tok) {
    try {
      let p = String(tok).split('.')[1] || '';
      p = p.replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      return (JSON.parse(atob(p)).sub) || '';
    } catch (_) { return ''; }
  }
  function persistSession(username, sess) {
    localStorage.setItem(USER_KEY, username);
    const prev = loadToken();
    const uid = (sess.user && sess.user.id) || jwtSub(sess.access_token) || (prev && prev.uid) || '';
    saveToken({
      access_token:  sess.access_token,
      refresh_token: sess.refresh_token,
      username:      username,
      uid:           uid,
      expires_at:    Date.now() + ((sess.expires_in || 3600) * 1000),
    });
  }
  async function sbAuthFetch(path, body) {
    const res = await fetch(SUPA.url + '/auth/v1/' + path, {
      method: 'POST',
      headers: { apikey: SUPA.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, data: data };
  }
  function authMsg(d) { return String((d && (d.msg || d.error_description || d.error || d.message)) || ''); }
  async function signUp(username, password) {
    const r = await sbAuthFetch('signup', { email: emailFor(username), password: password, data: { username: username } });
    const sess = r.data && (r.data.access_token ? r.data : (r.data.session || null));
    if (r.ok && sess && sess.access_token) { persistSession(username, sess); return { ok: true, isNew: true }; }
    const m = authMsg(r.data);
    if (r.status === 422 || /already.*(registered|exists)|user.*exists/i.test(m)) return { ok: false, reason: 'taken' };
    if (/password/i.test(m)) return { ok: false, reason: 'weak_pass' };
    if (r.ok) {                                 // created but no session returned → sign in to get one
      const si = await signIn(username, password);
      if (si.ok) return { ok: true, isNew: true };
      return { ok: false, reason: 'no_session' };
    }
    return { ok: false, reason: 'error', msg: m || ('HTTP ' + r.status) };
  }
  async function signIn(username, password) {
    const r = await sbAuthFetch('token?grant_type=password', { email: emailFor(username), password: password });
    if (r.ok && r.data && r.data.access_token) { persistSession(username, r.data); return { ok: true, isNew: false }; }
    return { ok: false, reason: 'bad_creds' };
  }
  async function refreshSession() {
    const t = loadToken();
    if (!t || !t.refresh_token) return false;
    try {
      const r = await sbAuthFetch('token?grant_type=refresh_token', { refresh_token: t.refresh_token });
      if (r.ok && r.data && r.data.access_token) { persistSession(t.username, r.data); return true; }
    } catch (_) {}
    return false;
  }
  // Force-password-change flag: an admin sets a `force_pw` row for the user;
  // the app makes them set a new password on next sign-in, then clears it.
  async function mustChangePassword() {
    const uid = cloudId();
    if (!_canFetch || !uid) return false;
    try {
      const res = await fetch(SUPA.url + '/rest/v1/' + SUPA.table +
        '?user_id=eq.' + encodeURIComponent(uid) + '&slot=eq.force_pw&select=slot', { headers: supaHeaders() });
      if (!res.ok) return false;
      return (await res.json()).length > 0;
    } catch (_) { return false; }
  }
  async function changePassword(newPw) {
    newPw = String(newPw || '');
    if (newPw.length < 6) return { ok: false, reason: 'weak_pass' };
    try {
      const res = await fetch(SUPA.url + '/auth/v1/user', {
        method: 'PUT',
        headers: supaHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password: newPw }),
      });
      if (!res.ok) { let d = {}; try { d = await res.json(); } catch (_) {} return { ok: false, reason: 'error', msg: authMsg(d) }; }
      const uid = cloudId();   // clear the flag (own row)
      try {
        await fetch(SUPA.url + '/rest/v1/' + SUPA.table + '?user_id=eq.' + encodeURIComponent(uid) + '&slot=eq.force_pw',
          { method: 'DELETE', headers: supaHeaders() });
      } catch (_) {}
      return { ok: true };
    } catch (e) { return { ok: false, reason: 'error', msg: (e && e.message) || 'exception' }; }
  }

  const nowISO = () => new Date().toISOString();
  const ok     = v => Promise.resolve(v);
  const newId  = () => 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  // ─── bidirectional sync: cfg.codes ⇄ ql_genetics ──────────────────────────
  // Runs on every load. Unions both lists by `code` so the genetics catalog
  // stays consistent whether records were added via legacy cfg.codes pushes
  // or via db.genetics.create. Idempotent.
  function syncGeneticsAndCfg() {
    const cfg      = storage.read(KEYS.cfg, null);
    const genetics = storage.read(KEYS.genetics, []) || [];
    const cfgCodes = (cfg && Array.isArray(cfg.codes)) ? cfg.codes : [];

    // Compose a stable key: prefer the lab code; fall back to
    // genus|species|cultivar for legacy records that lack a code.
    const keyOf = r => {
      if (!r) return '';
      const code = String(r.code || '').trim().toUpperCase();
      if (code) return 'C:' + code;
      const g = String(r.genus    || '').trim().toLowerCase();
      const s = String(r.species  || '').trim().toLowerCase();
      const c = String(r.cultivar || '').trim().toLowerCase();
      if (g || s || c) return `N:${g}|${s}|${c}`;
      return '';
    };
    const inGen = new Set(genetics.map(keyOf).filter(Boolean));
    const inCfg = new Set(cfgCodes.map(keyOf).filter(Boolean));

    let geneticsChanged = false;
    // Backfill _id for any existing genetics rows missing one.
    for (const r of genetics) {
      if (!r._id) { r._id = newId(); geneticsChanged = true; }
    }
    for (const r of cfgCodes) {
      const k = keyOf(r);
      if (!k || inGen.has(k)) continue;
      genetics.push({ ...r, _id: newId(), _fromCfg: true, createdAt: nowISO(), updatedAt: nowISO() });
      inGen.add(k);
      geneticsChanged = true;
    }
    if (geneticsChanged) storage.write(KEYS.genetics, genetics);

    let cfgChanged = false;
    for (const r of genetics) {
      const k = keyOf(r);
      if (!k || inCfg.has(k)) continue;
      cfgCodes.push({
        code:     r.code,
        cat:      r.cat,
        genus:    r.genus,
        species:  r.species,
        cultivar: r.cultivar,
        ingestData: r.ingestData,
      });
      inCfg.add(k);
      cfgChanged = true;
    }
    if (cfgChanged && cfg) {
      cfg.codes = cfgCodes;
      storage.write(KEYS.cfg, cfg);
    }
  }

  // ─── session ───────────────────────────────────────────────────────────────
  // One-time per-user import of the legacy (unnamespaced) localStorage keys.
  // On first login as user `u`, if u has no namespaced data yet but the
  // legacy keys exist, copy them into u's namespace. Legacy keys are then
  // left alone (read-only backup) — `db.session.purgeLegacy()` clears them.
  function importLegacyForUser(user) {
    const K = keysFor(user);
    const hasOwn = localStorage.getItem(K.cfg) || localStorage.getItem(K.genetics);
    if (hasOwn) return { imported: false, reason: 'user_has_data' };

    let imported = 0;
    for (const slot of Object.keys(LEGACY_KEYS)) {
      const legacy = localStorage.getItem(LEGACY_KEYS[slot]);
      if (legacy != null) {
        localStorage.setItem(K[slot], legacy);
        imported++;
      }
    }
    return { imported: imported > 0, copied: imported };
  }

  const session = {
    currentUser,
    isLoggedIn()  { return !!currentUser() && !!accessToken(); },
    refresh() { return refreshSession(); },
    mustChangePassword() { return mustChangePassword(); },
    changePassword(pw) { return changePassword(pw); },
    // Username + password via real auth (synthetic email). mode: 'login'|'signup'.
    async login(name, password, mode) {
      const u = String(name || '').trim();   // keep exact case (e.g. "pSi:L")
      if (!u) return { ok: false, reason: 'empty' };
      if (!String(password || '')) return { ok: false, reason: 'empty_pass' };
      const res = (mode === 'signup') ? await signUp(u, String(password)) : await signIn(u, String(password));
      if (!res.ok) return res;                 // { reason: taken|bad_creds|weak_pass|... }
      const imp = importLegacyForUser(u);       // session already persisted by signUp/signIn
      syncGeneticsAndCfg();
      return { ok: true, user: u, isNew: res.isNew, legacy: imp };
    },
    logout() {
      clearToken();
      try { localStorage.removeItem(USER_KEY); } catch (_) {}
      return ok({ ok: true });
    },
    purgeLegacy() {
      for (const k of Object.values(LEGACY_KEYS)) {
        try { localStorage.removeItem(k); } catch (_) {}
      }
      return ok({ ok: true });
    },
    // Heuristic: are the legacy unnamespaced keys still in localStorage?
    hasLegacyData() {
      return !!(localStorage.getItem(LEGACY_KEYS.cfg) || localStorage.getItem(LEGACY_KEYS.genetics));
    },
  };

  // ─── genetics ──────────────────────────────────────────────────────────────
  const genetics = {
    list({ q } = {}) {
      const all = storage.read(KEYS.genetics, []);
      if (!q) return ok(all.slice());
      const needle = String(q).toLowerCase();
      return ok(all.filter(r => {
        return ['code', 'cultivar', 'genus', 'species'].some(f =>
          String(r[f] || '').toLowerCase().includes(needle)
        );
      }));
    },
    get(code) {
      const all = storage.read(KEYS.genetics, []);
      const up  = String(code || '').toUpperCase();
      return ok(all.find(r => String(r.code || '').toUpperCase() === up) || null);
    },
    create(record) {
      const all = storage.read(KEYS.genetics, []);
      const up  = String(record.code || '').toUpperCase();
      if (up && all.some(r => String(r.code || '').toUpperCase() === up)) {
        return ok({ ok: false, reason: 'duplicate', code: record.code });
      }
      const row = { ...record, _id: record._id || newId(), createdAt: nowISO(), updatedAt: nowISO() };
      all.push(row);
      storage.write(KEYS.genetics, all);
      return ok({ ok: true, record: row });
    },
    // Updates by _id (preferred) — supports editing legacy records with empty codes.
    update(id, patch) {
      const all = storage.read(KEYS.genetics, []);
      const i   = all.findIndex(r => r._id === id);
      if (i < 0) return ok({ ok: false, reason: 'not_found' });
      all[i] = { ...all[i], ...patch, updatedAt: nowISO() };
      storage.write(KEYS.genetics, all);
      return ok({ ok: true, record: all[i] });
    },
    remove(id) {
      const all = storage.read(KEYS.genetics, []);
      const i   = all.findIndex(r => r._id === id);
      if (i < 0) return ok({ ok: false, reason: 'not_found' });
      const removed = all.splice(i, 1)[0];
      storage.write(KEYS.genetics, all);
      return ok({ ok: true, record: removed });
    },
    archive(id) {
      return genetics.update(id, { archived: true });
    },
  };

  // ─── lots ──────────────────────────────────────────────────────────────────
  // Counters live in their own key (ql_lots), the existing source. The records
  // store (ql_lot_records) is net-new and holds one row per print run.
  const lots = {
    list({ code, prefix } = {}) {
      const all = storage.read(KEYS.lots, []);
      let rows = all;
      if (code)   rows = rows.filter(r => String(r.geneticCode || '').toUpperCase() === String(code).toUpperCase());
      if (prefix) rows = rows.filter(r => String(r.lotId || '').startsWith(prefix + '-'));
      return ok(rows);
    },
    get(lotId) {
      const all = storage.read(KEYS.lots, []);
      return ok(all.find(r => r.lotId === lotId) || null);
    },
    byPrefix(prefix) {
      return lots.list({ prefix });
    },
    nextNumber({ prefix, code, date }) {
      if (!prefix || !code || !date) return ok(1);
      const counters = storage.read(KEYS.counters, {});
      const key = `${prefix}_${code}_${date}`;
      return ok((counters[key] || 0) + 1);
    },
    create(record) {
      const all = storage.read(KEYS.lots, []);
      const row = { ...record, createdAt: nowISO(), status: record.status || 'active' };
      all.push(row);
      storage.write(KEYS.lots, all);
      return ok({ ok: true, record: row });
    },
    // Counter passthroughs — kept thin so the existing inline code can drive
    // the counter dict while we centralize storage here.
    _loadCounters()  { return ok(storage.read(KEYS.counters, {})); },
    _saveCounters(c) { storage.write(KEYS.counters, c); return ok(true); },
  };

  // ─── lineage ───────────────────────────────────────────────────────────────
  const lineage = {
    addEdge(parent, child) {
      if (!parent || !child) return ok({ ok: false, reason: 'missing' });
      const all = storage.read(KEYS.lineage, []);
      if (all.some(e => e.parent === parent && e.child === child)) {
        return ok({ ok: true, deduped: true });
      }
      const edge = { parent, child, createdAt: nowISO() };
      all.push(edge);
      storage.write(KEYS.lineage, all);
      return ok({ ok: true, edge });
    },
    parentsOf(child) {
      const all = storage.read(KEYS.lineage, []);
      return ok(all.filter(e => e.child === child).map(e => e.parent));
    },
    childrenOf(parent) {
      const all = storage.read(KEYS.lineage, []);
      return ok(all.filter(e => e.parent === parent).map(e => e.child));
    },
    tree(root, { direction = 'up', maxDepth = 16 } = {}) {
      const all = storage.read(KEYS.lineage, []);
      const seen = new Set();
      const walk = (node, depth) => {
        if (seen.has(node) || depth > maxDepth) return { node, children: [] };
        seen.add(node);
        const next = direction === 'up'
          ? all.filter(e => e.child === node).map(e => e.parent)
          : all.filter(e => e.parent === node).map(e => e.child);
        return { node, children: next.map(n => walk(n, depth + 1)) };
      };
      return ok(walk(root, 0));
    },
  };

  // ─── config ────────────────────────────────────────────────────────────────
  const config = {
    get()        { return ok(storage.read(KEYS.cfg, null)); },
    set(cfg)     { storage.write(KEYS.cfg, cfg); return ok(true); },
  };

  // ─── form ──────────────────────────────────────────────────────────────────
  const form = {
    save(snapshot)  { storage.write(KEYS.form, snapshot); return ok(true); },
    restore()       { return ok(storage.read(KEYS.form, null)); },
  };

  window.db = { genetics, lots, lineage, config, form, session, sync, _keys: KEYS };
})();
