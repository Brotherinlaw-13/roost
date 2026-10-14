import {existsSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {statePath} from './config.js';

// `roost --demo`: made-up sessions, tickets, PRs and notes for a fictional
// company, so roost can be shown or recorded without real work on screen.
// Opening a session runs lib/demo-session.js instead of `claude attach`.
// While it runs, the desktop pet shows made-up alerts too (DEMO_FLAG).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_FLAG = statePath('demo');
// Only while the roost that wrote it is alive: a crash must not leave the pet in demo mode.
export function demoOn() {
  if (!existsSync(DEMO_FLAG)) return false;
  try { process.kill(Number(readFileSync(DEMO_FLAG, 'utf8')), 0); return true; } catch { return false; }
}
export function setDemoFlag(on) {
  if (on) writeFileSync(DEMO_FLAG, String(process.pid)); else rmSync(DEMO_FLAG, {force: true});
}

const MIN = 60 * 1000;
const t0 = Date.now();
const pr = n => `https://github.com/acme/app/pull/${n}`;

const SESSIONS = [
  {id: 'demo0001', name: '🦜 [ENG-142] retry storm on the webhook consumer', group: 'Bugs', state: 'blocked', status: 'waiting',
    detail: 'Shall I merge the fix and deploy?', ago: 3, prs: [482], intent: 'The webhook consumer retries every failed message to every consumer group'},
  {id: 'demo0002', name: '🍉 [ENG-150] slow orders dashboard', group: 'Bugs', state: 'working', status: 'busy',
    steps: ['Profiling the orders query', 'Adding an index on orders.created_at', 'Running the test suite', 'Comparing query plans'], ago: 12, prs: []},
  {id: 'demo0003', name: '🦊 [ENG-131] dark mode for settings', group: 'Features', state: 'done', status: 'idle',
    detail: 'PR #476 approved; ready to merge', ago: 25, prs: [476]},
  {id: 'demo0004', name: '🐙 [ENG-160] invoice PDF export', group: 'Features', state: 'working', status: 'busy',
    steps: ['Writing the PDF renderer', 'Adding the line-item table', 'Checking totals against the API'], ago: 40, prs: [490]},
  {id: 'demo0005', name: '🦋 review: payments refactor', group: 'Reviews', state: 'blocked', status: 'waiting',
    detail: 'Left 3 comments; want me to post them?', ago: 55, prs: [471]},
  {id: 'demo0006', name: '🪐 [ENG-118] flaky e2e login test', group: '', state: 'done', status: 'idle',
    detail: 'Fixed: the test now waits for the redirect', ago: 180, prs: [468]},
];

const STATUSES = {
  [pr(482)]: {number: 482, title: 'ENG-142 fix: retry only to the consumer group that failed', state: 'OPEN', review: null, additions: 64, deletions: 12},
  [pr(476)]: {number: 476, title: 'ENG-131 feat: dark mode for settings', state: 'OPEN', review: 'APPROVED', additions: 230, deletions: 41},
  [pr(490)]: {number: 490, title: 'ENG-160 feat: invoice PDF export (wip)', state: 'DRAFT', review: null, additions: 310, deletions: 2},
  [pr(471)]: {number: 471, title: 'Payments: split the charge service', state: 'OPEN', review: 'CHANGES_REQUESTED', additions: 512, deletions: 488},
  [pr(468)]: {number: 468, title: 'ENG-118 test: wait for the login redirect', state: 'MERGED', review: 'APPROVED', additions: 6, deletions: 2},
};

const ISSUES = {
  'ENG-142': {key: 'ENG-142', summary: 'Webhook consumer: a failed message is retried to every consumer group', status: 'In Review', statusCategory: 'indeterminate',
    type: 'Bug', priority: 'High', assignee: 'Sam Rivera', sprint: 'Sprint 31',
    description: 'When a delivery fails, the consumer re-publishes the message to the shared topic.\nEvery consumer group then receives it again, so one slow partner causes a retry storm for all.\n\nExpected: retry only to the group that failed.\n\nSteps:\n1. Make partner B return 500\n2. Send one event\n3. Partners A and C receive it 3 times'},
  'ENG-150': {key: 'ENG-150', summary: 'Orders dashboard takes 9 s to load', status: 'In Progress', statusCategory: 'indeterminate',
    type: 'Bug', priority: 'Medium', assignee: 'Sam Rivera', sprint: 'Sprint 31', description: 'The orders page waits on a query that scans the whole table.'},
  'ENG-131': {key: 'ENG-131', summary: 'Dark mode for the settings pages', status: 'In Review', statusCategory: 'indeterminate',
    type: 'Story', priority: 'Low', assignee: 'Sam Rivera', sprint: 'Sprint 31', description: 'Follow the system theme; add a toggle in Settings → Appearance.'},
  'ENG-160': {key: 'ENG-160', summary: 'Export invoices as PDF', status: 'In Progress', statusCategory: 'indeterminate',
    type: 'Story', priority: 'Medium', assignee: 'Sam Rivera', sprint: 'Sprint 31', description: 'Customers ask for a PDF of each invoice, with line items and totals.'},
  'ENG-118': {key: 'ENG-118', summary: 'Login e2e test fails 1 run in 10', status: 'Done', statusCategory: 'done',
    type: 'Bug', priority: 'Low', assignee: 'Sam Rivera', sprint: 'Sprint 30', description: 'The test clicks before the redirect finishes.'},
};

const NOTES = {
  'ENG-142': ['Root cause: retries go to the shared topic, not the failed group.', 'Fix in PR #482 with a regression test.', 'Next: merge, deploy, watch the dead-letter queue for an hour.'],
};

const PAST = [
  {sessionId: 'past-1', title: 'Set up the staging database snapshot', ago: 26 * 60},
  {sessionId: 'past-2', title: 'Why does the webhook signature check fail on retries?', ago: 3 * 24 * 60},
  {sessionId: 'past-3', title: 'Upgrade the queue client to v5', ago: 6 * 24 * 60},
];

function liveSessions(list) {
  const now = Date.now();
  return list.map(s => {
    const tick = Math.floor((now - t0) / 8000);
    return {
      id: s.id, sessionId: `${s.id}-sid`, name: s.name, state: s.state, status: s.status, alive: true,
      cwd: '~/code/app', detail: s.steps ? s.steps[tick % s.steps.length] : s.detail, intent: s.intent || '',
      tokens: 120000, children: s.prs.map(n => ({kind: 'pr', href: pr(n)})),
      updatedAt: t0 - s.ago * MIN, startedAt: t0 - (s.ago + 30) * MIN, group: s.group,
    };
  });
}

export function demoServices(base) {
  let list = SESSIONS.map(s => ({...s}));
  const find = id => list.find(s => s.id === id);
  return {
    ...base,
    loadSessions: async () => liveSessions(list),
    loadSettings: () => ({groups: ['Bugs', 'Features', 'Reviews'], ignored: [], quota: '5h ███░░░░░░░ 31% ↻2h10m   7d █████░░░░░ 48% ↻3d'}),
    refreshStatuses: async () => STATUSES,
    refreshIssues: async () => ISSUES,
    searchTicketPrs: async () => ({}),
    issueUrl: key => `https://acme.atlassian.net/browse/${key}`,
    trackerLabel: () => 'JIRA',
    loadNotes: key => (NOTES[key] ? {path: `~/notes/${key}.md`, title: key, section: 'Status', lines: NOTES[key], text: NOTES[key].join('\n'), mtime: Date.now()} : null),
    loadTimeline: id => {
      const s = find(id);
      const steps = s?.steps || [s?.detail || 'Started'];
      return steps.map((text, i) => ({at: Date.now() - (steps.length - i) * 3 * MIN, state: s?.state, text}));
    },
    loadPastSessions: () => PAST.map(p => ({sessionId: p.sessionId, title: p.title, cwd: '~/code/app', mtime: Date.now() - p.ago * MIN})),
    transcriptTitle: (_p, id) => ({title: PAST.find(p => p.sessionId === id)?.title || id, cwd: '~/code/app'}),
    pastTranscriptPath: id => `/demo/${id}.jsonl`,
    searchTranscripts: async q => {
      const hits = new Map();
      if (/webhook|retry|signature/i.test(q)) hits.set('past-2', {who: 'claude', mtime: Date.now() - 3 * 24 * 60 * MIN, snippet: {before: 'the ', match: q.split(/\s+/)[0], after: ' check uses the raw body, but retries re-encode it'}});
      return hits;
    },
    refreshIndex: () => {},
    markSeen: () => {},
    openUrl: () => {},
    dispatch: async (prompt, group) => {
      const id = `demo${String(list.length + 1).padStart(4, '0')}`;
      list = [...list, {id, name: `✨ ${prompt.slice(0, 60)}`, group, state: 'working', status: 'busy', steps: ['Reading the code', 'Planning the change'], ago: 0, prs: []}];
      return id;
    },
    resume: async () => 'demo0002',
    stopAndRemove: async id => { list = list.filter(s => s.id !== id); },
    rename: (id, name) => { const s = find(id); if (s) s.name = name; },
    setGroup: async (id, group) => { const s = find(id); if (s) s.group = group; },
    removeGroup: async name => { for (const s of list) if (s.group === name) s.group = ''; },
    attach: async (id, opts = {}) => {
      const pty = (await import('node-pty')).default;
      const {attachProxied} = await import('./attach.js');
      const name = find(id)?.name || id;
      const r = await attachProxied(pty, process.execPath, [join(ROOT, 'lib', 'demo-session.js'), id, name],
        {env: process.env, cwd: process.env.HOME, ...opts});
      const how = r.leaveReason ? {viaArrow: r.leaveReason === 'left', card: r.leaveReason === 'card'} : {viaArrow: false, card: false};
      return {error: null, syncOpen: r.syncOpen, shown: r.shown, keptAlt: r.keptAlt, ...how};
    },
  };
}

// What the desktop pet sees in demo mode: a made-up alert that changes every
// 15 seconds, so the ghost goes through its colours.
export function demoAttention(now = Date.now()) {
  const phase = Math.floor(now / 15000) % 4;
  const at = now - 20000;
  const item = [
    {id: 'demo0001', name: SESSIONS[0].name, kind: 'needs', label: 'needs you', since: at, detail: 'Shall I merge the fix and deploy?'},
    {id: `pr:${pr(476)}`, url: pr(476), name: '#476 ENG-131 feat: dark mode for settings', kind: 'approved', label: 'approved', since: at, detail: 'Approved by Alex'},
    null,
    {id: `pr:${pr(471)}`, url: pr(471), name: '#471 Payments: split the charge service', kind: 'changes', label: 'changes requested', since: at, detail: 'Changes requested by Jo'},
  ][phase];
  return {items: item ? [item] : [], muted: [], working: 2, total: SESSIONS.length, quota: 31};
}
