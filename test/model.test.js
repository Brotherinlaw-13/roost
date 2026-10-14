import test from 'node:test';
import assert from 'node:assert/strict';
import {prColor, pickPr, prCounts, prSummary, buildGroups, filterGroups, ghostPose, msToNextPose} from '../src/model.js';
import {toStatus, buildQuery, parsePrUrl} from '../src/pr.js';

const S = {
  a: {state: 'OPEN', review: 'CHANGES_REQUESTED'},
  b: {state: 'OPEN', review: null},
  c: {state: 'OPEN', review: 'APPROVED'},
  m: {state: 'MERGED', review: 'APPROVED'},
};
const pr = id => ({kind: 'pr', href: id});

test('prColor follows reviews, not checks', () => {
  assert.equal(prColor(S.a), 'error');
  assert.equal(prColor(S.b), 'warning');
  assert.equal(prColor(S.c), 'success');
  assert.equal(prColor(S.m), 'merged');
  assert.equal(prColor({state: 'CLOSED'}), 'merged');
  assert.equal(prColor({state: 'DRAFT', review: 'APPROVED'}), 'warning');
  assert.equal(prColor(undefined), null);
});

test('pickPr shows the most urgent unmerged PR, merged only as fallback', () => {
  assert.equal(pickPr({children: [pr('c'), pr('a'), pr('m')]}, S).href, 'a');
  assert.equal(pickPr({children: [pr('m')]}, S).color, 'merged');
  assert.equal(pickPr({children: [pr('unknown')]}, S), null);
});

test('prCounts dedups across sessions and skips merged', () => {
  const sessions = [{children: [pr('a'), pr('b')]}, {children: [pr('a'), pr('c'), pr('m')]}];
  assert.deepEqual(prCounts(sessions, S), {error: 1, warning: 1, success: 1});
  assert.equal(prSummary([], S), 'no open PRs');
});

test('buildGroups keeps empty persistent groups, hides ignored, no-group last', () => {
  const sessions = [
    {id: '1', name: 'b', group: '02 Bugs'},
    {id: '2', name: 'a', group: '02 Bugs'},
    {id: '3', name: 'x', group: ''},
    {id: '4', name: 'y', group: '10 Later'},
  ];
  const g = buildGroups(sessions, ['01. Agents', '02 Bugs', '07 Old'], ['07 Old']);
  assert.deepEqual(g.map(x => x.name), ['01. Agents', '02 Bugs', '10 Later', '']);
  assert.deepEqual(g[1].sessions.map(s => s.name), ['a', 'b']);
  assert.equal(g[0].sessions.length, 0);
});

test('filterGroups matches anywhere, ignoring case, prefix first', () => {
  const all = ['02 Bugs', 'Bugbash', '03 Working on'];
  assert.deepEqual(filterGroups(all, 'bugs'), ['02 Bugs']);
  assert.deepEqual(filterGroups(all, 'bug'), ['Bugbash', '02 Bugs']);
});

test('ghost blinks half, closed, half, then open for the rest of the cycle', () => {
  assert.deepEqual([0, 70, 130, 200, 2599].map(ghostPose), ['h', 's', 'h', 'o', 'o']);
  assert.equal(msToNextPose(200), 2400);
});

test('toStatus: any CHANGES_REQUESTED wins, draft is its own state', () => {
  const node = (states, extra = {}) => ({number: 1, title: 't', state: 'OPEN', isDraft: false, latestOpinionatedReviews: {nodes: states.map(state => ({state}))}, ...extra});
  assert.equal(toStatus(node(['APPROVED', 'CHANGES_REQUESTED'])).review, 'CHANGES_REQUESTED');
  assert.equal(toStatus(node(['APPROVED'])).review, 'APPROVED');
  assert.equal(toStatus(node([])).review, null);
  assert.equal(toStatus(node([], {isDraft: true})).state, 'DRAFT');
});

test('buildQuery aliases one PR per field', () => {
  const q = buildQuery([parsePrUrl('https://github.com/acme/app/pull/13')]);
  assert.match(q, /p0: repository\(owner: "acme", name: "app"\) \{ pullRequest\(number: 13\)/);
  assert.match(q, /latestOpinionatedReviews/);
});

test('windowLines never returns more than room lines, markers included', async () => {
  const {windowLines} = await import('../src/ui/components.js');
  const lines = Array.from({length: 50}, (_, i) => ({key: `k${i}`}));
  for (const focus of ['k0', 'k25', 'k49']) {
    const w = windowLines(lines, focus, 20);
    assert.ok(w.visible.length + w.above + w.below <= 20);
    assert.ok(w.visible.some(l => l.key === focus));
  }
});

test('rewriteFrame overwrites in place instead of erasing first', async () => {
  const {rewriteFrame} = await import('../src/terminal.js');
  const erase3 = '\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G';
  const out = rewriteFrame(erase3 + 'a\nb\n');
  assert.equal(out, '\x1b[?2026h\x1b[?25l\x1b[2A\x1b[Ga\x1b[K\nb\x1b[K\n\x1b[K\x1b[J\x1b[?2026l');
  assert.doesNotMatch(out, /\x1b\[2K/);
  assert.equal(rewriteFrame('plain text'), 'plain text');
});

test('rewriteFrame writes only the lines that changed', async () => {
  const {rewriteFrame} = await import('../src/terminal.js');
  const erase3 = '\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G';
  const out = rewriteFrame(erase3 + 'a\nB\n', ['a', 'b', '']);
  assert.equal(out, '\x1b[?2026h\x1b[?25l\x1b[2A\n\x1b[GB\x1b[K\n\x1b[J\x1b[?2026l');
  // a different height is written in full
  assert.match(rewriteFrame(erase3 + 'a\nb\nc\n', ['a', 'b', '']), /\x1b\[Ga\x1b\[K\nb/);
});

test('attach proxy helpers: keep escapes, drop text, never split an escape', async () => {
  const {onlyEscapes, textOf, splitPartial} = await import('../src/attach.js');
  const s = 'Waking session ab12…\r\n\x1b[?1049h\x1b[2Jhello';
  assert.equal(onlyEscapes(s), '\x1b[?1049h\x1b[2J');
  assert.equal(textOf(s), 'Waking session ab12…\r\nhello');
  assert.deepEqual(splitPartial('abc\x1b[?104'), ['abc', '\x1b[?104']);
  assert.deepEqual(splitPartial('abc\x1b[?1049h'), ['abc\x1b[?1049h', '']);
  assert.deepEqual(splitPartial('plain'), ['plain', '']);
});

test('resumeOutput waits for the next frame, then closes the sync block once', async () => {
  const t = await import('../src/terminal.js');
  const writes = [];
  const fake = {write: s => { writes.push(s); return true; }};
  t.installFlickerFreeOutput(fake);
  t.suspendOutput();
  fake.write('held-frame');
  assert.equal(writes.length, 0, 'nothing reaches the terminal while suspended');
  t.resumeOutput({closeSync: true});
  fake.write('new-frame');
  assert.deepEqual(writes, ['new-frame\x1b[?2026l']);
  await new Promise(r => setTimeout(r, 120));
  assert.equal(writes.length, 1, 'the fallback does not fire once a frame closed the block');
});

test('the real services expose every function the app calls', async () => {
  const data = await import('../src/data.js');
  const pr = await import('../src/pr.js');
  const jira = await import('../src/tracker.js');
  const search = await import('../src/search.js');
  const attn = await import('../src/attention.js');
  const control = await import('../src/control.js');
  const pane = await import('../src/pane.js');
  const services = {...data, ...pr, ...jira, ...search, ...attn, ...control, ...pane};
  const app = (await import('node:fs')).readFileSync(new URL('../src/ui/App.js', import.meta.url), 'utf8');
  const used = [...new Set([...app.matchAll(/services\.(\w+)/g)].map(m => m[1]))];
  const missing = used.filter(name => typeof services[name] !== 'function');
  assert.deepEqual(missing, [], `services used by App.js but not exported: ${missing.join(', ')}`);
});

test('attention: only what changed after you looked, needs > failed > done', async () => {
  const {attention} = await import('../src/attention.js');
  const sessions = [
    {id: 'a', name: 'old wait', state: 'blocked', status: 'idle'},
    {id: 'b', name: 'new wait', state: 'blocked', status: 'idle'},
    {id: 'c', name: 'finished', state: 'done'},
    {id: 'd', name: 'busy', state: 'working', status: 'busy'},
    {id: 'e', name: 'broke', state: 'failed'},
    {id: 'f', name: 'never seen, waiting', state: 'working', status: 'waiting'},
  ];
  const since = {a: 100, b: 500, c: 600, e: 450, f: 300};
  const r = attention(sessions, {seen: {a: 200, b: 200, c: 200, e: 200}, since: id => since[id]});
  assert.deepEqual(r.items.map(i => i.id), ['b', 'f', 'e', 'c']);
  assert.equal(r.working, 1);
});
