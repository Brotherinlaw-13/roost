import {readFileSync, writeFileSync, renameSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {statePath} from './config.js';

// The board view: one column (lane) per stage of the work. A session's lane is
// worked out from its state, its PRs and its ticket; you can pin it to another
// lane by hand. Groups stay what they are, an epic, shown on each card.
export const LANES = [
  {key: 'me', title: 'Waiting for me'},
  {key: 'dev', title: 'In dev'},
  {key: 'cr', title: 'In CR'},
  {key: 'ready', title: 'Ready to merge'},
  {key: 'others', title: 'Waiting on others'},
  {key: 'released', title: 'Released'},
  {key: 'done', title: 'Done'},
];
const KEYS = new Set(LANES.map(l => l.key));

const prsOf = (session, statuses) => (session.children || [])
  .filter(c => c.kind === 'pr').map(c => statuses[c.href]).filter(Boolean);

// The first rule that fits wins. The PRs and the ticket decide first: a
// session waiting for you whose PR is in review stays in In CR (its card says
// "Needs input"); Waiting for me keeps what waits for you while still in dev.
export function autoLane(session, {statuses = {}, issue = null} = {}) {
  if (session.state === 'failed') return 'me';
  const prs = prsOf(session, statuses);
  const open = prs.filter(p => p.state === 'OPEN' || p.state === 'DRAFT');
  const ready = prs.filter(p => p.state === 'OPEN');
  const jira = issue?.status || '';
  if ((prs.some(p => p.state === 'MERGED') && !open.length) || (issue?.statusCategory === 'done' && !open.length)) return 'released';
  if (/clarif|blocked|on hold|waiting/i.test(jira) || /waiting on others/i.test(session.group || '')) return 'others';
  const changes = ready.some(p => p.review === 'CHANGES_REQUESTED');
  if (!changes && (ready.some(p => p.review === 'APPROVED') || /pass cr|\bqa\b/i.test(jira))) return 'ready';
  if (!changes && (ready.length || /review|\bcr\b/i.test(jira))) return 'cr';
  if (session.state === 'blocked' || session.status === 'waiting') return 'me';
  if (session.state === 'done' && !open.length) return 'done';
  return 'dev';
}

const OVERRIDES = statePath('lanes.json');

export function loadLaneOverrides() {
  try { return JSON.parse(readFileSync(OVERRIDES, 'utf8')); } catch { return {}; }
}

// lane = null: back to the automatic lane.
export function setLaneOverride(id, lane) {
  const all = loadLaneOverrides();
  if (lane && KEYS.has(lane)) all[id] = lane; else delete all[id];
  mkdirSync(dirname(OVERRIDES), {recursive: true});
  writeFileSync(`${OVERRIDES}.tmp`, JSON.stringify(all));
  renameSync(`${OVERRIDES}.tmp`, OVERRIDES);
  return all;
}

// {laneKey: [session…]} with the newest activity first, and whether each
// session was pinned by hand.
export function boardLanes(sessions, {statuses, issueOf, overrides = {}}) {
  const lanes = Object.fromEntries(LANES.map(l => [l.key, []]));
  for (const s of sessions) {
    const pinned = KEYS.has(overrides[s.id]);
    const lane = pinned ? overrides[s.id] : autoLane(s, {statuses, issue: issueOf(s)});
    lanes[lane].push({...s, pinned});
  }
  for (const list of Object.values(lanes)) list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return lanes;
}

// Where the selected session is, as [lane index, card index].
export function locate(lanes, id) {
  for (let i = 0; i < LANES.length; i++) {
    const j = lanes[LANES[i].key].findIndex(s => s.id === id);
    if (j >= 0) return [i, j];
  }
  return [-1, -1];
}
