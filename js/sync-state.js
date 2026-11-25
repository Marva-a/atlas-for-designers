// Sync state: what is shared between your devices, and how two copies are merged.
//
// Pure functions only (no storage, no network), so the rules can be checked with `node js/sync-selftest.js`.
//
// What syncs: your progress in every domain (lessons done, labs, question history, reviews, practice exam
// results, performance-based practice, design work and extended weeks). What does not: your settings, such as
// the theme, and a practice exam you are sitting right now.
//
// Every shared item has a path, "p:<domain>:<part>", and a key (its id). Paths are discovered from the data,
// so a new domain syncs without any change here. The merge keeps, for each key, the most recent change on
// either device. A deletion is remembered as a tombstone with its time, so a device that still has the item
// does not bring it back.

export const SYNC_FORMAT = 'atlas-for-designers-sync';
export const SYNC_FORMAT_VERSION = 1;
/** Tombstones older than this are forgotten; a device offline for longer may bring a deleted item back. */
export const TOMBSTONE_DAYS = 400;

const MAPS = ['lessons', 'labs', 'q', 'pbq', 'extraWeeks', 'design'];
const LOGS = {
  reviews: (r) => (r && r.obj != null && r.at != null ? `${r.obj}|${r.at}` : null),
  exams: (e) => (e && e.id != null && e.at != null ? `${e.id}|${e.at}` : null),
};
const PATH_RE = /^p:([a-z0-9-]{1,40}):([a-zA-Z]+)$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const pathOf = (domain, part) => `p:${domain}:${part}`;

/** JSON with keys in a fixed order, so equal values always give equal text on every device. */
export function stableStringify(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** The shared part of an app document: { path: { key: value } }. */
export function syncView(doc) {
  const out = {};
  for (const [domain, p] of Object.entries(isObj(doc?.progress) ? doc.progress : {})) {
    if (!isObj(p)) continue;
    for (const part of MAPS) {
      const m = {};
      for (const [k, v] of Object.entries(isObj(p[part]) ? p[part] : {})) if (v !== undefined) m[k] = v;
      out[pathOf(domain, part)] = m;
    }
    for (const [part, keyOf] of Object.entries(LOGS)) {
      const m = {};
      for (const r of Array.isArray(p[part]) ? p[part] : []) {
        const k = keyOf(r);
        if (k) m[k] = r;
      }
      out[pathOf(domain, part)] = m;
    }
  }
  return out;
}

/** The shared part as text, { path: { key: JSON } }, so changes made in place are still noticed. */
export function viewSnapshot(doc) {
  const out = {};
  for (const [path, m] of Object.entries(syncView(doc))) {
    out[path] = {};
    for (const [k, v] of Object.entries(m)) out[path][k] = stableStringify(v);
  }
  return out;
}

export function emptyMeta() {
  return { t: {}, del: {} };
}

/** Records what changed between two snapshots, at time `now` (ms). Mutates and returns `meta`. */
export function stampChanges(prev, next, meta, now) {
  meta.t ??= {};
  meta.del ??= {};
  for (const path of new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])) {
    const a = prev?.[path] ?? {};
    const b = next?.[path] ?? {};
    for (const k of Object.keys(b)) {
      if (!own(a, k) || a[k] !== b[k]) {
        (meta.t[path] ??= {})[k] = now;
        if (meta.del[path]) delete meta.del[path][k];
      }
    }
    for (const k of Object.keys(a)) {
      if (!own(b, k)) {
        (meta.del[path] ??= {})[k] = now;
        if (meta.t[path]) delete meta.t[path][k];
      }
    }
  }
  return meta;
}

/** The shareable state of a document: what is uploaded (encrypted) and merged. */
export function toState(doc, meta, schemaVersion) {
  const entries = syncView(doc);
  const t = {};
  const del = {};
  for (const path of Object.keys(entries)) {
    t[path] = {};
    for (const k of Object.keys(entries[path])) if (meta?.t?.[path]?.[k] != null) t[path][k] = meta.t[path][k];
  }
  for (const [path, gone] of Object.entries(meta?.del ?? {})) {
    for (const [k, at] of Object.entries(gone)) {
      if (!entries[path] || !own(entries[path], k)) (del[path] ??= {})[k] = at;
    }
  }
  return { format: SYNC_FORMAT, v: SYNC_FORMAT_VERSION, schemaVersion, entries, t, del };
}

/** Is this a well-formed state from another device? Returns a list of problems (empty = fine). */
export function stateProblems(state) {
  if (!isObj(state) || state.format !== SYNC_FORMAT) return ['This is not Atlas for Designers sync data.'];
  if (state.v !== SYNC_FORMAT_VERSION) return [`The synced copy uses format ${String(state.v).slice(0, 8)}, which this version does not know. Reload the app on every device to update it.`];
  for (const part of ['entries', 't', 'del']) if (!isObj(state[part])) return [`The synced copy is missing "${part}".`];
  for (const [path, m] of Object.entries(state.entries)) if (!PATH_RE.test(path) || !isObj(m)) return [`The synced copy has a broken part "${String(path).slice(0, 40)}".`];
  return [];
}

/** When an item last changed, for items with no recorded change time. Uses its own timestamps. 0 = unknown. */
export function fallbackTime(v) {
  if (typeof v === 'number' && v > 1e11) return v;
  if (!isObj(v)) return 0;
  for (const f of ['updatedAt', 'at', 'createdAt']) {
    const x = v[f];
    if (typeof x === 'number' && x > 1e11) return x;
    if (typeof x === 'string') {
      const ms = Date.parse(x);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return 0;
}

function isEmptyValue(v) {
  if (v === null || v === undefined || v === '' || v === false || v === 0) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isObj(v)) return Object.keys(v).length === 0;
  return false;
}

/** Picks between two versions of the same item. Same answer on every device, whichever is "local". */
function pick(x, y) {
  if (x.time !== y.time) return x.time > y.time ? x : y;
  const ex = isEmptyValue(x.value);
  const ey = isEmptyValue(y.value);
  if (ex !== ey) return ex ? y : x;
  return x.text >= y.text ? x : y;
}

/** Merges two states. The result is the same in either order, and merging again changes nothing. */
export function mergeStates(a, b, now = Date.now()) {
  const out = { format: SYNC_FORMAT, v: SYNC_FORMAT_VERSION, schemaVersion: Math.max(a?.schemaVersion ?? 0, b?.schemaVersion ?? 0), entries: {}, t: {}, del: {} };
  const forgetBefore = now - TOMBSTONE_DAYS * 86400000;
  const side = (s, path, k) => {
    const e = s?.entries?.[path];
    if (!e || !own(e, k)) return null;
    const value = e[k];
    const recorded = s.t?.[path]?.[k];
    return { value, time: typeof recorded === 'number' ? recorded : fallbackTime(value), text: stableStringify(value) };
  };
  const paths = new Set([...Object.keys(a?.entries ?? {}), ...Object.keys(b?.entries ?? {}), ...Object.keys(a?.del ?? {}), ...Object.keys(b?.del ?? {})]);
  for (const path of paths) {
    if (!PATH_RE.test(path)) continue;
    const keys = new Set([
      ...Object.keys(a?.entries?.[path] ?? {}), ...Object.keys(b?.entries?.[path] ?? {}),
      ...Object.keys(a?.del?.[path] ?? {}), ...Object.keys(b?.del?.[path] ?? {}),
    ]);
    for (const k of keys) {
      const x = side(a, path, k);
      const y = side(b, path, k);
      const da = a?.del?.[path]?.[k];
      const db = b?.del?.[path]?.[k];
      const deletedAt = Math.max(typeof da === 'number' ? da : -1, typeof db === 'number' ? db : -1);
      const win = x && y ? pick(x, y) : (x ?? y);
      if (win && win.time > deletedAt) {
        (out.entries[path] ??= {})[k] = win.value;
        if (win.time > 0) (out.t[path] ??= {})[k] = win.time;
      } else if (deletedAt >= forgetBefore) {
        (out.del[path] ??= {})[k] = deletedAt;
      }
    }
    out.entries[path] ??= {};
  }
  return out;
}

function applyList(local, merged, keyOf) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(local) ? local : []) {
    const k = keyOf(r);
    if (k == null) continue;
    if (own(merged, k) && !seen.has(k)) { out.push(merged[k]); seen.add(k); }
  }
  for (const [k, v] of Object.entries(merged)) if (!seen.has(k)) { out.push(v); seen.add(k); }
  return out;
}

/** A copy of `doc` with every domain's progress replaced by `state`. Settings and an exam in progress stay as they are. */
export function applyState(doc, state) {
  const out = { ...doc, progress: { ...(isObj(doc.progress) ? doc.progress : {}) } };
  const domains = new Set(Object.keys(out.progress));
  for (const path of Object.keys(state.entries)) {
    const m = path.match(PATH_RE);
    if (m) domains.add(m[1]);
  }
  for (const domain of domains) {
    const local = isObj(out.progress[domain]) ? out.progress[domain] : {};
    const p = { ...local };
    for (const part of MAPS) {
      const merged = state.entries[pathOf(domain, part)];
      if (merged) p[part] = { ...merged };
    }
    for (const [part, keyOf] of Object.entries(LOGS)) {
      const merged = state.entries[pathOf(domain, part)];
      if (merged) p[part] = applyList(local[part], merged, keyOf);
    }
    out.progress[domain] = p;
  }
  return out;
}

/** True when two states hold the same items, change times and tombstones (so nothing needs uploading). */
export function sameState(a, b) {
  const clean = (s) => {
    const e = {};
    for (const [p, m] of Object.entries(s.entries)) if (Object.keys(m).length) e[p] = m;
    const t = {};
    for (const [p, m] of Object.entries(s.t)) if (Object.keys(m).length) t[p] = m;
    const d = {};
    for (const [p, m] of Object.entries(s.del)) if (Object.keys(m).length) d[p] = m;
    return stableStringify({ e, t, d });
  };
  return clean(a) === clean(b);
}
