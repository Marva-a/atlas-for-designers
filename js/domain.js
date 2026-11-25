// The domain engine: every page of one domain at #d/<domain>/... Generalized from Atlas's original single-domain pathway.
//
// A domain's course text is loaded on demand from content/domains/<id>/*.json (built by scripts/build-domains.py)
// and is never copied into your saved data. Only progress is stored, one record per domain.
import * as store from './store.js';
import { esc, announce, nav, plural, linkHtml } from './ui.js';
import { lessonVisualsHtml, diagramFrameHtml, loadVisuals } from './visuals.js';
import {
  STATUSES, STATUS_LABELS, RULES, shuffledIndexes, isAnswered, gradeQuestion, recordAnswer, latestExams,
  objectiveMetrics, objectiveStatus, examReport, weakObjectives, readiness, reviewMinimum,
  DESIGN_LABELS, DESIGN_RULES, DESIGN_DIMENSIONS, RATING_LABELS, designStatus, designSummary, lessonDeck,
} from './cert-logic.js';

const EXAM_MS = 90 * 60_000;
// One cache per domain, so switching domains never mixes their content.
const caches = {};
const failures = {};
let D = null; // the domain on screen
let cache = {};
let failed = {};
function useDomain(id) {
  if (id === D) return;
  D = id;
  cache = (caches[id] ??= {});
  failed = (failures[id] ??= {});
  loadVisuals(id);
}
/** The start of every link inside the current domain. */
const B = () => `#d/${D}/`;
let refresh = () => {};
export function setDomainRefresh(fn) { refresh = fn; }

const FILES = { index: 'index.json', exams: 'exams.json', pbq: 'pbq.json', diagrams: 'diagrams.json', glossary: 'glossary.json', coverage: 'coverage.json', cases: 'cases.json' };
const weekFile = (n) => `w${String(n).padStart(2, '0')}.json`;
const OPTIONAL = new Set(['exams', 'pbq', 'diagrams', 'glossary', 'coverage', 'cases']);

function fetchOnce(key, file) {
  if (cache[key] !== undefined || cache[`${key}:loading`]) return;
  const domain = D;
  const target = cache;
  const fails = failed;
  target[`${key}:loading`] = true;
  fetch(`content/domains/${domain}/${file}`)
    .then((r) => {
      // Optional files a domain does not have count as empty, not as an error.
      if (r.status === 404 && OPTIONAL.has(key)) return {};
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then((doc) => { target[key] = doc; delete fails[key]; })
    .catch(() => { fails[key] = true; })
    .finally(() => { delete target[`${key}:loading`]; refresh(); });
}

/** Asks for what a page needs. Returns a holding page until it has arrived, or null when everything is here. */
function need(...keys) {
  const missing = keys.filter((k) => cache[k] === undefined);
  if (!missing.length) return null;
  if (missing.some((k) => failed[k])) {
    return `<h1 id="day-heading" tabindex="-1">Could not load this page</h1><p>Part of the course did not arrive. Check your connection, then <button type="button" data-action="cert-retry">try again</button>.</p>`;
  }
  for (const k of missing) fetchOnce(k, k.startsWith('week') ? weekFile(k.slice(4)) : FILES[k]);
  return '<h1 id="day-heading" tabindex="-1">Loading…</h1>';
}

const cert = () => store.getProgress(D);
const saveProgress = () => store.saveProgress();

const designEntry = (id) => { const d = cert().design; d[id] ??= {}; return d[id]; };
const designMeta = (id) => index().designs.find((x) => x.id === id);
const moduleOf = (week) => index().modules.find((m) => m.weeks.includes(week));
const index = () => cache.index;
const lessonMeta = (id) => index().lessons.find((l) => l.id === id);
const weekKeys = () => index().weeks.filter((w) => w.sessions.some((s) => s.type === 'lesson' && lessonMeta(s.id))).map((w) => `week${w.n}`);
const weekOfDoc = (n) => cache[`week${n}`];
const fullLesson = (id) => { const m = lessonMeta(id); return m ? weekOfDoc(m.week)?.lessons.find((l) => l.id === id) : null; };
const allQuestions = () => index().lessons.flatMap((m) => fullLesson(m.id)?.qs ?? []);
const objectiveById = (id) => index().objectives.find((o) => o.id === id);
const areaOf = (objectiveId) => String(objectiveId).split('.')[0];
const areaName = (a) => index().areas[a]?.name ?? a;
const labsOf = (lessonId) => lessonMeta(lessonId)?.labs.map((l) => l.id) ?? [];
const pct = (r, n) => (n ? Math.round((r / n) * 100) : 0);
const lessonLink = (id, text) => `<a href="${B()}lesson/${esc(id)}">${esc(text ?? lessonMeta(id)?.title ?? id)}</a>`;

function metricsAll() {
  const out = {};
  for (const o of index().objectives) out[o.id] = { ...objectiveMetrics({ ...o, pool: index().objectivePool?.[o.id] }, cert(), labsOf), examRequired: Boolean(index().hasExams) };
  return out;
}

// ─── Shared page parts ───────────────────────────────────────────────────────

function subnav(current) {
  const items = index().sections.map(([path, label]) => {
    const here = path === current;
    return `<li><a href="#d/${D}${path ? `/${path}` : ''}"${here ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;
  }).join('');
  return `<nav class="cert-subnav" aria-label="${esc(index().short)} sections"><ul>${items}</ul></nav>`;
}

const page = (current, html) => `<p class="meta"><a href="#">← All domains</a> · <strong>${esc(index().title)}</strong></p>${subnav(current)}${html}`;
const bar = (value, label) => `<div class="progress cert-bar" role="img" aria-label="${esc(label)}"><span style="width:${Math.min(100, value)}%"></span></div>`;
const objChips = (ids) => (ids.length ? ids.map((o) => `<a class="cert-chip" href="${B()}objective/${esc(o)}">${esc(index().objectiveLabel)} ${esc(o)}</a>`).join(' ') : '<span class="cert-chip cert-chip--found">Foundation</span>');

/** Text with any http(s) URLs turned into links. */
const linkify = (text) => esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,)]/g, (u) => linkHtml(u.replace(/&amp;/g, '&'), u));

function noticeHtml() {
  const list = index().notices ?? [];
  if (!list.length) return '';
  return `
    <section class="card card--notice cert-notice">
      <h2 class="small-label">Read before you rely on this domain</h2>
      <ul>${list.map((n) => `<li>${linkify(n)}</li>`).join('')}</ul>
    </section>`;
}

const RELEVANCE = { direct: 'Direct product design relevance', professional: 'Professional relevance for cross-functional work', foundation: 'Foundational technical knowledge' };
const RELEVANCE_SHORT = { direct: 'Design exercise', professional: 'Cross-functional', foundation: 'Foundational' };

/** A week's estimated minutes: lessons, reviews and design exercises. */
function weekMinutes(w) {
  return w.sessions.reduce((n, s) => {
    if (s.type !== 'lesson') return n + (s.min ?? 0);
    return n + (lessonMeta(s.id)?.min ?? 0) + (designMeta(s.id)?.min ?? 0);
  }, 0);
}
function weekRangeText() {
  const list = index().weeks.map((w) => ({ n: w.n, h: Math.round(weekMinutes(w) / 60) })).sort((a, b) => b.h - a.h);
  const [top, next] = list;
  return `Most weeks take ${list[list.length - 1].h} to ${next.h} hours, and Week ${top.n} is the longest at about ${top.h}.`;
}
const totalHours = () => Math.round(index().weeks.reduce((n, w) => n + weekMinutes(w), 0) / 60);

// ─── Overview ────────────────────────────────────────────────────────────────

function overviewView() {
  const ix = index();
  const c = cert();
  const done = ix.lessons.filter((l) => c.lessons[l.id]).length;
  const areas = Object.entries(ix.areas).map(([a, v]) => `<tr><th scope="row">${esc(a)}. ${esc(v.name)}</th><td>${v.weight ? `${v.weight}%` : '–'}</td></tr>`).join('');
  const ds = designSummary(ix.designs, c.design);
  const hours = totalHours();
  const next = ix.lessons.find((l) => !c.lessons[l.id]);
  const steps = [
    ['Learn the concept', 'Understand the idea from first principles: what it is, why it exists and what problem it solves.'],
    ['Technical deep dive', 'The mechanisms and terminology people in this field use, with a hands-on lab.'],
    ['See it in real products', 'How the concept shapes the products designers in this field work on.'],
    ['Apply it as a Product Designer', 'Where the concept has a real design application, produce an artifact from a realistic brief.'],
    ['Test your understanding', 'A knowledge check and, separately, a design assessment.'],
    ['Review and references', 'Common mistakes, a summary, free references and flashcards.'],
  ];
  const exam = ix.exam;
  return page('', `
    <h1 id="day-heading" tabindex="-1">${esc(ix.title)}</h1>
    <p class="lesson-summary">${esc(ix.tagline)}</p>
    <p class="meta"><strong>For:</strong> ${esc(ix.audience)}</p>
    <div class="cert-measures">
      <section class="card cert-measure"><h2 class="small-label">${esc(ix.short)} knowledge</h2><p class="cert-measure__n">${done} of ${ix.lessons.length}</p><p class="meta">lessons complete. ${esc(ix.objectiveLabel)} status comes from quizzes, labs and reviews${exam ? ' and mock exams' : ''}.</p><a href="${B()}progress">Progress dashboard</a></section>
      <section class="card cert-measure"><h2 class="small-label">Product design competency</h2><p class="cert-measure__n">${ds.assessed} of ${ds.total}</p><p class="meta">exercises assessed, from your deliverables, critiques and self-assessment against written criteria.</p><a href="${B()}design">Design practice</a></section>
    </div>
    <p class="meta">These two are measured separately and never combined: knowing a concept and designing a good experience around it are different skills.</p>
    <div class="button-row">${next ? `<a class="button button--primary" href="${B()}lesson/${esc(next.id)}">${done ? 'Continue' : 'Start'}: ${esc(next.title)}</a>` : ''}<a class="button" href="${B()}curriculum">See the curriculum</a></div>
    ${ix.unwritten.length ? `<p class="status--behind cert-pad"><strong>Still being written:</strong> ${plural(ix.unwritten.length, 'lesson', 'lessons')} of this domain are not finished yet.</p>` : ''}
    ${noticeHtml()}
    <section class="card"><h2>How every lesson works</h2>
      <ol class="cert-phases">${steps.map(([t, d]) => `<li><strong>${esc(t)}.</strong> ${esc(d)}</li>`).join('')}</ol>
      <p>Not every concept needs a design challenge. Each lesson is labelled honestly:</p>
      <ul class="cert-phases">
        <li><strong>${RELEVANCE.direct}.</strong> ${plural(ix.lessons.filter((l) => l.rel === 'direct').length, 'lesson includes', 'lessons include')} a full design exercise and a design assessment.</li>
        <li><strong>${RELEVANCE.professional}.</strong> ${plural(ix.lessons.filter((l) => l.rel === 'professional').length, 'lesson shows', 'lessons show')} where the concept reaches products, with questions to bring to engineering, security and product partners.</li>
        <li><strong>${RELEVANCE.foundation}.</strong> ${plural(ix.lessons.filter((l) => l.rel === 'foundation').length, 'lesson explains', 'lessons explain')} why the concept matters, without inventing an exercise.</li>
      </ul>
      <p class="meta">Design exercises sharpen your judgment. They don't replace the specialists accountable for the domain.</p>
    </section>
    ${ix.about?.length ? `<section class="card"><h2>About this domain</h2>${ix.about.map((p) => `<p>${linkify(p)}</p>`).join('')}</section>` : ''}
    ${exam ? `<section class="card"><h2>${esc(ix.examLabel || 'The exam')}</h2>
      <table class="cert-table"><caption class="visually-hidden">Exam facts</caption><tbody>
        ${exam.code ? `<tr><th scope="row">Exam code</th><td>${esc(exam.code)}${exam.version ? ` (${esc(exam.version)})` : ''}</td></tr>` : ''}
        ${exam.questions ? `<tr><th scope="row">Questions</th><td>${esc(exam.questions)}${exam.types ? `, ${esc(exam.types.toLowerCase())}` : ''}</td></tr>` : ''}
        ${exam.minutes ? `<tr><th scope="row">Length</th><td>${exam.minutes} minutes</td></tr>` : ''}
        ${exam.passing ? `<tr><th scope="row">Passing score</th><td>${esc(exam.passing)}</td></tr>` : ''}
        ${exam.experience ? `<tr><th scope="row">Experience</th><td>${esc(exam.experience)}</td></tr>` : ''}
        ${exam.launch ? `<tr><th scope="row">Availability</th><td>${esc(exam.launch)}${exam.checked ? `. Checked ${esc(exam.checked)}` : ''}${exam.url ? `; confirm on ${linkHtml(exam.url, 'the official page')} before booking` : ''}.</td></tr>` : ''}
      </tbody></table></section>` : ''}
    <section class="card"><h2>How long it takes</h2>
      <p>${plural(ix.weeks.length, 'week', 'weeks')}, about ${hours} hours including the design practice. ${ix.weeks.length > 2 ? weekRangeText() : ''} This is an estimate, not a promise: any week can be extended and nothing has a deadline.</p>
    </section>
    <section class="card"><h2>What it covers</h2>
      <table class="cert-table"><thead><tr><th scope="col">Area</th><th scope="col">Weight</th></tr></thead><tbody>${areas}</tbody></table>
    </section>
    <section class="card"><h2>Modules</h2>
      <div class="cert-scroll" tabindex="0"><table class="cert-table"><thead><tr><th scope="col">Module</th><th scope="col">Weeks</th><th scope="col">Domain knowledge</th><th scope="col">Product design application</th></tr></thead><tbody>
      ${ix.modules.map((m) => `<tr><th scope="row">${String(m.n).padStart(2, '0')}. ${esc(m.title)}</th><td>${m.weeks[0]}${m.weeks.length > 1 ? `–${m.weeks[m.weeks.length - 1]}` : ''}</td><td>${esc(m.security)}</td><td>${esc(m.design)}</td></tr>`).join('')}
      </tbody></table></div>
      <p>Everything you need is free. ${plural(ix.lessons.reduce((n, l) => n + l.labs.length, 0), 'lab', 'labs')} use tools you can run yourself, only ever on your own systems or authorized practice environments.</p>
      <p class="meta">Progress is saved on this device. Back it up, or sync it with your other devices, from <a href="#settings">Settings</a>.</p>
    </section>`);
}

// ─── Curriculum and weeks ────────────────────────────────────────────────────

function sessionRow(w, s, i) {
  const c = cert();
  if (s.type === 'lesson') {
    const l = lessonMeta(s.id);
    if (!l) return `<li class="step step--todo"><div class="step__row"><span class="step__mark" aria-hidden="true">${i + 1}</span><span class="step__body"><span class="step__title">Lesson being written</span><span class="step__meta">${esc(s.id)}</span></span></div></li>`;
    const done = Boolean(c.lessons[l.id]);
    return `<li class="step step--${done ? 'done' : 'todo'}"><a class="step__row" href="${B()}lesson/${esc(l.id)}"><span class="step__mark" aria-hidden="true">${done ? '✓' : i + 1}</span><span class="step__body"><span class="step__title">${esc(l.title)}</span><span class="step__meta">${l.obj.length ? `Objective ${esc(l.obj.join(', '))}` : 'Foundation'} · ${esc(l.level)} · about ${l.min + (designMeta(l.id)?.min ?? 0)} min${l.rel ? ` · ${esc(RELEVANCE_SHORT[l.rel])}` : ''}</span></span><span class="visually-hidden"> (${done ? 'complete' : 'not started'})</span><span class="step__go" aria-hidden="true">›</span></a></li>`;
  }
  return `<li class="step step--todo"><a class="step__row" href="${B()}${esc(s.link)}"><span class="step__mark" aria-hidden="true">${i + 1}</span><span class="step__body"><span class="step__title">${esc(s.title)}</span><span class="step__meta">${s.detail ? `${esc(s.detail)} · ` : ''}about ${s.min} min</span></span><span class="step__go" aria-hidden="true">›</span></a></li>`;
}

function curriculumView() {
  const ix = index();
  const c = cert();
  let moduleN = 0;
  const rows = ix.weeks.map((w) => {
    const m = moduleOf(w.n);
    const head = m.n !== moduleN ? `<div class="cert-module"><h2 class="small-label lessons-week">Module ${String(m.n).padStart(2, '0')} · ${esc(m.title)}</h2><p class="meta"><strong>Domain knowledge:</strong> ${esc(m.security)}<br><strong>Product design application:</strong> ${esc(m.design)}</p></div>` : '';
    moduleN = m.n;
    const ls = w.sessions.filter((s) => s.type === 'lesson').map((s) => s.id);
    const done = ls.filter((id) => c.lessons[id]).length;
    const extra = c.extraWeeks[w.n] ?? 0;
    return `${head}<article class="card cert-week"><h3><a href="${B()}week/${w.n}">Week ${w.n}: ${esc(w.title)}</a></h3><p class="meta">${esc(w.outcome)}</p><p class="meta">${ls.length ? `${done} of ${ls.length} lessons complete` : `${w.sessions.length} sessions`} · about ${Math.round(weekMinutes(w) / 60)} hours${extra ? ` · extended by ${plural(extra, 'week', 'weeks')}` : ''}</p></article>`;
  }).join('');
  const extraTotal = Object.values(c.extraWeeks).reduce((a, b) => a + b, 0);
  return page('curriculum', `<h1 id="day-heading" tabindex="-1">The curriculum</h1><p class="meta page-intro">${plural(index().modules.length, 'module', 'modules')}, about ${totalHours()} hours over ${plural(index().weeks.length, 'week', 'weeks')}${extraTotal ? `, plus ${plural(extraTotal, 'extra week', 'extra weeks')} you added` : ''}. Self-paced: there is no deadline.</p>${rows}`);
}

function weekView(n) {
  const w = index().weeks.find((x) => x.n === n);
  if (!w) return page('curriculum', '<h1 id="day-heading" tabindex="-1">No such week</h1>');
  const extra = cert().extraWeeks[n] ?? 0;
  return page('curriculum', `
    <p class="eyebrow">Module ${String(moduleOf(n).n).padStart(2, '0')} · ${esc(moduleOf(n).title)}</p>
    <h1 id="day-heading" tabindex="-1">Week ${n}: ${esc(w.title)}</h1>
    <p class="lesson-summary">${esc(w.outcome)}</p>
    <ol class="steps-list lessons-list">${w.sessions.map((s, i) => sessionRow(w, s, i)).join('')}</ol>
    <div class="card cert-pad"><h2 class="small-label">Need longer?</h2>
      <p>${extra ? `You have extended this week by ${plural(extra, 'week', 'weeks')}.` : 'Spend as long as you need here. Adding time only changes your plan totals.'}</p>
      <div class="button-row"><button type="button" class="button--small" data-action="cert-extend" data-week="${n}" data-by="1">Add a week</button>${extra ? `<button type="button" class="button--small" data-action="cert-extend" data-week="${n}" data-by="-1">Remove a week</button>` : ''}</div>
    </div>`);
}

// ─── Questions ───────────────────────────────────────────────────────────────

const responses = new Map();
const checked = new Set();

function initialResponse(q, seed) {
  if (q.k === 'order') return shuffledIndexes(q.seq.length, `${seed}${q.id}o`);
  if (q.k === 'match') return q.pairs.map(() => null);
  if (q.k === 'multi') return [];
  return undefined;
}

function respOf(q, store_, seed) {
  if (!store_.has(q.id) && (q.k === 'order' || q.k === 'match' || q.k === 'multi')) store_.set(q.id, initialResponse(q, seed));
  return store_.get(q.id);
}

function questionBody(q, response, { disabled, seed }) {
  const name = `q-${q.id}`;
  const dis = disabled ? 'disabled' : '';
  if (q.k === 'mcq' || q.k === 'tf' || q.k === 'multi') {
    const order = q.k === 'tf' ? q.a.map((_, i) => i) : shuffledIndexes(q.a.length, `${seed}${q.id}`);
    const type = q.k === 'multi' ? 'checkbox' : 'radio';
    return `<fieldset class="cert-options"><legend class="visually-hidden">Answer options</legend>${order.map((i) => {
      const on = q.k === 'multi' ? (response ?? []).includes(i) : response === i;
      return `<label class="cert-option"><input type="${type}" name="${esc(name)}" value="${i}" data-cert-q="${esc(q.id)}" ${on ? 'checked' : ''} ${dis}><span>${esc(q.a[i].t)}</span></label>`;
    }).join('')}</fieldset>`;
  }
  if (q.k === 'order') {
    return `<ol class="cert-order">${response.map((step, pos) => `<li><span>${esc(q.seq[step])}</span>${disabled ? '' : `<span class="cert-order__btns"><button type="button" class="button--small" data-action="cert-move" data-q="${esc(q.id)}" data-pos="${pos}" data-by="-1" ${pos === 0 ? 'disabled' : ''} aria-label="Move up: ${esc(q.seq[step])}">↑</button><button type="button" class="button--small" data-action="cert-move" data-q="${esc(q.id)}" data-pos="${pos}" data-by="1" ${pos === response.length - 1 ? 'disabled' : ''} aria-label="Move down: ${esc(q.seq[step])}">↓</button></span>`}</li>`).join('')}</ol>`;
  }
  const rights = shuffledIndexes(q.pairs.length, `${seed}${q.id}m`);
  return `<div class="cert-match">${q.pairs.map(([left], row) => `<label class="cert-match__row"><span>${esc(left)}</span><select data-cert-match="${esc(q.id)}" data-row="${row}" ${dis}><option value="">Choose…</option>${rights.map((r) => `<option value="${r}" ${response?.[row] === r ? 'selected' : ''}>${esc(q.pairs[r][1])}</option>`).join('')}</select></label>`).join('')}</div>`;
}

function explainHtml(q, response) {
  const ok = gradeQuestion(q, response);
  let detail = '';
  if (q.a) {
    detail = `<ul class="cert-why">${q.a.map((a, i) => {
      const chose = Array.isArray(response) ? response.includes(i) : response === i;
      return `<li class="${a.ok ? 'cert-why--right' : ''}"><strong>${a.ok ? 'Correct answer' : chose ? 'Your choice, incorrect' : 'Incorrect'}:</strong> ${esc(a.t)}. <span>${esc(a.w)}</span></li>`;
    }).join('')}</ul>`;
  } else if (q.seq) detail = `<p><strong>Correct order:</strong></p><ol>${q.seq.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  else detail = `<p><strong>Correct matches:</strong></p><ul>${q.pairs.map(([l, r]) => `<li>${esc(l)} → ${esc(r)}</li>`).join('')}</ul>`;
  return `<div class="cert-explain ${ok ? 'cert-explain--ok' : 'cert-explain--no'}">
    <p class="cert-result">${ok ? '✓ Correct' : '✗ Not quite'}</p>${detail}${q.why ? `<p>${esc(q.why)}</p>` : ''}
    <p class="meta"><strong>Concept:</strong> ${esc(q.c)}${q.o.length ? ` · Objective ${esc(q.o.join(', '))}` : ''}${q.l && lessonMeta(q.l) ? ` · ${lessonLink(q.l, 'Revisit the lesson')}` : ''}</p></div>`;
}

const KIND_HINT = { mcq: 'Choose one answer.', tf: 'True or false?', multi: 'Choose all that apply.', order: 'Put the steps in the correct order.', match: 'Match each item on the left to one answer.' };

function questionCard(q, n, seed, design = null) {
  const response = respOf(q, responses, seed);
  const isDone = checked.has(q.id);
  return `<article class="card cert-q" id="card-${esc(q.id)}">
    <p class="eyebrow">${design ? 'Design critique' : `Question ${n}`}</p>
    <h3 class="cert-q__stem">${esc(q.s)}</h3>
    ${q.pre ? `<pre class="cert-pre" tabindex="0">${esc(q.pre.join('\n'))}</pre>` : ''}
    <p class="meta">${esc(KIND_HINT[q.k])}</p>
    ${questionBody(q, response, { disabled: isDone, seed })}
    ${isDone ? explainHtml(q, response) : `<div class="button-row"><button type="button" class="button--small button--primary" data-action="${design ? 'cert-design-check' : 'cert-check'}" data-q="${esc(q.id)}"${design ? ` data-owner="${esc(design)}"` : ''}>Check answer</button></div>`}
    ${design && isDone ? `<div class="button-row"><button type="button" class="button--small" data-action="cert-design-retry" data-q="${esc(q.id)}">Try again</button></div>` : ''}
  </article>`;
}

const questionLookup = new Map();
function rememberQuestions(list) { for (const q of list) questionLookup.set(q.id, q); }

/** Reads an option click. Returns true when the event belonged to a question. */
export function handleDomainChange(e) {
  const t = e.target;
  if (t.dataset?.designField) {
    designEntry(t.dataset.owner)[t.dataset.designField] = t.value.trim().slice(0, t.dataset.designField === 'link' ? 500 : 4000);
    saveProgress();
    return true;
  }
  const id = t.dataset?.certQ ?? t.dataset?.certMatch;
  if (!id) return false;
  const q = questionLookup.get(id);
  if (!q) return false;
  const active = cert().active;
  const inExam = active && active.ids?.includes(id);
  const read = () => (inExam ? active.resp[id] : responses.get(id));
  const write = (v) => {
    if (inExam) { active.resp[id] = v; saveProgress(); } else responses.set(id, v);
  };
  if (t.dataset.certMatch) {
    const next = [...(read() ?? q.pairs.map(() => null))];
    next[Number(t.dataset.row)] = t.value === '' ? null : Number(t.value);
    write(next);
  } else if (q.k === 'multi') {
    const set = new Set(read() ?? []);
    if (t.checked) set.add(Number(t.value)); else set.delete(Number(t.value));
    write([...set]);
  } else write(Number(t.value));
  return true;
}

// ─── Lessons ─────────────────────────────────────────────────────────────────

function diagramHtml(key) {
  const d = cache.diagrams?.[key];
  if (!d) return '';
  return diagramFrameHtml(key, `<figure class="cert-figure${d.art ? ' cert-figure--art' : ''}" role="group" aria-label="${esc(d.alt)}">${d.svg}<figcaption class="meta">${esc(d.caption)}</figcaption></figure>`, `${d.alt} ${d.caption}`);
}

function tableHtml(t) {
  return `<div class="cert-scroll" tabindex="0"><table class="cert-table"><caption>${esc(t.caption)}</caption><thead><tr>${t.cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function labHtml(lab) {
  const done = Boolean(cert().labs[lab.id]);
  return `<section class="cert-lab" aria-label="Lab: ${esc(lab.title)}">
    <h4>${esc(lab.title)}</h4><p class="meta">About ${lab.min} min · ${esc(lab.tool)}</p>
    <ol>${lab.do.map((d) => `<li>${esc(d)}</li>`).join('')}</ol>
    <details class="lesson-check"><summary><span>What you should see, and why</span></summary><p><strong>Expected outcome:</strong> ${esc(lab.expect)}</p><p>${esc(lab.explain)}</p></details>
    <p><strong>You are done when:</strong></p><ul>${lab.pass.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    <label class="cert-option"><input type="checkbox" data-action="cert-lab" data-lab="${esc(lab.id)}" ${done ? 'checked' : ''}><span>I completed this lab and met every line above</span></label>
  </section>`;
}

// The six parts of a lesson. They sit on one continuous page, so moving from security to design never feels like
// switching courses.
const LESSON_PARTS = ['Learn the concept', 'Technical deep dive', 'See it in real products', 'Apply it as a Product Designer', 'Test your understanding', 'Review and references'];
const ASK_LABELS = { eng: 'Engineering', sec: 'Security', prod: 'Product' };

function lessonStepper() {
  return `<nav class="cert-parts" aria-label="Parts of this lesson"><ol>${LESSON_PARTS.map((t, i) => `<li><button type="button" class="cert-parts__b" data-action="cert-jump" data-to="#cert-part-${i + 1}"><span aria-hidden="true">${i + 1}</span> ${esc(t)}</button></li>`).join('')}</ol></nav>`;
}

const partHead = (n) => `<header class="cert-part__head" id="cert-part-${n}" tabindex="-1"><span class="cert-part__n" aria-hidden="true">${n}</span><h2>${esc(LESSON_PARTS[n - 1])}</h2></header>`;

function asksHtml(asks) {
  if (!asks.eng.length && !asks.sec.length && !asks.prod.length) return '';
  return `<h3 class="lesson__label">Questions a Senior Product Designer should ask</h3><div class="cert-asks">${Object.entries(ASK_LABELS).map(([k, t]) => (asks[k].length ? `<div><h4>${t}</h4><ul>${asks[k].map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : '')).join('')}</div>`;
}

function exerciseBriefHtml(ex) {
  const list = (t, items) => `<h4>${t}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return `<section class="cert-brief" aria-label="Design brief: ${esc(ex.title)}">
    <p class="eyebrow">Design brief · about ${ex.min} min, a working draft and not a polished file</p>
    <h3>${esc(ex.title)}</h3>
    <h4>Scenario</h4><p>${esc(ex.scenario)}</p>
    <h4>Problem statement</h4><p>${esc(ex.problem)}</p>
    <h4>Your design task</h4><ol>${ex.tasks.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
    ${list('Technical security constraints', ex.constraints)}
    ${list('User needs', ex.needs)}
    <h4>Expected deliverable</h4><p>${esc(ex.deliver)}</p>
    ${list('Evaluation criteria', ex.crit.map((c) => c.t))}
    ${list('Senior-level considerations', ex.seniors)}
    <p class="meta">A design review is not a security sign-off. Have security engineers confirm technical decisions, and leave risk acceptance to the people accountable for it.</p>
  </section>`;
}

function exerciseWorkHtml(id) {
  const e = designEntry(id);
  return `<section class="cert-work" aria-label="Your design work">
    <h4>Your work</h4>
    <label class="cert-field"><span>Link to your artifact (optional)</span><input type="url" maxlength="500" data-design-field="link" data-owner="${esc(id)}" value="${esc(e.link ?? '')}" placeholder="https://"></label>
    <label class="cert-field"><span>Notes and decisions</span><textarea rows="4" maxlength="4000" data-design-field="work" data-owner="${esc(id)}">${esc(e.work ?? '')}</textarea></label>
    <label class="cert-option"><input type="checkbox" data-action="cert-design-delivered" data-owner="${esc(id)}" ${e.delivered ? 'checked' : ''}><span>I produced the expected deliverable</span></label>
    <p class="meta">Saved in this browser only. Leave out confidential employer or customer details.</p>
  </section>`;
}

function exerciseAssessHtml(id, ex) {
  const e = designEntry(id);
  const meta = designMeta(id);
  rememberQuestions(ex.cq);
  const status = designStatus(meta, e);
  const rows = ex.crit.map((c, i) => `<fieldset class="cert-rate"><legend>${esc(c.t)} <span class="meta">(${esc(DESIGN_DIMENSIONS[c.d])})</span></legend><div>${RATING_LABELS.map((label, v) => `<label><input type="radio" name="rate-${esc(id)}-${i}" data-action="cert-design-rate" data-owner="${esc(id)}" data-i="${i}" data-v="${v}" ${e.rate?.[i] === v ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset>`).join('');
  const len = (e.defense ?? '').trim().length;
  return `<section class="cert-assess" id="cert-assess-${esc(id)}" tabindex="-1" aria-label="Product design assessment">
    ${ex.cq.map((q, i) => questionCard(q, i + 1, 'D', id)).join('')}
    ${ex.cq.filter((q) => !checked.has(q.id) && e.cq?.[q.id] !== undefined).map((q) => `<p class="meta">Your last critique answer was ${e.cq[q.id] ? 'correct' : 'not correct'}.</p>`).join('')}
    <h4>Rate your work against each criterion</h4>
    <p class="meta">Be strict. These are your own ratings, so ask a colleague to challenge them if you can.</p>
    ${rows}
    <label class="cert-field"><span>Defend your design: the main decision you made, the alternative you rejected and the trade-off you accepted</span><textarea rows="5" maxlength="4000" data-design-field="defense" data-owner="${esc(id)}">${esc(e.defense ?? '')}</textarea></label>
    <p class="meta">At least ${DESIGN_RULES.defenseMin} characters. ${len ? `You have ${len}.` : ''}</p>
    <div class="button-row"><button type="button" class="button--small button--primary" data-action="cert-design-save" data-owner="${esc(id)}">Save assessment</button></div>
    <p class="meta"><strong>Design status:</strong> <span class="cert-status cert-status--d-${status}">${esc(DESIGN_LABELS[status])}</span>. This does not change your ${esc(index().objectiveLabel.toLowerCase())} status.</p>
  </section>`;
}

// ─── Flashcards from a lesson ────────────────────────────────────────────────
// For now, a lesson's cards are shown to flip through. A saved deck with spaced repetition is planned.

function lessonCardsHtml(id, l) {
  const deck = lessonDeck(l);
  const ideas = deck.filter((c) => c.kind === 'idea');
  const terms = deck.filter((c) => c.kind === 'term');
  const row = (c) => `<li><details class="lesson-check"><summary><span>${esc(c.front)}</span></summary><p>${esc(c.back)}</p></details></li>`;
  return `
    <p class="meta">${deck.length} cards from this lesson: ${plural(ideas.length, 'key idea', 'key ideas')} and ${plural(terms.length, 'key term', 'key terms')}. Try to answer before you open each one.</p>
    ${ideas.length ? `<h4 class="cert-cards__group">Key ideas</h4><ul class="cert-cards">${ideas.map(row).join('')}</ul>` : ''}
    ${terms.length ? `<h4 class="cert-cards__group">Key terms</h4><ul class="cert-cards">${terms.map(row).join('')}</ul>` : ''}`;
}

function lessonView(id) {
  const m = lessonMeta(id);
  const l = fullLesson(id);
  if (!m || !l) return page('curriculum', '<h1 id="day-heading" tabindex="-1">No such lesson</h1>');
  rememberQuestions(l.qs);
  const c = cert();
  const refs = index().references;
  const label = (t) => `<h3 class="lesson__label">${esc(t)}</h3>`;
  const paras = (list) => list.map((p) => `<p>${esc(p)}</p>`).join('');
  const done = c.lessons[id];
  const d = l.design;
  const ex = d.ex;
  const blocks = l.blocks.map((b) => (b.diagram ? diagramHtml(b.diagram) : tableHtml(b.table))).join('');
  const refRows = l.refs.map((r) => {
    const x = refs.find((y) => y.id === r.id);
    return `<li>${linkHtml(x.url, x.title)} <span class="meta">${esc(x.org)} · ${esc(x.type)} · ${x.minutes} min · ${r.req ? 'Required' : 'Supplementary'} · ${esc(x.access)}</span></li>`;
  }).join('');
  return page('curriculum', `
    <article class="card lesson" aria-labelledby="day-heading">
      <p class="eyebrow">Lesson ${l.n} · Week ${m.week}${l.domain ? ` · ${esc(l.domain)}` : ''} · ${esc(l.level)} · about ${l.min + (ex?.min ?? 0)} min</p>
      <h1 id="day-heading" tabindex="-1">${esc(l.title)}</h1>
      <p>${objChips(l.obj)} <span class="cert-chip cert-chip--rel">${esc(RELEVANCE[d.rel])}</span></p>
      <p class="meta"><strong>Before this:</strong> ${l.pre.length ? l.pre.map((p) => lessonLink(p)).join(', ') : 'nothing, start here'}</p>
      ${lessonStepper()}

      ${partHead(1)}
      ${label('By the end, you can')}<ul>${l.out.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
      ${label('Why it exists and what problem it solves')}<p>${esc(l.why)}</p>
      ${label('In plain language')}${paras(l.plain)}
      ${lessonVisualsHtml(id)}

      ${partHead(2)}
      ${paras(l.tech)}
      ${blocks}
      ${label('Key terms')}<dl class="words">${l.terms.map(([t, x]) => `<div><dt>${esc(t)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl>
      ${l.walks.map((w) => `${label(`Walkthrough: ${w.title}`)}<ol class="cert-steps">${w.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('')}
      ${label('Hands-on lab')}${l.labs.map(labHtml).join('')}

      ${partHead(3)}
      ${d.sector ? `<p class="eyebrow">${esc(d.sector)}</p>` : ''}
      ${paras(d.product)}
      ${label('In practice')}<ul>${l.eg.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>

      ${partHead(4)}
      ${ex ? `${exerciseBriefHtml(ex)}${exerciseWorkHtml(id)}` : `<p><strong>No design exercise here, on purpose.</strong> ${esc(d.noex)}</p>`}
      ${asksHtml(d.asks)}

      ${partHead(5)}
      <h3 class="lesson__label">A. ${esc(index().short)} knowledge check</h3>
      <p class="meta">Counts toward your ${esc(index().objectiveLabel.toLowerCase())} status. Original Atlas practice questions${index().exam ? ', not real exam questions' : ''}.</p>
      <h4>Scenario</h4><p>${esc(l.scenario)}</p>
      <details class="lesson-check"><summary><span>Reason it through, then compare</span></summary><p>${esc(l.answer)}</p></details>
      ${l.qs.map((q, i) => questionCard(q, i + 1, 'L')).join('')}
      ${ex ? `<h3 class="lesson__label">B. Product design assessment</h3><p class="meta">Counts toward your design competency only.</p>${exerciseAssessHtml(id, ex)}` : ''}

      ${partHead(6)}
      ${label('Common mistakes')}<ul>${l.mistakes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${label('Summary')}<ul>${l.sum.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${label('References')}<ul class="cert-refs">${refRows}</ul>
      ${label('Flashcards')}${lessonCardsHtml(id, l)}
      <div class="lesson-complete ${done ? 'lesson-complete--done' : ''}" id="cert-done" tabindex="-1">
        <button type="button" class="${done ? 'button--small' : 'button--primary'}" data-action="cert-lesson" data-lesson="${esc(id)}">${done ? 'Mark as not complete' : 'Complete lesson'}</button>
        ${done ? '<p class="meta">Lesson complete. Completing a lesson is only the first step toward mastery.</p>' : ''}
        ${l.next ? `<a class="button${done ? ' button--primary' : ''}" href="${B()}lesson/${esc(l.next)}">Next lesson<span class="visually-hidden">: ${esc(lessonMeta(l.next)?.title ?? '')}</span></a>` : ''}
      </div>
    </article>`);
}

// ─── Product design practice ─────────────────────────────────────────────────

function designRow(x) {
  const status = designStatus(x, cert().design[x.id]);
  const href = x.kind === 'case' ? `${B()}case/${esc(x.id)}` : `${B()}lesson/${esc(x.id)}`;
  return `<tr><th scope="row"><a href="${href}">${esc(x.title)}</a><br><span class="meta">${esc(x.deliver)}</span></th><td>${x.week}</td><td>${x.min} min</td><td><span class="cert-status cert-status--d-${status}">${esc(DESIGN_LABELS[status])}</span></td></tr>`;
}

function designTable(list, caption) {
  return `<div class="cert-scroll" tabindex="0"><table class="cert-table"><caption>${esc(caption)}</caption><thead><tr><th scope="col">Exercise and deliverable</th><th scope="col">Week</th><th scope="col">Time</th><th scope="col">Status</th></tr></thead><tbody>${list.map(designRow).join('')}</tbody></table></div>`;
}

function designSummaryHtml() {
  const s = designSummary(index().designs, cert().design);
  const tile = (value, label) => `<div class="cert-tile"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
  const dims = Object.entries(DESIGN_DIMENSIONS).map(([k, t]) => {
    const d = s.dims[k];
    return `<tr><th scope="row">${esc(t)}</th><td>${d.meets} of ${d.total}</td><td>${d.partly}</td></tr>`;
  }).join('');
  return `<div class="cert-tiles">${tile(`${s.assessed} of ${s.total}`, 'Applied exercises assessed')}${tile(`${s.delivered} of ${s.total}`, 'Design deliverables made')}${tile(`${s.meets} of ${s.total}`, 'Exercises meeting all criteria')}${tile(`${s.critiqueRight} of ${s.critiqueTotal}`, 'Design critiques correct')}</div>
    <div class="cert-scroll" tabindex="0"><table class="cert-table"><caption>Competencies, from your ratings against written criteria</caption><thead><tr><th scope="col">Competency</th><th scope="col">Criteria met</th><th scope="col">Partly met</th></tr></thead><tbody>${dims}</tbody></table></div>
    <p class="meta">Design ratings are your own judgment, so treat them as a prompt for critique and not as an external verdict. Nothing here affects your knowledge status, and no quiz or exam result affects anything here.</p>`;
}

function designView() {
  const ix = index();
  return page('design', `<h1 id="day-heading" tabindex="-1">Product design practice</h1>
    <p class="lesson-summary">Every exercise lives inside its lesson. This page shows them together so you can follow your competency and return to your work.</p>
    ${designSummaryHtml()}
    ${designTable(ix.designs.filter((x) => x.kind === 'lesson'), 'Exercises inside lessons')}
    ${ix.designs.some((x) => x.kind === 'case') ? designTable(ix.designs.filter((x) => x.kind === 'case'), 'Integrated case studies') : ''}`);
}

function caseView(id) {
  const k = cache.cases.cases.find((x) => x.id === id);
  if (!k) return page('design', '<h1 id="day-heading" tabindex="-1">No such case study</h1>');
  const ex = k.ex;
  return page('design', `
    <article class="card lesson" aria-labelledby="day-heading">
      <p class="eyebrow">Integrated case study · Week ${k.week} · ${esc(k.sector)} · about ${ex.min} min</p>
      <h1 id="day-heading" tabindex="-1">${esc(ex.title)}</h1>
      <p>${objChips(k.obj)}</p>
      <p class="meta"><strong>Draws on:</strong> ${k.lessons.map((x) => lessonLink(x)).join(', ')}</p>
      <h2 class="lesson__label">Technical half</h2>
      <p class="meta">Counts toward your knowledge status through the quizzes and exercises themselves.</p>
      <ul>${k.practice.map((p) => `<li><a href="${B()}${esc(p.link.replace(/^#(cert\/)?/, ''))}">${esc(p.t)}</a></li>`).join('')}</ul>
      <h2 class="lesson__label">Design half</h2>
      ${exerciseBriefHtml(ex)}${exerciseWorkHtml(id)}
      <h2 class="lesson__label">Product design assessment</h2>
      <p class="meta">Counts toward your design competency only.</p>
      ${exerciseAssessHtml(id, ex)}
    </article>`);
}

// ─── Quizzes ─────────────────────────────────────────────────────────────────

const quizzes = new Map();

function poolFor(scope) {
  const all = allQuestions();
  const c = cert();
  const seed = String(Date.now());
  const take = (list, n, s) => shuffledIndexes(list.length, seed + s).slice(0, n).map((i) => list[i]);
  const weekOfLesson = (id) => lessonMeta(id)?.week ?? 0;
  const foundationWeeks = index().weeks.filter((w) => w.phase === 'foundation').map((w) => w.n);
  if (scope === 'foundation' && foundationWeeks.length) return { title: 'Foundation assessment', questions: take(all.filter((q) => foundationWeeks.includes(weekOfLesson(q.l))), 40, 'f'), intro: `Covers the foundation weeks (${foundationWeeks.join(', ')}). Aim for 80% or more before moving on. Each explanation links to the lesson to revisit.` };
  if (scope === 'weak') {
    const wrong = all.filter((q) => c.q[q.id]?.last === 0);
    return { title: 'Your weak-area questions', questions: take(wrong, 30, 'w'), intro: 'Every question you most recently answered incorrectly.' };
  }
  let m = scope.match(/^week-(\d+)$/);
  if (m) {
    const n = Number(m[1]);
    const earlier = all.filter((q) => weekOfLesson(q.l) < n);
    return { title: `Week ${n} review`, questions: [...take(all.filter((q) => weekOfLesson(q.l) === n), 15, 'n'), ...take(earlier, 8, 'e')], intro: 'This week’s topics plus a few from earlier weeks, so older ideas stay fresh.' };
  }
  m = scope.match(/^area-(.+)$/);
  if (m) return { title: `${areaName(m[1])} review`, questions: take(all.filter((q) => q.o.some((o) => areaOf(o) === m[1])), 40, 'd'), intro: 'Mixed questions for this area.' };
  m = scope.match(/^obj-(.+)$/);
  if (m) return { title: `${index().objectiveLabel} ${m[1]} review`, questions: take(all.filter((q) => q.o.includes(m[1])), 15, 'o'), intro: `Scoring ${Math.round(RULES.reviewPassScore * 100)}% or more on ${reviewMinimum(index().objectivePool?.[m[1]])}+ questions, at least a day after finishing the lessons, counts as a review.` };
  return null;
}

function quizView(scope) {
  let s = quizzes.get(scope);
  if (!s) {
    const p = poolFor(scope);
    if (!p) return page('checks', '<h1 id="day-heading" tabindex="-1">No such check</h1>');
    s = { ...p, finished: null };
    for (const q of s.questions) { responses.delete(q.id); checked.delete(q.id); }
    quizzes.set(scope, s);
  }
  rememberQuestions(s.questions);
  if (!s.questions.length) return page('checks', `<h1 id="day-heading" tabindex="-1">${esc(s.title)}</h1><p class="empty-state">No questions here yet. ${scope === 'weak' ? 'Answer some questions first.' : 'Complete more of the course.'}</p><button type="button" data-action="cert-quiz-reset" data-scope="${esc(scope)}">Try again</button>`);
  const answered = s.questions.filter((q) => checked.has(q.id)).length;
  const right = s.questions.filter((q) => checked.has(q.id) && gradeQuestion(q, responses.get(q.id))).length;
  return page('checks', `
    <h1 id="day-heading" tabindex="-1">${esc(s.title)}</h1>
    <p class="meta page-intro">${esc(s.intro)} Original Atlas practice questions.</p>
    <p class="meta"><strong>${answered} of ${s.questions.length}</strong> answered · ${right} correct</p>
    ${s.questions.map((q, i) => questionCard(q, i + 1, 'Q')).join('')}
    <div class="button-row">${answered === s.questions.length && !s.finished ? `<button type="button" class="button--primary" data-action="cert-quiz-finish" data-scope="${esc(scope)}">Record my result</button>` : ''}<button type="button" data-action="cert-quiz-reset" data-scope="${esc(scope)}">New set of questions</button></div>
    ${s.finished ? `<p class="status-ok" id="cert-quiz-done" tabindex="-1">Recorded: ${s.finished.right} of ${s.finished.n} (${pct(s.finished.right, s.finished.n)}%).</p>` : ''}`);
}

function checksView() {
  const ix = index();
  const metrics = metricsAll();
  const rows = ix.objectives.map((o) => `<tr><th scope="row"><a href="${B()}objective/${esc(o.id)}">${esc(o.id)} ${esc(o.title)}</a></th><td>${esc(STATUS_LABELS[objectiveStatus(metrics[o.id])])}</td><td><a class="button button--small" href="${B()}quiz/obj-${esc(o.id)}">Practice</a></td></tr>`).join('');
  return page('checks', `<h1 id="day-heading" tabindex="-1">Knowledge checks</h1>
    <div class="button-row"><a class="button button--primary" href="${B()}quiz/weak">My weak areas</a>${ix.weeks.some((w) => w.phase === 'foundation') ? `<a class="button" href="${B()}quiz/foundation">Foundation assessment</a>` : ''}${Object.entries(ix.areas).map(([a, v]) => `<a class="button button--small" href="${B()}quiz/area-${esc(a)}">${esc(v.name)}</a>`).join('')}</div>
    <div class="cert-scroll" tabindex="0"><table class="cert-table"><caption>Practice by objective</caption><thead><tr><th scope="col">Objective</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

// ─── Objective page ──────────────────────────────────────────────────────────

function objectiveView(id) {
  const o = objectiveById(id);
  if (!o) return page('progress', '<h1 id="day-heading" tabindex="-1">No such objective</h1>');
  const m = metricsAll()[id];
  const status = objectiveStatus(m);
  return page('progress', `
    <p class="eyebrow">${esc(areaName(o.domain))}</p>
    <h1 id="day-heading" tabindex="-1">${esc(index().objectiveLabel)} ${esc(id)}: ${esc(o.title)}</h1>
    <p><span class="status status--none">${esc(STATUS_LABELS[status])}</span></p>
    <ul>
      <li>Lessons complete: ${m.lessonsDone} of ${m.lessonsTotal}</li>
      <li>Labs complete: ${m.labsDone} of ${m.labsTotal}</li>
      <li>Different questions answered: ${m.answered}${m.answered ? ` (${Math.round(m.accuracy * 100)}% correct on the latest try)` : ''}</li>
      <li>Timed exam questions: ${m.examSeen}${m.examSeen ? ` (${Math.round(m.examAccuracy * 100)}% correct)` : ''}</li>
      <li>Review pass: ${m.reviewPass ? 'yes' : 'not yet'}</li>
    </ul>
    <h2 class="small-label">Lessons</h2><ul>${o.lessons.map((l) => `<li>${lessonLink(l)}</li>`).join('') || '<li>None yet</li>'}</ul>
    <div class="button-row"><a class="button button--primary" href="${B()}quiz/obj-${esc(id)}">Practice this objective</a></div>`);
}

// ─── Exams ───────────────────────────────────────────────────────────────────

let timerHandle = null;
function stopExamTimer() { clearInterval(timerHandle); timerHandle = null; }

function startExamTimer() {
  stopExamTimer();
  const tick = () => {
    const a = cert().active;
    const el = document.getElementById('cert-timer');
    if (!a || !el) { stopExamTimer(); return; }
    const left = a.started + EXAM_MS - Date.now();
    if (left <= 0) { stopExamTimer(); finishExam(); nav.focus = '#day-heading'; location.hash = `${B()}exam/${a.id}/result`; return; }
    const min = Math.floor(left / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    el.textContent = `${min}:${String(sec).padStart(2, '0')}`;
  };
  tick();
  timerHandle = setInterval(tick, 1000);
}

function examQuestions(id) { return cache.exams.exams[id]?.qs ?? []; }

function finishExam() {
  const c = cert();
  const a = c.active;
  if (!a) return;
  const qs = examQuestions(a.id);
  const report = examReport(a.id, qs, a.resp, { ms: Date.now() - a.started });
  report.resp = a.resp;
  for (const e of c.exams) if (e.id === a.id) delete e.resp; // only the latest sitting keeps its answers
  c.exams.push(report);
  for (const q of qs) recordAnswer(c, q, gradeQuestion(q, a.resp[q.id]));
  c.active = null;
  saveProgress();
}

function examsView() {
  const ix = index();
  const c = cert();
  const card = (id, name) => {
    const qs = examQuestions(id);
    const last = latestExams(c).find((e) => e.id === id);
    return `<article class="card"><h2>${esc(name)}</h2><p class="meta">${qs.length} original questions · 90 minutes · weighted like the published domain percentages</p>
      ${last ? `<p>Latest: <strong>${last.right} of ${last.n}</strong> (${pct(last.right, last.n)}%). <a href="${B()}exam/${id}/result">See results</a></p>` : ''}
      <a class="button button--primary" href="${B()}exam/${id}">${last ? 'Sit again' : 'Open exam'}</a></article>`;
  };
  return page('exams', `<h1 id="day-heading" tabindex="-1">Practice examinations</h1>
    <p class="meta page-intro">Timed practice in Atlas's own format, not a reproduction of the real exam interface. Atlas percentages are not predicted exam scores.</p>
    ${card('a', 'Mock exam A')}${card('b', 'Mock exam B')}
    <section class="card"><h2>Performance-based practice</h2><p>${plural(ix.pbqs.length, 'interactive exercise', 'interactive exercises')}: firewall rules, log analysis, sequencing and more.</p><a class="button" href="${B()}pbq">Open exercises</a></section>`);
}

function examStartView(id) {
  const qs = examQuestions(id);
  if (!qs.length) return page('exams', '<h1 id="day-heading" tabindex="-1">This exam is not ready yet</h1>');
  const active = cert().active;
  if (active?.id === id) { location.hash = `${B()}exam/${id}/run`; return '<h1 id="day-heading" tabindex="-1">Resuming…</h1>'; }
  return page('exams', `<h1 id="day-heading" tabindex="-1">Mock exam ${esc(id.toUpperCase())}</h1>
    <ul><li>${qs.length} questions and 90 minutes.</li><li>The clock keeps running if you leave or close the page, and your answers are saved as you go.</li><li>You can flag questions and move between them.</li><li>It is submitted automatically when time is up. Explanations appear afterward.</li></ul>
    ${active ? `<p class="status--behind cert-pad">Mock exam ${esc(active.id.toUpperCase())} is still in progress. <a href="${B()}exam/${esc(active.id)}/run">Resume it</a> or finish it before starting another.</p>` : `<button type="button" class="button--primary" data-action="cert-exam-start" data-exam="${esc(id)}">Start the 90-minute timer</button>`}`);
}

function examRunView(id) {
  const c = cert();
  const a = c.active;
  // No redirect here: this view also redraws for a moment after submitting, on the way to the results page.
  if (!a || a.id !== id) return page('exams', `<h1 id="day-heading" tabindex="-1">This exam is not in progress</h1><p><a href="${B()}exam/${esc(id)}">Open the exam page</a></p>`);
  const byId = new Map(examQuestions(id).map((q) => [q.id, q]));
  const qs = a.ids.map((x) => byId.get(x));
  rememberQuestions(qs);
  const pos = Math.min(a.pos ?? 0, qs.length - 1);
  const q = qs[pos];
  if ((q.k === 'order' || q.k === 'match') && a.resp[q.id] === undefined) { a.resp[q.id] = initialResponse(q, a.seed); saveProgress(); }
  const unanswered = qs.filter((x) => !isAnswered(x, a.resp[x.id])).length;
  const grid = qs.map((x, i) => `<button type="button" class="cert-grid__b ${isAnswered(x, a.resp[x.id]) ? 'is-answered' : ''} ${a.flags.includes(x.id) ? 'is-flagged' : ''}" data-action="cert-exam-go" data-pos="${i}" ${i === pos ? 'aria-current="true"' : ''} aria-label="Question ${i + 1}${a.flags.includes(x.id) ? ', flagged' : ''}${isAnswered(x, a.resp[x.id]) ? ', answered' : ''}">${i + 1}</button>`).join('');
  setTimeout(startExamTimer, 0);
  return `
    <div class="cert-exam-head"><h1 id="day-heading" tabindex="-1">Mock exam ${esc(id.toUpperCase())}</h1><p class="cert-clock" role="timer" aria-label="Time remaining"><span id="cert-timer">…</span></p></div>
    <article class="card cert-q">
      <p class="eyebrow">Question ${pos + 1} of ${qs.length}</p>
      <h2 class="cert-q__stem">${esc(q.s)}</h2>
      ${q.pre ? `<pre class="cert-pre" tabindex="0">${esc(q.pre.join('\n'))}</pre>` : ''}
      <p class="meta">${esc(KIND_HINT[q.k])}</p>
      ${questionBody(q, a.resp[q.id], { disabled: false, seed: a.seed })}
      <div class="button-row">
        <button type="button" data-action="cert-exam-go" data-pos="${pos - 1}" ${pos === 0 ? 'disabled' : ''}>Previous</button>
        <button type="button" class="button--primary" data-action="cert-exam-go" data-pos="${pos + 1}" ${pos === qs.length - 1 ? 'disabled' : ''}>Next</button>
        <button type="button" class="button--small" data-action="cert-exam-flag" data-q="${esc(q.id)}">${a.flags.includes(q.id) ? 'Remove flag' : 'Flag for review'}</button>
      </div>
    </article>
    <section class="card"><h2 class="small-label">Questions</h2><div class="cert-grid">${grid}</div>
      <p class="meta">${unanswered ? `${plural(unanswered, 'question', 'questions')} unanswered.` : 'Every question is answered.'}</p>
      ${a.confirm ? `<p role="alert"><strong>Submit now?</strong> ${unanswered ? `${plural(unanswered, 'unanswered question', 'unanswered questions')} will be marked wrong.` : 'You cannot change answers afterward.'}</p><div class="button-row"><button type="button" class="button--primary" data-action="cert-exam-submit" data-sure="1">Yes, submit</button><button type="button" data-action="cert-exam-cancel">Keep going</button></div>` : '<button type="button" data-action="cert-exam-submit">Submit exam</button>'}
    </section>`;
}

function examResultView(id) {
  const ix = index();
  const c = cert();
  const r = latestExams(c).find((e) => e.id === id);
  if (!r) return page('exams', '<h1 id="day-heading" tabindex="-1">No result yet</h1>');
  const qs = examQuestions(id);
  rememberQuestions(qs);
  const domains = Object.entries(r.byDomain).sort().map(([d, [a, n]]) => `<tr><th scope="row">${esc(d)}. ${esc(areaName(d))}</th><td>${a} of ${n}</td><td>${pct(a, n)}%</td></tr>`).join('');
  const objectives = Object.entries(r.byObj).sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true })).map(([o, [a, n]]) => `<tr><th scope="row">${esc(o)} ${esc(objectiveById(o).title)}</th><td>${a} of ${n}</td><td>${pct(a, n)}%</td></tr>`).join('');
  const missedLessons = [...new Set(qs.filter((q) => r.wrong.includes(q.id)).map((q) => q.l))];
  const count = new Map();
  for (const q of qs.filter((x) => r.wrong.includes(x.id))) count.set(q.l, (count.get(q.l) ?? 0) + 1);
  missedLessons.sort((a, b) => count.get(b) - count.get(a));
  const weak = Object.entries(r.byObj).filter(([, [a, n]]) => a / n < 0.75).map(([o]) => o);
  const review = r.resp ? qs.map((q, i) => `<article class="card cert-q"><p class="eyebrow">Question ${i + 1}</p><h3 class="cert-q__stem">${esc(q.s)}</h3>${q.pre ? `<pre class="cert-pre" tabindex="0">${esc(q.pre.join('\n'))}</pre>` : ''}${explainHtml(q, r.resp[q.id])}</article>`) : [];
  const wrongOnly = review.filter((_, i) => r.wrong.includes(qs[i].id));
  return page('exams', `
    <h1 id="day-heading" tabindex="-1">Mock exam ${esc(id.toUpperCase())}: results</h1>
    <p class="lesson-summary"><strong>${r.right} correct, ${r.n - r.right} incorrect</strong> of ${r.n} (${pct(r.right, r.n)}%) in ${Math.round(r.ms / 60000)} minutes.</p>
    <p class="meta">An Atlas percentage, not a predicted 100–900 score.</p>
    <div class="cert-scroll" tabindex="0"><table class="cert-table"><caption>By domain</caption><thead><tr><th scope="col">Domain</th><th scope="col">Correct</th><th scope="col">Score</th></tr></thead><tbody>${domains}</tbody></table></div>
    <div class="cert-scroll" tabindex="0"><table class="cert-table"><caption>By objective</caption><thead><tr><th scope="col">Objective</th><th scope="col">Correct</th><th scope="col">Score</th></tr></thead><tbody>${objectives}</tbody></table></div>
    <section class="card"><h2>Weak topics</h2>${weak.length ? `<ul>${weak.map((o) => `<li><a href="${B()}objective/${esc(o)}">${esc(o)} ${esc(objectiveById(o).title)}</a></li>`).join('')}</ul>` : '<p>No objective fell below 75% on this sitting.</p>'}
      <h2>Lessons to revisit first</h2>${missedLessons.length ? `<ol>${missedLessons.slice(0, 8).map((l) => `<li>${lessonLink(l)} <span class="meta">(${plural(count.get(l), 'miss', 'misses')})</span></li>`).join('')}</ol>` : '<p>Nothing missed.</p>'}
      <div class="button-row"><a class="button button--primary" href="${B()}quiz/weak">Practice my weak areas</a><a class="button" href="${B()}exam/${esc(id)}">Sit again</a></div></section>
    <h2 class="small-label lessons-week">What you got wrong</h2>${wrongOnly.join('') || '<p>Nothing to show.</p>'}
    ${review.length ? `<details class="lesson-check"><summary><span>See all ${review.length} explanations</span></summary>${review.join('')}</details>` : ''}`);
}

// ─── Performance-based practice ──────────────────────────────────────────────

const pbqState = new Map();

function pbqListView() {
  const c = cert();
  const rows = cache.pbq.pbqs.map((p, i) => {
    const best = c.pbq[p.id]?.best;
    return `<li class="step step--${best >= RULES.readyPbqScore ? 'done' : 'todo'}"><a class="step__row" href="${B()}pbq/${esc(p.id)}"><span class="step__mark" aria-hidden="true">${best >= RULES.readyPbqScore ? '✓' : i + 1}</span><span class="step__body"><span class="step__title">${esc(p.title)}</span><span class="step__meta">Objective ${esc(p.obj.join(', '))} · about ${p.min} min${best !== undefined ? ` · best ${Math.round(best * 100)}%` : ''}</span></span><span class="step__go" aria-hidden="true">›</span></a></li>`;
  }).join('');
  return page('exams', `<h1 id="day-heading" tabindex="-1">Performance-based practice</h1><p class="meta page-intro">Original exercises that teach the skill behind each task. They do not reproduce any exam's own interface.</p><ol class="steps-list lessons-list">${rows}</ol>`);
}

function pbqScore(p, st) {
  if (p.kind === 'grid') return p.rows.filter((r, i) => st.resp[i] === r[r.length - 2]).length / p.rows.length;
  if (p.kind === 'pick') return p.rows.filter((r, i) => (r[1] === 'yes') === Boolean(st.resp[i])).length / p.rows.length;
  return st.order.filter((step, i) => step === i).length / p.rows.length;
}

function pbqView(id) {
  const p = cache.pbq.pbqs.find((x) => x.id === id);
  if (!p) return page('exams', '<h1 id="day-heading" tabindex="-1">No such exercise</h1>');
  let st = pbqState.get(id);
  if (!st) { st = { resp: {}, order: shuffledIndexes(p.rows.length, `${id}${Date.now()}`), done: false }; pbqState.set(id, st); }
  const off = st.done ? 'disabled' : '';
  let body = '';
  if (p.kind === 'grid') {
    const dataCols = (p.cols ?? []).length;
    body = `<div class="cert-scroll" tabindex="0"><table class="cert-table"><caption class="visually-hidden">Your answers</caption><thead><tr>${(p.cols ?? []).map((c) => `<th scope="col">${esc(c)}</th>`).join('')}<th scope="col">Your answer</th></tr></thead><tbody>${p.rows.map((r, i) => `<tr>${r.slice(0, dataCols).map((c) => `<td>${esc(c)}</td>`).join('')}<td><select data-pbq="${esc(id)}" data-i="${i}" ${off} aria-label="Answer for row ${i + 1}"><option value="">Choose…</option>${p.choices.map((c) => `<option ${st.resp[i] === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>${st.done ? `<p class="meta">${st.resp[i] === r[r.length - 2] ? '✓' : `✗ Correct: ${esc(r[r.length - 2])}.`} ${esc(r[r.length - 1])}</p>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  } else if (p.kind === 'pick') {
    body = `<fieldset class="cert-options"><legend class="visually-hidden">Select every line that applies</legend>${p.rows.map((r, i) => `<label class="cert-option cert-option--mono"><input type="checkbox" data-pbq="${esc(id)}" data-i="${i}" ${st.resp[i] ? 'checked' : ''} ${off}><span>${esc(r[0])}${st.done ? `<br><em class="meta">${(r[1] === 'yes') === Boolean(st.resp[i]) ? '✓' : '✗'} ${r[1] === 'yes' ? 'Should be selected.' : 'Should not be selected.'} ${esc(r[2])}</em>` : ''}</span></label>`).join('')}</fieldset>`;
  } else {
    body = `<ol class="cert-order">${st.order.map((step, pos) => `<li><span>${esc(p.rows[step][0])}${st.done ? `<br><em class="meta">${step === pos ? '✓' : `✗ Belongs in position ${step + 1}.`} ${esc(p.rows[step][1])}</em>` : ''}</span>${st.done ? '' : `<span class="cert-order__btns"><button type="button" class="button--small" data-action="cert-pbq-move" data-id="${esc(id)}" data-pos="${pos}" data-by="-1" ${pos === 0 ? 'disabled' : ''} aria-label="Move up: ${esc(p.rows[step][0])}">↑</button><button type="button" class="button--small" data-action="cert-pbq-move" data-id="${esc(id)}" data-pos="${pos}" data-by="1" ${pos === p.rows.length - 1 ? 'disabled' : ''} aria-label="Move down: ${esc(p.rows[step][0])}">↓</button></span>`}</li>`).join('')}</ol>`;
  }
  const score = st.done ? pbqScore(p, st) : null;
  return page('exams', `
    <p class="eyebrow">Objective ${esc(p.obj.join(', '))} · about ${p.min} min · Original Atlas exercise</p>
    <h1 id="day-heading" tabindex="-1">${esc(p.title)}</h1>
    <p>${esc(p.intro)}</p>
    ${(p.context ?? []).length ? `<pre class="cert-pre" tabindex="0">${esc(p.context.join('\n'))}</pre>` : ''}
    ${body}
    ${st.done ? `<div class="cert-explain ${score >= RULES.readyPbqScore ? 'cert-explain--ok' : 'cert-explain--no'}" id="cert-pbq-result" tabindex="-1"><p class="cert-result">Score: ${Math.round(score * 100)}%</p><p>${esc(p.why)}</p>${p.lesson ? `<p class="meta">${lessonLink(p.lesson, 'Revisit the lesson')}</p>` : ''}</div>` : ''}
    <div class="button-row">${st.done ? `<button type="button" data-action="cert-pbq-reset" data-id="${esc(id)}">Try again</button>` : `<button type="button" class="button--primary" data-action="cert-pbq-check" data-id="${esc(id)}">Check my work</button>`}<a class="button" href="${B()}pbq">All exercises</a></div>`);
}

/** A choice inside a PBQ. Returns true when the event was for one. */
export function handlePbqChange(e) {
  const t = e.target;
  if (!t.dataset?.pbq) return false;
  const st = pbqState.get(t.dataset.pbq);
  if (!st) return true;
  st.resp[Number(t.dataset.i)] = t.type === 'checkbox' ? t.checked : t.value;
  return true;
}

// ─── Labs, library, glossary, sheets ─────────────────────────────────────────

function labsView() {
  const c = cert();
  const ix = index();
  const total = ix.lessons.reduce((n, l) => n + l.labs.length, 0);
  const done = ix.lessons.reduce((n, l) => n + l.labs.filter((x) => c.labs[x.id]).length, 0);
  const rows = ix.weeks.map((w) => {
    const ls = ix.lessons.filter((l) => l.week === w.n && l.labs.length);
    if (!ls.length) return '';
    return `<h2 class="small-label lessons-week">Week ${w.n}</h2><ul class="steps-list lessons-list">${ls.flatMap((l) => l.labs.map((x) => `<li class="step step--${c.labs[x.id] ? 'done' : 'todo'}"><a class="step__row" href="${B()}lesson/${esc(l.id)}"><span class="step__mark" aria-hidden="true">${c.labs[x.id] ? '✓' : '·'}</span><span class="step__body"><span class="step__title">${esc(x.title)}</span><span class="step__meta">${esc(x.tool)} · about ${x.min} min</span></span><span class="step__go" aria-hidden="true">›</span></a></li>`)).join('')}</ul>`;
  }).join('');
  return page('labs', `<h1 id="day-heading" tabindex="-1">Hands-on labs</h1><p class="meta page-intro"><strong>${done} of ${total}</strong> complete. Labs are self-assessed against the listed criteria. Only ever test systems you own or environments that explicitly authorize it.</p>${rows}`);
}

function libraryView() {
  const ix = index();
  const used = ix.references.filter((r) => r.lessons.length);
  const row = (r) => `<tr><th scope="row">${linkHtml(r.url, r.title)}</th><td>${esc(r.org)}</td><td>${esc(r.type)}</td><td>${r.minutes} min</td><td>${r.objectives.length ? esc(r.objectives.join(', ')) : 'Foundations'}</td><td>${r.required ? 'Required' : 'Supplementary'}</td><td>${esc(r.access)}</td></tr>`;
  const org = ix.officialOrg;
  const official = org ? used.filter((r) => r.org.startsWith(org)) : [];
  const other = org ? used.filter((r) => !r.org.startsWith(org)) : used;
  const head = '<thead><tr><th scope="col">Title</th><th scope="col">From</th><th scope="col">Type</th><th scope="col">Time</th><th scope="col">Objectives</th><th scope="col">Use</th><th scope="col">Access</th></tr></thead>';
  return page('library', `<h1 id="day-heading" tabindex="-1">Reference library</h1>
    <p class="meta page-intro">Every link was opened and checked before it was added${ix.referencesChecked ? ` (most recently ${esc(ix.referencesChecked)})` : ''}, and everything required is free. <a href="${B()}glossary">Open the glossary</a>.</p>
    ${official.length ? `<div class="cert-scroll" tabindex="0"><table class="cert-table"><caption>Official ${esc(org)} material</caption>${head}<tbody>${official.map(row).join('')}</tbody></table></div>` : ''}
    <div class="cert-scroll" tabindex="0"><table class="cert-table"><caption>${org ? `Independent sources (not from ${esc(org)})` : 'Sources'}</caption>${head}<tbody>${other.map(row).join('')}</tbody></table></div>`);
}

function glossaryView() {
  const terms = new Map();
  for (const m of index().lessons) for (const [t, d] of fullLesson(m.id)?.terms ?? []) if (!terms.has(t.toLowerCase())) terms.set(t.toLowerCase(), { t, d, l: m.id });
  const rows = [...terms.values()].sort((a, b) => a.t.localeCompare(b.t)).map((x) => `<div><dt>${esc(x.t)}</dt><dd>${esc(x.d)} <span class="meta">${lessonLink(x.l, 'Lesson')}</span></dd></div>`).join('');
  return page('library', `<h1 id="day-heading" tabindex="-1">Glossary</h1><p class="meta page-intro">${plural(terms.size, 'term', 'terms')} from the lessons, in plain language.</p><dl class="words">${rows}</dl>`);
}

function sheetsView() {
  const sheets = index().sheets;
  return page('ready', `<h1 id="day-heading" tabindex="-1">Revision sheets</h1>${sheets.map((s) => `<section class="card"><h2>${esc(s.title)}</h2>${s.tables.map(tableHtml).join('')}</section>`).join('') || '<p class="empty-state">Revision sheets are being written.</p>'}`);
}

function readyView() {
  const statuses = index().objectives.map((o) => objectiveStatus(metricsAll()[o.id]));
  const r = readiness(cert(), statuses, index().pbqs.length);
  return page('ready', `<h1 id="day-heading" tabindex="-1">Exam readiness</h1>
    <p class="lesson-summary">${r.ready ? 'You have met every line of Atlas’s readiness bar.' : `You have met ${r.met} of ${r.lines.length} lines. Keep going: readiness comes from your results, not from reaching the last week.`}</p>
    <ul class="cert-ready">${r.lines.map((l) => `<li class="${l.ok ? 'is-ok' : ''}"><span aria-hidden="true">${l.ok ? '✓' : '○'}</span> ${esc(l.label)}<span class="visually-hidden">${l.ok ? ' (met)' : ' (not yet)'}</span></li>`).join('')}</ul>
    <p class="meta">This is Atlas’s own bar. Meeting it is not a guarantee, and it is not a predicted score. Your <a href="${B()}design">product design competency</a> is measured separately and is not part of this bar.</p>
    <div class="button-row"><a class="button button--primary" href="${B()}sheets">Revision sheets</a><a class="button" href="${B()}exams">Practice exams</a><a class="button" href="${B()}pbq">Performance-based practice</a></div>`);
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function progressView() {
  const ix = index();
  const c = cert();
  const metrics = metricsAll();
  const statuses = Object.fromEntries(ix.objectives.map((o) => [o.id, objectiveStatus(metrics[o.id])]));
  const doneLessons = ix.lessons.filter((l) => c.lessons[l.id]);
  const labs = ix.lessons.flatMap((l) => l.labs);
  const labsDone = labs.filter((x) => c.labs[x.id]).length;
  const weeksDone = ix.weeks.filter((w) => {
    const ls = w.sessions.filter((s) => s.type === 'lesson');
    return ls.length && ls.every((s) => c.lessons[s.id]);
  }).length;
  const rows = Object.values(c.q);
  const answers = rows.reduce((n, r) => n + r.n, 0);
  const correct = rows.reduce((n, r) => n + r.c, 0);
  const hours = Math.round((doneLessons.reduce((n, l) => n + l.min, 0) + c.exams.reduce((n, e) => n + e.ms / 60000, 0)) / 60);
  const exams = latestExams(c);
  const tile = (value, label) => `<div class="cert-tile"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
  const domainCards = Object.entries(ix.areas).map(([d, v]) => {
    const objs = ix.objectives.filter((o) => o.domain === d);
    const earned = objs.reduce((n, o) => n + STATUSES.indexOf(statuses[o.id]), 0);
    const p = pct(earned, objs.length * 4);
    return `<article class="card cert-domain"><h3>${esc(d)}. ${esc(v.name)}</h3><p class="meta">${v.weight ? `${v.weight}% weight · ` : ''}${objs.filter((o) => ['reviewed', 'mastered'].includes(statuses[o.id])).length} of ${objs.length} objectives reviewed</p>${bar(p, `${v.name}: ${p}% of the way to mastery`)}</article>`;
  }).join('');
  const objRows = ix.objectives.map((o) => `<tr><th scope="row"><a href="${B()}objective/${esc(o.id)}">${esc(o.id)} ${esc(o.title)}</a></th><td><span class="cert-status cert-status--${statuses[o.id]}">${esc(STATUS_LABELS[statuses[o.id]])}</span></td><td>${metrics[o.id].answered ? `${Math.round(metrics[o.id].accuracy * 100)}%` : '–'}</td><td><a class="button button--small" href="${B()}quiz/obj-${esc(o.id)}">Practice</a></td></tr>`).join('');
  const weak = weakObjectives(ix.objectives, metrics, ix.areas).slice(0, 5);
  const weakHtml = weak.length ? `<ol>${weak.map((w) => {
    const o = objectiveById(w.id);
    return `<li><a href="${B()}objective/${esc(w.id)}">${esc(w.id)} ${esc(o.title)}</a> <span class="meta">(${Math.round(w.score * 100)}%)</span><br><span class="meta">Revisit: ${o.lessons.map((l) => lessonLink(l)).join(', ')}. Labs: ${o.lessons.flatMap((l) => lessonMeta(l).labs.map((x) => (c.labs[x.id] ? null : x.title))).filter(Boolean).map(esc).join('; ') || 'all complete'}.</span></li>`;
  }).join('')}</ol>` : '<p>No weak areas yet. Answer more questions to build a picture.</p>';
  return page('progress', `
    <h1 id="day-heading" tabindex="-1">Progress dashboard</h1>
    <p class="lesson-summary">One learning journey, two separate measures.</p>
    <h2 class="cert-measure-h">${esc(ix.short)} knowledge</h2>
    <p class="meta">Can you explain, recognize and apply the technical concept? Tracks objectives, quizzes, labs, performance-based practice and mock exams.</p>
    <div class="cert-tiles">
      ${tile(`${weeksDone} of ${ix.weeks.length}`, 'Weeks complete')}${tile(`${doneLessons.length} of ${ix.lessons.length}`, 'Lessons complete')}${tile(`About ${hours}`, 'Estimated hours')}
      ${tile(answers ? `${pct(correct, answers)}%` : '–', 'Question accuracy')}${tile(`${labsDone} of ${labs.length}`, 'Labs complete')}${tile(exams.length ? exams.map((e) => `${e.id.toUpperCase()} ${pct(e.right, e.n)}%`).join(', ') : '–', 'Latest mock exams')}
    </div>
    <p class="meta">Saved on this device; back it up or sync it from <a href="#settings">Settings</a>. Hours are estimated from completed work.</p>
    <h2 class="small-label lessons-week">Areas</h2>${domainCards}
    <section class="card"><h2>Weakest areas</h2>${weakHtml}<a class="button button--small" href="${B()}quiz/weak">Practice weak areas</a></section>
    <div class="cert-scroll" tabindex="0"><table class="cert-table"><caption>All ${ix.objectives.length} ${esc(ix.objectiveLabel.toLowerCase())}s</caption><thead><tr><th scope="col">Objective</th><th scope="col">Status</th><th scope="col">Accuracy</th><th scope="col"><span class="visually-hidden">Action</span></th></tr></thead><tbody>${objRows}</tbody></table></div>
    <p class="meta"><strong>How status works.</strong> Learning: you have started. Practiced: lessons finished, at least half the labs done, ${RULES.practicedAnswered}+ questions at ${Math.round(RULES.practicedAccuracy * 100)}%+. Reviewed: a later review at ${Math.round(RULES.reviewPassScore * 100)}%+. Mastered: ${Math.round(RULES.masteredAccuracy * 100)}%+ overall and on ${RULES.masteredExamSeen}+ timed exam questions. Status can fall if later answers are wrong.</p>
    <h2 class="cert-measure-h">Product design competency</h2>
    <p class="meta">Can you translate the concept into a good product experience? Tracks design exercises, deliverables, critiques and your assessment against written criteria.</p>
    ${designSummaryHtml()}
    <a class="button button--small" href="${B()}design">All design exercises</a>`);
}

// ─── Routing and actions ─────────────────────────────────────────────────────

export function domainView(domainId, section) {
  useDomain(domainId);
  const [first = '', second, third] = String(section ?? '').split('/').filter((p, i) => p !== '' || i > 0);
  let wait = need('index');
  if (wait) return wait;
  if (first !== 'exam' || third !== 'run') stopExamTimer();
  const allWeeks = weekKeys();
  if (first === '') return overviewView();
  if (first === 'curriculum') return curriculumView();
  if (first === 'week') return weekView(Number(second));
  if (first === 'lesson') {
    const m = lessonMeta(second);
    wait = need('diagrams', ...(m ? [`week${m.week}`] : []));
    return wait ?? lessonView(second);
  }
  if (first === 'design') return designView();
  if (first === 'case') return need('cases', 'diagrams') ?? caseView(second);
  if (first === 'labs') return labsView();
  if (first === 'checks') return checksView();
  if (first === 'objective') return objectiveView(second);
  if (first === 'quiz') return need(...allWeeks) ?? quizView(second);
  if (first === 'exams') return need('exams') ?? examsView();
  if (first === 'exam') {
    wait = need('exams', ...allWeeks);
    if (wait) return wait;
    if (third === 'run') return examRunView(second);
    if (third === 'result') return examResultView(second);
    return examStartView(second);
  }
  if (first === 'pbq') return need('pbq') ?? (second ? pbqView(second) : pbqListView());
  if (first === 'ready') return readyView();
  if (first === 'sheets') return sheetsView();
  if (first === 'library') return libraryView();
  if (first === 'glossary') return need(...allWeeks) ?? glossaryView();
  if (first === 'progress') return progressView();
  return page('', '<h1 id="day-heading" tabindex="-1">Page not found</h1>');
}

const moved = (list, pos, by) => {
  const next = [...list];
  const to = pos + by;
  if (to < 0 || to >= next.length) return next;
  [next[pos], next[to]] = [next[to], next[pos]];
  return next;
};

export const domainActions = {
  'cert-retry': () => { for (const k of Object.keys(failed)) delete failed[k]; return '#day-heading'; },
  'cert-lesson': (el) => {
    const c = cert();
    const id = el.dataset.lesson;
    if (c.lessons[id]) delete c.lessons[id]; else c.lessons[id] = Date.now();
    saveProgress();
    announce(c.lessons[id] ? 'Lesson complete.' : 'Marked as not complete.');
    return '#cert-done';
  },
  'cert-jump': (el) => el.dataset.to,
  'cert-design-delivered': (el) => {
    const e = designEntry(el.dataset.owner);
    if (el.checked) e.delivered = Date.now(); else delete e.delivered;
    saveProgress();
    announce(el.checked ? 'Deliverable marked as made.' : 'Deliverable marked as not made.');
    return `[data-action="cert-design-delivered"][data-owner="${el.dataset.owner}"]`;
  },
  'cert-design-rate': (el) => {
    const e = designEntry(el.dataset.owner);
    e.rate ??= {};
    e.rate[el.dataset.i] = Number(el.dataset.v);
    saveProgress();
    return `[data-action="cert-design-rate"][data-owner="${el.dataset.owner}"][data-i="${el.dataset.i}"][data-v="${el.dataset.v}"]`;
  },
  'cert-design-save': (el) => { saveProgress(); announce('Assessment saved.'); return `[data-action="cert-design-save"][data-owner="${el.dataset.owner}"]`; },
  'cert-design-check': (el) => {
    const q = questionLookup.get(el.dataset.q);
    const response = responses.get(q.id);
    if (!isAnswered(q, response)) { announce('Choose an answer first.'); return null; }
    const ok = gradeQuestion(q, response);
    checked.add(q.id);
    const e = designEntry(el.dataset.owner);
    e.cq ??= {};
    e.cq[q.id] = ok ? 1 : 0;
    saveProgress();
    announce(ok ? 'Correct.' : 'Not quite. The explanation is below the question.');
    return `#card-${q.id}`;
  },
  'cert-design-retry': (el) => { checked.delete(el.dataset.q); responses.delete(el.dataset.q); return `#card-${el.dataset.q}`; },
  'cert-lab': (el) => {
    const c = cert();
    if (el.checked) c.labs[el.dataset.lab] = Date.now(); else delete c.labs[el.dataset.lab];
    saveProgress();
    announce(el.checked ? 'Lab marked complete.' : 'Lab marked not complete.');
    return `[data-lab="${el.dataset.lab}"]`;
  },
  'cert-extend': (el) => {
    const c = cert();
    const w = el.dataset.week;
    const next = (c.extraWeeks[w] ?? 0) + Number(el.dataset.by);
    if (next > 0) c.extraWeeks[w] = next; else delete c.extraWeeks[w];
    saveProgress();
    return `[data-action="cert-extend"][data-by="1"]`;
  },
  'cert-check': (el) => {
    const q = questionLookup.get(el.dataset.q);
    const response = responses.get(q.id);
    if (!isAnswered(q, response)) { announce('Choose an answer first.'); return null; }
    const ok = gradeQuestion(q, response);
    checked.add(q.id);
    recordAnswer(cert(), q, ok);
    saveProgress();
    announce(ok ? 'Correct.' : 'Not quite. The explanation is below the question.');
    return `#card-${q.id}`;
  },
  'cert-move': (el) => {
    const id = el.dataset.q;
    const active = cert().active;
    if (active?.ids?.includes(id)) { active.resp[id] = moved(active.resp[id], Number(el.dataset.pos), Number(el.dataset.by)); saveProgress(); } else responses.set(id, moved(responses.get(id), Number(el.dataset.pos), Number(el.dataset.by)));
    const pos = Number(el.dataset.pos) + Number(el.dataset.by);
    return `[data-action="cert-move"][data-q="${id}"][data-pos="${pos}"][data-by="${el.dataset.by}"]:not([disabled]), [data-action="cert-move"][data-q="${id}"][data-pos="${pos}"]:not([disabled])`;
  },
  'cert-quiz-reset': (el) => { quizzes.delete(el.dataset.scope); return '#day-heading'; },
  'cert-quiz-finish': (el) => {
    const s = quizzes.get(el.dataset.scope);
    const right = s.questions.filter((q) => gradeQuestion(q, responses.get(q.id))).length;
    s.finished = { right, n: s.questions.length };
    const c = cert();
    const tally = {};
    for (const q of s.questions) {
      for (const o of q.o) {
        tally[o] ??= [0, 0];
        tally[o][1] += 1;
        if (gradeQuestion(q, responses.get(q.id))) tally[o][0] += 1;
      }
    }
    const at = Date.now();
    for (const [obj, [r, n]] of Object.entries(tally)) if (n >= reviewMinimum(index().objectivePool?.[obj])) c.reviews.push({ obj, at, n, r });
    saveProgress();
    return '#cert-quiz-done';
  },
  'cert-exam-start': (el) => {
    const c = cert();
    const id = el.dataset.exam;
    if (c.active) return null;
    const qs = examQuestions(id);
    const seed = String(Date.now());
    c.active = { id, started: Date.now(), seed, pos: 0, ids: shuffledIndexes(qs.length, seed).map((i) => qs[i].id), resp: {}, flags: [], confirm: false };
    saveProgress();
    nav.focus = '#day-heading';
    location.hash = `${B()}exam/${id}/run`;
    return null;
  },
  'cert-exam-go': (el) => { const a = cert().active; a.pos = Number(el.dataset.pos); a.confirm = false; saveProgress(); return '#day-heading'; },
  'cert-exam-flag': (el) => {
    const a = cert().active;
    const id = el.dataset.q;
    a.flags = a.flags.includes(id) ? a.flags.filter((x) => x !== id) : [...a.flags, id];
    saveProgress();
    return '[data-action="cert-exam-flag"]';
  },
  'cert-exam-cancel': () => { cert().active.confirm = false; saveProgress(); return '[data-action="cert-exam-submit"]'; },
  'cert-exam-submit': (el) => {
    const a = cert().active;
    if (!el.dataset.sure) { a.confirm = true; saveProgress(); return '[data-action="cert-exam-submit"][data-sure]'; }
    const id = a.id;
    stopExamTimer();
    finishExam();
    nav.focus = '#day-heading';
    location.hash = `${B()}exam/${id}/result`;
    return null;
  },
  'cert-pbq-move': (el) => {
    const st = pbqState.get(el.dataset.id);
    st.order = moved(st.order, Number(el.dataset.pos), Number(el.dataset.by));
    const pos = Number(el.dataset.pos) + Number(el.dataset.by);
    return `[data-action="cert-pbq-move"][data-pos="${pos}"][data-by="${el.dataset.by}"]:not([disabled]), [data-action="cert-pbq-move"][data-pos="${pos}"]:not([disabled])`;
  },
  'cert-pbq-check': (el) => {
    const p = cache.pbq.pbqs.find((x) => x.id === el.dataset.id);
    const st = pbqState.get(p.id);
    st.done = true;
    const score = pbqScore(p, st);
    const c = cert();
    c.pbq[p.id] = { best: Math.max(score, c.pbq[p.id]?.best ?? 0), last: score, at: Date.now() };
    recordAnswer(c, { id: `pbq-${p.id}`, o: p.obj }, score >= RULES.readyPbqScore);
    saveProgress();
    return '#cert-pbq-result';
  },
  'cert-pbq-reset': (el) => { pbqState.delete(el.dataset.id); return '#day-heading'; },
};

