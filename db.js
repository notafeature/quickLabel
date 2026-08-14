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
    if (t && t.access_token === 'offline') return true;   // emergency offline session
    if (!t || !t.refresh_token) return false;
    try {
      const r = await sbAuthFetch('token?grant_type=refresh_token', { refresh_token: t.refresh_token });
      if (r.ok && r.data && r.data.access_token) { persistSession(t.username, r.data); return true; }
      // Supabase answered but couldn't refresh. Only a definitive rejection
      // (4xx: revoked/invalid refresh token) invalidates the session; a 5xx
      // means Supabase itself is broken — keep the cached session so the app
      // stays usable offline and sync retries later.
      return r.status >= 500;
    } catch (_) {
      return true;   // network unreachable → proceed on cached token
    }
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

  // Self-serve "forgot password": calls a server-side function (claim_password)
  // that only resets the password when an admin has enabled it (force_pw flag).
  async function claimPassword(username, newPw) {
    newPw = String(newPw || '');
    if (newPw.length < 6) return { ok: false, reason: 'weak_pass' };
    try {
      const res = await fetch(SUPA.url + '/rest/v1/rpc/claim_password', {
        method: 'POST',
        headers: { apikey: SUPA.key, Authorization: 'Bearer ' + SUPA.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_username: String(username || '').trim(), p_newpw: newPw }),
      });
      let d = null; try { d = await res.json(); } catch (_) {}
      if (res.ok && d && d.ok) return { ok: true };
      return { ok: false, reason: (d && d.reason) || 'error' };
    } catch (e) { return { ok: false, reason: 'error', msg: (e && e.message) || 'exception' }; }
  }

  const nowISO = () => new Date().toISOString();
  const ok     = v => Promise.resolve(v);
  const newId  = () => 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  // ─── seed catalog (from the genetics tracking sheet, 2026-08-14) ──────────
  // When a user's genetics slot is empty (fresh device/origin, e.g. running
  // the app offline from a local file), it is seeded with the full tracking
  // sheet so the catalog is never blank. Existing data always wins — the
  // seed only ever fills a truly empty slot.
  /*__SEED_GENETICS__*/
  const SEED_GENETICS = [{"code":"SL001","genus":"Psilocybe","species":"cubensis","cultivar":"Shakti","origin":"","vendor":"ITW","family":"malabar","notes":"Albino Malabar","ingestData":{"vendor":"ITW","originator":"","family":"malabar","notes":"Albino Malabar"}},
  {"code":"SL002","genus":"Psilocybe","species":"cubensis","cultivar":"AMVP","origin":"","vendor":"ITW","family":"TAM","notes":"","ingestData":{"vendor":"ITW","originator":"","family":"TAM","notes":""}},
  {"code":"SL003","genus":"Psilocybe","species":"ochraceocentrata","cultivar":"Natal Super Strain","origin":"Landrace","vendor":"ITW","family":"Natal Landrace","notes":"NSS from ITW","ingestData":{"vendor":"ITW","originator":"Landrace","family":"Natal Landrace","notes":"NSS from ITW"}},
  {"code":"SL004","genus":"Psilocybe","species":"cubensis","cultivar":"Lizard King (spore)","origin":"Landrace","vendor":"ITW","family":"Landrace (GA?)","notes":"Syringe from ITW","ingestData":{"vendor":"ITW","originator":"Landrace","family":"Landrace (GA?)","notes":"Syringe from ITW"}},
  {"code":"SL005","genus":"Psilocybe","species":"cubensis","cultivar":"Jedi Mind Fuck","origin":"Landrace","vendor":"WM","family":"Landrace (South US)","notes":"","ingestData":{"vendor":"WM","originator":"Landrace","family":"Landrace (South US)","notes":""}},
  {"code":"SL006","genus":"Psilocybe","species":"cubensis","cultivar":"Paja Crown","origin":"Paja Poke x some TAT","vendor":"WM","family":"TAT, Brazilian (?) Landrace","notes":"TAT cross with Paja Poke","ingestData":{"vendor":"WM","originator":"Paja Poke x some TAT","family":"TAT, Brazilian (?) Landrace","notes":"TAT cross with Paja Poke"}},
  {"code":"SL007","genus":"Psilocybe","species":"cubensis","cultivar":"Toque F9","origin":"B+ x PE","vendor":"WM","family":"Tidal Wave","notes":"","ingestData":{"vendor":"WM","originator":"B+ x PE","family":"Tidal Wave","notes":""}},
  {"code":"SL008","genus":"Psilocybe","species":"cubensis","cultivar":"Hillbilly","origin":"","vendor":"WM","family":"Landrace (US)","notes":"","ingestData":{"vendor":"WM","originator":"","family":"Landrace (US)","notes":""}},
  {"code":"SL009","genus":"Psilocybe","species":"cubensis","cultivar":"Toque F9","origin":"B+ x PE","vendor":"WM","family":"Tidal Wave","notes":"Sold as SNAPE","ingestData":{"vendor":"WM","originator":"B+ x PE","family":"Tidal Wave","notes":"Sold as SNAPE"}},
  {"code":"SL010","genus":"Psilocybe","species":"cubensis","cultivar":"Toque F9","origin":"B+ x PE","vendor":"WM","family":"Tidal Wave","notes":"Sold as SNAPE","ingestData":{"vendor":"WM","originator":"B+ x PE","family":"Tidal Wave","notes":"Sold as SNAPE"}},
  {"code":"SL011","genus":"Psilocybe","species":"cubensis","cultivar":"Toque F9","origin":"B+ x PE","vendor":"WM","family":"Tidal Wave","notes":"SOLD as Mystery","ingestData":{"vendor":"WM","originator":"B+ x PE","family":"Tidal Wave","notes":"SOLD as Mystery"}},
  {"code":"SL012","genus":"Psilocybe","species":"cubensis","cultivar":"Accadian Coast","origin":"Landrace","vendor":"ITW","family":"Landrace (LA, US)","notes":"","ingestData":{"vendor":"ITW","originator":"Landrace","family":"Landrace (LA, US)","notes":""}},
  {"code":"SL013","genus":"Psilocybe","species":"cubensis","cultivar":"Jack Frost","origin":"","vendor":"ITW","family":"APE, TAT","notes":"","ingestData":{"vendor":"ITW","originator":"","family":"APE, TAT","notes":""}},
  {"code":"SL014","genus":"Psilocybe","species":"cubensis","cultivar":"Lizard King (spore)","origin":"Landrace","vendor":"ITW","family":"Landrace (GA?)","notes":"ITW","ingestData":{"vendor":"ITW","originator":"Landrace","family":"Landrace (GA?)","notes":"ITW"}},
  {"code":"SL015","genus":"Psilocybe","species":"cubensis","cultivar":"SyZyGy","origin":"","vendor":"ITW","family":"Unknown","notes":"Mckenna brothers house strain","ingestData":{"vendor":"ITW","originator":"","family":"Unknown","notes":"Mckenna brothers house strain"}},
  {"code":"SL016","genus":"Psilocybe","species":"cubensis","cultivar":"APE Pipes","origin":"","vendor":"SpH","family":"APE","notes":"APE iso from Capt Tripps","ingestData":{"vendor":"SpH","originator":"","family":"APE","notes":"APE iso from Capt Tripps"}},
  {"code":"SL017","genus":"Psilocybe","species":"cubensis","cultivar":"Casper","origin":"Lady Hyphae","vendor":"SpH","family":"Melmac, Shakti, APE","notes":"LC from Lady Hyphae via sporophore hunter","ingestData":{"vendor":"SpH","originator":"Lady Hyphae","family":"Melmac, Shakti, APE","notes":"LC from Lady Hyphae via sporophore hunter"}},
  {"code":"SL018","genus":"Psilocybe","species":"cubensis","cultivar":"Golden Halo","origin":"","vendor":"SpH","family":"Possibly Jamaica?","notes":"","ingestData":{"vendor":"SpH","originator":"","family":"Possibly Jamaica?","notes":""}},
  {"code":"SL019","genus":"Psilocybe","species":"cubensis","cultivar":"Operation Stargate","origin":"Avery Albino x Pluto (shakti iso)","vendor":"SpH","family":"AA, Shakti","notes":"from Capt. Tripps via Sporophore Hunter","ingestData":{"vendor":"SpH","originator":"Avery Albino x Pluto (shakti iso)","family":"AA, Shakti","notes":"from Capt. Tripps via Sporophore Hunter"}},
  {"code":"SL020","genus":"Psilocybe","species":"cubensis","cultivar":"Toquelahoma","origin":"B+ x PE / OK Wild","vendor":"SpH","family":"Tidal Wave","notes":"","ingestData":{"vendor":"SpH","originator":"B+ x PE / OK Wild","family":"Tidal Wave","notes":""}},
  {"code":"SL021","genus":"Psilocybe","species":"cubensis","cultivar":"Santisima F2","origin":"M.Sabina flowers (yoshi) / OK Wild","vendor":"SpH","family":"Huatula, OK","notes":"Cross by Sporophore Hunter (Maria Sabina Flowers x OK wild) MSF came from Wombat's Maria Sabina which is a Huatula isolation","ingestData":{"vendor":"SpH","originator":"M.Sabina flowers (yoshi) / OK Wild","family":"Huatula, OK","notes":"Cross by Sporophore Hunter (Maria Sabina Flowers x OK wild) MSF came from Wombat's Maria Sabina which is a Huatula isolation"}},
  {"code":"SL022","genus":"Psilocybe","species":"cubensis","cultivar":"White Wizzard","origin":"Dino Spores","vendor":"Dino Spores","family":"TAM","notes":"Jullian Mattucci cross (Gandalf = TATxMelmac, Long Ghost = TAT iso from t.pigg)","ingestData":{"vendor":"Dino Spores","originator":"Dino Spores","family":"TAM","notes":"Jullian Mattucci cross (Gandalf = TATxMelmac, Long Ghost = TAT iso from t.pigg)"}},
  {"code":"SL023","genus":"Psilocybe","species":"cubensis","cultivar":"Saturn","origin":"Dino Spores","vendor":"Dino Spores","family":"TAM","notes":"Melmac Revert Archaic Revival x TAT Black Cap","ingestData":{"vendor":"Dino Spores","originator":"Dino Spores","family":"TAM","notes":"Melmac Revert Archaic Revival x TAT Black Cap"}},
  {"code":"SL024","genus":"Psilocybe","species":"cubensis","cultivar":"Coda","origin":"Dino Spores","vendor":"Dino Spores","family":"Melmac","notes":"Melmac iso from Yoshi","ingestData":{"vendor":"Dino Spores","originator":"Dino Spores","family":"Melmac","notes":"Melmac iso from Yoshi"}},
  {"code":"SL025","genus":"Psilocybe","species":"cubensis","cultivar":"HTF (Huat the Fuck)","origin":"Dave Whombat","vendor":"Dino Spores","family":"","notes":"","ingestData":{"vendor":"Dino Spores","originator":"Dave Whombat","family":"","notes":""}},
  {"code":"SL026","genus":"Psilocybe","species":"zapotecorum","cultivar":"Cinco Palos (zap)","origin":"Dino Spores","vendor":"Dino Spores","family":"","notes":"The original wild spores came from a collection made by Jordan Jacobs and Alan Rockefeller in Cinco Palos, Vera Cruz, Mexico in 2022 -- https://www.inaturalist.org/observations/134803503","ingestData":{"vendor":"Dino Spores","originator":"Dino Spores","family":"","notes":"The original wild spores came from a collection made by Jordan Jacobs and Alan Rockefeller in Cinco Palos, Vera Cruz, Mexico in 2022 -- https://www.inaturalist.org/observations/134803503"}},
  {"code":"SL028","genus":"Psilocybe","species":"cubensis","cultivar":"Blue Cap Bluey Vuitton","origin":"Goomba","vendor":"MW","family":"TAT, Melmac, Panama","notes":"Albino from Goomba","ingestData":{"vendor":"MW","originator":"Goomba","family":"TAT, Melmac, Panama","notes":"Albino from Goomba"}},
  {"code":"SL029","genus":"Psilocybe","species":"cubensis","cultivar":"Nerds (TW 8 blob ISO)","origin":"Tidal Wave 8","vendor":"Mycelio","family":"Tidal Wave","notes":"via blue bear","ingestData":{"vendor":"Mycelio","originator":"Tidal Wave 8","family":"Tidal Wave","notes":"via blue bear"}},
  {"code":"SL030","genus":"Psilocybe","species":"cubensis","cultivar":"Bulbasaur (ABV ISO)","origin":"Goomba","vendor":"MW","family":"TAT, Melmac, Panama","notes":"Albino from Goomba - small popcorn fruits - extremely potent","ingestData":{"vendor":"MW","originator":"Goomba","family":"TAT, Melmac, Panama","notes":"Albino from Goomba - small popcorn fruits - extremely potent"}},
  {"code":"SL031","genus":"Psilocybe","species":"cubensis","cultivar":"Bluey Vuitton 140","origin":"Matt Winter","vendor":"MW","family":"TAT, Melmac, Panama","notes":"","ingestData":{"vendor":"MW","originator":"Matt Winter","family":"TAT, Melmac, Panama","notes":""}},
  {"code":"SL032","genus":"Psilocybe","species":"cubensis","cultivar":"BCBV x BV140","origin":"Matt Winter","vendor":"MW","family":"TAT, Melmac, Panama","notes":"","ingestData":{"vendor":"MW","originator":"Matt Winter","family":"TAT, Melmac, Panama","notes":""}},
  {"code":"SL033","genus":"Psilocybe","species":"cubensis","cultivar":"BV x Haole","origin":"Matt Winter","vendor":"MW","family":"TAT, Melmac, Panama","notes":"","ingestData":{"vendor":"MW","originator":"Matt Winter","family":"TAT, Melmac, Panama","notes":""}},
  {"code":"SL034","genus":"Psilocybe","species":"cubensis","cultivar":"Bluey Blanco (ABV iso)","origin":"Goomba","vendor":"MW","family":"TAT, Melmac, Panama","notes":"","ingestData":{"vendor":"MW","originator":"Goomba","family":"TAT, Melmac, Panama","notes":""}},
  {"code":"SL035","genus":"Psilocybe","species":"cubensis","cultivar":"Haole","origin":"PGT?","vendor":"MW","family":"Unknown","notes":"Albino PES Hawaiian","ingestData":{"vendor":"MW","originator":"PGT?","family":"Unknown","notes":"Albino PES Hawaiian"}},
  {"code":"SL036","genus":"Psilocybe","species":"cubensis","cultivar":"Ecuador","origin":"Landrace","vendor":"TMC","family":"Landrace","notes":"","ingestData":{"vendor":"TMC","originator":"Landrace","family":"Landrace","notes":""}},
  {"code":"SL037","genus":"Psilocybe","species":"cubensis","cultivar":"Amazon","origin":"Landrace","vendor":"TMC","family":"Landrace","notes":"champ got from Homestead","ingestData":{"vendor":"TMC","originator":"Landrace","family":"Landrace","notes":"champ got from Homestead"}},
  {"code":"SL038","genus":"Psilocybe","species":"cubensis","cultivar":"B+","origin":"","vendor":"TMC","family":"","notes":"","ingestData":{"vendor":"TMC","originator":"","family":"","notes":""}},
  {"code":"SL039","genus":"Psilocybe","species":"cubensis","cultivar":"Melmac","origin":"","vendor":"TMC","family":"Melmac","notes":"","ingestData":{"vendor":"TMC","originator":"","family":"Melmac","notes":""}},
  {"code":"SL040","genus":"Psilocybe","species":"cubensis","cultivar":"Momo","origin":"Chris Aaron","vendor":"Dino Spores","family":"Shakti","notes":"Chris Aaron -> Turtle Hermit -> Yoshi Amano","ingestData":{"vendor":"Dino Spores","originator":"Chris Aaron","family":"Shakti","notes":"Chris Aaron -> Turtle Hermit -> Yoshi Amano"}},
  {"code":"SL043","genus":"Psilocybe","species":"cubensis","cultivar":"Enigma","origin":"","vendor":"TBG","family":"Tidal Wave","notes":"TW3","ingestData":{"vendor":"TBG","originator":"","family":"Tidal Wave","notes":"TW3"}},
  {"code":"SL063","genus":"Psilocybe","species":"cubensis","cultivar":"Momo C2.1","origin":"Shakti","vendor":"Dino Spores","family":"Malabar","notes":"Momo project grow along - Clone #1 of 8","ingestData":{"vendor":"Dino Spores","originator":"Shakti","family":"Malabar","notes":"Momo project grow along - Clone #1 of 8"}},
  {"code":"SL064","genus":"Psilocybe","species":"cubensis","cultivar":"Yakuza","origin":"Minami Okinawa x Albino Normak","vendor":"WSM","family":"Minami, Melmac","notes":"Wizard Shit Mycology - Sent F2 Spore print aprox 3cm dia","ingestData":{"vendor":"WSM","originator":"Minami Okinawa x Albino Normak","family":"Minami, Melmac","notes":"Wizard Shit Mycology - Sent F2 Spore print aprox 3cm dia"}},
  {"code":"SL065","genus":"Psilocybe","species":"cubensis","cultivar":"SNAPE","origin":"APE iso (Yoshi)","vendor":"Scrynn","family":"APE","notes":"","ingestData":{"vendor":"Scrynn","originator":"APE iso (Yoshi)","family":"APE","notes":""}},
  {"code":"SL066","genus":"Psilocybe","species":"cubensis","cultivar":"killaflip","origin":"","vendor":"Scrynn","family":"TAT, Melmac","notes":"Makilla Gorrila x Flipper (cross by Scrynn)","ingestData":{"vendor":"Scrynn","originator":"","family":"TAT, Melmac","notes":"Makilla Gorrila x Flipper (cross by Scrynn)"}},
  {"code":"SL067","genus":"Psilocybe","species":"cubensis","cultivar":"og tbc","origin":"Ghost ISO < TAT","vendor":"Scrynn","family":"TAT","notes":"Jik Fibs","ingestData":{"vendor":"Scrynn","originator":"Ghost ISO < TAT","family":"TAT","notes":"Jik Fibs"}},
  {"code":"SL068","genus":"Psilocybe","species":"cubensis","cultivar":"Dancing Tiger","origin":"","vendor":"Scrynn","family":"Landrace","notes":"China Landrace","ingestData":{"vendor":"Scrynn","originator":"","family":"Landrace","notes":"China Landrace"}},
  {"code":"SL069","genus":"Psilocybe","species":"cubensis","cultivar":"Blue nips","origin":"Shakti ISO","vendor":"Scrynn","family":"Malabar","notes":"","ingestData":{"vendor":"Scrynn","originator":"Shakti ISO","family":"Malabar","notes":""}},
  {"code":"SL070","genus":"Psilocybe","species":"cubensis","cultivar":"Phantom","origin":"BAPER iso (APE Lineage)","vendor":"Scrynn","family":"APE","notes":"Blue Ape Revert Iso from Cadaverous","ingestData":{"vendor":"Scrynn","originator":"BAPER iso (APE Lineage)","family":"APE","notes":"Blue Ape Revert Iso from Cadaverous"}},
  {"code":"SL071","genus":"Panaleos","species":"cyanescens","cultivar":"unknown Cyan","origin":"","vendor":"Scrynn","family":"pan cyan","notes":"he got it from j1mbub","ingestData":{"vendor":"Scrynn","originator":"","family":"pan cyan","notes":"he got it from j1mbub"}},
  {"code":"SL072","genus":"Panaleos","species":"cyanescens","cultivar":"TX. Pan","origin":"","vendor":"Scrynn","family":"pan cyan","notes":"","ingestData":{"vendor":"Scrynn","originator":"","family":"pan cyan","notes":""}},
  {"code":"SL073","genus":"Panaleos","species":"cyanescens","cultivar":"TTBVI","origin":"","vendor":"Scrynn","family":"pan cyan","notes":"","ingestData":{"vendor":"Scrynn","originator":"","family":"pan cyan","notes":""}},
  {"code":"SL075","genus":"Psilocybe","species":"cubensis","cultivar":"mazatapec","origin":"Landrace","vendor":"Wunderland","family":"Oaxaca","notes":"Huautla de Jimenez, Should be called Mazatec, but origionally misspelled","ingestData":{"vendor":"Wunderland","originator":"Landrace","family":"Oaxaca","notes":"Huautla de Jimenez, Should be called Mazatec, but origionally misspelled"}},
  {"code":"SL076","genus":"Psilocybe","species":"cubensis","cultivar":"angkor","origin":"","vendor":"Wunderland","family":"Cambodian","notes":"possibly from John Allen","ingestData":{"vendor":"Wunderland","originator":"","family":"Cambodian","notes":"possibly from John Allen"}},
  {"code":"SL077","genus":"Psilocybe","species":"cubensis","cultivar":"Rusty Whyte","origin":"PastyWhyte","vendor":"Scrynn","family":"AA+, CRS","notes":"Columbian Red Spore x Albino A+, Orig","ingestData":{"vendor":"Scrynn","originator":"PastyWhyte","family":"AA+, CRS","notes":"Columbian Red Spore x Albino A+, Orig"}},
  {"code":"SL078","genus":"Psilocybe","species":"cubensis","cultivar":"ankh","origin":"","vendor":"Wunderland","family":"Illinois - USA","notes":"Ankh is landrace cube to Illinois. Was found in Chillicothe, Peoria, 3 Sisters Park, and Bartonville. All in Illinois. Work was done by Myco Madden. SillyKittie, his lady is the one who found it.","ingestData":{"vendor":"Wunderland","originator":"","family":"Illinois - USA","notes":"Ankh is landrace cube to Illinois. Was found in Chillicothe, Peoria, 3 Sisters Park, and Bartonville. All in Illinois. Work was done by Myco Madden. SillyKittie, his lady is the one who found it."}},
  {"code":"SL079","genus":"Psilocybe","species":"cubensis","cultivar":"Zilla","origin":"","vendor":"Wunderland","family":"","notes":"Lizard King x KSSS x APE - Magic Myco cross","ingestData":{"vendor":"Wunderland","originator":"","family":"","notes":"Lizard King x KSSS x APE - Magic Myco cross"}},
  {"code":"SL080","genus":"Psilocybe","species":"cubensis","cultivar":"chupacabra","origin":"","vendor":"Wunderland","family":"Mexican Red Spore","notes":"From Wombat: Chupacabra began as a multi-capped fin mutation from wild Mexican Redspore. Early generations had narrow stems and round caps that curled up like bowls, and later generations have trended much thicker.","ingestData":{"vendor":"Wunderland","originator":"","family":"Mexican Red Spore","notes":"From Wombat: Chupacabra began as a multi-capped fin mutation from wild Mexican Redspore. Early generations had narrow stems and round caps that curled up like bowls, and later generations have trended much thicker."}},
  {"code":"SL082","genus":"Panaleos","species":"cyanescens","cultivar":"Pan Cyan TTBVI","origin":"GORDO","vendor":"SDMG","family":"pan cyan","notes":"Tamarind Tree Brittish Virgin Islands","ingestData":{"vendor":"SDMG","originator":"GORDO","family":"pan cyan","notes":"Tamarind Tree Brittish Virgin Islands"}},
  {"code":"SL083","genus":"Psilocybe","species":"cubensis","cultivar":"Shakti Blue Mutant","origin":"Humble Bruise","vendor":"SDMG","family":"Malabar","notes":"","ingestData":{"vendor":"SDMG","originator":"Humble Bruise","family":"Malabar","notes":""}},
  {"code":"SL084","genus":"Psilocybe","species":"cubensis","cultivar":"Blue Ghost","origin":"Humble Bruise","vendor":"SDMG","family":"Shakti, TAT","notes":"SBM x Long Ghost - Shakti Blue Mutant, Long Ghost = Tim Pigg's Long Ghost isolation","ingestData":{"vendor":"SDMG","originator":"Humble Bruise","family":"Shakti, TAT","notes":"SBM x Long Ghost - Shakti Blue Mutant, Long Ghost = Tim Pigg's Long Ghost isolation"}},
  {"code":"SL085","genus":"Psilocybe","species":"cubensis","cultivar":"Iceberg","origin":"Miss mush SoCal","vendor":"SDMG","family":"Thai Lipa Yai","notes":"","ingestData":{"vendor":"SDMG","originator":"Miss mush SoCal","family":"Thai Lipa Yai","notes":""}},
  {"code":"SL086","genus":"Psilocybe","species":"cubensis","cultivar":"Green cap Thrasher","origin":"Miss mush SoCal","vendor":"SDMG","family":"Melmac, PE","notes":"","ingestData":{"vendor":"SDMG","originator":"Miss mush SoCal","family":"Melmac, PE","notes":""}},
  {"code":"SL087","genus":"Psilocybe","species":"cubensis","cultivar":"Casper","origin":"Psyteam United","vendor":"SDMG","family":"Melmac, Shakti, APE","notes":"","ingestData":{"vendor":"SDMG","originator":"Psyteam United","family":"Melmac, Shakti, APE","notes":""}},
  {"code":"SL088","genus":"Psilocybe","species":"cubensis","cultivar":"Coda (2)","origin":"fungi guru","vendor":"SDMG","family":"Melmac","notes":"Melmac iso from Yoshi","ingestData":{"vendor":"SDMG","originator":"fungi guru","family":"Melmac","notes":"Melmac iso from Yoshi"}},
  {"code":"SL089","genus":"Psilocybe","species":"cubensis","cultivar":"White Rabbit","origin":"BLU myco","vendor":"SDMG","family":"APE, AA+, GT","notes":"APE x Moby Dick - Unknown Holland Cultivator (Moby Dick being either AA+ iso or cross with GT) -- this LC was created by Electric Fun guy and expanded by SDMG","ingestData":{"vendor":"SDMG","originator":"BLU myco","family":"APE, AA+, GT","notes":"APE x Moby Dick - Unknown Holland Cultivator (Moby Dick being either AA+ iso or cross with GT) -- this LC was created by Electric Fun guy and expanded by SDMG"}},
  {"code":"SL090","genus":"Psilocybe","species":"cubensis","cultivar":"Flipper","origin":"Humble Bruise","vendor":"SDMG","family":"TAT, PE","notes":"Blackhawk backcross to TBC","ingestData":{"vendor":"SDMG","originator":"Humble Bruise","family":"TAT, PE","notes":"Blackhawk backcross to TBC"}},
  {"code":"SL091","genus":"Psilocybe","species":"cubensis","cultivar":"Albino Trinity","origin":"fungi guru","vendor":"SDMG","family":"PE, B+, Aztec","notes":"PE x TW x Aztec God","ingestData":{"vendor":"SDMG","originator":"fungi guru","family":"PE, B+, Aztec","notes":"PE x TW x Aztec God"}},
  {"code":"SL092","genus":"Psilocybe","species":"cubensis","cultivar":"Ocean Gates","origin":"","vendor":"Bus Driver","family":"PE, B+, Melmac, TAT","notes":"Lucid Gates (Leucistic Emerald Gates) x Tidal Wave","ingestData":{"vendor":"Bus Driver","originator":"","family":"PE, B+, Melmac, TAT","notes":"Lucid Gates (Leucistic Emerald Gates) x Tidal Wave"}},
  {"code":"SL093","genus":"Psilocybe","species":"cubensis","cultivar":"Rango","origin":"Psilo Vybin","vendor":"Bus Driver","family":"PE","notes":"APE iso from Psilo Vybin","ingestData":{"vendor":"Bus Driver","originator":"Psilo Vybin","family":"PE","notes":"APE iso from Psilo Vybin"}},
  {"code":"SL094","genus":"Psilocybe","species":"cubensis","cultivar":"Chitwan","origin":"","vendor":"Organic Matrix","family":"Landrace","notes":"Nepal","ingestData":{"vendor":"Organic Matrix","originator":"","family":"Landrace","notes":"Nepal"}},
  {"code":"SL095","genus":"Psilocybe","species":"cubensis","cultivar":"Thai","origin":"John Allen","vendor":"Organic Matrix","family":"Landrace","notes":"John Allen","ingestData":{"vendor":"Organic Matrix","originator":"John Allen","family":"Landrace","notes":"John Allen"}},
  {"code":"SL096","genus":"Psilocybe","species":"cubensis","cultivar":"Costa Rica","origin":"Landrace","vendor":"Organic Matrix","family":"Landrace","notes":"","ingestData":{"vendor":"Organic Matrix","originator":"Landrace","family":"Landrace","notes":""}},
  {"code":"SL097","genus":"Psilocybe","species":"cubensis","cultivar":"Cream Coffee F6","origin":"","vendor":"Void","family":"Tidal Wave, Shakti","notes":"Shakti x Tidal Wave from Johan Rhizo - F6 is Dark Roast - mycominded grow along","ingestData":{"vendor":"Void","originator":"","family":"Tidal Wave, Shakti","notes":"Shakti x Tidal Wave from Johan Rhizo - F6 is Dark Roast - mycominded grow along"}},
  {"code":"SL098","genus":"Psilocybe","species":"zapotecorum","cultivar":"zapotecorum (peru)","origin":"Landrace","vendor":"Scrynn","family":"","notes":"Wild from Peru. Stabalized via source previous to scrynn","ingestData":{"vendor":"Scrynn","originator":"Landrace","family":"","notes":"Wild from Peru. Stabalized via source previous to scrynn"}},
  {"code":"SL099","genus":"Psilocybe","species":"cubensis","cultivar":"Outdoor Gandalf","origin":"TAT/ Melmac","vendor":"Scrynn","family":"","notes":"Scrynn ran outdoor, brought back into cultivation and has seen revert and spores along with black caps and other fun phenos. Sent as bonus gift with trade! (gandalf was origionally gift only)","ingestData":{"vendor":"Scrynn","originator":"TAT/ Melmac","family":"","notes":"Scrynn ran outdoor, brought back into cultivation and has seen revert and spores along with black caps and other fun phenos. Sent as bonus gift with trade! (gandalf was origionally gift only)"}},
  {"code":"SL100","genus":"Psilocybe","species":"cubensis","cultivar":"Stargazer","origin":"","vendor":"Wunderland","family":"Landrace - Peru","notes":"OG from Paul Stamets","ingestData":{"vendor":"Wunderland","originator":"","family":"Landrace - Peru","notes":"OG from Paul Stamets"}},
  {"code":"SL101","genus":"Psilocybe","species":"cubensis","cultivar":"OG APE BC","origin":"HumbleBruise","vendor":"Mizer","family":"APE","notes":"Black cap ISO from Mizer of HB OG APE","ingestData":{"vendor":"Mizer","originator":"HumbleBruise","family":"APE","notes":"Black cap ISO from Mizer of HB OG APE"}},
  {"code":"SL103","genus":"Psilocybe","species":"cubensis","cultivar":"Iceberg","origin":"MycoUnity","vendor":"Bus Driver","family":"Thai Lipa Yai","notes":"MycoUnity's genetic via Bus Driver from Discord","ingestData":{"vendor":"Bus Driver","originator":"MycoUnity","family":"Thai Lipa Yai","notes":"MycoUnity's genetic via Bus Driver from Discord"}},
  {"code":"SL104","genus":"Psilocybe","species":"cubensis","cultivar":"Pumpkin PE","origin":"Sean Giuliani","vendor":"Bus Driver","family":"Hillbilly, APE","notes":"","ingestData":{"vendor":"Bus Driver","originator":"Sean Giuliani","family":"Hillbilly, APE","notes":""}},
  {"code":"SL105","genus":"Psilocybe","species":"cubensis","cultivar":"Brain Melt","origin":"Sean Giuliani","vendor":"Bus Driver","family":"PE","notes":"Coral Blob - PE mutation","ingestData":{"vendor":"Bus Driver","originator":"Sean Giuliani","family":"PE","notes":"Coral Blob - PE mutation"}},
  {"code":"SL106","genus":"Psilocybe","species":"cubensis","cultivar":"Belafonte","origin":"Natural State","vendor":"Tryptronics","family":"TAT","notes":"Deep End (yeti iso) Mutant","ingestData":{"vendor":"Tryptronics","originator":"Natural State","family":"TAT","notes":"Deep End (yeti iso) Mutant"}},
  {"code":"SL107","genus":"Psilocybe","species":"cubensis","cultivar":"Alacabenzi","origin":"Magic Myco","vendor":"Tryptronics","family":"","notes":"","ingestData":{"vendor":"Tryptronics","originator":"Magic Myco","family":"","notes":""}},
  {"code":"SL108","genus":"Psilocybe","species":"zapotecorum","cultivar":"Zapotecorum Jalisco","origin":"Pheno Dreamer","vendor":"Tryptronics","family":"Zapotecorum","notes":"","ingestData":{"vendor":"Tryptronics","originator":"Pheno Dreamer","family":"Zapotecorum","notes":""}},
  {"code":"SL109","genus":"Panaleos","species":"cyanescens","cultivar":"Aguadilla","origin":"Brown Treasure?","vendor":"Tryptronics","family":"","notes":"probably contaminated","ingestData":{"vendor":"Tryptronics","originator":"Brown Treasure?","family":"","notes":"probably contaminated"}},
  {"code":"SL110","genus":"Panaleos","species":"cyanescens","cultivar":"PHV","origin":"LP?","vendor":"Tryptronics","family":"pan cyan","notes":"Panaeolus cyanscens from Hausetca, Mexico, crossed with a Panaeolus cyanescens from Australia -- PHV is short for Purple Haustralia Venom (pan Trop red spore X with pan cyan hausteca)","ingestData":{"vendor":"Tryptronics","originator":"LP?","family":"pan cyan","notes":"Panaeolus cyanscens from Hausetca, Mexico, crossed with a Panaeolus cyanescens from Australia -- PHV is short for Purple Haustralia Venom (pan Trop red spore X with pan cyan hausteca)"}},
  {"code":"SL111","genus":"Psilocybe","species":"ochraceocentrata","cultivar":"Black Cap Ochraceocentrata","origin":"Myco Cat","vendor":"Tryptronics","family":"Ochraceocentrata","notes":"","ingestData":{"vendor":"Tryptronics","originator":"Myco Cat","family":"Ochraceocentrata","notes":""}},
  {"code":"SL112","genus":"Psilocybe","species":"allenii","cultivar":"Allenii","origin":"Happi","vendor":"Tryptronics","family":"Alenii","notes":"Described in 2012. Closely related to Cyanecens and Azurescens -- https://www.researchgate.net/publication/233864673","ingestData":{"vendor":"Tryptronics","originator":"Happi","family":"Alenii","notes":"Described in 2012. Closely related to Cyanecens and Azurescens -- https://www.researchgate.net/publication/233864673"}},
  {"code":"SL113","genus":"Psilocybe","species":"tampanensis","cultivar":"ATL7","origin":"Happi","vendor":"Tryptronics","family":"Mexicana","notes":"Produces \"philosopher's stones\" / Truffles","ingestData":{"vendor":"Tryptronics","originator":"Happi","family":"Mexicana","notes":"Produces \"philosopher's stones\" / Truffles"}},
  {"code":"SL114","genus":"Psilocybe","species":"subtropicalis","cultivar":"HVC","origin":"Happi","vendor":"Tryptronics","family":"Subtropicalis","notes":"Potentially collocted and isolated by Happi. TBC","ingestData":{"vendor":"Tryptronics","originator":"Happi","family":"Subtropicalis","notes":"Potentially collocted and isolated by Happi. TBC"}},
  {"code":"SL115","genus":"Psilocybe","species":"cubensis","cultivar":"SNAPE","origin":"Fungus Frequency","vendor":"Tryptronics","family":"APE","notes":"Stary Night Albino Penis Envy","ingestData":{"vendor":"Tryptronics","originator":"Fungus Frequency","family":"APE","notes":"Stary Night Albino Penis Envy"}},
  {"code":"SL116","genus":"Psilocybe","species":"cubensis","cultivar":"Goliath PE","origin":"Hashoil","vendor":"Ann Chovie","family":"PE","notes":"Low Spore iso from PE7","ingestData":{"vendor":"Ann Chovie","originator":"Hashoil","family":"PE","notes":"Low Spore iso from PE7"}},
  {"code":"SL117","genus":"Panaleos","species":"cyanescens","cultivar":"eungai","origin":"SporExchange","vendor":"DickeyDoo","family":"pan cyan","notes":"Eungai Rail NSW Australia - from AUS Myco discord group grow (2024 collection?)","ingestData":{"vendor":"DickeyDoo","originator":"SporExchange","family":"pan cyan","notes":"Eungai Rail NSW Australia - from AUS Myco discord group grow (2024 collection?)"}},
  {"code":"SL118","genus":"Psilocybe","species":"cubensis","cultivar":"Double Chocolate Penis Envy Uncut","origin":"","vendor":"Agar Wolfe","family":"Penis Envy","notes":"wolfe got from curt who runs mycomafia on fb no cross just forced mutations","ingestData":{"vendor":"Agar Wolfe","originator":"","family":"Penis Envy","notes":"wolfe got from curt who runs mycomafia on fb no cross just forced mutations"}},
  {"code":"SL119","genus":"Psilocybe","species":"cubensis","cultivar":"Satan's Sphincter","origin":"","vendor":"Agar Wolfe","family":"Shakti","notes":"archive origins Grow Along. 2025 - Red Cap Bowser iso with possible inverted umbo","ingestData":{"vendor":"Agar Wolfe","originator":"","family":"Shakti","notes":"archive origins Grow Along. 2025 - Red Cap Bowser iso with possible inverted umbo"}},
  {"code":"SL120","genus":"Psilocybe","species":"cubensis","cultivar":"Safari 402","origin":"","vendor":"WTF - Q","family":"Shakti, AA+, Puerto Rico","notes":"Shakti BM 227 x GWM (Great White Monster (Puerto-Rico x AA+))","ingestData":{"vendor":"WTF - Q","originator":"","family":"Shakti, AA+, Puerto Rico","notes":"Shakti BM 227 x GWM (Great White Monster (Puerto-Rico x AA+))"}},
  {"code":"SL121","genus":"Panaleos","species":"cyanescens","cultivar":"Tweed Valley","origin":"Austrailian Landrace","vendor":"WTF - Q","family":"pan cyan","notes":"Swab - Foraged by 'OnlySpores' - New South Wales","ingestData":{"vendor":"WTF - Q","originator":"Austrailian Landrace","family":"pan cyan","notes":"Swab - Foraged by 'OnlySpores' - New South Wales"}},
  {"code":"SL122","genus":"Psilocybe","species":"cubensis","cultivar":"Frilly Vanilli","origin":"Austrailian Landrace","vendor":"WTF - Q","family":"Landrace","notes":"Wild Cube - New South Wales -- Aus Wild #1 Leucictic","ingestData":{"vendor":"WTF - Q","originator":"Austrailian Landrace","family":"Landrace","notes":"Wild Cube - New South Wales -- Aus Wild #1 Leucictic"}},
  {"code":"SL123","genus":"Psilocybe","species":"cubensis","cultivar":"Aussie Big Boi","origin":"Austrailian Landrace","vendor":"WTF - Q","family":"Landrace","notes":"Wild Cube - New South Wales","ingestData":{"vendor":"WTF - Q","originator":"Austrailian Landrace","family":"Landrace","notes":"Wild Cube - New South Wales"}},
  {"code":"SL124","genus":"Psilocybe","species":"cubensis","cultivar":"Blue Voodoo","origin":"","vendor":"WTF - Q","family":"Shakti, Ochra, Mars","notes":"Shakti (Blue rav) x Natal Moon (Ochra x Phobos(MARS iso))","ingestData":{"vendor":"WTF - Q","originator":"","family":"Shakti, Ochra, Mars","notes":"Shakti (Blue rav) x Natal Moon (Ochra x Phobos(MARS iso))"}},
  {"code":"SL125","genus":"Psilocybe","species":"cubensis","cultivar":"Gamma Decay","origin":"Q","vendor":"WTF - Q","family":"Melmac, TAT, Shakti","notes":"Black Betty Gates (tam) x Blue Ravioli (shakti iso)","ingestData":{"vendor":"WTF - Q","originator":"Q","family":"Melmac, TAT, Shakti","notes":"Black Betty Gates (tam) x Blue Ravioli (shakti iso)"}},
  {"code":"SL126","genus":"Psilocybe","species":"cubensis","cultivar":"Megaton - Mono","origin":"","vendor":"WTF - Q","family":"","notes":"\"KLF\" Koh Samui Little Flowers","ingestData":{"vendor":"WTF - Q","originator":"","family":"","notes":"\"KLF\" Koh Samui Little Flowers"}},
  {"code":"SL127","genus":"Psilocybe","species":"cubensis","cultivar":"Penis Envy - Mono","origin":"","vendor":"WTF - Q","family":"Penis Envy","notes":"the one and only","ingestData":{"vendor":"WTF - Q","originator":"","family":"Penis Envy","notes":"the one and only"}},
  {"code":"SL128","genus":"Psilocybe","species":"cubensis","cultivar":"Indian Graveyard - Mono","origin":"MoonDaddy","vendor":"WTF - Q","family":"Shakti, TAT","notes":"Shakti x Ghost - MoonDaddy (not sure which ghost, assuming tat ghost not pe ghost)","ingestData":{"vendor":"WTF - Q","originator":"MoonDaddy","family":"Shakti, TAT","notes":"Shakti x Ghost - MoonDaddy (not sure which ghost, assuming tat ghost not pe ghost)"}},
  {"code":"SL129","genus":"Psilocybe","species":"cubensis","cultivar":"HBSS - Mono","origin":"","vendor":"WTF - Q","family":"","notes":"Hillbilly Super Squats","ingestData":{"vendor":"WTF - Q","originator":"","family":"","notes":"Hillbilly Super Squats"}},
  {"code":"SL130","genus":"Psilocybe","species":"cubensis","cultivar":"Blue Nips 153 - Mono","origin":"","vendor":"WTF - Q","family":"","notes":"","ingestData":{"vendor":"WTF - Q","originator":"","family":"","notes":""}},
  {"code":"SL131","genus":"Psilocybe","species":"cubensis","cultivar":"Hulk - Mono","origin":"","vendor":"WTF - Q","family":"","notes":"Emerald Gates iso","ingestData":{"vendor":"WTF - Q","originator":"","family":"","notes":"Emerald Gates iso"}},
  {"code":"SL132","genus":"Panaleos","species":"cyanescens","cultivar":"Naolinco","origin":"Mexican Landrace","vendor":"ROG","family":"wild Pan","notes":"Pan foraged by \"Rog\" - extinct volcano, Veracruz, Naolinco 1200m - crater near base. Cow pasture ~July 2025","ingestData":{"vendor":"ROG","originator":"Mexican Landrace","family":"wild Pan","notes":"Pan foraged by \"Rog\" - extinct volcano, Veracruz, Naolinco 1200m - crater near base. Cow pasture ~July 2025"}},
  {"code":"SL133","genus":"Psilocybe","species":"cubensis","cultivar":"Albino Trinity","origin":"iso","vendor":"HOME","family":"","notes":"Revert clone from SDMG A. Trinity bag. (from SL091)","ingestData":{"vendor":"HOME","originator":"iso","family":"","notes":"Revert clone from SDMG A. Trinity bag. (from SL091)"}},
  {"code":"SL134","genus":"Panaleos","species":"cyanescens","cultivar":"Pan - Oregon (bisporus)","origin":"","vendor":"tree frog","family":"","notes":"","ingestData":{"vendor":"tree frog","originator":"","family":"","notes":""}},
  {"code":"SL135","genus":"Psilocybe","species":"caerulescens","cultivar":"Caerulecens Pastaza","origin":"","vendor":"tree frog","family":"","notes":"","ingestData":{"vendor":"tree frog","originator":"","family":"","notes":""}},
  {"code":"SL136","genus":"Psilocybe","species":"subtropicalis","cultivar":"HVC (No Vanity)","origin":"Bassidium Equilibrium","vendor":"No Vanity","family":"Subtropicalis","notes":"","ingestData":{"vendor":"No Vanity","originator":"Bassidium Equilibrium","family":"Subtropicalis","notes":""}},
  {"code":"SL137","genus":"Psilocybe","species":"azurescens","cultivar":"Wild Azzie","origin":"unknown foraged","vendor":"Brad","family":"Wood Lover","notes":"","ingestData":{"vendor":"Brad","originator":"unknown foraged","family":"Wood Lover","notes":""}},
  {"code":"SL138","genus":"Psilocybe","species":"cubensis","cultivar":"mars","origin":"","vendor":"","family":"Landrace","notes":"Possible USA?","ingestData":{"vendor":"","originator":"","family":"Landrace","notes":"Possible USA?"}},
  {"code":"SL139","genus":"Psilocybe","species":"cubensis","cultivar":"Jedi Mind Fuck","origin":"Lord of Spore","vendor":"Urban Rebel","family":"Landrace","notes":"weak syringe 20+ to colonize","ingestData":{"vendor":"Urban Rebel","originator":"Lord of Spore","family":"Landrace","notes":"weak syringe 20+ to colonize"}},
  {"code":"SL140","genus":"Psilocybe","species":"cubensis","cultivar":"Pasithea","origin":"","vendor":"Scrynn","family":"PE x TAM","notes":"Scrynn cross Killa flip x Goliathh PE","ingestData":{"vendor":"Scrynn","originator":"","family":"PE x TAM","notes":"Scrynn cross Killa flip x Goliathh PE"}},
  {"code":"SL141","genus":"Panaleos","species":"cyanescens","cultivar":"TTBVI","origin":"MushroomGod","vendor":"Rashfree","family":"Landrace","notes":"","ingestData":{"vendor":"Rashfree","originator":"MushroomGod","family":"Landrace","notes":""}},
  {"code":"SL142","genus":"Psilocybe","species":"zapotecorum","cultivar":"NZ02 (Jizz in your pants)","origin":"","vendor":"Rashfree","family":"Landrace","notes":"","ingestData":{"vendor":"Rashfree","originator":"","family":"Landrace","notes":""}},
  {"code":"SL143","genus":"Psilocybe","species":"cubensis","cultivar":"3-Way","origin":"Dirty South Myco","vendor":"Rashfree","family":"Landrace","notes":"","ingestData":{"vendor":"Rashfree","originator":"Dirty South Myco","family":"Landrace","notes":""}},
  {"code":"SL144","genus":"Psilocybe","species":"cubensis","cultivar":"Aztec God","origin":"","vendor":"Mycelio","family":"Landrace","notes":"Possibly from Puebla (near Popocatepetl) described by Roger Heim in 1956 - all potentially bullshit","ingestData":{"vendor":"Mycelio","originator":"","family":"Landrace","notes":"Possibly from Puebla (near Popocatepetl) described by Roger Heim in 1956 - all potentially bullshit"}},
  {"code":"SL145","genus":"Psilocybe","species":"cubensis","cultivar":"Rudolph","origin":"","vendor":"Mycelio","family":"","notes":"XLS ready per label. But no fucking clue","ingestData":{"vendor":"Mycelio","originator":"","family":"","notes":"XLS ready per label. But no fucking clue"}},
  {"code":"SL146","genus":"Psilocybe","species":"cubensis","cultivar":"Godilocks #3","origin":"Psilovibe via Swamp fox","vendor":"Mycelio","family":"Landrace","notes":"XLS ready per label. Per bas USA Landrace - Arkansas' River Valley by Psilovibe","ingestData":{"vendor":"Mycelio","originator":"Psilovibe via Swamp fox","family":"Landrace","notes":"XLS ready per label. Per bas USA Landrace - Arkansas' River Valley by Psilovibe"}},
  {"code":"SL147","genus":"Psilocybe","species":"cubensis","cultivar":"Quetzalcoatl","origin":"Mycogentampa","vendor":"Mycelio","family":"Aztec God","notes":"Claimed Albino ISO of Aztec God though I'm only seeing Leucistic expressions","ingestData":{"vendor":"Mycelio","originator":"Mycogentampa","family":"Aztec God","notes":"Claimed Albino ISO of Aztec God though I'm only seeing Leucistic expressions"}},
  {"code":"SL148","genus":"Psilocybe","species":"cubensis","cultivar":"TAM x El Choco (F2)","origin":"Ed Grand","vendor":"Mycelio","family":"TAT, Melmac, B+","notes":"albino TAM x ElChoco from Ed Grand via swamp fox","ingestData":{"vendor":"Mycelio","originator":"Ed Grand","family":"TAT, Melmac, B+","notes":"albino TAM x ElChoco from Ed Grand via swamp fox"}},
  {"code":"SL149","genus":"Psilocybe","species":"cubensis","cultivar":"Butters","origin":"","vendor":"Mycelio","family":"","notes":"Mexican Red spore cross from Dave AMEX Asymmetric/KSAT","ingestData":{"vendor":"Mycelio","originator":"","family":"","notes":"Mexican Red spore cross from Dave AMEX Asymmetric/KSAT"}},
  {"code":"SL150","genus":"Psilocybe","species":"cubensis","cultivar":"\"combo uncut\" x Mak Shak","origin":"","vendor":"Mycelio","family":"","notes":"totally unknown. Possibly from swampfox. Via Mycelio","ingestData":{"vendor":"Mycelio","originator":"","family":"","notes":"totally unknown. Possibly from swampfox. Via Mycelio"}},
  {"code":"SL151","genus":"Psilocybe","species":"cubensis","cultivar":"Time Warp","origin":"","vendor":"Mycelio","family":"","notes":"totally unknown. Possibly from swampfox. Via Mycelio","ingestData":{"vendor":"Mycelio","originator":"","family":"","notes":"totally unknown. Possibly from swampfox. Via Mycelio"}},
  {"code":"SL152","genus":"Psilocybe","species":"subtropicalis","cultivar":"tres soles","origin":"","vendor":"Brahman Shaman","family":"","notes":"","ingestData":{"vendor":"Brahman Shaman","originator":"","family":"","notes":""}},
  {"code":"SL153","genus":"Psilocybe","species":"zapotecorum","cultivar":"texolo","origin":"Pheno Dreamer","vendor":"Brahman Shaman","family":"","notes":"","ingestData":{"vendor":"Brahman Shaman","originator":"Pheno Dreamer","family":"","notes":""}},
  {"code":"SL154","genus":"Psilocybe","species":"zapotecorum","cultivar":"ingeli","origin":"Pheno Dreamer","vendor":"Brahman Shaman","family":"","notes":"","ingestData":{"vendor":"Brahman Shaman","originator":"Pheno Dreamer","family":"","notes":""}},
  {"code":"SL155","genus":"Psilocybe","species":"zapotecorum","cultivar":"nz02 (JIYP)","origin":"","vendor":"Brahman Shaman","family":"","notes":"unknown FB trade, sounds like it might be Kilor, based on loose context","ingestData":{"vendor":"Brahman Shaman","originator":"","family":"","notes":"unknown FB trade, sounds like it might be Kilor, based on loose context"}},
  {"code":"SL156","genus":"Panaleous","species":"cyanescens","cultivar":"weza","origin":"popocatapetl","vendor":"Brahman Shaman","family":"","notes":"","ingestData":{"vendor":"Brahman Shaman","originator":"popocatapetl","family":"","notes":""}},
  {"code":"SL157","genus":"Panaleous","species":"cyanescens","cultivar":"Snake Gully","origin":"popocatapetl","vendor":"Brahman Shaman","family":"","notes":"","ingestData":{"vendor":"Brahman Shaman","originator":"popocatapetl","family":"","notes":""}},
  {"code":"SL158","genus":"Psilocybe","species":"subaeruginoa","cultivar":"Subaeruginosa","origin":"Stephen Martinez","vendor":"Brahman Shaman","family":"","notes":"","ingestData":{"vendor":"Brahman Shaman","originator":"Stephen Martinez","family":"","notes":""}},
  {"code":"SL159","genus":"Psilocybe","species":"cubensis","cultivar":"Wild TN","origin":"unknown foraged","vendor":"Brahman Shaman","family":"","notes":"I am third hand from collection - unknown forager in TN","ingestData":{"vendor":"Brahman Shaman","originator":"unknown foraged","family":"","notes":"I am third hand from collection - unknown forager in TN"}},
  {"code":"SL160","genus":"Psilocybe","species":"natalensis","cultivar":"True Natalensis?","origin":"Yoshi","vendor":"Brahman Shaman","family":"","notes":"could be Ochra, could be first run on Natalensis - by way of popacatapetl","ingestData":{"vendor":"Brahman Shaman","originator":"Yoshi","family":"","notes":"could be Ochra, could be first run on Natalensis - by way of popacatapetl"}},
  {"code":"SL161","genus":"Psilocybe","species":"cubensis","cultivar":"Mak Rev","origin":"","vendor":"Brahman Shaman","family":"","notes":"No real solid info. Lives near shaman","ingestData":{"vendor":"Brahman Shaman","originator":"","family":"","notes":"No real solid info. Lives near shaman"}},
  {"code":"SL162","genus":"Psilocybe","species":"cubensis","cultivar":"MMTP","origin":"","vendor":"Brahman Shaman","family":"","notes":"Melmac Thick Penis","ingestData":{"vendor":"Brahman Shaman","originator":"","family":"","notes":"Melmac Thick Penis"}},
  {"code":"SL163","genus":"Psilocybe","species":"cubensis","cultivar":"Blasher","origin":"Jeff Karas","vendor":"Brahman Shaman","family":"","notes":"Bluey Vuiton x Thrasher","ingestData":{"vendor":"Brahman Shaman","originator":"Jeff Karas","family":"","notes":"Bluey Vuiton x Thrasher"}},
  {"code":"SL164","genus":"Psilocybe","species":"cubensis","cultivar":"Ape 442","origin":"","vendor":"Brahman Shaman","family":"PE","notes":"APE iso from ????","ingestData":{"vendor":"Brahman Shaman","originator":"","family":"PE","notes":"APE iso from ????"}},
  {"code":"SL165","genus":"Psilocybe","species":"cubensis","cultivar":"Albino Bluey Vuiton","origin":"","vendor":"Brahman Shaman","family":"","notes":"","ingestData":{"vendor":"Brahman Shaman","originator":"","family":"","notes":""}},
  {"code":"SL166","genus":"Psilocybe","species":"cubensis","cultivar":"SGBD","origin":"FAHTSTER","vendor":"Dragonaut","family":"Golden Teacher","notes":"Sporeless GT Beef Supreeme Jr - Dragonaut Giveaway - Sporeless Golden Beef Dong","ingestData":{"vendor":"Dragonaut","originator":"FAHTSTER","family":"Golden Teacher","notes":"Sporeless GT Beef Supreeme Jr - Dragonaut Giveaway - Sporeless Golden Beef Dong"}},
  {"code":"SL167","genus":"Psilocybe","species":"tampanensis","cultivar":"Tampanensis","origin":"Sporeworks","vendor":"Dragonaut","family":"","notes":"Tamp from Sporeworks - probably the pollock 1977 collection","ingestData":{"vendor":"Dragonaut","originator":"Sporeworks","family":"","notes":"Tamp from Sporeworks - probably the pollock 1977 collection"}},
  {"code":"SL168","genus":"","species":"","cultivar":"Luna Terra","origin":"","vendor":"WTF - Q","family":"","notes":"Black Betty Gates x Phobos (Mars iso)","ingestData":{"vendor":"WTF - Q","originator":"","family":"","notes":"Black Betty Gates x Phobos (Mars iso)"}},
  {"code":"SL169","genus":"","species":"","cultivar":"Krang","origin":"","vendor":"WTF - Q","family":"","notes":"Shredder blob project F0 clone","ingestData":{"vendor":"WTF - Q","originator":"","family":"","notes":"Shredder blob project F0 clone"}},
  {"code":"SL172","genus":"Psilocybe","species":"caerulescens","cultivar":"Caerulecens var Mazatecorum","origin":"Someguys Fungi","vendor":"Hyphae fisherman","family":"","notes":"2024 Collection by Rog - Vera Cruz","ingestData":{"vendor":"Hyphae fisherman","originator":"Someguys Fungi","family":"","notes":"2024 Collection by Rog - Vera Cruz"}},
  {"code":"SL173","genus":"Psilocybe","species":"yungensis","cultivar":"Yungensis","origin":"Someguys Fungi","vendor":"Hyphae fisherman","family":"","notes":"2024 Collection by Rog Vera Cruz - Rancho Viejo","ingestData":{"vendor":"Hyphae fisherman","originator":"Someguys Fungi","family":"","notes":"2024 Collection by Rog Vera Cruz - Rancho Viejo"}},
  {"code":"SL174","genus":"Psilocybe","species":"muliercula","cultivar":"Muliercula","origin":"Someguys Fungi","vendor":"Hyphae fisherman","family":"","notes":"2024 Collection by Rog - Vera Cruz","ingestData":{"vendor":"Hyphae fisherman","originator":"Someguys Fungi","family":"","notes":"2024 Collection by Rog - Vera Cruz"}},
  {"code":"SL175","genus":"Psilocybe","species":"aztecorum","cultivar":"Aztecorum","origin":"Someguys Fungi","vendor":"Hyphae fisherman","family":"","notes":"2024 Collection by Rog - Puebla paso de Cortez","ingestData":{"vendor":"Hyphae fisherman","originator":"Someguys Fungi","family":"","notes":"2024 Collection by Rog - Puebla paso de Cortez"}},
  {"code":"SL176","genus":"Psilocybe","species":"antioquiensis","cultivar":"Antioquiensis","origin":"Workman","vendor":"Hyphae fisherman","family":"","notes":"Goes back to Workman so likely the Siem Reap, Cambodia, John Allen Collection, August 2003","ingestData":{"vendor":"Hyphae fisherman","originator":"Workman","family":"","notes":"Goes back to Workman so likely the Siem Reap, Cambodia, John Allen Collection, August 2003"}},
  {"code":"SL178","genus":"","species":"","cultivar":"weza","origin":"","vendor":"Mystery","family":"","notes":"maaaaybe rashfree?","ingestData":{"vendor":"Mystery","originator":"","family":"","notes":"maaaaybe rashfree?"}},
  {"code":"SL179","genus":"","species":"","cultivar":"Stunzii","origin":"","vendor":"Pheno Dreamer","family":"Semilanceata","notes":"","ingestData":{"vendor":"Pheno Dreamer","originator":"","family":"Semilanceata","notes":""}},
  {"code":"SL180","genus":"","species":"","cultivar":"Hopii","origin":"","vendor":"Pheno Dreamer","family":"Sect Hopii","notes":"Unconfirmed - try well decayed aspen wood at 9000 to 9500 ft elevation","ingestData":{"vendor":"Pheno Dreamer","originator":"","family":"Sect Hopii","notes":"Unconfirmed - try well decayed aspen wood at 9000 to 9500 ft elevation"}},
  {"code":"SL181","genus":"Psilocybe","species":"cubensis","cultivar":"Maria Sabina","origin":"","vendor":"BAKON","family":"","notes":"","ingestData":{"vendor":"BAKON","originator":"","family":"","notes":""}},
  {"code":"SL182","genus":"Psilocybe","species":"cubensis","cultivar":"Moon Surfer","origin":"Fungus Frequency","vendor":"BAKON","family":"PE, GT, B+, Ochra, Mars","notes":"Natal moon x surf monkey (Apetar x TW)","ingestData":{"vendor":"BAKON","originator":"Fungus Frequency","family":"PE, GT, B+, Ochra, Mars","notes":"Natal moon x surf monkey (Apetar x TW)"}},
  {"code":"SL183","genus":"Psilocybe","species":"cubensis x ochra","cultivar":"TW x Ochra","origin":"","vendor":"BAKON","family":"","notes":"","ingestData":{"vendor":"BAKON","originator":"","family":"","notes":""}},
  {"code":"SL184","genus":"Psilocybe","species":"cubensis x ochra","cultivar":"Natal Moon","origin":"","vendor":"BAKON","family":"Ochra, Cube","notes":"Ochra x Phobos(MARS iso)","ingestData":{"vendor":"BAKON","originator":"","family":"Ochra, Cube","notes":"Ochra x Phobos(MARS iso)"}},
  {"code":"SL185","genus":"Psilocybe","species":"cubensis","cultivar":"Blue Meanies","origin":"","vendor":"BAKON","family":"","notes":"US Landrace Cube - Bakon has not fruited, so needs a proof","ingestData":{"vendor":"BAKON","originator":"","family":"","notes":"US Landrace Cube - Bakon has not fruited, so needs a proof"}},
  {"code":"SL186","genus":"Psilocybe","species":"cubensis","cultivar":"El Dragon","origin":"Fungus Frequency","vendor":"BAKON","family":"PE, B+","notes":"Gidorah x El Choco","ingestData":{"vendor":"BAKON","originator":"Fungus Frequency","family":"PE, B+","notes":"Gidorah x El Choco"}},
  {"code":"SL187","genus":"Psilocybe","species":"cubensis","cultivar":"Machine Elf","origin":"Basidium Equlibrium","vendor":"Basidium Equlibrium","family":"PE x Peru","notes":"Created through anastomosis between Penis Envy Uncut (PEU) and a wild Peruvian leucistic variety","ingestData":{"vendor":"Basidium Equlibrium","originator":"Basidium Equlibrium","family":"PE x Peru","notes":"Created through anastomosis between Penis Envy Uncut (PEU) and a wild Peruvian leucistic variety"}},
  {"code":"SL188","genus":"Psilocybe","species":"ochraceocentrata","cultivar":"MFH Ochra","origin":"Mana From Heavan","vendor":"Basidium Equlibrium","family":"Ochraceocentrata","notes":"","ingestData":{"vendor":"Basidium Equlibrium","originator":"Mana From Heavan","family":"Ochraceocentrata","notes":""}},
  {"code":"SL189","genus":"Psilocybe","species":"cubensis","cultivar":"Penis Envy Uncut","origin":"Workman","vendor":"Basidium Equlibrium","family":"Penis Envy","notes":"Sporeless or close. Green hues","ingestData":{"vendor":"Basidium Equlibrium","originator":"Workman","family":"Penis Envy","notes":"Sporeless or close. Green hues"}},
  {"code":"SL190","genus":"Psilocybe","species":"cubensis","cultivar":"Rusty White","origin":"Basidium Equlibrium","vendor":"Basidium Equlibrium","family":"","notes":"","ingestData":{"vendor":"Basidium Equlibrium","originator":"Basidium Equlibrium","family":"","notes":""}},
  {"code":"SL191","genus":"Psilocybe","species":"cubensis","cultivar":"Bluey Vuitton","origin":"Basidium Equlibrium","vendor":"Basidium Equlibrium","family":"","notes":"","ingestData":{"vendor":"Basidium Equlibrium","originator":"Basidium Equlibrium","family":"","notes":""}},
  {"code":"SL192","genus":"Psilocybe","species":"cubensis","cultivar":"Enigma","origin":"Basidium Equlibrium","vendor":"Basidium Equlibrium","family":"Tidal Wave x PE","notes":"","ingestData":{"vendor":"Basidium Equlibrium","originator":"Basidium Equlibrium","family":"Tidal Wave x PE","notes":""}},
  {"code":"SL193","genus":"Psilocybe","species":"cubensis","cultivar":"Cabo Amarillo","origin":"Basidium Equlibrium","vendor":"Basidium Equlibrium","family":"Landrace","notes":"Low Spore Puerto Rico","ingestData":{"vendor":"Basidium Equlibrium","originator":"Basidium Equlibrium","family":"Landrace","notes":"Low Spore Puerto Rico"}},
  {"code":"SL194","genus":"Psilocybe","species":"cubensis","cultivar":"Iceberg","origin":"Basidium Equlibrium","vendor":"Basidium Equlibrium","family":"","notes":"","ingestData":{"vendor":"Basidium Equlibrium","originator":"Basidium Equlibrium","family":"","notes":""}},
  {"code":"SL196","genus":"Psilocybe","species":"cubensis","cultivar":"Fae Portal Cube","origin":"Rog","vendor":"Some Guys Fungi","family":"Landrace","notes":"has iNat - collected 2025 - Xalapa, Vera Cruz","ingestData":{"vendor":"Some Guys Fungi","originator":"Rog","family":"Landrace","notes":"has iNat - collected 2025 - Xalapa, Vera Cruz"}},
  {"code":"SL199","genus":"Psilocybe","species":"cubensis","cultivar":"Green Cap Ochraceocentrata","origin":"UNK","vendor":"Telly Myco","family":"","notes":"","ingestData":{"vendor":"Telly Myco","originator":"UNK","family":"","notes":""}},
  {"code":"SL200","genus":"Psilocybe","species":"cubensis","cultivar":"Paja Crown","origin":"Fungus Frequency","vendor":"Telly Myco","family":"","notes":"","ingestData":{"vendor":"Telly Myco","originator":"Fungus Frequency","family":"","notes":""}},
  {"code":"SL201","genus":"Psilocybe","species":"cubensis","cultivar":"Jack Frost 2.0","origin":"Legends Mycology","vendor":"Telly Myco","family":"","notes":"","ingestData":{"vendor":"Telly Myco","originator":"Legends Mycology","family":"","notes":""}},
  {"code":"SL202","genus":"Psilocybe","species":"cubensis","cultivar":"Creature","origin":"Legends Mycology","vendor":"Telly Myco","family":"","notes":"","ingestData":{"vendor":"Telly Myco","originator":"Legends Mycology","family":"","notes":""}},
  {"code":"SL203","genus":"Psilocybe","species":"cubensis","cultivar":"El Dragon","origin":"Fungus Frequency","vendor":"Telly Myco","family":"PE, B+","notes":"Gidorah x El Choco","ingestData":{"vendor":"Telly Myco","originator":"Fungus Frequency","family":"PE, B+","notes":"Gidorah x El Choco"}},
  {"code":"SL204","genus":"Psilocybe","species":"cubensis","cultivar":"Purple Mystic","origin":"","vendor":"Telly Myco","family":"","notes":"","ingestData":{"vendor":"Telly Myco","originator":"","family":"","notes":""}},
  {"code":"SL205","genus":"Psilocybe","species":"cubensis","cultivar":"ABV","origin":"Travis Tyler Fluck","vendor":"viakate","family":"TAT, Melmac, Panama","notes":"possible Psilly Simon - creator of Shiva Lingam","ingestData":{"vendor":"viakate","originator":"Travis Tyler Fluck","family":"TAT, Melmac, Panama","notes":"possible Psilly Simon - creator of Shiva Lingam"}},
  {"code":"SL206","genus":"Psilocybe","species":"cubensis","cultivar":"Blue Meanies","origin":"Travis Tyler Fluck","vendor":"viakate","family":"","notes":"possible Psilly Simon - creator of Shiva Lingam","ingestData":{"vendor":"viakate","originator":"Travis Tyler Fluck","family":"","notes":"possible Psilly Simon - creator of Shiva Lingam"}}];
  /*__END_SEED__*/
  function seedGenetics() {
    try {
      const u = currentUser();
      if (!u || !SEED_GENETICS.length) return;
      const K = keysFor(u);
      const existing = storage.read(K.genetics, []) || [];
      if (existing.length) return;
      const now = nowISO();
      storage.write(K.genetics, SEED_GENETICS.map(g => ({
        _id: newId(), cat: 'actives', createdAt: now, updatedAt: now,
        _fromSeed: true, ...g,
      })));
    } catch (_) {}
  }

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
    claimPassword(u, pw) { return claimPassword(u, pw); },
    // Username + password via real auth (synthetic email). mode: 'login'|'signup'.
    async login(name, password, mode) {
      const u = String(name || '').trim();   // keep exact case (e.g. "pSi:L")
      if (!u) return { ok: false, reason: 'empty' };
      if (!String(password || '')) return { ok: false, reason: 'empty_pass' };
      let res;
      try {
        res = (mode === 'signup') ? await signUp(u, String(password)) : await signIn(u, String(password));
      } catch (_) {
        // Supabase unreachable (network error) — emergency offline entry.
        // The user's data lives locally under their namespace; let them in
        // on it. Password can't be verified offline; anyone at this device
        // could already read localStorage, so nothing new is exposed. A real
        // login (and sync) happens next time Supabase answers.
        localStorage.setItem(USER_KEY, u);
        saveToken({ access_token: 'offline', refresh_token: '', username: u, uid: '', expires_at: 0 });
        res = { ok: true, isNew: false, offline: true };
      }
      if (!res.ok) return res;                 // { reason: taken|bad_creds|weak_pass|... }
      const imp = importLegacyForUser(u);       // session already persisted by signUp/signIn
      seedGenetics();
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

  seedGenetics();   // covers the already-logged-in load path (boot skips login)

  window.db = { genetics, lots, lineage, config, form, session, sync, _keys: KEYS };
})();
