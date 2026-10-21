import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from 'ink-testing-library';
import {html} from '../src/ui/components.js';
import {App} from '../src/ui/App.js';

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const KEY = {down: '\x1b[B', up: '\x1b[A', enter: '\r', esc: '\x1b', ctrlE: '\x05', ctrlR: '\x12', ctrlX: '\x18', backspace: '\x7f'};
const plain = s => s.replace(/\x1b\]8;;[^\x07]*\x07/g, '').replace(/\x1b\[[0-9;]*m/g, '');

const SESSIONS = [
  {id: 'aaaaaaa1', sessionId: 's1', name: '🦜 [HS-1234] fix the thing', state: 'working', status: 'busy', group: '02 Bugs', detail: 'Running tests', updatedAt: Date.now() - 120000,
    children: [{kind: 'pr', href: 'https://github.com/acme/x/pull/1'}]},
  {id: 'aaaaaaa2', sessionId: 's2', name: '🍉 [–] product idea', state: 'blocked', group: '03 Working on', updatedAt: Date.now() - 3600000, children: []},
  {id: 'aaaaaaa3', sessionId: 's3', name: 'loose one', state: 'done', group: '', children: []},
];
const STATUSES = {'https://github.com/acme/x/pull/1': {number: 1, title: 'Fix it', state: 'OPEN', review: 'CHANGES_REQUESTED'}};

function makeServices(calls, overrides = {}) {
  return {
    loadSessions: async () => SESSIONS,
    loadSettings: () => ({groups: ['01. Agents', '02 Bugs', '03 Working on'], ignored: [], quota: '5h █░░ 9%'}),
    refreshStatuses: async (_h, cur) => cur,
    attach: id => { calls.push(['attach', id]); return {error: null, viaArrow: false}; },
    dispatch: async (p, g) => { calls.push(['dispatch', p, g]); return 'bbbbbbb1'; },
    setGroup: async (id, g) => { calls.push(['setGroup', id, g]); },
    removeGroup: async g => { calls.push(['removeGroup', g]); },
    rename: (id, n) => { calls.push(['rename', id, n]); },
    stopAndRemove: async id => { calls.push(['stopAndRemove', id]); },
    openUrl: u => calls.push(['openUrl', u]),
    loadPastSessions: () => [{sessionId: 'old-1', title: 'old conversation about invoices', cwd: '/tmp', mtime: Date.now() - 86400000}],
    resume: async sid => { calls.push(['resume', sid]); return 'ccccccc1'; },
    refreshIssues: async (_k, cur) => ({...cur, 'HS-1234': {key: 'HS-1234', summary: 'The thing is broken', status: 'Code Review', type: 'Bug', priority: 'Major', sprint: 'S141', assignee: 'Alex', statusCategory: 'indeterminate', description: 'Long story\nsecond line'}}),
    searchTicketPrs: async () => ({'HS-1234': ['https://github.com/acme/y/pull/7']}),
    loadNotes: k => ({path: `/home/.ticket-notes/${k}.md`, title: 't', section: 'Status', lines: ['PR open, waiting on Tom'], mtime: 0}),
    loadTimeline: () => [{at: Date.now() - 600000, text: 'Ran the tests'}, {at: Date.now(), text: 'Running tests'}],
    issueUrl: k => `https://jira.example/browse/${k}`,
    refreshIndex: () => {},
    markSeen: ids => { (calls.seen ||= []).push(...ids); },
    searchTranscripts: async q => q.toLowerCase().includes('forge')
      ? new Map([['old-9', {who: 'claude', mtime: Date.now() - 7200000, snippet: {before: 'the Jira ', match: 'forge', after: ' app writes as Product Loop'}}]])
      : new Map(),
    transcriptTitle: () => ({title: 'product loop jira wiring', cwd: '/tmp'}),
    pastTranscriptPath: id => `/tmp/${id}.jsonl`,
    trackerLabel: () => 'JIRA',
    ...overrides,
  };
}

function setup(overrides = {}, initial = {}) {
  const calls = [];
  const services = makeServices(calls, overrides);
  const r = render(html`<${App} services=${services} initial=${{statuses: STATUSES, ...initial}} />`);
  const frame = () => plain(r.lastFrame() || '');
  // Wait for the sessions to be on screen, then a beat more so the input
  // handler bound to that render is live. A fixed sleep raced under load.
  const ready = async () => {
    for (let i = 0; i < 100 && !/fix the thing|no sessions/.test(frame()); i++) await wait(20);
    await wait(150);
  };
  return {...r, calls, services, frame, ready};
}

test('header: name, PR summary, quota and state counts', async () => {
  const {frame, unmount, ready} = setup(); await ready();
  const f = frame();
  assert.match(f, /roost/);
  assert.match(f, /🔴 1 changes requested/);
  assert.match(f, /5h █░░ 9%/);
  assert.match(f, /1 awaiting input · 1 working · 1 completed/);
  unmount();
});

test('list: groups in order, empty groups hidden, inline state + detail, PR emoji', async () => {
  const {frame, unmount, ready} = setup(); await ready();
  const f = frame();
  const order = ['02 Bugs', '03 Working on', 'No group'].map(g => f.indexOf(g));
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), f);
  assert.doesNotMatch(f, /01\. Agents/);
  assert.match(f, /fix the thing\s+🔴 Working · Running tests/);
  assert.match(f, /product idea\s+Needs input/);
  assert.match(f, /loose one\s+Done/);
  unmount();
});

test('arrows move focus; Enter on empty prompt attaches', async () => {
  const {stdin, calls, frame, unmount, ready} = setup(); await ready();
  stdin.write(KEY.down); await wait();
  stdin.write(KEY.enter); await wait();
  assert.deepEqual(calls.at(-1), ['attach', 'aaaaaaa2']);
  unmount();
});

test('typing then Enter dispatches into the focused group', async () => {
  const {stdin, calls, frame, unmount, ready} = setup(); await ready();
  assert.match(frame(), /describe a task for a new session  → «02 Bugs»/);
  stdin.write('investiga'); await wait(); stdin.write(KEY.backspace); stdin.write('a esto'); await wait();
  assert.match(frame(), /› investiga esto/);
  stdin.write(KEY.enter); await wait(120);
  assert.deepEqual(calls.at(-1), ['dispatch', 'investiga esto', '02 Bugs']);
  assert.match(frame(), /launched bbbbbbb1 in «02 Bugs»/);
  unmount();
});

test('ctrl+e: substring search finds "02 Bugs" from "bugs", Enter moves', async () => {
  const {stdin, calls, frame, unmount, ready} = setup(); await ready();
  stdin.write(KEY.down); await wait();
  stdin.write(KEY.ctrlE); await wait();
  stdin.write('bugs'); await wait();
  const f = frame();
  assert.match(f, /Move «🍉 \[–\] product idea» to…/);
  assert.match(f, /  02 Bugs/);
  stdin.write(KEY.enter); await wait();
  assert.deepEqual(calls.at(-1), ['setGroup', 'aaaaaaa2', '02 Bugs']);
  unmount();
});

test('ctrl+e then ctrl+x twice deletes the highlighted group', async () => {
  const {stdin, calls, frame, unmount, ready} = setup(); await ready();
  stdin.write(KEY.ctrlE); await wait();
  stdin.write('agents'); await wait();
  stdin.write(KEY.ctrlX); await wait();
  assert.match(frame(), /ctrl\+x again to delete «01\. Agents»/);
  assert.equal(calls.length, 0);
  stdin.write(KEY.ctrlX); await wait();
  assert.deepEqual(calls.at(-1), ['removeGroup', '01. Agents']);
  unmount();
});

test('ctrl+e offers to create a new group', async () => {
  const {stdin, calls, frame, unmount, ready} = setup(); await ready();
  stdin.write(KEY.ctrlE); await wait();
  stdin.write('09 New'); await wait();
  assert.match(frame(), /\+ create «09 New»/);
  stdin.write(KEY.enter); await wait();
  assert.deepEqual(calls.at(-1), ['setGroup', 'aaaaaaa1', '09 New']);
  unmount();
});

test('ctrl+r renames, ctrl+x asks before stopping and removing', async () => {
  const {stdin, calls, frame, unmount, ready} = setup(); await ready();
  stdin.write(KEY.ctrlR); await wait();
  stdin.write('!'); await wait();
  stdin.write(KEY.enter); await wait();
  assert.deepEqual(calls.at(-1), ['rename', 'aaaaaaa1', '🦜 [HS-1234] fix the thing!']);
  stdin.write(KEY.ctrlX); await wait();
  assert.match(frame(), /Stop and delete/);
  stdin.write(KEY.esc); await wait();
  assert.equal(calls.length, 1);
  stdin.write(KEY.ctrlX); await wait(); stdin.write('y'); await wait();
  assert.deepEqual(calls.at(-1), ['stopAndRemove', 'aaaaaaa1']);
  unmount();
});

test('/resume lists past conversations, Enter resumes and attaches', async () => {
  const {stdin, calls, frame, unmount, ready} = setup(); await ready();
  stdin.write('/resume'); await wait(); stdin.write(KEY.enter); await wait();
  assert.match(frame(), /Resume a past session/);
  assert.match(frame(), /❯ old conversation about invoices\s+1d/);
  assert.match(frame(), /old conversation about invoices/);
  stdin.write(KEY.enter); await wait(120);
  assert.deepEqual(calls.slice(-2), [['resume', 'old-1'], ['attach', 'ccccccc1']]);
  unmount();
});

test('? shows shortcuts, any key closes', async () => {
  const {stdin, frame, unmount, ready} = setup(); await ready();
  stdin.write('?'); await wait();
  assert.match(frame(), /Shortcuts/);
  stdin.write('x'); await wait();
  assert.doesNotMatch(frame(), /Shortcuts/);
  unmount();
});

test('selected row is padded to full width so the bar spans the terminal', async () => {
  const {lastFrame, unmount, ready} = setup(); await ready();
  const row = lastFrame().split('\n').find(l => l.includes('fix the thing'));
  assert.match(row, /\x1b\[48;/);
  unmount();
});

test('delete is instant: the row goes away before stop/rm finish, focus moves on', async () => {
  const {stdin, frame, unmount, ready} = setup({stopAndRemove: () => new Promise(() => {})}); await ready();
  stdin.write(KEY.ctrlX); await wait(); stdin.write('y'); await wait();
  const f = frame();
  assert.doesNotMatch(f, /fix the thing\s+🔴 Working/);
  assert.match(f, /deleted 🦜 \[HS-1234\] fix the thing/);
  assert.match(f, /describe a task for a new session  → «03 Working on»/);
  unmount();
});

test('a failed delete brings the row back with the error', async () => {
  const {stdin, frame, unmount, ready} = setup({stopAndRemove: async () => { throw new Error('boom'); }}); await ready();
  stdin.write(KEY.ctrlX); await wait(); stdin.write('y'); await wait(120);
  const f = frame();
  assert.match(f, /fix the thing/);
  assert.match(f, /could not delete .*boom/);
  unmount();
});

test('status words follow FleetView: Working only while busy, Idle otherwise', async () => {
  const {statusWord} = await import('../src/model.js');
  assert.equal(statusWord({state: 'working', status: 'busy'}).word, 'Working');
  assert.equal(statusWord({state: 'working', status: 'idle'}).word, 'Idle');
  assert.equal(statusWord({state: 'working', status: 'waiting'}).word, 'Needs input');
  assert.equal(statusWord({state: 'blocked', status: 'idle'}).word, 'Needs input');
  assert.equal(statusWord({state: 'done'}).word, 'Done');
});

test('tab opens the session card: Jira, ticket PRs, notes and AI session together', async () => {
  const {stdin, calls, frame, unmount, ready} = setup(); await ready();
  stdin.write('\t'); await wait(120);
  const f = frame();
  assert.match(f, /JIRA\s+HS-1234/);
  assert.match(f, /Code Review · Bug · Major · S141 · Alex/);
  assert.match(f, /The thing is broken/);
  assert.match(f, /PULL REQUESTS\s+2/);
  assert.match(f, /x#1\s+Fix it · changes requested/);
  assert.match(f, /y#7/);
  assert.match(f, /NOTES\s+\/home\/.ticket-notes\/HS-1234.md/);
  assert.match(f, /PR open, waiting on Tom/);
  assert.match(f, /AI SESSION/);
  assert.match(f, /now: Running tests/);
  assert.match(f, /Ran the tests/);
  stdin.write('o'); await wait(); stdin.write('2'); await wait();
  assert.deepEqual(calls.slice(-2), [['openUrl', 'https://jira.example/browse/HS-1234'], ['openUrl', 'https://github.com/acme/y/pull/7']]);
  stdin.write('\x1b[D'); await wait();
  assert.doesNotMatch(frame(), /AI SESSION/);
  unmount();
});

test('→ inside a session (ECARD) lands on its card; ← lands on the list', async () => {
  for (const [card, expectCard] of [[true, true], [false, false]]) {
    const {stdin, frame, unmount, ready} = setup({attach: () => ({error: null, viaArrow: !card, card})}); await ready();
    stdin.write(KEY.enter); await wait(120);
    assert.equal(/AI SESSION/.test(frame()), expectCard, `card=${card}`);
    unmount();
  }
});

test('→ in the list opens the session, like enter', async () => {
  const {stdin, calls, unmount, ready} = setup(); await ready();
  stdin.write(KEY.down); await wait();
  stdin.write('\x1b[C'); await wait();
  assert.deepEqual(calls.at(-1), ['attach', 'aaaaaaa2']);
  unmount();
});

test('card reached with → from a session: ← goes back into that session, esc to the list', async () => {
  let n = 0;
  const {stdin, calls, frame, unmount, ready} = setup({attach: id => { calls.push(['attach', id]); n++; return {error: null, card: n === 1}; }}); await ready();
  stdin.write(KEY.enter); await wait(120);
  assert.match(frame(), /AI SESSION/);
  stdin.write('\x1b[D'); await wait(120);
  assert.equal(calls.filter(c => c[0] === 'attach').length, 2);
  unmount();
});

test('card reached with tab: ← goes back to the list', async () => {
  const {stdin, calls, frame, unmount, ready} = setup(); await ready();
  stdin.write('\t'); await wait();
  stdin.write('\x1b[D'); await wait();
  assert.doesNotMatch(frame(), /AI SESSION/);
  assert.equal(calls.filter(c => c[0] === 'attach').length, 0);
  unmount();
});

test('card: ↑↓ move inside the card; enter opens the ticket, unfolds it, and opens PRs', async () => {
  const long = Array.from({length: 12}, (_, i) => `line ${i + 1} of the ticket`).join('\n');
  const {stdin, calls, frame, unmount, ready} = setup({
    refreshIssues: async () => ({'HS-1234': {key: 'HS-1234', summary: 'The thing is broken', status: 'Code Review', description: long}}),
  }); await ready(); await wait(120);
  stdin.write('\t'); await wait();
  let f = frame();
  assert.match(f, /line 2 of the ticket/);
  assert.doesNotMatch(f, /line 9 of the ticket/);
  assert.match(f, /enter to read all 12 lines/);
  stdin.write(KEY.enter); await wait();
  assert.deepEqual(calls.at(-1), ['openUrl', 'https://jira.example/browse/HS-1234']);
  stdin.write(KEY.down); await wait();
  stdin.write(KEY.enter); await wait();
  f = frame();
  assert.match(f, /line 12 of the ticket/);
  assert.match(f, /enter to fold/);
  stdin.write(KEY.enter); await wait();
  assert.doesNotMatch(frame(), /line 12 of the ticket/);
  stdin.write(KEY.down); await wait();
  stdin.write(KEY.enter); await wait();
  assert.equal(calls.at(-1)[0], 'openUrl');
  assert.match(calls.at(-1)[1], /pull\/1$/);
  assert.equal(calls.filter(c => c[0] === 'attach').length, 0, 'moving inside the card never opens another session');
  unmount();
});

test('ctrl+f search: sessions by name, past conversations by title and by what was said', async () => {
  const {stdin, calls, frame, unmount, ready} = setup(); await ready();
  stdin.write('\x06'); await wait();
  assert.match(frame(), /type to search/);
  stdin.write('thing'); await wait(300);
  let f = frame();
  assert.match(f, /SESSIONS 1/);
  assert.match(f, /❯ 🦜 \[HS-1234\] fix the thing/);
  assert.match(f, /name: .*thing/);
  stdin.write(KEY.enter); await wait(150);
  assert.deepEqual(calls.at(-1), ['attach', 'aaaaaaa1']);

  stdin.write('\x06'); await wait();
  stdin.write('forge'); await wait(300);
  f = frame();
  assert.match(f, /PAST CONVERSATIONS 1/);
  assert.match(f, /product loop jira wiring/);
  assert.match(f, /claude said: the Jira forge app writes as Product Loop/);
  stdin.write(KEY.enter); await wait(200);
  assert.deepEqual(calls.slice(-2), [['resume', 'old-9'], ['attach', 'ccccccc1']]);
  unmount();
});

test('search matches every word, across fields; esc closes', async () => {
  const {stdin, frame, unmount, ready} = setup(); await ready();
  stdin.write('\x06'); await wait();
  stdin.write('product idea'); await wait(300);
  assert.match(frame(), /SESSIONS 1/);
  stdin.write(' zzz'); await wait(300);
  assert.match(frame(), /nothing found/);
  stdin.write(KEY.esc); await wait();
  assert.doesNotMatch(frame(), /search ›/);
  unmount();
});

test('opening a session or its card marks it seen; --open opens it on start', async () => {
  const {stdin, calls, unmount, ready} = setup(); await ready();
  stdin.write('\t'); await wait();
  assert.ok((calls.seen || []).includes('aaaaaaa1'));
  unmount();
  const c2 = [];
  const r = render(html`<${App} services=${makeServices(c2)} initial=${{statuses: {}, openId: 'aaaaaaa2'}} />`);
  await wait(300);
  assert.ok(c2.some(c => c[0] === 'attach' && c[1] === 'aaaaaaa2'));
  r.unmount();
});

test('→ inside a session in iTerm: card in a side pane, back into the session; → again closes it; ← closes it too', async () => {
  const results = [{card: true, syncOpen: true}, {card: true, syncOpen: true}, {card: true, syncOpen: true}, {viaArrow: true}];
  const t = setup({
    attach: id => { t.calls.push(['attach', id]); return results.shift() || {}; },
    paneSupported: () => true,
    openPane: id => { t.calls.push(['openPane', id]); t.panes = 1; return Promise.resolve(`pane-${id}`); },
    hasPanes: () => t.panes > 0,
    closeAllPanes: async () => { t.calls.push(['closeAllPanes']); t.panes = 0; },
  }, {echoMs: 0});
  await t.ready();
  t.stdin.write(KEY.enter);
  for (let i = 0; i < 50 && t.calls.filter(c => c[0] === 'attach').length < 5; i++) await wait(20);
  await wait(100);
  assert.deepEqual(t.calls.filter(c => ['attach', 'openPane', 'closeAllPanes'].includes(c[0])), [
    ['attach', 'aaaaaaa1'], ['openPane', 'aaaaaaa1'], ['attach', 'aaaaaaa1'], ['closeAllPanes'],
    ['attach', 'aaaaaaa1'], ['openPane', 'aaaaaaa1'], ['attach', 'aaaaaaa1'], ['closeAllPanes'], ['attach', 'aaaaaaa1'],
  ]);
  assert.match(t.frame(), /fix the thing/);
  t.unmount();
});

test('--card <id>: only the card, esc closes its own pane', async () => {
  const calls = [];
  const services = makeServices(calls, {closeOwnPane: () => calls.push(['closeOwnPane'])});
  const r = render(html`<${App} services=${services} initial=${{statuses: STATUSES, paneId: 'aaaaaaa1'}} />`);
  const frame = () => plain(r.lastFrame() || '');
  for (let i = 0; i < 100 && !/The thing is broken/.test(frame()); i++) await wait(20);
  await wait(150);
  assert.match(frame(), /HS-1234/);
  assert.doesNotMatch(frame(), /PR summary|awaiting input/);
  r.stdin.write(KEY.esc);
  await wait(100);
  assert.deepEqual(calls.filter(c => c[0] === 'closeOwnPane'), [['closeOwnPane']]);
  r.unmount();
});

test('a card exit right after going back in is the session echoing →: the pane stays open', async () => {
  const results = [{card: true, syncOpen: true}, {card: true, syncOpen: true}, {viaArrow: true}];
  const t = setup({
    attach: id => { t.calls.push(['attach', id]); return results.shift() || {}; },
    paneSupported: () => true,
    openPane: id => { t.calls.push(['openPane', id]); t.panes = 1; return Promise.resolve(`pane-${id}`); },
    hasPanes: () => t.panes > 0,
    closeAllPanes: async () => { t.calls.push(['closeAllPanes']); t.panes = 0; },
  }, {echoMs: 60000});
  await t.ready();
  t.stdin.write(KEY.enter);
  for (let i = 0; i < 50 && t.calls.filter(c => c[0] === 'attach').length < 4; i++) await wait(20);
  await wait(100);
  assert.deepEqual(t.calls.filter(c => ['attach', 'openPane', 'closeAllPanes'].includes(c[0])), [
    ['attach', 'aaaaaaa1'], ['openPane', 'aaaaaaa1'], ['attach', 'aaaaaaa1'], ['attach', 'aaaaaaa1'], ['closeAllPanes'], ['attach', 'aaaaaaa1'],
  ]);
  t.unmount();
});

test('terminal replies arriving after a session never land in the prompt', async () => {
  const t = setup(); await t.ready();
  t.stdin.write('\x1bP>|iTerm2 3.7.4\x1b\\\x1b[?64;1;2;4;6;17;18;21;22;52c');
  await wait();
  t.stdin.write('hola');
  await wait();
  assert.match(t.frame(), /› hola/);
  assert.doesNotMatch(t.frame(), /iTerm2|52c/);
  t.unmount();
});

test('← inside a session with the card open closes the card and stays in; ← again goes to the list', async () => {
  const results = [{card: true, syncOpen: true}, {viaArrow: true, syncOpen: true}, {viaArrow: true, syncOpen: true}];
  const t = setup({
    attach: id => { t.calls.push(['attach', id]); return results.shift() || {}; },
    paneSupported: () => true,
    openPane: id => { t.calls.push(['openPane', id]); t.panes = 1; return Promise.resolve(`pane-${id}`); },
    hasPanes: () => t.panes > 0,
    prunePanes: async () => {},
    closeAllPanes: async () => { t.calls.push(['closeAllPanes']); t.panes = 0; },
  }, {echoMs: 0});
  await t.ready();
  t.stdin.write(KEY.enter);
  for (let i = 0; i < 50 && t.calls.filter(c => c[0] === 'attach').length < 3; i++) await wait(20);
  await wait(100);
  assert.deepEqual(t.calls.filter(c => ['attach', 'openPane', 'closeAllPanes'].includes(c[0])), [
    ['attach', 'aaaaaaa1'], ['openPane', 'aaaaaaa1'], ['attach', 'aaaaaaa1'], ['closeAllPanes'], ['attach', 'aaaaaaa1'],
  ]);
  assert.match(t.frame(), /fix the thing/);
  t.unmount();
});

test('a card pane that closed itself is forgotten: the next → opens a new one', async () => {
  const results = [{card: true, syncOpen: true}, {card: true, syncOpen: true}, {viaArrow: true}];
  const t = setup({
    attach: id => { t.calls.push(['attach', id]); return results.shift() || {}; },
    paneSupported: () => true,
    openPane: id => { t.calls.push(['openPane', id]); t.panes = 1; return Promise.resolve(`pane-${id}`); },
    hasPanes: () => t.panes > 0,
    prunePanes: async () => { t.panes = 0; },
    closeAllPanes: async () => { t.calls.push(['closeAllPanes']); t.panes = 0; },
  }, {echoMs: 0});
  await t.ready();
  t.stdin.write(KEY.enter);
  for (let i = 0; i < 50 && t.calls.filter(c => c[0] === 'attach').length < 3; i++) await wait(20);
  await wait(100);
  assert.deepEqual(t.calls.filter(c => ['openPane'].includes(c[0])).length, 2);
  t.unmount();
});

test('paneAlwaysOpen: the card pane opens before the session; → hides it for this visit', async () => {
  const results = [{card: true, syncOpen: true}, {viaArrow: true, syncOpen: true}];
  const t = setup({
    attach: id => { t.calls.push(['attach', id]); return results.shift() || {}; },
    paneSupported: () => true,
    openPane: id => { t.calls.push(['openPane', id]); t.panes = 1; return Promise.resolve(`pane-${id}`); },
    hasPanes: () => t.panes > 0,
    prunePanes: async () => {},
    closeAllPanes: async () => { t.calls.push(['closeAllPanes']); t.panes = 0; },
  }, {echoMs: 0, paneAlwaysOpen: true});
  await t.ready();
  t.stdin.write(KEY.enter);
  for (let i = 0; i < 50 && t.calls.filter(c => c[0] === 'attach').length < 2; i++) await wait(20);
  await wait(100);
  assert.deepEqual(t.calls.filter(c => ['attach', 'openPane', 'closeAllPanes'].includes(c[0])), [
    ['openPane', 'aaaaaaa1'], ['attach', 'aaaaaaa1'], ['closeAllPanes'], ['attach', 'aaaaaaa1'],
  ]);
  assert.match(t.frame(), /fix the thing/);
  t.unmount();
});

test('/auto-panel turns the always-open card pane on and off and saves it', async () => {
  const saved = [];
  const t = setup({setConfigValue: (k, v) => saved.push([k, v]), paneSupported: () => true});
  await t.ready();
  t.stdin.write('/auto-panel'); await wait();
  t.stdin.write(KEY.enter); await wait();
  assert.match(t.frame(), /auto panel on/);
  t.stdin.write('/auto-panel off'); await wait();
  t.stdin.write(KEY.enter); await wait();
  assert.match(t.frame(), /auto panel off/);
  assert.deepEqual(saved, [['paneAlwaysOpen', true], ['paneAlwaysOpen', false]]);
  assert.equal(t.calls.filter(c => c[0] === 'dispatch').length, 0, 'a command never launches a session');
  t.unmount();
});

test('with the auto panel on, ← goes back to the list instead of closing the card', async () => {
  const results = [{viaArrow: true, syncOpen: true}];
  const t = setup({
    attach: id => { t.calls.push(['attach', id]); return results.shift() || {}; },
    paneSupported: () => true,
    openPane: id => { t.calls.push(['openPane', id]); t.panes = 1; return Promise.resolve(`pane-${id}`); },
    hasPanes: () => t.panes > 0,
    prunePanes: async () => {},
    closeAllPanes: async () => { t.calls.push(['closeAllPanes']); t.panes = 0; },
  }, {echoMs: 0, paneAlwaysOpen: true});
  await t.ready();
  t.stdin.write(KEY.enter);
  for (let i = 0; i < 50 && !t.calls.some(c => c[0] === 'closeAllPanes'); i++) await wait(20);
  await wait(150);
  assert.deepEqual(t.calls.filter(c => ['attach', 'openPane', 'closeAllPanes'].includes(c[0])), [
    ['openPane', 'aaaaaaa1'], ['attach', 'aaaaaaa1'], ['closeAllPanes'],
  ]);
  assert.match(t.frame(), /describe a task/);
  t.unmount();
});

test('/auto-focus switches whether links come to the front and saves it', async () => {
  const saved = [];
  const t = setup({setConfigValue: (k, v) => saved.push([k, v])}, {followLinks: true});
  await t.ready();
  t.stdin.write('/auto-focus'); await wait();
  t.stdin.write(KEY.enter); await wait();
  assert.match(t.frame(), /auto focus off/);
  t.stdin.write('/auto-focus on'); await wait();
  t.stdin.write(KEY.enter); await wait();
  assert.match(t.frame(), /auto focus on/);
  assert.deepEqual(saved, [['followLinks', false], ['followLinks', true]]);
  t.unmount();
});

test('a deleted session comes back when a resume reuses its id', async () => {
  let list = SESSIONS;
  const {stdin, frame, unmount, ready} = setup({loadSessions: async () => list}); await ready();
  stdin.write(KEY.ctrlX); await wait(); stdin.write('y'); await wait();
  assert.doesNotMatch(frame(), /fix the thing\s+🔴 Working/);
  list = SESSIONS.slice(1); await wait(3200);
  list = SESSIONS; await wait(3200);
  assert.match(frame(), /fix the thing\s+🔴 Working/);
  unmount();
});
