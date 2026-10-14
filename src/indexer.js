#!/usr/bin/env node
// Search index of what was actually SAID in each conversation: the user's
// prompts and Claude's text, one message per line. Transcripts also carry
// system reminders (memory index, CLAUDE.md) on almost every turn, so
// searching them raw matches every conversation for half the words you type.
//
// Incremental: per transcript it remembers how far it has read and only
// appends what is new. Run on its own (roost spawns it in the background).

import {readdirSync, statSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, rmSync, openSync, readSync, closeSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {statePath} from './config.js';
const HOME = homedir();
export const PROJECT = join(HOME, '.claude', 'projects', HOME.replace(/[/.]/g, '-'));
export const INDEX = statePath('search-index');
const STATE = join(INDEX, 'state.json');

// Text parts only; a part that opens with "<" is a system wrapper.
export function spokenText(e) {
  if (!e || e.isMeta) return null;
  const c = e.message?.content;
  const parts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter(p => p.type === 'text').map(p => p.text) : [];
  const text = parts.filter(t => t && !t.trimStart().startsWith('<')).join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (e.type === 'user') return `U\t${text}`;
  if (e.type === 'assistant') return `A\t${text}`;
  return null;
}

function readState() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; }
}

function saveState(state) {
  writeFileSync(`${STATE}.tmp`, JSON.stringify(state));
  renameSync(`${STATE}.tmp`, STATE);
}

// Reads from `from` up to the last complete line. A line still being written
// is left for the next run, so the offset never moves past half a message.
function indexFile(path, out, from, size) {
  const fd = openSync(path, 'r');
  let buf;
  try {
    buf = Buffer.alloc(size - from);
    readSync(fd, buf, 0, buf.length, from);
  } finally { closeSync(fd); }
  const end = buf.lastIndexOf(0x0a);
  if (end < 0) return from;
  const lines = [];
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (line.length > 2_000_000 || (!line.includes('"type":"user"') && !line.includes('"type":"assistant"'))) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const t = spokenText(e);
    if (t) lines.push(t);
  }
  if (lines.length) appendFileSync(out, `${lines.join('\n')}\n`);
  return from + end + 1;
}

export async function updateIndex() {
  mkdirSync(INDEX, {recursive: true});
  const state = readState();
  let files;
  try { files = readdirSync(PROJECT).filter(f => f.endsWith('.jsonl')); } catch { return 0; }
  let touched = 0;
  for (const f of files) {
    const id = f.slice(0, -6);
    const path = join(PROJECT, f);
    const size = statSync(path).size;
    const out = join(INDEX, `${id}.txt`);
    let from = state[id]?.offset || 0;
    if (size < from) { rmSync(out, {force: true}); from = 0; }
    if (size === from) continue;
    state[id] = {offset: indexFile(path, out, from, size)};
    touched++;
    if (touched % 10 === 0) saveState(state);
  }
  saveState(state);
  return touched;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t = Date.now();
  const n = await updateIndex();
  if (process.env.ROOST_INDEX_VERBOSE) console.log(`indexed ${n} transcript(s) in ${Date.now() - t} ms`);
}
