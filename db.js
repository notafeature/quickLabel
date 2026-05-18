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
        return true;
      } catch (_) {
        return false;
      }
    },
  };

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
    isLoggedIn()  { return !!currentUser(); },
    login(name) {
      const u = String(name || '').trim();
      if (!u) return ok({ ok: false, reason: 'empty' });
      localStorage.setItem(USER_KEY, u);
      const imp = importLegacyForUser(u);
      syncGeneticsAndCfg();
      return ok({ ok: true, user: u, legacy: imp });
    },
    logout() {
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

  window.db = { genetics, lots, lineage, config, form, session, _keys: KEYS };
})();
