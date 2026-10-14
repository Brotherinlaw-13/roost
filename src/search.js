import {execDetached} from './proc.js';
import {statePath} from './config.js';
import {realpathSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, basename} from 'node:path';
import {sessionTickets} from './tickets.js';

const HOME = homedir();
const INDEX = statePath('search-index');
const PROJECT = join(HOME, '.claude', 'projects', HOME.replace(/[/.]/g, '-'));
const MAX_FILES = 40;
const SNIPPET = 90;

// ripgrep ships inside the Claude Code binary, which behaves as `rg` when
// ARGV0=rg. There is no standalone rg on this machine.
let RG = null;
function rgBinary() {
  if (RG) return RG;
  for (const dir of (process.env.PATH || '').split(':')) {
    try {
      const p = realpathSync(join(dir, 'claude'));
      if (statSync(p).isFile()) return (RG = {cmd: p, env: {...process.env, ARGV0: 'rg'}});
    } catch {}
  }
  return (RG = {cmd: 'rg', env: process.env});
}

function rg(args) {
  const {cmd, env} = rgBinary();
  return new Promise(resolve => {
    execDetached(cmd, args, {env, maxBuffer: 64 * 1024 * 1024}, (err, out) => resolve(err && !out ? '' : out));
  });
}

export const termsOf = q => q.trim().toLowerCase().split(/\s+/).filter(t => t.length >= 2);

export function snippetAround(text, term) {
  const flat = text.replace(/\s+/g, ' ');
  const i = flat.toLowerCase().indexOf(term);
  if (i < 0) return null;
  const from = Math.max(0, i - Math.floor(SNIPPET / 3));
  return {before: (from > 0 ? '…' : '') + flat.slice(from, i), match: flat.slice(i, i + term.length), after: flat.slice(i + term.length, from + SNIPPET)};
}

// Conversations where every term was said (by you or by Claude), searched in
// the spoken-text index (indexer.js) rather than the raw transcripts.
// Returns sessionId -> {snippet, who, mtime}, newest first.
export async function searchTranscripts(query) {
  const terms = termsOf(query);
  if (!terms.length) return new Map();
  const base = ['-l', '-i', '-F', '--max-depth', '1', '--glob', '*.txt'];
  let files = null;
  for (const t of terms) {
    const hit = new Set((await rg([...base, t, INDEX])).split('\n').filter(Boolean));
    files = files ? new Set([...files].filter(f => hit.has(f))) : hit;
    if (!files.size) return new Map();
  }
  // Age and order come from the conversation itself, not from its index file
  // (rebuilt at once on the first run).
  const lastActive = f => { try { return statSync(join(PROJECT, `${basename(f, '.txt')}.jsonl`)).mtimeMs; } catch { return statSync(f).mtimeMs; } };
  const ranked = [...files].map(f => ({f, mtime: lastActive(f)})).sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES);
  const out = await rg(['--json', '-i', '-F', '-m', '60', terms[0], ...ranked.map(r => r.f)]);
  // Per conversation, prefer a message holding every term.
  const best = new Map();
  for (const line of out.split('\n')) {
    if (!line.includes('"type":"match"')) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    const id = basename(m.data.path.text, '.txt');
    if (best.get(id)?.all) continue;
    const raw = (m.data.lines.text || '').replace(/\n$/, '');
    const text = raw.slice(2);
    const all = terms.every(t => text.toLowerCase().includes(t));
    if (!best.has(id) || all) best.set(id, {all, who: raw[0] === 'U' ? 'you' : 'claude', snippet: snippetAround(text, terms[0])});
  }
  const result = new Map();
  for (const r of ranked) {
    const id = basename(r.f, '.txt');
    const b = best.get(id);
    result.set(id, {snippet: b?.snippet || null, who: b?.who || null, mtime: r.mtime});
  }
  return result;
}

// Live sessions: every term must appear somewhere in what the row knows —
// name, group, what it is doing, its ticket and the ticket's title, its PRs.
export function matchSession(session, terms, {issues = {}, statuses = {}} = {}) {
  const {primary} = sessionTickets(session);
  const fields = [
    ['name', session.name], ['ticket', primary], ['jira', issues[primary]?.summary],
    ['doing', session.detail], ['asked', session.intent], ['group', session.group],
    ...(session.children || []).filter(c => c.kind === 'pr').map(c => ['pr', statuses[c.href]?.title]),
  ].filter(([, v]) => v);
  const hay = fields.map(([, v]) => String(v).toLowerCase()).join(' \n ');
  if (!terms.every(t => hay.includes(t))) return null;
  const [label, text] = fields.find(([, v]) => String(v).toLowerCase().includes(terms[0])) || fields[0];
  return {field: label, snippet: snippetAround(String(text), terms[0])};
}
