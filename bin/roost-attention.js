#!/usr/bin/env node
// What claims your attention right now, as JSON, for the desktop pet.
//   roost-attention              -> {items:[{id,name,kind,label,since,detail,url?}], muted, working, total, quota}
//   roost-attention --seen ID…   -> mark sessions / PRs as seen
//   roost-attention --seen-all   -> mark everything that claims attention as seen
//   roost-attention --open ID    -> hand ID to the running roost; prints its tty, or nothing if none
//   roost-attention --open-pr URL-> open the PR in the browser and mark it seen
//   roost-attention --mute ID MIN-> no alerts from ID for MIN minutes (0 = for good)
//   roost-attention --unmute ID
//   roost-attention --dispatch TEXT -> start a session for the Jira ticket in TEXT; prints "KEY\tGROUP"
//   roost-attention --refresh-prs   -> refresh your open PRs (run detached by the poll)
import {fileURLToPath} from 'node:url';
import {loadSessions, dispatch, openUrl} from '../src/data.js';
import {attention, markSeen, mute, unmute} from '../src/attention.js';
import {sendOpen} from '../src/control.js';
import {loadMyPrs, refreshMyPrs, refreshMyPrsIfStale} from '../src/myprs.js';
import {refreshIssues, issueUrl} from '../src/tracker.js';
import {config} from '../src/config.js';

const [cmd, ...rest] = process.argv.slice(2);
// `roost --demo` is running: show its made-up alerts and change nothing real.
const {demoOn, demoAttention} = await import('../src/demo.js');
if (demoOn() && cmd !== '--open') {
  if (!cmd) process.stdout.write(JSON.stringify(demoAttention()));
  process.exit(0);
}
const SELF = fileURLToPath(import.meta.url);

async function dispatchTicket(text) {
  const key = /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(text)?.[1];
  if (!key) process.exit(1);
  // dispatchGroups: {"<issue type>": "<group>", "*": "<group>"}; none = no group.
  const groups = config().dispatchGroups || {};
  const issues = await refreshIssues([key], {}).catch(() => ({}));
  const group = groups[issues[key]?.type] || groups['*'] || '';
  const prompt = /^https?:\/\//.test(text.trim()) ? text.trim() : issueUrl(key);
  await dispatch(prompt, group);
  process.stdout.write(`${key}\t${group}`);
}

if (cmd === '--open') {
  const tty = await sendOpen(rest[0]);
  if (tty !== null) process.stdout.write(tty || 'sent');
} else if (cmd === '--open-pr') {
  openUrl(rest[0], {background: false});
  markSeen([`pr:${rest[0]}`]);
} else if (cmd === '--seen') {
  markSeen(rest);
} else if (cmd === '--mute') {
  mute(rest[0], Number(rest[1]) || 0);
} else if (cmd === '--unmute') {
  unmute(rest[0]);
} else if (cmd === '--dispatch') {
  await dispatchTicket(rest.join(' '));
} else if (cmd === '--refresh-prs') {
  await refreshMyPrs();
} else {
  refreshMyPrsIfStale(SELF);
  const result = attention(await loadSessions(), {myPrs: loadMyPrs()});
  if (cmd === '--seen-all') markSeen(result.items.map(i => i.id));
  else process.stdout.write(JSON.stringify(result));
}
