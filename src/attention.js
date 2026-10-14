import {readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, openSync, readSync, closeSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {prItems} from './myprs.js';
import {config, statePath, LEGACY_DIR} from './config.js';

// "Unread", like mail: a session claims you only if it reached a state that
// needs you AFTER the last time you looked at it. Sessions can sit in
// "Needs input" for days; a pet that flags all of them is noise you would
// learn to ignore.
const HOME = homedir();
const JOBS = join(HOME, '.claude', 'jobs');
const SEEN = statePath('seen.json');
const MUTED = statePath('muted.json');
const QUOTA = join(LEGACY_DIR, 'quota.json');

export const KIND_ORDER = {needs: 0, failed: 1, changes: 2, done: 3, approved: 4};
export const KIND_LABEL = {needs: 'needs you', failed: 'failed', done: 'finished', changes: 'changes requested', approved: 'approved'};

export function kindOf(s) {
  if (s.state === 'failed') return 'failed';
  if (s.state === 'done') return 'done';
  if (s.state === 'blocked' || s.status === 'waiting') return 'needs';
  return null;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(`${path}.tmp`, JSON.stringify(data));
  renameSync(`${path}.tmp`, path);
}

export const readSeen = () => readJson(SEEN);

export function markSeen(ids, at = Date.now()) {
  const seen = readSeen() || {};
  for (const id of ids) seen[id] = at;
  writeJson(SEEN, seen);
}

// Muted: {id: until} in ms, 0 = for good. Expired entries are dropped on read.
export function readMuted(now = Date.now()) {
  const all = readJson(MUTED) || {};
  return Object.fromEntries(Object.entries(all).filter(([, until]) => until === 0 || until > now));
}

export function mute(id, minutes) {
  const muted = readMuted();
  muted[id] = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
  writeJson(MUTED, muted);
}

export function unmute(id) {
  const muted = readMuted();
  delete muted[id];
  writeJson(MUTED, muted);
}

// Five-hour quota used, in percent, as the fleet-quota LaunchAgent last wrote it.
export function quotaUsed() {
  if (!config().quota) return null;
  const q = readJson(QUOTA);
  return typeof q?.five === 'number' ? q.five : null;
}

function tail(path, bytes = 128 * 1024) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally { closeSync(fd); }
}

// When the session entered the state it is in now: the start of the last run
// of timeline entries that share that state.
export function stateSince(id) {
  let entries;
  try {
    entries = tail(join(JOBS, id, 'timeline.jsonl')).trim().split('\n').slice(1)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return null; }
  if (!entries.length) return null;
  const now = entries.at(-1).state;
  let since = Date.parse(entries.at(-1).at);
  for (let i = entries.length - 1; i >= 0 && entries[i].state === now; i--) since = Date.parse(entries[i].at) || since;
  return since;
}

// The first run starts with a clean slate: everything there now counts as
// seen, so only what changes from then on can claim attention.
export function attention(sessions, {seen = readSeen(), muted = readMuted(), now = Date.now(), since = stateSince, myPrs = null} = {}) {
  if (!seen) {
    seen = Object.fromEntries(sessions.map(s => [s.id, now]));
    writeJson(SEEN, seen);
  }
  const items = [];
  for (const s of sessions) {
    const kind = kindOf(s);
    if (!kind) continue;
    const at = since(s.id) || s.updatedAt || 0;
    if (seen[s.id] && at <= seen[s.id]) continue;
    items.push({id: s.id, name: s.name, kind, since: at, detail: s.detail || ''});
  }
  items.push(...prItems(myPrs, seen));
  const shown = items.filter(i => !(i.id in muted)).map(i => ({...i, label: KIND_LABEL[i.kind]}));
  shown.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.since - a.since);
  const names = Object.fromEntries(sessions.map(s => [s.id, s.name]));
  const mutedList = Object.entries(muted).map(([id, until]) => ({id, name: names[id] || id, until}));
  const working = sessions.filter(s => s.status === 'busy' || s.status === 'shell').length;
  return {items: shown, muted: mutedList, working, total: sessions.length, quota: quotaUsed()};
}

export const seenFileExists = () => existsSync(SEEN);
