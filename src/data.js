import {execFile, spawnSync} from 'node:child_process';
import {execDetached} from './proc.js';
import {rawWrite, SYNC_ON} from './terminal.js';
import {config, statePath, LEGACY_DIR} from './config.js';
import {readFileSync, writeFileSync, renameSync, existsSync, rmSync, readdirSync, statSync, openSync, readSync, closeSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const HOME = homedir();
const JOBS = join(HOME, '.claude', 'jobs');
const PROJECTS = join(HOME, '.claude', 'projects');
const TOOLS = join(HOME, '.claude', 'tools');
const CLAUDE = process.env.ROOST_CLAUDE || 'claude';
const WRAPPER = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'attach-wrapper.sh');
const RETURN_FILE = join(tmpdir(), `roost-return-${process.pid}`);


// Children never get roost's own variables: `claude --bg` or `agents` may boot
// the daemon, and the daemon passes its environment on to every session.
const {ROOST_ONLY: _only, ROOST_PARENT_PID: _ppid, ROOST_AGENTS_RETURN: _ret, ...CHILD_ENV} = process.env;
for (const name of config().parentPidEnv || []) delete CHILD_ENV[name];

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execDetached(cmd, args, {maxBuffer: 16 * 1024 * 1024, env: CHILD_ENV, ...opts}, (err, out, errOut) => {
      if (err) return reject(new Error((errOut || out || err.message).trim().split('\n').pop()));
      resolve(out);
    });
  });
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(path, data) {
  const tmp = `${path}.roost.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

function readGroup(id) {
  try { return readFileSync(join(JOBS, id, 'group'), 'utf8').trim(); } catch { return ''; }
}

export async function loadSessions() {
  // --all also returns completed sessions, which FleetView lists too.
  const all = JSON.parse(await run(CLAUDE, ['agents', '--json', '--all']));
  // ROOST_ONLY=<id>: show one session only; lets end-to-end checks avoid real ones.
  const list = process.env.ROOST_ONLY ? all.filter(s => s.id === process.env.ROOST_ONLY) : all;
  return list.map(s => {
    const st = readJson(join(JOBS, s.id, 'state.json')) || {};
    return {
      id: s.id,
      sessionId: s.sessionId,
      name: s.name || st.name || s.id,
      state: s.state || st.state,
      status: s.status,
      alive: s.pid != null,
      cwd: s.cwd || st.cwd,
      detail: st.detail || '',
      intent: st.displayIntent || st.intent || '',
      tokens: st.tokens || 0,
      children: st.children || [],
      updatedAt: st.updatedAt ? Date.parse(st.updatedAt) || st.updatedAt : s.startedAt,
      startedAt: s.startedAt,
      group: readGroup(s.id),
    };
  });
}

// Groups: a session's group is the `group` file in its job folder. The list
// of groups, kept even when empty, comes from the fleet-group tools when they
// are installed (groups: 'fleet'), else from roost's own store. The quota line
// is written into ~/.claude.json by the fleet-quota tool, when installed.
const GROUPS = statePath('groups.json');

export function loadSettings() {
  const c = config();
  const store = readJson(c.groups === 'fleet' ? join(LEGACY_DIR, 'groups.json') : GROUPS) || {};
  const settings = c.quota ? readJson(join(HOME, '.claude.json')) || {} : {};
  return {
    groups: store.groups || [],
    ignored: store.ignore || [],
    quota: settings.fleetQuota || '',
  };
}

function rememberGroup(name) {
  const store = readJson(GROUPS) || {groups: []};
  if (!store.groups.includes(name)) store.groups.push(name);
  writeJsonAtomic(GROUPS, store);
}

// Opens a session and resolves when it is left. Exit codes from patches 17/18:
// 42 = left with → (open its card), 43 = left with ← (back to the list).
// The wrapper's RETURN_FILE is the fallback for an unpatched attach.
let pty = null;
try { pty = (await import('node-pty')).default; } catch { pty = null; }

function attachEnv() {
  const {ROOST_ONLY, ...env} = process.env;
  const pid = String(process.pid);
  const extra = Object.fromEntries((config().parentPidEnv || []).map(name => [name, pid]));
  return {...env, ...extra, CLAUDE_CODE_PROCESS_WRAPPER: WRAPPER, ROOST_AGENTS_RETURN: RETURN_FILE, ROOST_PARENT_PID: pid};
}

function outcome(status, text, syncOpen, screen = {}) {
  const viaArrow = status === 43 || existsSync(RETURN_FILE);
  rmSync(RETURN_FILE, {force: true});
  const card = status === 42;
  if (status === 0 || card || status === 43) return {error: null, viaArrow, card, syncOpen, ...screen};
  const err = String(text || '').split('\n')
    .filter(l => l.trim() && !/^(Waking|Reconnecting|Session moved|ECARD:)/.test(l.trim())).join(' ');
  return {error: err || `attach exited with code ${status}`, viaArrow: false, card: false, syncOpen, ...screen};
}

export async function attach(id, {keepAlt, hotkeys, onArrow} = {}) {
  rmSync(RETURN_FILE, {force: true});
  if (pty) {
    const {attachProxied} = await import('./attach.js');
    const r = await attachProxied(pty, CLAUDE, ['attach', id], {env: attachEnv(), cwd: HOME, keepAlt, hotkeys, onArrow});
    const leftWithArrow = r.leaveReason ? {viaArrow: r.leaveReason === 'left', card: r.leaveReason === 'card'} : {};
    return {...outcome(r.status, r.text, r.syncOpen, {shown: r.shown, keptAlt: r.keptAlt}), ...leftWithArrow};
  }
  const r = spawnSync(CLAUDE, ['attach', id], {stdio: ['inherit', 'inherit', 'pipe'], env: attachEnv()});
  return outcome(r.status, (r.stderr || '').toString(), false);
}

// Leaves an alternate screen kept by attach (keepAlt) when roost does not go
// back into the session after all; inside a sync block its next frame closes.
export function restoreScreen() {
  rawWrite(`${SYNC_ON}\x1b[?1049l`);
}

export async function cancelAttach() {
  if (pty) (await import('./attach.js')).cancelAttach();
}

const parseId = out => /attach ([0-9a-f]{8})/.exec(out)?.[1] || null;

// New sessions always start in ~, never in the folder roost was launched from:
// a session started inside another ticket's worktree inherits the wrong cwd.
// `ticket start` creates the right worktree from there.
const launchFlags = () => (config().launchPermissionMode ? ['--permission-mode', config().launchPermissionMode] : []);

export async function dispatch(prompt, group) {
  const out = await run(CLAUDE, ['--bg', ...launchFlags(), prompt], {cwd: HOME});
  const id = parseId(out);
  if (id && group) await setGroup(id, group);
  return id;
}

export async function resume(sessionId, cwd) {
  const out = await run(CLAUDE, ['--bg', ...launchFlags(), '--resume', sessionId],
    {cwd: cwd && existsSync(cwd) ? cwd : HOME});
  return parseId(out);
}

export async function stopAndRemove(id) {
  await run(CLAUDE, ['stop', id]).catch(() => {});
  await run(CLAUDE, ['rm', id]);
}

// `nameSource: "user"` keeps the auto-namer from overwriting a manual name.
export function rename(id, name) {
  const path = join(JOBS, id, 'state.json');
  const st = readJson(path);
  if (!st) throw new Error(`no state.json for ${id}`);
  writeJsonAtomic(path, {...st, name, nameSource: 'user'});
}

export async function setGroup(id, group) {
  if (!group) {
    rmSync(join(JOBS, id, 'group'), {force: true});
    return;
  }
  if (config().groups === 'fleet') return void await run(join(TOOLS, 'fleet-group-set'), [group, id]);
  writeFileSync(join(JOBS, id.slice(0, 8), 'group'), `${group}\n`);
  rememberGroup(group);
}

export async function removeGroup(name) {
  if (config().groups === 'fleet') return void await run(join(TOOLS, 'fleet-group'), ['rm', name]);
  const store = readJson(GROUPS) || {groups: []};
  writeJsonAtomic(GROUPS, {...store, groups: store.groups.filter(g => g !== name)});
  for (const id of readdirSync(JOBS)) {
    const f = join(JOBS, id, 'group');
    try { if (readFileSync(f, 'utf8').trim() === name) rmSync(f, {force: true}); } catch {}
  }
}

// `-g` keeps the browser in the background, so roost keeps the focus and
// several PRs can be opened in a row.
export function openUrl(url, {background = true} = {}) {
  execFile('open', background ? ['-g', url] : [url], () => {});
}

function readRange(path, fromEnd, bytes) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, fromEnd ? size - len : 0);
    return buf.toString('utf8');
  } finally { closeSync(fd); }
}

function firstPrompt(head) {
  for (const line of head.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'user' || e.isMeta) continue;
    const c = e.message?.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.find(p => p.type === 'text')?.text : null;
    if (text && !text.startsWith('<')) return {text: text.replace(/\s+/g, ' ').trim(), cwd: e.cwd || null};
  }
  return {text: null, cwd: null};
}

// Titles are appended to the transcript over time; the last of each kind wins.
function latestTitles(tail) {
  const t = {};
  for (const line of tail.split('\n')) {
    if (!line.includes('Title') && !line.includes('agentName')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.agentName) t.agentName = e.agentName;
    if (e.customTitle) t.customTitle = e.customTitle;
    if (e.aiTitle) t.aiTitle = e.aiTitle;
  }
  return t;
}

const projectDir = dir => join(PROJECTS, dir.replace(/[/.]/g, '-'));

export function transcriptTitle(path, sessionId) {
  const t = latestTitles(readRange(path, true, 128 * 1024));
  const {text, cwd} = firstPrompt(readRange(path, false, 64 * 1024));
  const title = t.agentName || t.customTitle || t.aiTitle || text || sessionId.slice(0, 8);
  return {title: title.replace(/\s+/g, ' ').trim(), cwd};
}

// Past conversations for /resume, built like FleetView's picker: only the home
// project (where sessions start), newest first, none that is already listed,
// titled agent name > custom title > AI title > first prompt.
export function loadPastSessions(listedSessionIds, limit = 200) {
  const base = projectDir(HOME);
  let names;
  try { names = readdirSync(base); } catch { return []; }
  const files = [];
  for (const f of names) {
    if (!f.endsWith('.jsonl')) continue;
    const sessionId = f.slice(0, -6);
    if (listedSessionIds.has(sessionId)) continue;
    const path = join(base, f);
    const st = statSync(path);
    if (st.size > 0) files.push({sessionId, path, mtime: st.mtimeMs});
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, limit).map(f => ({sessionId: f.sessionId, mtime: f.mtime, ...transcriptTitle(f.path, f.sessionId)}));
}

// Keeps the spoken-text search index current. Runs as a child process: the
// first build reads every transcript (a few seconds) and must not freeze the UI.
let indexer = null;
export function refreshIndex() {
  if (indexer) return;
  indexer = execFile(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'indexer.js')], {env: CHILD_ENV}, () => { indexer = null; });
}

export function pastTranscriptPath(sessionId) {
  return join(projectDir(HOME), `${sessionId}.jsonl`);
}

// The session's recent steps: each change of what it said it was doing.
// Only the tail is read: a long session's timeline runs to megabytes.
export function loadTimeline(id, limit = 6) {
  let lines;
  try {
    lines = readRange(join(JOBS, id, 'timeline.jsonl'), true, 256 * 1024).trim().split('\n').slice(1);
  } catch { return []; }
  const steps = [];
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const text = (e.detail || e.text || '').trim();
    if (text && text !== steps.at(-1)?.text) steps.push({at: Date.parse(e.at) || 0, state: e.state, text});
  }
  return steps.slice(-limit);
}

const STATUS_HEADING = /^#{1,4}\s*(current status|status|next steps|blockers?|estado)/i;

// The notes title plus its status / next-steps section; else the opening lines.
export function loadNotes(key, limit = 6) {
  const dir = config().notesDir;
  if (!dir) return null;
  const path = join(dir, `${key}.md`);
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  const lines = text.split('\n');
  const title = (lines.find(l => /^#\s/.test(l)) || '').replace(/^#\s*/, '');
  const at = lines.findIndex(l => STATUS_HEADING.test(l));
  const from = at >= 0 ? lines.slice(at + 1) : lines.slice(lines.findIndex(l => /^#\s/.test(l)) + 1);
  const body = [];
  for (const l of from) {
    if (at >= 0 && /^#{1,4}\s/.test(l)) break;
    if (l.trim()) body.push(l.trim());
    if (body.length >= limit) break;
  }
  return {path, title, section: at >= 0 ? lines[at].replace(/^#+\s*/, '') : null, lines: body, text, mtime: statSync(path).mtimeMs};
}
