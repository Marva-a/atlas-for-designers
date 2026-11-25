// Atlas for Designers: the app shell. Routes, the home page (choose a domain), Settings, and event wiring.
// Every domain's pages come from domain.js. Views are plain HTML strings; events use delegation on <main>.
import * as store from './store.js';
import { esc, announce, plural, downloadFile, linkHtml, nav } from './ui.js';
import { domainView, domainActions, handleDomainChange, handlePbqChange, setDomainRefresh } from './domain.js';
import { visualActions, setVisualsRefresh } from './visuals.js';
import * as sync from './sync.js';
import { syncPanelHtml, refreshSyncPanel, syncActions, submitSyncJoin, submitSyncEnter, receivePairingLink, setSyncRefresh } from './sync-ui.js';

export const REPO_URL = 'https://github.com/Marva-a/atlas-for-designers';
const mainEl = document.getElementById('main');
const STATUS_LABELS = { complete: 'Complete', beta: 'Beta', draft: 'Draft', example: 'Example' };

let route = { name: 'home' };
let registry; // content/domains.json once loaded
let registryFailed = false;
const ui = { importPreview: null, importProblems: [], dataMessage: '' };

// ─── Domain registry ─────────────────────────────────────────────────────────

function loadRegistry() {
  if (registry !== undefined) return;
  registry = null;
  fetch('content/domains.json')
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((doc) => { registry = doc.domains; registryFailed = false; render(); })
    .catch(() => { registry = undefined; registryFailed = true; render(); });
}

// ─── Home: choose a domain ───────────────────────────────────────────────────

function domainCard(d) {
  const p = store.progressSummary(d.id);
  const pct = d.lessons ? Math.round((p.lessons / d.lessons) * 100) : 0;
  return `
    <article class="card afd-domain" aria-labelledby="dom-${esc(d.id)}">
      <p class="afd-domain__meta"><span class="afd-badge afd-badge--${esc(d.status)}">${esc(STATUS_LABELS[d.status] ?? d.status)}</span> ${plural(d.lessons, 'lesson', 'lessons')} · ${plural(d.weeks, 'week', 'weeks')} · about ${d.hours} hours${d.hasExams ? ' · practice exams' : ''}${d.cases ? ` · ${plural(d.cases, 'case study', 'case studies')}` : ''}</p>
      <h2 id="dom-${esc(d.id)}">${esc(d.title)}</h2>
      <p>${esc(d.tagline)}</p>
      <p class="meta"><strong>For:</strong> ${esc(d.audience)}</p>
      ${p.started ? `<div class="progress cert-bar" role="img" aria-label="${pct}% of lessons complete"><span style="width:${pct}%"></span></div><p class="meta">${p.lessons} of ${d.lessons} lessons complete</p>` : ''}
      <div class="button-row"><a class="button ${p.started ? 'button--primary' : ''}" href="#d/${esc(d.id)}">${p.started ? 'Continue' : 'Explore'}<span class="visually-hidden"> ${esc(d.title)}</span></a></div>
    </article>`;
}

function homeView() {
  loadRegistry();
  if (!registry) {
    return registryFailed
      ? '<h1 id="day-heading" tabindex="-1">Could not load the domains</h1><p>Check your connection, then <button type="button" data-action="registry-retry">try again</button>.</p>'
      : '<h1 id="day-heading" tabindex="-1">Loading…</h1>';
  }
  const last = registry.find((d) => d.id === store.getSettings().lastDomain);
  const learnable = registry.filter((d) => d.status !== 'example');
  const examples = registry.filter((d) => d.status === 'example');
  return `
    <section class="afd-hero">
      <h1 id="day-heading" tabindex="-1">Learn the domain behind the product</h1>
      <p class="lesson-summary">Free lessons that pair real domain knowledge with product design practice: concepts, hands-on labs, design exercises and portfolio case studies.</p>
      ${last ? `<div class="button-row"><a class="button button--primary" href="#d/${esc(last.id)}">Continue ${esc(last.title)}</a></div>` : ''}
    </section>
    <h2 class="small-label lessons-week">Domains</h2>
    <div class="afd-domains">${learnable.map(domainCard).join('')}</div>
    <section class="card afd-contribute" aria-labelledby="contribute-heading">
      <h2 id="contribute-heading">Know a domain well?</h2>
      <p>Atlas for Designers is developed in the open. Domain experts write and review domains; designers shape the design practice in each one. Every lesson follows the same format and passes the same checks, and AI-assisted drafts are always reviewed by a named expert.</p>
      <div class="button-row">${linkHtml(`${REPO_URL}/blob/main/CONTRIBUTING.md`, 'How to contribute')} ${examples.map((d) => `<a href="#d/${esc(d.id)}">${esc(d.title)}</a>`).join(' ')}</div>
    </section>
    <p class="meta">Your progress stays on this device unless you turn on <a href="#settings">sync</a>, which uploads only an encrypted copy that only your devices can unlock. No account, no tracking.</p>`;
}

// ─── Settings ────────────────────────────────────────────────────────────────

const when = (iso) => new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

function settingsView() {
  const s = store.getSettings();
  const d = store.getData();
  const domains = Object.keys(d.progress);
  const lessons = domains.reduce((n, id) => n + Object.keys(d.progress[id].lessons).length, 0);
  const backup = store.getBackupInfo();
  const preview = ui.importPreview;
  const theme = (value, label) => `<label class="afd-radio"><input type="radio" name="theme" value="${value}" data-setting="theme" ${s.theme === value ? 'checked' : ''}> ${label}</label>`;
  return `
    <h1 id="day-heading" tabindex="-1">Settings</h1>
    ${syncPanelHtml()}
    <section class="card" aria-labelledby="data-heading">
      <h2 id="data-heading">Your data</h2>
      <p>${sync.isOn()
    ? '<strong>Synced.</strong> Your progress is saved on this device, and an encrypted copy that only your devices can unlock keeps your other devices up to date.'
    : '<strong>On this device only.</strong> Your progress is saved in this browser and nothing is sent anywhere. Clearing site data, or using another browser, starts empty, so download a backup now and then or turn on sync.'}</p>
      <p class="meta">Saved now: progress in ${plural(domains.length, 'domain', 'domains')}, ${plural(lessons, 'lesson', 'lessons')} complete. Last backup file: ${s.lastExportedAt ? esc(when(s.lastExportedAt)) : 'never'}.</p>
      ${ui.dataMessage ? `<p class="status-ok" id="data-message" tabindex="-1">${esc(ui.dataMessage)}</p>` : ''}
      <div class="button-row"><button type="button" class="button--primary" data-action="export">Download a backup file (.json)</button></div>
      <h3>Restore from a backup file</h3>
      <div class="field">
        <label for="import-file">Choose a backup file (.json)</label>
        <input type="file" id="import-file" accept="application/json,.json" aria-describedby="import-hint">
        <span class="hint" id="import-hint">You'll see what's in the file and confirm before anything is replaced.</span>
      </div>
      ${ui.importProblems.length ? `<div class="error-summary" role="alert" tabindex="-1" id="import-errors"><ul>${ui.importProblems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
      ${preview ? `
        <div class="note note--gate" id="import-preview" tabindex="-1" role="region" aria-label="Import preview">
          <p><strong>Ready to import.</strong> The file has progress in ${plural(preview.summary.domains.length, 'domain', 'domains')} (${plural(preview.summary.lessons, 'lesson', 'lessons')} complete)${preview.summary.exportedAt ? `, exported ${esc(when(preview.summary.exportedAt))}` : ''}.</p>
          <p><strong>Importing replaces all your current data.</strong> A copy is kept in this browser, and you can undo it below.</p>
          ${sync.isOn() ? '<p><strong>Sync is on,</strong> so this file also becomes your progress on your other devices.</p>' : ''}
          <div class="button-row"><button type="button" class="button--danger" data-action="import-confirm">Replace my data with this file</button><button type="button" data-action="import-cancel">Cancel</button></div>
        </div>` : ''}
      ${backup ? `<h3>Undo the last import</h3><p class="meta">Saved ${esc(when(backup.savedAt))}.</p><button type="button" data-action="restore-backup">Restore data from before the last import</button>` : ''}
    </section>
    <section class="card" aria-labelledby="theme-heading">
      <h2 id="theme-heading">Appearance</h2>
      <fieldset class="afd-fieldset"><legend>Theme</legend>${theme('system', 'Match this device')}${theme('light', 'Light')}${theme('dark', 'Dark')}</fieldset>
      <label class="afd-radio"><input type="checkbox" data-setting="hideVisuals" ${s.hideVisuals ? 'checked' : ''}> Hide lesson visuals and diagrams (their descriptions stay as text)</label>
    </section>
    <section class="card" aria-labelledby="about-heading">
      <h2 id="about-heading">About</h2>
      <p>Atlas for Designers is developed in the open. Copyright (c) 2026 Marva Abouei; an open licence for the code and content is still being decided. ${linkHtml(REPO_URL, 'Source code and contribution guide')}.</p>
    </section>`;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function applyTheme() {
  const t = store.getSettings().theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function parseRoute() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const pair = h.match(/^pair\/(.*)$/);
  if (pair) {
    // A pairing link from another of your devices: keep the code for the confirm step, and take it out of the address bar.
    receivePairingLink(pair[1]);
    history.replaceState(null, '', '#settings');
    nav.focus = '#sync-pair-confirm, #sync-heading';
    return { name: 'settings' };
  }
  if (h === 'settings' || h.startsWith('settings/')) return { name: 'settings' };
  const d = h.match(/^d\/([a-z0-9-]{1,40})(?:\/(.*))?$/);
  if (d) return { name: 'domain', id: d[1], section: d[2] ?? '' };
  return { name: 'home' };
}

let syncRenderPending = false;
function render({ focus } = {}) {
  syncRenderPending = false;
  const activeId = document.activeElement?.id;
  applyTheme();
  document.querySelectorAll('[data-route]').forEach((a) => {
    if (a.dataset.route === route.name || (route.name === 'domain' && a.dataset.route === 'home')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (route.name === 'domain') {
    if (store.getSettings().lastDomain !== route.id) store.updateSettings({ lastDomain: route.id });
    mainEl.innerHTML = domainView(route.id, route.section);
  } else if (route.name === 'settings') {
    mainEl.innerHTML = settingsView();
  } else {
    mainEl.innerHTML = homeView();
  }
  const h1 = mainEl.querySelector('h1');
  document.title = h1 && route.name !== 'home' ? `${h1.textContent.trim()} · Atlas for Designers` : 'Atlas for Designers';
  const target = focus
    ? focus.split(',').map((sel) => document.querySelector(sel.trim())).find(Boolean)
    : activeId ? document.getElementById(activeId) : null;
  target?.focus();
}

// Changes from another device arrive in the background. Redraw to show them, but never while you are typing.
const EDITING = 'input, textarea, select, [contenteditable="true"]';
function renderAfterSync() {
  const a = document.activeElement;
  if (a && mainEl.contains(a) && a.matches(EDITING)) { syncRenderPending = true; return; }
  render();
}
mainEl.addEventListener('focusout', () => {
  if (!syncRenderPending) return;
  setTimeout(() => {
    const a = document.activeElement;
    if (!syncRenderPending || (a && mainEl.contains(a) && a.matches(EDITING))) return;
    render();
  }, 0);
});

// ─── Events ──────────────────────────────────────────────────────────────────

const actions = {
  'registry-retry': () => { registry = undefined; registryFailed = false; render({ focus: '#day-heading' }); },
  export: () => {
    downloadFile(`atlas-for-designers-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson());
    ui.dataMessage = 'Backup file downloaded.';
    announce(ui.dataMessage);
    render({ focus: '#data-message' });
  },
  'import-confirm': () => {
    const result = store.replaceWithImport(ui.importPreview);
    ui.importPreview = null;
    if (!result.ok) { ui.importProblems = result.problems; render({ focus: '#import-errors' }); return; }
    ui.dataMessage = 'Import complete. Your previous data is kept as a backup below.';
    announce(ui.dataMessage);
    render({ focus: '#data-message' });
  },
  'import-cancel': () => { ui.importPreview = null; announce('Import cancelled. Nothing was changed.'); render({ focus: '#import-file' }); },
  'restore-backup': () => {
    const r = store.restoreBackup();
    ui.dataMessage = r.ok ? 'Restored your data from before the last import.' : r.problems.join(' ');
    announce(ui.dataMessage);
    render({ focus: '#data-message' });
  },
};

mainEl.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const name = el.dataset.action;
  if (actions[name]) { actions[name](el); return; }
  const handler = domainActions[name] ?? visualActions[name] ?? syncActions[name];
  if (!handler) return;
  const focus = handler(el);
  render(focus ? { focus } : {});
});

mainEl.addEventListener('change', (e) => {
  if (handleDomainChange(e) || handlePbqChange(e)) return;
  const t = e.target;
  if (t.dataset?.setting === 'theme') { store.updateSettings({ theme: t.value }); applyTheme(); announce('Theme changed.'); return; }
  if (t.dataset?.setting === 'hideVisuals') { store.updateSettings({ hideVisuals: t.checked }); announce(t.checked ? 'Visuals hidden.' : 'Visuals shown.'); return; }
  if (t.id === 'import-file' && t.files?.[0]) {
    t.files[0].text().then((text) => {
      const parsed = store.parseImport(text);
      ui.importProblems = parsed.ok ? [] : parsed.problems;
      ui.importPreview = parsed.ok ? parsed : null;
      render({ focus: parsed.ok ? '#import-preview' : '#import-errors' });
    });
  }
});

mainEl.addEventListener('submit', (e) => {
  if (e.target.id === 'sync-join-form') {
    e.preventDefault();
    render({ focus: submitSyncJoin(e.target) });
  } else if (e.target.id === 'sync-enter-form') {
    e.preventDefault();
    const focus = submitSyncEnter(e.target);
    render(focus ? { focus } : {});
  }
});

window.addEventListener('hashchange', () => {
  route = parseRoute();
  ui.dataMessage = '';
  const focus = nav.focus ?? '#day-heading';
  nav.focus = null;
  render({ focus });
  window.scrollTo(0, 0);
});

// ─── Start ───────────────────────────────────────────────────────────────────

store.load();
setDomainRefresh(() => { if (route.name === 'domain') render(); });
setVisualsRefresh(() => { if (route.name === 'domain') render(); });
sync.onStatusChange(refreshSyncPanel);
sync.onDataChanged(renderAfterSync);
setSyncRefresh((focus) => { if (route.name === 'settings') render({ focus }); else refreshSyncPanel(); });
sync.start();
route = parseRoute();
render(nav.focus ? { focus: nav.focus } : {});
nav.focus = null;

// Offline use and installing: register the service worker (it keeps a copy of what this site loaded).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
