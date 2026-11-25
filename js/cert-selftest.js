// Checks the scoring rules, and every question's answer key in every domain. Run: node js/cert-selftest.js
import fs from 'node:fs';
import { gradeQuestion, emptyCert, recordAnswer, objectiveMetrics, objectiveStatus, examReport, readiness, shuffledIndexes, latestExams, designStatus, designSummary, DESIGN_RULES, lessonDeck } from './cert-logic.js';

let failed = 0;
let passed = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else { failed += 1; console.log(`FAIL  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
};

const mcq = { id: 'm', o: ['1.1'], k: 'mcq', a: [{ ok: false }, { ok: true }, { ok: false }, { ok: false }] };
const multi = { id: 'x', o: ['1.1'], k: 'multi', a: [{ ok: true }, { ok: true }, { ok: false }, { ok: false }] };
const order = { id: 'o', o: ['1.1'], k: 'order', seq: ['a', 'b', 'c'] };
const match = { id: 't', o: ['1.1'], k: 'match', pairs: [['a', '1'], ['b', '2'], ['c', '3']] };
check('mcq right', gradeQuestion(mcq, 1), true);
check('mcq wrong', gradeQuestion(mcq, 0), false);
check('mcq blank', gradeQuestion(mcq, undefined), false);
check('multi exact', gradeQuestion(multi, [1, 0]), true);
check('multi partial is wrong', gradeQuestion(multi, [0]), false);
check('multi extra is wrong', gradeQuestion(multi, [0, 1, 2]), false);
check('order right', gradeQuestion(order, [0, 1, 2]), true);
check('order wrong', gradeQuestion(order, [1, 0, 2]), false);
check('match right', gradeQuestion(match, [0, 1, 2]), true);
check('match incomplete', gradeQuestion(match, [0, null, 2]), false);
check('shuffle is stable', shuffledIndexes(9, 'a'), shuffledIndexes(9, 'a'));
check('shuffle is complete', [...shuffledIndexes(9, 'b')].sort(), [0, 1, 2, 3, 4, 5, 6, 7, 8]);

// Mastery: reading alone must never be enough.
const obj = { id: '1.1', lessons: ['l1'], pool: 12 };
const labs = () => ['lab1'];
const statusOf = (c) => objectiveStatus(objectiveMetrics(obj, c, labs));
const c = emptyCert();
check('empty is not started', statusOf(c), 'not-started');
c.lessons.l1 = 1000;
check('reading only is Learning', statusOf(c), 'learning');
c.labs.lab1 = 1000;
for (let i = 0; i < 12; i += 1) recordAnswer(c, { id: `q${i}`, o: ['1.1'] }, i < 11);
check('lessons, lab and accuracy is Practiced', statusOf(c), 'practiced');
c.reviews.push({ obj: '1.1', at: 1000 + 3600_000, n: 6, r: 6 });
check('a review the same hour does not count', statusOf(c), 'practiced');
c.reviews.push({ obj: '1.1', at: 1000 + 90_000_000, n: 6, r: 5 });
check('a later review passes to Reviewed', statusOf(c), 'reviewed');
c.exams.push({ id: 'a', at: 5, ms: 1, n: 4, right: 4, byDomain: { 1: [4, 4] }, byObj: { 1.1: [4, 4] }, wrong: [] });
check('strong exam evidence is Mastered', statusOf(c), 'mastered');
c.exams.push({ id: 'a', at: 9, ms: 1, n: 4, right: 1, byDomain: { 1: [1, 4] }, byObj: { 1.1: [1, 4] }, wrong: [] });
check('a later poor sitting lowers status', statusOf(c), 'reviewed');
check('latest sitting is used', latestExams(c).length, 1);

const report = examReport('a', [mcq, { ...multi, id: 'x2', o: ['2.5'] }], { m: 1, x2: [0] });
check('exam counts', [report.right, report.n, report.wrong], [1, 2, ['x2']]);
check('exam by domain', report.byDomain, { 1: [1, 1], 2: [0, 1] });

const low = { id: '2.1', lessons: ['l1'], pool: 4 };
const d = emptyCert();
d.lessons.l1 = 1000;
d.reviews.push({ obj: '2.1', at: 1000 + 90_000_000, n: 4, r: 4 });
check('a small objective can still pass review', objectiveMetrics(low, d, () => []).reviewPass, true);

const none = readiness(emptyCert(), Array(27).fill('not-started'), 12);
check('week 16 alone is not ready', [none.ready, none.met], [false, 0]);

// Every answer key in the course must grade as correct, and a wrong response must not.
const rightResponse = (q) => {
  if (q.k === 'mcq' || q.k === 'tf') return q.a.findIndex((a) => a.ok);
  if (q.k === 'multi') return q.a.flatMap((a, i) => (a.ok ? [i] : []));
  if (q.k === 'order') return q.seq.map((_, i) => i);
  return q.pairs.map((_, i) => i);
};
const wrongResponse = (q) => {
  if (q.k === 'mcq' || q.k === 'tf') return q.a.findIndex((a) => !a.ok);
  if (q.k === 'multi') return [q.a.findIndex((a) => !a.ok)];
  const list = rightResponse(q);
  [list[0], list[1]] = [list[1], list[0]];
  return list;
};
const DOMAINS = fs.readdirSync('content/domains').filter((d) => fs.existsSync(`content/domains/${d}/index.json`));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const weekDocs = (d) => fs.readdirSync(`content/domains/${d}`).filter((n) => /^w\d+\.json$/.test(n)).map((n) => readJson(`content/domains/${d}/${n}`));
const ids = new Set();
let total = 0;
for (const dom of DOMAINS) {
  const index = readJson(`content/domains/${dom}/index.json`);
  const exams = readJson(`content/domains/${dom}/exams.json`).exams ?? {};
  const lessonIds = new Set(index.lessons.map((l) => l.id));
  const lessonQs = weekDocs(dom).flatMap((w) => w.lessons.flatMap((l) => l.qs));
  const examQs = Object.values(exams).flatMap((e) => e.qs);
  for (const q of [...lessonQs, ...examQs]) {
    total += 1;
    const key = `${dom}:${q.id}`;
    if (ids.has(key)) check(`unique id ${key}`, false, true);
    ids.add(key);
    if (!gradeQuestion(q, rightResponse(q))) check(`answer key ${key}`, false, true);
    if (gradeQuestion(q, wrongResponse(q))) check(`wrong answer ${key}`, true, false);
    if (!lessonIds.has(q.l)) check(`lesson link ${key}`, q.l, 'a written lesson');
    if (q.a && q.a.some((a) => !a.w)) check(`explanations ${key}`, false, true);
  }
  // Every question the index declares was found and checked, so none can go missing unnoticed.
  check(`${dom}: every lesson question was checked`, lessonQs.length, index.lessons.reduce((n, l) => n + l.q, 0));
  check(`${dom}: every ${index.objectiveLabel.toLowerCase()} has lessons`, index.objectives.filter((o) => !o.lessons.length).map((o) => o.id), []);
}
// One pathway, two measures: neither side may move the other.
const ex1 = { id: 'l1', crit: ['risk', 'senior'], cq: ['d1'] };
const dc = emptyCert();
check('design starts not started', designStatus(ex1, dc.design.l1), 'not-started');
dc.design.l1 = { work: 'notes' };
check('notes alone are in progress', designStatus(ex1, dc.design.l1), 'in-progress');
dc.design.l1.delivered = 1;
check('a deliverable alone is not assessed', designStatus(ex1, dc.design.l1), 'delivered');
dc.design.l1.rate = { 0: 2, 1: 2 };
dc.design.l1.cq = { d1: 1 };
check('no written defense, not assessed', designStatus(ex1, dc.design.l1), 'delivered');
dc.design.l1.defense = 'x'.repeat(DESIGN_RULES.defenseMin);
check('all criteria met', designStatus(ex1, dc.design.l1), 'meets');
dc.design.l1.rate[1] = 1;
check('a partly met criterion is self-assessed', designStatus(ex1, dc.design.l1), 'self-assessed');
dc.design.l1.rate[1] = 2;
dc.design.l1.cq.d1 = 0;
check('a wrong critique is not meets', designStatus(ex1, dc.design.l1), 'self-assessed');
dc.design.l1.cq.d1 = 1;
check('design work leaves objective status alone', objectiveStatus(objectiveMetrics(obj, dc, labs)), 'not-started');
const pass = emptyCert();
for (let i = 0; i < 12; i += 1) recordAnswer(pass, { id: `q${i}`, o: ['1.1'] }, true, 1000);
pass.exams.push({ id: 'a', at: 2000, n: 90, right: 90, byDomain: { 1: [14, 14] }, byObj: { 1.1: [9, 9] }, wrong: [] });
check('a perfect exam leaves design untouched', designSummary([ex1], pass.design).assessed, 0);
check('a perfect exam leaves design status alone', designStatus(ex1, pass.design.l1), 'not-started');
check('summary counts each measure', designSummary([ex1], dc.design).meets, 1);
check('summary has no combined score', Object.keys(designSummary([ex1], dc.design)).includes('score'), false);
// Flashcards from a lesson: the written cards, then one per key term, with nothing asked twice.
const deckOf = lessonDeck({ cards: [['What does volatile mean?', 'Lost at power-off.']], terms: [['Volatile', 'x'], ['RAM', 'Memory.'], ['IP', 'An address.']] });
check('deck: written cards come first', deckOf[0].kind, 'idea');
check('deck: a term already asked about is not repeated', deckOf.map((c) => c.front), ['What does volatile mean?', 'What does “RAM” mean?', 'What does “IP” mean?']);
check('deck: a short term only matches whole words', lessonDeck({ cards: [['Why ship patches?', 'x']], terms: [['IP', 'y']] }).length, 2);
let deckOk = true;
const asked = {};
for (const dom of DOMAINS) {
  asked[dom] = new Set();
  for (const w of weekDocs(dom)) {
    for (const l of w.lessons) {
      const d = lessonDeck(l);
      const fronts = d.map((c) => c.front.toLowerCase());
      if (new Set(fronts).size !== fronts.length || d.length < l.cards.length || d.some((c) => !c.back || c.front.length > 2000 || c.back.length > 2000)) deckOk = false;
      for (const bl of l.blocks) if (bl.diagram) asked[dom].add(bl.diagram);
    }
  }
}
check('deck: every lesson gives well-formed cards with no repeats', deckOk, true);
// Pictures: every one a lesson asks for exists, every illustration is used, and each has words for people who cannot see it.
for (const dom of DOMAINS) {
  const pictures = readJson(`content/domains/${dom}/diagrams.json`);
  check(`${dom} pictures: every picture a lesson asks for exists`, [...asked[dom]].filter((k) => !pictures[k]), []);
  check(`${dom} pictures: every picture is used by a lesson`, Object.keys(pictures).filter((k) => !asked[dom].has(k)), []);
  check(`${dom} pictures: each has a full description and a caption`, Object.entries(pictures).filter(([, v]) => !(v.alt?.length >= 60 && v.caption?.length >= 20 && v.svg.startsWith('<svg'))).map(([k]) => k), []);
  check(`${dom} pictures: illustrations only use theme colours or paint swatches`, Object.entries(pictures).filter(([k, v]) => v.art && k !== 'key-exchange' && /#[0-9a-fA-F]{6}/.test(v.svg)).map(([k]) => k), []);
}
console.log(`${passed + total} checks; ${failed} failed`);
if (failed) process.exitCode = 1;
