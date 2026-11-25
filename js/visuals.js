// Lesson visuals: each domain may have content/domains/<id>/visuals.json. Format: js/visual-render.js.
import * as store from './store.js';
import { esc, announce } from './ui.js';
import { renderVisual } from './visual-render.js';

export { renderVisual };

const byDomain = {};
let current = null;
let refresh = () => {};
export function setVisualsRefresh(fn) { refresh = fn; }

/** Loads a domain's visuals once. If there are none, lessons simply show no visuals. */
export function loadVisuals(domainId) {
  current = domainId;
  if (byDomain[domainId] !== undefined) return;
  byDomain[domainId] = null;
  fetch(`content/domains/${domainId}/visuals.json`)
    .then((r) => (r.ok ? r.json() : { visuals: {} }))
    .then((doc) => { byDomain[domainId] = doc.visuals ?? {}; refresh(); })
    .catch(() => { byDomain[domainId] = {}; });
}

const hidden = () => Boolean(store.getSettings().hideVisuals);
const toggleHtml = (at, label) => `<button type="button" class="link-button vz-toggle" data-action="visuals-toggle" data-at="${esc(at)}">${label}</button>`;

/** A lesson's visuals with their show or hide control, or nothing if it has none. */
export function lessonVisualsHtml(lessonId) {
  const list = byDomain[current]?.[lessonId];
  if (!list?.length) return '';
  if (hidden()) return `<p class="vz-off">${toggleHtml('lesson', `Show ${list.length > 1 ? 'visuals' : 'visual'} for this idea`)}</p>`;
  return `<div class="vz-wrap"><div class="vz-wrap__head"><span class="lesson__label">See it</span>${toggleHtml('lesson', 'Hide visuals')}</div>${list.map(renderVisual).join('')}</div>`;
}

/** Wraps a diagram that is already written into a lesson. Hidden, its description stays as text so nothing is lost. */
export function diagramFrameHtml(key, figureHtml, description) {
  if (hidden()) return `<p class="vz-off"><span>${esc(description)}</span> ${toggleHtml(key, 'Show diagram')}</p>`;
  return `<div class="vz-wrap vz-wrap--diagram"><div class="vz-wrap__head vz-wrap__head--end">${toggleHtml(key, 'Hide visuals')}</div>${figureHtml}</div>`;
}

export const visualActions = {
  'visuals-toggle': (el) => {
    const hide = !hidden();
    store.updateSettings({ hideVisuals: hide });
    announce(hide ? 'Visuals hidden.' : 'Visuals shown.');
    return `[data-action="visuals-toggle"][data-at="${el.dataset.at}"]`;
  },
};
