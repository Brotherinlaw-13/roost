import {execDetached} from './proc.js';
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, renameSync, mkdirSync, statSync, openSync, closeSync, rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {toStatus} from './pr.js';
import {config, statePath} from './config.js';

// Your own open PRs and the moment each got its latest verdict, so the pet
// can react when a PR is approved or gets changes requested.
const FILE = statePath('my-prs.json');
const LOCK = `${FILE}.lock`;
const STALE_MS = 3 * 60 * 1000;
const QUERY = `query { viewer { pullRequests(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
  nodes { url number title state isDraft additions deletions latestOpinionatedReviews(first: 20) { nodes { state } } } } } }`;

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export const loadMyPrs = () => readJson(FILE);

// The verdict changes at most once per refresh; the first run records what is
// there now without announcing it.
export function mergePrs(prev, nodes, now = Date.now()) {
  const prs = {};
  for (const n of nodes) {
    const {review, title} = toStatus(n);
    const old = prev?.prs?.[n.url];
    const changedAt = !prev ? 0 : old?.review === review ? old.changedAt : (review ? now : 0);
    prs[n.url] = {title, number: n.number, review, changedAt};
  }
  return {at: now, prs};
}

export function refreshMyPrs() {
  return new Promise(done => {
    const resolve = v => { rmSync(LOCK, {force: true}); done(v); };
    execDetached('gh', ['api', 'graphql', '-f', `query=${QUERY}`], {maxBuffer: 16 * 1024 * 1024, env: process.env}, (err, out) => {
      if (err) return resolve(null);
      let nodes;
      try { nodes = JSON.parse(out).data.viewer.pullRequests.nodes; } catch { return resolve(null); }
      const next = mergePrs(loadMyPrs(), nodes);
      mkdirSync(dirname(FILE), {recursive: true});
      writeFileSync(`${FILE}.tmp`, JSON.stringify(next));
      renameSync(`${FILE}.tmp`, FILE);
      resolve(next);
    });
  });
}

// The pet polls every few seconds; GitHub is asked at most every 3 minutes,
// in a detached child so the poll never waits for it.
export function refreshMyPrsIfStale(script) {
  if (config().codeHost !== 'github') return;
  const cur = loadMyPrs();
  if (cur && Date.now() - cur.at < STALE_MS) return;
  try {
    if (Date.now() - statSync(LOCK).mtimeMs < 60 * 1000) return;
  } catch {}
  closeSync(openSync(LOCK, 'w'));
  spawn(process.execPath, [script, '--refresh-prs'], {detached: true, stdio: 'ignore'}).unref();
}

const PR_KIND = {APPROVED: 'approved', CHANGES_REQUESTED: 'changes'};

export function prItems(my, seen) {
  if (!my) return [];
  return Object.entries(my.prs)
    .filter(([url, p]) => PR_KIND[p.review] && p.changedAt && !(seen[`pr:${url}`] >= p.changedAt))
    .map(([url, p]) => ({id: `pr:${url}`, url, name: `#${p.number} ${p.title}`, kind: PR_KIND[p.review], since: p.changedAt, detail: p.title}));
}
