// Checks the sync merge rules, encryption and code pairing, without a browser or a network.
// Run: node js/sync-selftest.js
import {
  syncView, viewSnapshot, stampChanges, emptyMeta, toState, mergeStates, applyState, sameState,
  stateProblems, fallbackTime, stableStringify,
} from './sync-state.js';
import { emptyCert } from './cert-logic.js';

const results = [];
const check = (name, actual, expected) => {
  const a = typeof actual === 'string' ? actual : stableStringify(actual);
  const e = typeof expected === 'string' ? expected : stableStringify(expected);
  results.push({ name, pass: a === e, actual: a, expected: e });
};

const T0 = Date.parse('2026-11-20T10:00:00Z');
const clone = (x) => JSON.parse(JSON.stringify(x));

/** A small app document, shaped like store.js's. */
function doc(progress = {}) {
  const p = {};
  for (const [d, over] of Object.entries(progress)) p[d] = { ...emptyCert(), ...over };
  return { schemaVersion: 1, app: 'atlas-for-designers', settings: { theme: 'dark', hideVisuals: false, lastDomain: null }, progress: p };
}

/** A device: a document plus its change record, with the same bookkeeping store.js does on each save. */
function device(d) {
  const dev = { doc: d, meta: emptyMeta(), base: viewSnapshot(d) };
  dev.save = (now) => { const next = viewSnapshot(dev.doc); stampChanges(dev.base, next, dev.meta, now); dev.base = next; };
  dev.state = () => toState(dev.doc, dev.meta, 1);
  dev.apply = (state) => { dev.doc = applyState(dev.doc, state); dev.meta = { t: clone(state.t), del: clone(state.del) }; dev.base = viewSnapshot(dev.doc); };
  return dev;
}

/** One sync: pull the cloud copy, merge, apply locally, upload the merged copy. */
function sync(dev, cloud, now) {
  const merged = cloud.state ? mergeStates(dev.state(), cloud.state, now) : dev.state();
  dev.apply(merged);
  cloud.state = clone(merged);
  return merged;
}

// ─── What is shared ──────────────────────────────────────────────────────────
{
  const v = syncView(doc({ security: { lessons: { 'w1-1': T0 } }, healthcare: { labs: { 'h1-1-lab1': T0 } } }));
  check('View: each domain has its own paths', Object.keys(v).filter((p) => p.endsWith(':lessons')).sort(), ['p:healthcare:lessons', 'p:security:lessons']);
  check('View: settings are not shared', Object.keys(v).some((p) => p.includes('settings')), 'false');
  const withExam = doc({ security: { active: { id: 'a', pos: 3 } } });
  check('View: an exam in progress is not shared', Object.keys(syncView(withExam)).some((p) => p.endsWith(':active')), 'false');
}

// ─── The main case: lessons done on one device show on the other ─────────────
{
  const cloud = {};
  const laptop = device(doc({ security: { lessons: { 'w1-1': T0 - 9000, 'w1-2': T0 - 8000 } } }));
  laptop.save(T0);
  const phone = device(doc({ security: { lessons: { 'w1-3': T0 - 5000 } }, authoring: { lessons: { 'a1-1': T0 - 4000 } } }));
  phone.save(T0 + 1);
  sync(laptop, cloud, T0 + 10);
  sync(phone, cloud, T0 + 20);
  sync(laptop, cloud, T0 + 30);
  check('Join: the phone has every security lesson from both devices', Object.keys(phone.doc.progress.security.lessons).sort(), ['w1-1', 'w1-2', 'w1-3']);
  check('Join: a domain started only on the phone reaches the laptop', Object.keys(laptop.doc.progress.authoring?.lessons ?? {}), ['a1-1']);
  check('Join: both devices hold the same progress', sameState(laptop.state(), phone.state()), 'true');
  check('Join: the phone keeps its own theme', phone.doc.settings.theme, 'dark');

  delete phone.doc.progress.security.lessons['w1-1'];
  phone.save(T0 + 40);
  sync(phone, cloud, T0 + 50);
  sync(laptop, cloud, T0 + 60);
  sync(phone, cloud, T0 + 70);
  check('Delete: un-completing on the phone un-completes on the laptop', 'w1-1' in laptop.doc.progress.security.lessons, 'false');
  check('Delete: it does not come back', 'w1-1' in phone.doc.progress.security.lessons, 'false');

  laptop.doc.progress.security.design['w5-6'] = { work: 'laptop draft', updatedAt: '2026-11-20T10:01:00Z' };
  laptop.save(T0 + 100);
  phone.doc.progress.security.design['w5-6'] = { work: 'phone draft', updatedAt: '2026-11-20T10:02:00Z' };
  phone.save(T0 + 200);
  sync(laptop, cloud, T0 + 300);
  sync(phone, cloud, T0 + 310);
  sync(laptop, cloud, T0 + 320);
  check('Conflict: the later edit wins on both devices', [laptop.doc.progress.security.design['w5-6'].work, phone.doc.progress.security.design['w5-6'].work], ['phone draft', 'phone draft']);

  laptop.doc.progress.security.exams.push({ id: 'a', at: T0 + 400, n: 90, right: 70 });
  laptop.save(T0 + 400);
  sync(laptop, cloud, T0 + 410);
  sync(phone, cloud, T0 + 420);
  check('Logs: a finished practice exam reaches the other device', phone.doc.progress.security.exams.map((e) => e.right), [70]);
}

// ─── Merge laws ──────────────────────────────────────────────────────────────
{
  const a = device(doc({ security: { q: { x: { n: 1, c: 1, at: T0 } } } }));
  const b = device(doc({ security: { q: { x: { n: 2, c: 1, at: T0 } }, labs: { l: T0 } }, healthcare: { lessons: { h: T0 } } }));
  a.doc.progress.security.lessons.k = T0; a.save(T0);
  b.save(T0 + 1);
  const ab = mergeStates(a.state(), b.state(), T0 + 2);
  const ba = mergeStates(b.state(), a.state(), T0 + 2);
  check('Laws: merging A with B equals merging B with A', sameState(ab, ba), 'true');
  check('Laws: merging the result again changes nothing', sameState(mergeStates(ab, a.state(), T0 + 2), ab), 'true');
}

// ─── Odds and ends ───────────────────────────────────────────────────────────
check('Fallback time: a millisecond timestamp value', fallbackTime(T0), T0);
check('Fallback time: an ISO updatedAt', fallbackTime({ updatedAt: '2026-11-20T10:00:00Z' }), T0);
check('State check: rejects other data', stateProblems({ hello: 1 }).length, 1);
check('State check: rejects a strange path', stateProblems({ format: 'atlas-for-designers-sync', v: 1, entries: { '../x': {} }, t: {}, del: {} }).length, 1);
check('State check: accepts a real state', stateProblems(toState(doc({ security: {} }), emptyMeta(), 1)).length, 0);
{
  const old = { format: 'atlas-for-designers-sync', v: 1, entries: {}, t: {}, del: { 'p:security:lessons': { gone: T0 - 500 * 86400000 } } };
  const m = mergeStates(old, toState(doc({ security: {} }), emptyMeta(), 1), T0);
  check('Tombstones: very old ones are forgotten', Object.keys(m.del['p:security:lessons'] ?? {}).length, 0);
}

// ─── Encryption (Web Crypto; runs in Node 20+ and browsers) ──────────────────
{
  const { newSecret, cleanSecret, groupedSecret, deriveKeys, sealState, openState } = await import('./sync-crypto.js');
  const secret = newSecret();
  check('Code: 43 URL-safe characters', /^[A-Za-z0-9_-]{43}$/.test(secret), 'true');
  check('Code: two new codes differ', newSecret() === secret, 'false');
  check('Code: typed with spaces is accepted', cleanSecret(groupedSecret(secret)), secret);
  check('Code: a pasted pairing link is accepted', cleanSecret(`https://marva-a.github.io/atlas/#pair/${secret}`), secret);
  check('Code: a short code is refused', cleanSecret(secret.slice(1)), '');
  const k1 = await deriveKeys(secret);
  const k2 = await deriveKeys(secret);
  check('Keys: the same code gives the same vault on every device', k1.vaultId === k2.vaultId && k1.authToken === k2.authToken, 'true');
  check('Keys: the vault id is 32 hex characters', /^[0-9a-f]{32}$/.test(k1.vaultId), 'true');
  check('Keys: the access key is not the vault id', k1.authToken.includes(k1.vaultId), 'false');
  const state = toState(doc({ security: { lessons: { 'w1-1': T0 }, design: { 'w5-6': { work: 'Private name' } } } }), emptyMeta(), 1);
  const sealed = await sealState(state, k1);
  check('Seal: the private name is not readable in the upload', sealed.includes('Private name'), 'false');
  check('Seal: unlocks with the same code', stableStringify(await openState(sealed, k2)) === stableStringify(state), 'true');
  const other = await deriveKeys(newSecret());
  const fails = async (fn) => { try { await fn(); return 'opened'; } catch { return 'refused'; } };
  check('Seal: a different code cannot unlock it', await fails(() => openState(sealed, other)), 'refused');
  const env = JSON.parse(sealed);
  const flipped = Buffer.from(env.ct, 'base64'); flipped[10] ^= 1;
  check('Seal: a changed copy is refused', await fails(() => openState(JSON.stringify({ ...env, ct: flipped.toString('base64') }), k1)), 'refused');
  check('Seal: a copy moved to another vault is refused', await fails(() => openState(sealed, { ...k1, vaultId: other.vaultId })), 'refused');
}

// ─── Pairing with an 8-digit code ────────────────────────────────────────────
{
  const { newPairCode, cleanPairCode, groupedPairCode, pairId, makeOffer, sealForOffer, openForOffer } = await import('./sync-pair.js');
  const code = newPairCode();
  check('Pair code: 8 digits', /^\d{8}$/.test(code), 'true');
  check('Pair code: typed with a space is accepted', cleanPairCode(groupedPairCode(code)), code);
  check('Pair code: 7 digits is refused', cleanPairCode('1234 567'), '');
  check('Pair code: the same code finds the same pairing', (await pairId(code)) === (await pairId(code)), 'true');
  check('Pair code: the service never sees the code itself', (await pairId(code)).includes(code), 'false');
  const offer = await makeOffer(code);
  const secret = 'S'.repeat(43);
  const sealed = await sealForOffer(secret, offer.pub, code, offer.id);
  check('Pairing: the sync code is not readable in transit', sealed.includes(secret), 'false');
  check('Pairing: the new device unlocks the sync code', await openForOffer(sealed, offer), secret);
  const fails = async (fn) => { try { await fn(); return 'opened'; } catch { return 'refused'; } };
  const other = await makeOffer(code);
  check('Pairing: another device with the same code cannot unlock it', await fails(() => openForOffer(sealed, other)), 'refused');
  const wrongCode = await sealForOffer(secret, offer.pub, '00000000', offer.id);
  check('Pairing: locked with a different code, it cannot be unlocked', await fails(() => openForOffer(wrongCode, offer)), 'refused');
}

export { results };

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('sync-selftest.js')) {
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : ` (got ${r.actual}, expected ${r.expected})`}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}
