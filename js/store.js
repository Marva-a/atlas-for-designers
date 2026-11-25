// Your saved data: settings and your progress in each domain, in one JSON document in this browser's
// localStorage. Course text is never stored here; it is loaded from content/domains/<id>/ when needed.
//
// Nothing leaves your device unless you turn on sync (sync.js), which uploads only an encrypted copy of your
// progress (see sync-state.js).
//
// AppData {
//   schemaVersion: 1, app: 'atlas-for-designers',
//   settings: { theme: 'system' | 'light' | 'dark', hideVisuals: boolean, lastDomain: string | null, lastExportedAt: ISO | null },
//   progress: { [domainId]: Progress },   // see emptyCert() in cert-logic.js
// }
import { emptyCert } from './cert-logic.js';
import { viewSnapshot, stampChanges, emptyMeta, toState, applyState } from './sync-state.js';

export const SCHEMA_VERSION = 1;
export const APP_ID = 'atlas-for-designers';
export const STORAGE_KEY = 'atlas-for-designers:data';
export const BACKUP_KEY = 'atlas-for-designers:backup-before-import';
export const SYNC_META_KEY = 'atlas-for-designers:sync-meta';
const ID_RE = /^[a-z0-9-]{1,40}$/;

const defaultSettings = () => ({ theme: 'system', hideVisuals: false, lastDomain: null, lastExportedAt: null });
const emptyData = () => ({ schemaVersion: SCHEMA_VERSION, app: APP_ID, settings: defaultSettings(), progress: {} });

let data = emptyData();
let syncMeta = emptyMeta();
let syncBase = null;
export let storageAvailable = true;

function readKey(key) {
  try { return localStorage.getItem(key); } catch { storageAvailable = false; return null; }
}
function writeKey(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { storageAvailable = false; return false; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Fills in anything missing, so older or partial documents still work. */
function normalizeProgress(p) {
  const base = emptyCert();
  const out = { ...base, ...(isObj(p) ? p : {}) };
  for (const k of ['lessons', 'labs', 'q', 'pbq', 'extraWeeks', 'design']) if (!isObj(out[k])) out[k] = {};
  for (const k of ['reviews', 'exams']) if (!Array.isArray(out[k])) out[k] = [];
  return out;
}
function normalize(raw) {
  const out = emptyData();
  out.settings = { ...out.settings, ...(isObj(raw?.settings) ? raw.settings : {}) };
  for (const [id, p] of Object.entries(isObj(raw?.progress) ? raw.progress : {})) {
    if (ID_RE.test(id)) out.progress[id] = normalizeProgress(p);
  }
  return out;
}

export function load() {
  const text = readKey(STORAGE_KEY);
  if (text) {
    try {
      data = normalize(JSON.parse(text));
    } catch {
      writeKey(`${STORAGE_KEY}:corrupt-${Date.now()}`, text); // keep a copy rather than overwrite it
      data = emptyData();
    }
  }
  try {
    const m = JSON.parse(readKey(SYNC_META_KEY) ?? 'null');
    syncMeta = m && isObj(m.t) && isObj(m.del) ? m : emptyMeta();
  } catch { syncMeta = emptyMeta(); }
  syncBase = viewSnapshot(data);
  return data;
}

const saveListeners = new Set();
/** Runs `fn` after each successful save (sync uses this to upload changes). */
export function onSave(fn) { saveListeners.add(fn); }

function stampSync() {
  if (!syncBase) return;
  const next = viewSnapshot(data);
  stampChanges(syncBase, next, syncMeta, Date.now());
  syncBase = next;
  writeKey(SYNC_META_KEY, JSON.stringify(syncMeta));
}

function persist() {
  stampSync();
  const ok = writeKey(STORAGE_KEY, JSON.stringify(data));
  if (ok) for (const fn of saveListeners) { try { fn(); } catch { /* a listener must never stop a save */ } }
  return ok;
}

export const getData = () => data;
export const getSettings = () => data.settings;
export function updateSettings(patch) {
  data.settings = { ...data.settings, ...patch };
  persist();
  return data.settings;
}

/** Your progress in one domain, created the first time you open it. Views change it in place, then call saveProgress(). */
export function getProgress(domainId) {
  if (!ID_RE.test(domainId)) throw new Error(`Not a domain id: ${domainId}`);
  data.progress[domainId] ??= emptyCert();
  return data.progress[domainId];
}
export const saveProgress = () => persist();

/** How much you have done in each domain, for the home page. */
export function progressSummary(domainId) {
  const p = data.progress[domainId];
  return { lessons: p ? Object.keys(p.lessons).length : 0, started: Boolean(p && (Object.keys(p.lessons).length || Object.keys(p.q).length)) };
}

// ─── Export and import ───────────────────────────────────────────────────────

export function exportJson() {
  data.settings.lastExportedAt = new Date().toISOString();
  persist();
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 1);
}

/** Checks a backup file without changing anything. Returns { ok, doc, summary } or { ok: false, problems }. */
export function parseImport(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, problems: ['This file is not valid JSON.'] }; }
  if (!isObj(raw) || raw.app !== APP_ID) return { ok: false, problems: ['This file was not exported from Atlas for Designers.'] };
  if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion > SCHEMA_VERSION) return { ok: false, problems: ['This file is from a newer version of Atlas for Designers. Reload the app to update it, then try again.'] };
  const doc = normalize(raw);
  const domains = Object.keys(doc.progress);
  const lessons = domains.reduce((n, d) => n + Object.keys(doc.progress[d].lessons).length, 0);
  return { ok: true, doc, summary: { domains, lessons, exportedAt: raw.exportedAt ?? null } };
}

/** Replaces all data with an imported document, keeping a backup of the current data first. */
export function replaceWithImport(parsed) {
  if (!writeKey(BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data }))) {
    return { ok: false, problems: ['Could not save a backup of your current data, so nothing was replaced.'] };
  }
  data = parsed.doc;
  persist();
  return { ok: true };
}

export function getBackupInfo() {
  try {
    const b = JSON.parse(readKey(BACKUP_KEY) ?? 'null');
    return b ? { savedAt: b.savedAt } : null;
  } catch { return null; }
}

export function restoreBackup() {
  try {
    const b = JSON.parse(readKey(BACKUP_KEY) ?? 'null');
    if (!b) return { ok: false, problems: ['There is no backup to restore.'] };
    const current = data;
    data = normalize(b.data);
    writeKey(BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: current }));
    persist();
    return { ok: true };
  } catch {
    return { ok: false, problems: ['The backup could not be read.'] };
  }
}

// ─── Sync ────────────────────────────────────────────────────────────────────

/** Your progress in every domain, with change times and tombstones, ready to merge or upload. */
export function getSyncState() {
  stampSync();
  return toState(data, syncMeta, SCHEMA_VERSION);
}

/** Takes in a merged state from sync. An exam you are sitting right now, and your settings, stay as they are. */
export function applySyncState(state) {
  data = normalize(applyState(data, state));
  syncMeta = { t: JSON.parse(JSON.stringify(state.t)), del: JSON.parse(JSON.stringify(state.del)) };
  syncBase = viewSnapshot(data);
  writeKey(SYNC_META_KEY, JSON.stringify(syncMeta));
  return persist();
}
