import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {resolveConfig, keySequence, DEFAULTS} from '../src/config.js';
import {keyPattern} from '../src/tickets.js';
import {toIssue, buildQuery} from '../src/trackers/linear.js';
import {attachProxied} from '../src/attach.js';
import {promptState} from '../src/prompt.js';
import {createRequire} from 'node:module';

const {Terminal} = createRequire(import.meta.url)('@xterm/headless');
const RULE = '─'.repeat(40);
const screenOf = (text, rows = 8) => new Promise(res => { const t = new Terminal({cols: 60, rows, allowProposedApi: true}); t.write(text, () => res(t)); });

const FOUND = {tracker: 'linear', codeHost: 'none', notesDir: null, quota: false, groups: 'roost'};

test('config: "auto" takes what was found, explicit values win, nested objects merge', () => {
  const c = resolveConfig({codeHost: 'github', github: {org: 'acme'}}, FOUND);
  assert.equal(c.tracker, 'linear');
  assert.equal(c.codeHost, 'github');
  assert.equal(c.github.org, 'acme');
  assert.equal(c.jira.via, DEFAULTS.jira.via);
  assert.equal(c.paneKey, '');
  assert.equal(resolveConfig({notesDir: null}, {...FOUND, notesDir: '/n'}).notesDir, null);
});

test('keySequence: ctrl and alt keys', () => {
  assert.equal(keySequence('ctrl+]'), '\x1d');
  assert.equal(keySequence('ctrl+t'), '\x14');
  assert.equal(keySequence('alt+p'), '\x1bp');
  assert.equal(keySequence('shift+x'), null);
});

test('ticket keys: any KEY-123 by default, only the given prefixes when set', () => {
  assert.deepEqual('fix ENG-42 and HS-123, not abc-1'.match(keyPattern([])), ['ENG-42', 'HS-123']);
  assert.deepEqual('fix ENG-42 and HS-123'.match(keyPattern(['HS'])), ['HS-123']);
});

test('linear: issues map to the shape the card shows', () => {
  const i = toIssue({identifier: 'ENG-7', title: 'Fix it', url: 'https://linear.app/acme/issue/ENG-7/fix-it', description: 'a\n\n\n\nb',
    priorityLabel: 'High', state: {name: 'In Progress', type: 'started'}, assignee: {name: 'Sam'}, cycle: {number: 12, name: null},
    labels: {nodes: [{name: 'Bug'}]}});
  assert.deepEqual([i.key, i.summary, i.status, i.statusCategory, i.type, i.priority, i.assignee, i.sprint, i.description],
    ['ENG-7', 'Fix it', 'In Progress', 'indeterminate', 'Bug', 'High', 'Sam', 'Cycle 12', 'a\n\nb']);
  assert.match(buildQuery(['ENG-7', 'ENG-8']), /i0: issue\(id: "ENG-7"\).*i1: issue\(id: "ENG-8"\)/);
});

test('the pane key is handled by roost and never reaches the session; other keys do', async () => {
  const written = [];
  let exit;
  const fakePty = {spawn: () => ({onData() {}, onExit(fn) { exit = fn; }, write: s => written.push(s), resize() {}, kill() {}})};
  const stdin = Object.assign(new EventEmitter(), {setRawMode() {}, resume() {}, pause() {}});
  const stdout = Object.assign(new EventEmitter(), {columns: 80, rows: 24});
  let toggled = 0;
  const done = attachProxied(fakePty, 'claude', ['attach', 'x'], {env: {}, stdin, stdout, hotkeys: {'\x1d': () => toggled++}});
  stdin.emit('data', Buffer.from('a'));
  stdin.emit('data', Buffer.from('\x1d'));
  stdin.emit('data', Buffer.from('\r'));
  exit({exitCode: 0});
  await done;
  assert.deepEqual(written, ['a', '\r']);
  assert.equal(toggled, 1);
});

test('prompt: empty when "❯" between two rules has nothing or only dim text after it', async () => {
  assert.deepEqual(promptState(await screenOf(`hello\r\n${RULE}\r\n❯ \r\n${RULE}\r\nstatus`)), {found: true, empty: true});
  assert.deepEqual(promptState(await screenOf(`${RULE}\r\n❯ \x1b[2mtry this\x1b[22m\r\n${RULE}`)), {found: true, empty: true});
  assert.deepEqual(promptState(await screenOf(`${RULE}\r\n❯ fix it\r\n${RULE}`)), {found: true, empty: false});
  // Claude puts a no-break space after the marker; a suggestion can be grey instead of dim
  assert.deepEqual(promptState(await screenOf(`${RULE}\r\n❯\u00a0\r\n${RULE}`)), {found: true, empty: true});
  assert.deepEqual(promptState(await screenOf(`${RULE}\r\n❯\u00a0\x1b[38;2;153;153;153mmerge it\x1b[39m\r\n${RULE}`)), {found: true, empty: true});
  assert.deepEqual(promptState(await screenOf(`${RULE}\r\n❯\u00a0\x1b[38;2;255;255;255mmerge it\x1b[39m\r\n${RULE}`)), {found: true, empty: false});
  // a menu cursor is not the input
  assert.deepEqual(promptState(await screenOf('Allow?\r\n❯ 1. Yes\r\n  2. No')), {found: false, empty: false});
});

test('arrows with the input empty go to roost; with text they reach the session', async () => {
  const written = [];
  let exit, emit;
  const fakePty = {spawn: () => ({onData(fn) { emit = fn; }, onExit(fn) { exit = fn; }, write: s => written.push(s), resize() {}, kill() {}})};
  const stdin = Object.assign(new EventEmitter(), {setRawMode() {}, resume() {}, pause() {}});
  const stdout = Object.assign(new EventEmitter(), {columns: 60, rows: 8});
  const asked = [];
  const done = attachProxied(fakePty, 'claude', ['attach', 'x'], {env: {}, stdin, stdout, onArrow: dir => { asked.push(dir); return dir === 'right' ? 'handled' : 'detach'; }});
  const settle = () => new Promise(r => setTimeout(r, 30));
  emit(`\x1b[?1049h${RULE}\r\n❯ \r\n${RULE}`); await settle();
  stdin.emit('data', Buffer.from('\x1b[C'));
  emit(`\x1b[2;3Hhi`); await settle();
  stdin.emit('data', Buffer.from('\x1b[D'));
  emit(`\x1b[2;3H\x1b[K`); await settle();
  stdin.emit('data', Buffer.from('\x1b[D'));
  exit({exitCode: 0});
  const r = await done;
  assert.deepEqual(asked, ['right', 'left']);
  assert.deepEqual(written, ['\x1b[D', '\x1a']);
  assert.equal(r.leaveReason, 'left');
});
