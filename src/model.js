export const ACCENT = 'rgb(150,176,200)';
export const NO_GROUP = '';

// Claude Code's `dark-daltonized` palette (a colour-blind friendly theme), read from the binary,
// so the list matches FleetView colour for colour.
export const THEME = {
  text: 'rgb(255,255,255)',
  success: 'rgb(51,153,255)',
  warning: 'rgb(255,204,0)',
  error: 'rgb(255,102,102)',
  inactive: 'rgb(153,153,153)',
  claude: 'rgb(255,153,51)',
  selection: 'rgb(55,55,55)',
  suggestion: 'rgb(153,204,255)',
};

// FleetView's status word: Done / Failed / Stopped once finished, Working while
// the process is busy, Needs input when it waits on you, Idle otherwise.
export function statusWord(s) {
  if (s.state === 'done') return {word: 'Done', color: THEME.success};
  if (s.state === 'failed') return {word: 'Failed', color: THEME.error};
  if (s.state === 'stopped') return {word: 'Stopped', color: THEME.inactive};
  if (s.status === 'busy' || s.status === 'shell') return {word: 'Working', color: undefined};
  if (s.state === 'blocked' || s.status === 'waiting') return {word: 'Needs input', color: THEME.warning};
  return {word: 'Idle', color: undefined, dim: true};
}

export const PR_STYLE = {
  error: {emoji: '🔴', label: 'changes requested'},
  warning: {emoji: '🟡', label: 'awaiting review'},
  success: {emoji: '🟢', label: 'approved'},
  merged: {emoji: '🟣', label: 'merged'},
};

// Colour is decided by reviews only. Checks are deliberately ignored: their
// counters include historical and CANCELLED runs, which kept approved PRs red.
export function prColor(status) {
  if (!status) return null;
  if (status.state === 'MERGED' || status.state === 'CLOSED') return 'merged';
  if (status.state === 'DRAFT') return 'warning';
  if (status.review === 'CHANGES_REQUESTED') return 'error';
  if (status.review === 'APPROVED') return 'success';
  return 'warning';
}

const URGENCY = {error: 0, warning: 1, success: 2, merged: 3};

export function sessionPrs(session, statuses) {
  return (session.children || [])
    .filter(c => c.kind === 'pr' && c.href)
    .map(c => ({href: c.href, status: statuses[c.href] || null, color: prColor(statuses[c.href])}));
}

// The one PR a row shows: the most urgent unmerged one, or a merged one when
// every PR of the session is merged.
export function pickPr(session, statuses) {
  return sessionPrs(session, statuses)
    .filter(p => p.color)
    .sort((a, b) => URGENCY[a.color] - URGENCY[b.color])[0] || null;
}

// Only actionable states. Merged PRs are left out: sessions are closed but not
// deleted, so a merged counter only grows.
export function prCounts(sessions, statuses) {
  const counts = {error: 0, warning: 0, success: 0};
  const seen = new Set();
  for (const s of sessions) {
    for (const p of sessionPrs(s, statuses)) {
      if (seen.has(p.href)) continue;
      seen.add(p.href);
      if (p.color in counts) counts[p.color]++;
    }
  }
  return counts;
}

export function prSummary(sessions, statuses) {
  const counts = prCounts(sessions, statuses);
  const parts = ['error', 'warning', 'success']
    .filter(k => counts[k])
    .map(k => `${PR_STYLE[k].emoji} ${counts[k]} ${PR_STYLE[k].label}`);
  return parts.length ? parts.join('  ·  ') : 'no open PRs';
}

// Same buckets as FleetView's header: waiting on you, finished, everything else.
export function stateCounts(sessions) {
  const counts = {blocked: 0, working: 0, done: 0};
  for (const s of sessions) {
    if (['done', 'failed', 'stopped'].includes(s.state)) counts.done++;
    else if (s.state === 'blocked' || s.status === 'waiting') counts.blocked++;
    else counts.working++;
  }
  return counts;
}

export function stateSummary(sessions) {
  const c = stateCounts(sessions);
  return `${c.blocked} awaiting input · ${c.working} working · ${c.done} completed`;
}

const byName = (a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'});

// Groups persist even when empty (the `fleet-group` store), so a group stays
// until it is deleted on purpose. Sessions with no group go last.
export function buildGroups(sessions, persistent = [], ignored = []) {
  const map = new Map();
  for (const g of persistent) if (g && !ignored.includes(g)) map.set(g, []);
  for (const s of sessions) {
    const g = s.group || NO_GROUP;
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(s);
  }
  for (const list of map.values()) {
    list.sort((a, b) => byName(a.name || '', b.name || '') || a.id.localeCompare(b.id));
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === NO_GROUP) - (b === NO_GROUP) || byName(a, b))
    .filter(([name, list]) => name !== NO_GROUP || list.length)
    .map(([name, list]) => ({name, sessions: list}));
}

export function orderedSessions(groups) {
  return groups.flatMap(g => g.sessions);
}

// Substring match, case-insensitive: the numeric sort prefix ("02 Bugs") must not
// hide a group when you type "bugs". Prefix matches first.
export function filterGroups(groups, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups].sort(byName);
  return groups
    .filter(g => g.toLowerCase().includes(q))
    .sort((a, b) => (b.toLowerCase().startsWith(q) - a.toLowerCase().startsWith(q)) || byName(a, b));
}

export function formatAge(ms, now = Date.now()) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// The ghost blinks every 2.6 s: half-closed, closed, half-closed, 64 ms each.
export const BLINK_PERIOD = 2600;
const BLINK = ['h', 's', 'h'];
export function ghostPose(t) {
  const b = t % BLINK_PERIOD;
  return b < 192 ? BLINK[Math.floor(b / 64)] : 'o';
}
export function msToNextPose(t) {
  const b = t % BLINK_PERIOD;
  return b < 192 ? 64 - (b % 64) : BLINK_PERIOD - b;
}

export function shortCwd(cwd, home) {
  return cwd && home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd || '';
}
