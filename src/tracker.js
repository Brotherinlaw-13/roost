import {readFileSync, writeFileSync, renameSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {config, statePath} from './config.js';
import {jiraTracker} from './trackers/jira.js';
import {linearTracker} from './trackers/linear.js';

// The ticket tracker roost reads from, as configured: Jira, Linear or none.
// The rest of roost only sees issues: {key, summary, status, statusCategory,
// type, priority, assignee, sprint, description}.
const CACHE = statePath('issue-cache.json');
const LEGACY_CACHE = statePath('jira-cache.json');

function make() {
  const c = config();
  if (c.tracker === 'jira') return jiraTracker(c.jira);
  if (c.tracker === 'linear') return linearTracker(c.linear);
  return null;
}

let tracker;
const current = () => (tracker === undefined ? (tracker = make()) : tracker);

export const trackerLabel = () => current()?.label || 'TICKET';
export const issueUrl = key => current()?.issueUrl(key) || '';

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadCachedIssues() {
  return readJson(CACHE) || readJson(LEGACY_CACHE) || {};
}

export async function refreshIssues(keys, prev) {
  const t = current();
  if (!t || !keys.length) return prev;
  const next = {...prev, ...(await t.fetchIssues(keys))};
  mkdirSync(dirname(CACHE), {recursive: true});
  writeFileSync(`${CACHE}.tmp`, JSON.stringify(next));
  renameSync(`${CACHE}.tmp`, CACHE);
  return next;
}
