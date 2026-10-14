import {execDetached} from './proc.js';
import {config, statePath} from './config.js';
import {readFileSync, writeFileSync, renameSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';

const CACHE = statePath('pr-status.json');
// FleetView's own cache. Read once at start so the first frame already has
// colours; never written, so the two tools cannot race on it.
const FLEETVIEW_CACHE = join(homedir(), '.claude', 'gh-pr-status-cache.json');
const BATCH = 25;

const FRAGMENT = `fragment pr on PullRequest {
  number title state isDraft additions deletions
  latestOpinionatedReviews(first: 20) { nodes { state } }
}`;

export function parsePrUrl(href) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(href || '');
  return m ? {owner: m[1], repo: m[2], number: Number(m[3])} : null;
}

// `latestOpinionatedReviews` = each reviewer's latest review WITH a verdict.
// `reviewDecision` is not used: it is empty in repos that do not require review,
// even with two approvals. Any CHANGES_REQUESTED wins over approvals.
export function toStatus(node) {
  const verdicts = (node.latestOpinionatedReviews?.nodes || []).map(n => n.state);
  let review = null;
  if (verdicts.includes('CHANGES_REQUESTED')) review = 'CHANGES_REQUESTED';
  else if (verdicts.includes('APPROVED')) review = 'APPROVED';
  const state = node.state === 'OPEN' && node.isDraft ? 'DRAFT' : node.state;
  return {number: node.number, title: node.title, state, review, additions: node.additions, deletions: node.deletions};
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadCachedStatuses() {
  const own = readJson(CACHE) || {};
  const fleetview = readJson(FLEETVIEW_CACHE) || {};
  return {...fleetview, ...own};
}

function saveCache(statuses) {
  mkdirSync(dirname(CACHE), {recursive: true});
  const tmp = `${CACHE}.tmp`;
  writeFileSync(tmp, JSON.stringify(statuses));
  renameSync(tmp, CACHE);
}

function gh(query) {
  return new Promise((resolve, reject) => {
    execDetached('gh', ['api', 'graphql', '-f', `query=${query}`], {maxBuffer: 16 * 1024 * 1024, env: process.env}, (err, out, errOut) => {
      if (err) return reject(new Error((errOut || err.message).trim()));
      try { resolve(JSON.parse(out).data || {}); } catch (e) { reject(e); }
    });
  });
}

export function buildQuery(prs) {
  const parts = prs.map((p, i) =>
    `p${i}: repository(owner: ${JSON.stringify(p.owner)}, name: ${JSON.stringify(p.repo)}) { pullRequest(number: ${p.number}) { ...pr } }`);
  return `query { ${parts.join(' ')} }\n${FRAGMENT}`;
}

// Merged and closed PRs never change again, so they are fetched once.
export async function refreshStatuses(hrefs, current) {
  if (config().codeHost !== 'github') return current;
  const todo = [...new Set(hrefs)]
    .filter(h => !['MERGED', 'CLOSED'].includes(current[h]?.state))
    .map(h => ({href: h, ...parsePrUrl(h)}))
    .filter(p => p.number);
  const next = {...current};
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const data = await gh(buildQuery(batch));
    batch.forEach((p, k) => {
      const node = data[`p${k}`]?.pullRequest;
      if (node) next[p.href] = toStatus(node);
    });
  }
  saveCache(next);
  return next;
}

const searchCache = statePath('ticket-prs.json');

export function loadCachedTicketPrs() {
  return readJson(searchCache) || {};
}

function ghSearch(q) {
  return new Promise((resolve, reject) => {
    execDetached('gh', ['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', 'per_page=100'],
      {maxBuffer: 16 * 1024 * 1024, env: process.env}, (err, out, errOut) => {
        if (err) return reject(new Error((errOut || err.message).trim()));
        try { resolve(JSON.parse(out).items || []); } catch (e) { reject(e); }
      });
  });
}

// PRs that carry a ticket key in their TITLE. The search also matches bodies
// that merely mention the key, so those are dropped. GitHub allows at most 5
// OR operators per query, hence groups of 6.
export async function searchTicketPrs(keys, owner = config().github.org) {
  const found = {};
  if (config().codeHost !== 'github' || !owner) return found;
  for (let i = 0; i < keys.length; i += 6) {
    const group = keys.slice(i, i + 6);
    const items = await ghSearch(`${group.join(' OR ')} is:pr org:${owner}`);
    for (const it of items) {
      for (const k of group) {
        if (new RegExp(`\\b${k}\\b`).test(it.title || '')) (found[k] ||= []).push(it.html_url);
      }
    }
  }
  for (const k of Object.keys(found)) found[k] = [...new Set(found[k])].sort();
  mkdirSync(dirname(searchCache), {recursive: true});
  writeFileSync(`${searchCache}.tmp`, JSON.stringify(found));
  renameSync(`${searchCache}.tmp`, searchCache);
  return found;
}
