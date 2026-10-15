import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {ttyOf} from './control.js';
import {config, keySequence} from './config.js';

// The session card in an iTerm pane beside the session (→ inside a session).
// lib/pane.py drives iTerm's Python API (AppleScript can split a tab but
// cannot size the panes). Connecting to iTerm takes most of a second, so the
// helper starts once and stays connected; each request is then quick.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PY = join(ROOT, '.venv', 'bin', 'python');
const SCRIPT = join(ROOT, 'lib', 'pane.py');
const RATIO = 0.4;

// The key that shows or hides the pane while a session is open.
export const paneKeySequence = () => keySequence(config().paneKey);

export const paneSupported = () => process.env.TERM_PROGRAM === 'iTerm.app' && existsSync(PY);

let helper = null;
let seq = 0;
const waiting = new Map();

function start() {
  if (helper) return helper;
  const child = spawn(PY, [SCRIPT], {stdio: ['pipe', 'pipe', 'ignore'], detached: true});
  // Never keeps roost alive; it ends by itself when roost closes its stdin.
  child.unref();
  child.stdin.unref?.();
  child.stdout.unref?.();
  helper = child;
  createInterface({input: child.stdout}).on('line', line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
  const reset = () => {
    if (helper === child) helper = null;
    for (const done of waiting.values()) done({error: 'pane helper stopped'});
    waiting.clear();
  };
  child.on('exit', reset);
  child.on('error', reset);
  child.stdin.on('error', () => {});
  return child;
}

// roost waits on some replies before drawing (leaving a session): a helper
// that hangs must never freeze it.
// A reply that comes after the timeout still reaches onLate: a pane that
// opened slowly must be known, or it is left behind.
const TIMEOUT_MS = {open: 3000, close: 800, alive: 800, open_url: 3000};

function request(req, onLate = null) {
  const child = start();
  const id = ++seq;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (onLate) waiting.set(id, onLate); else waiting.delete(id);
      resolve({error: 'timeout'});
    }, TIMEOUT_MS[req.op] || 800);
    waiting.set(id, msg => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(`${JSON.stringify({...req, id})}\n`);
  });
}

// Connect ahead of time, so the first → is as quick as the rest.
export function warmPanes() {
  if (paneSupported()) start();
}

// Every pane this roost opened, also those still opening: leaving a session
// closes them all, so none is left behind when two requests cross.
const opened = new Set();
const opening = new Set();

// Resolves to the pane's iTerm session id, or null.
export function openPane(id, title = '') {
  const p = requestPane(id, title).then(pane => { opening.delete(p); if (pane) opened.add(pane); return pane; });
  opening.add(p);
  return p;
}

async function requestPane(id, title) {
  const tty = ttyOf(process.pid);
  if (!tty) return null;
  // iTerm starts the pane with its own environment: give it a PATH that finds
  // `claude` (installed next to node) and a socket that is not the pet's.
  const path = `${dirname(process.execPath)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`;
  const demo = process.env.ROOST_DEMO === '1' ? ' ROOST_DEMO=1' : '';
  const command = `/usr/bin/env PATH=${path}${demo} ROOST_SOCKET=/tmp/roost-pane-${id}.sock ${process.execPath} ${join(ROOT, 'bin', 'roost.js')} --card ${id}`;
  const r = await request({op: 'open', tty, ratio: RATIO, command, title}, late => { if (late.pane) opened.add(late.pane); });
  return r.pane || null;
}

function closePanes(ids) {
  const panes = ids.filter(Boolean);
  return panes.length ? request({op: 'close', panes}) : Promise.resolve({});
}

export async function closeAllPanes() {
  await Promise.all([...opening]);
  const ids = [...opened];
  opened.clear();
  await closePanes(ids);
}

// Opens a link in the browser without leaving iTerm (Chrome takes the focus
// even with `open -g`; the helper takes it straight back).
export function openUrlKeepFocus(url) {
  return request({op: 'open_url', url});
}

export const hasPanes = () => opened.size + opening.size > 0;

// The card in a pane closes itself (esc, ←, →): forget the panes iTerm no
// longer has, so the next → opens a new one instead of closing a ghost.
export async function prunePanes() {
  await Promise.all([...opening]);
  if (!opened.size) return;
  const r = await request({op: 'alive', panes: [...opened]});
  if (!Array.isArray(r.panes)) return;
  opened.clear();
  for (const p of r.panes) opened.add(p);
}

// iTerm names each session "w0t0p1:<uuid>"; the card in the pane closes itself.
export const closeOwnPane = () => closePanes([process.env.ITERM_SESSION_ID?.split(':')[1]]);
