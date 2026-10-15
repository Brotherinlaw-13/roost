import React from 'react';
import htm from 'htm';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';
import cliTruncate from 'cli-truncate';
import wrapAnsi from 'wrap-ansi';
import {
  ACCENT, NO_GROUP, THEME, PR_STYLE,
  pickPr, prSummary, stateSummary, statusWord, formatAge, prColor,
} from '../model.js';

export const html = htm.bind(React.createElement);


// OSC 8 hyperlink: the emoji opens its PR in the browser on cmd+click.
export const link = (url, text) => `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;

// Truncate to `width` cells and pad to exactly `width`, so columns line up and
// the selection bar reaches the right edge.
export function fit(text, width) {
  if (width <= 0) return '';
  const t = cliTruncate(String(text || '').replace(/[\r\n\t]+/g, ' '), width, {position: 'end'});
  return t + ' '.repeat(Math.max(0, width - stringWidth(t)));
}

const GHOST = {
  top: '   ▜     ▛',
  head: '  ▄███████▄',
  eyes: {
    o: '  ██ ███ ██',
    h: '  ██▀███▀██',
    s: '  █████████',
  },
  skirt: '  █▀█▀█▀█▀█',
};

export function Ghost({pose = 'o'}) {
  return html`<${Box} flexDirection="column" flexShrink=${0}>
    <${Text} color=${ACCENT}>${GHOST.top}<//>
    <${Text} color=${ACCENT}>${GHOST.head}<//>
    <${Text} color=${ACCENT}>${GHOST.eyes[pose] || GHOST.eyes.o}<//>
    <${Text} color=${ACCENT}>${GHOST.skirt}<//>
  <//>`;
}

export function Header({sessions, statuses, quota, pose}) {
  return html`<${Box}>
    <${Ghost} pose=${pose} />
    <${Box} flexDirection="column" marginLeft=${2} flexShrink=${1}>
      <${Text} bold color=${THEME.claude}>roost<//>
      <${Text} dimColor wrap="truncate">${prSummary(sessions, statuses)}<//>
      <${Text} color=${ACCENT} wrap="truncate">${quota || ' '}<//>
      <${Text} dimColor wrap="truncate">${stateSummary(sessions)}<//>
    <//>
  <//>`;
}

// Name column: as wide as the longest name, capped at 30% of the terminal.
export function nameColumn(sessions, cols) {
  const longest = Math.max(0, ...sessions.map(s => stringWidth(s.name || '')));
  return Math.max(16, Math.min(longest, Math.floor(cols * 0.3)));
}

const AGE_W = 4;

export function SessionRow({session, statuses, selected, now, cols, nameWidth}) {
  const st = statusWord(session);
  const pr = pickPr(session, statuses);
  // FleetView: the focused row gets the user-message background and plain text.
  const bg = selected ? THEME.selection : undefined;
  const fg = selected ? THEME.text : undefined;
  // glyph+space, name, gap, emoji (2 cells), gap, word, " · ", detail, gap, age
  const fixed = 2 + nameWidth + 1 + 2 + 1 + stringWidth(st.word) + 3 + 1 + AGE_W;
  const detailWidth = Math.max(0, cols - 1 - fixed);
  return html`<${Text} wrap="truncate">
    <${Text} color=${st.word === 'Working' ? THEME.claude : st.color} dimColor=${st.dim} backgroundColor=${bg}>${session.alive ? '✱' : '•'} <//>
    <${Text} bold=${selected} color=${fg} backgroundColor=${bg}>${fit(session.name, nameWidth)}<//>
    <${Text} backgroundColor=${bg}> ${pr ? link(pr.href, PR_STYLE[pr.color].emoji) : '  '} <//>
    <${Text} color=${st.color || fg} dimColor=${st.dim} backgroundColor=${bg}>${st.word}<//>
    <${Text} dimColor backgroundColor=${bg}> · <//>
    <${Text} color=${fg} backgroundColor=${bg}>${fit(session.detail, detailWidth)}<//>
    <${Text} dimColor backgroundColor=${bg}> ${formatAge(session.updatedAt, now).padStart(AGE_W)}<//>
  <//>`;
}

// Flat list of lines (group headers, rows) so the caller can window it to the
// terminal height. Only groups that hold sessions are listed; empty persistent
// groups still exist for ctrl+e.
export function listLines({groups, statuses, selectedId, now, cols}) {
  const nameWidth = nameColumn(groups.flatMap(g => g.sessions), cols);
  const lines = [];
  groups.filter(g => g.sessions.length).forEach((g, gi) => {
    if (gi > 0) lines.push({key: `sp:${g.name}`, el: html`<${Text} key=${`sp:${g.name}`}> <//>`});
    lines.push({key: `g:${g.name}`, el: html`<${Text} key=${`g:${g.name}`} dimColor>${g.name === NO_GROUP ? 'No group' : g.name}<//>`});
    for (const s of g.sessions) {
      lines.push({key: s.id, sessionId: s.id, el: html`<${SessionRow} key=${s.id}
        session=${s} statuses=${statuses} selected=${s.id === selectedId} now=${now} cols=${cols} nameWidth=${nameWidth} />`});
    }
  });
  return lines;
}

// `room` includes the two "more" markers: a frame taller than the terminal
// scrolls, and Ink cannot erase lines that scrolled off, so the list ghosts.
export function windowLines(lines, focusKey, room) {
  if (lines.length <= room) return {visible: lines, above: false, below: false};
  const fit = Math.max(1, room - 2);
  const at = Math.max(0, lines.findIndex(l => l.key === focusKey));
  const start = Math.max(0, Math.min(at - Math.floor(fit / 3), lines.length - fit));
  return {visible: lines.slice(start, start + fit), above: start > 0, below: start + fit < lines.length};
}

export function Picker({title, items, cursor, room, cols}) {
  const start = Math.max(0, Math.min(cursor - Math.floor(room / 2), items.length - room));
  const shown = items.slice(start, start + room);
  return html`<${Box} flexDirection="column">
    <${Text} bold color=${ACCENT}>${title}<//>
    <${Text}> <//>
    ${items.length === 0 ? html`<${Text} dimColor>  nothing matches<//>` : null}
    ${shown.map((it, i) => {
      const sel = start + i === cursor;
      const bg = sel ? THEME.selection : undefined;
      const note = it.note ? ` ${it.note}` : '';
      return html`<${Text} key=${it.key} wrap="truncate">
        <${Text} backgroundColor=${bg} dimColor=${it.dim} bold=${sel}>${fit(`  ${it.label}`, cols - 1 - stringWidth(note))}<//>
        <${Text} backgroundColor=${bg} dimColor>${note}<//>
      <//>`;
    })}
  <//>`;
}

export const Rule = ({cols}) => html`<${Text} dimColor>${'─'.repeat(Math.max(1, cols - 1))}<//>`;

const Section = ({title, note}) => html`<${Text}><${Text} bold color=${ACCENT}>${title}<//>${note ? html`<${Text} dimColor>  ${note}<//>` : null}<//>`;

// One card line made of styled segments. The selected line gets the same
// full-width bar as the list, so it is padded to the terminal width.
function cardRow(key, stop, segs, selected, width) {
  const bg = selected ? THEME.selection : undefined;
  let used = 0;
  const parts = [];
  segs.forEach((sg, i) => {
    const room = width - used;
    if (room <= 0 || !sg.text) return;
    const t = stringWidth(sg.text) > room ? cliTruncate(sg.text, room, {position: 'end'}) : sg.text;
    used += stringWidth(t);
    parts.push(html`<${Text} key=${i} color=${sg.color || (selected ? THEME.text : undefined)} dimColor=${!!sg.dim && !selected}
      bold=${!!sg.bold} backgroundColor=${bg}>${sg.href ? link(sg.href, t) : t}<//>`);
  });
  if (selected && used < width) parts.push(html`<${Text} key="pad" backgroundColor=${bg}>${' '.repeat(width - used)}<//>`);
  return {key, stop, el: html`<${Text} key=${key} wrap="truncate">${parts}<//>`};
}

const blank = key => ({key, el: html`<${Text} key=${key}> <//>`});
const header = (key, title, note) => ({key, el: html`<${Box} key=${key}><${Section} title=${title} note=${note} /><//>`});

function wrapText(text, width) {
  return wrapAnsi(String(text || ''), Math.max(10, width), {hard: true, trim: false}).split('\n');
}

// Everything about one piece of work, in one place: the session, its Jira
// ticket, its PRs, the ticket notes and what the AI did last. Lines carry a
// `stop` when ↑↓ can land on them; the ticket and the notes unfold in place.
export function cardLines({session, ticket, issues, prs, statuses, notes, timeline, now, cols, home, issueUrl, cursor, expanded = {}, trackerLabel = 'TICKET'}) {
  const w = cols - 1;
  const L = [];
  const row = (key, stop, segs) => L.push(cardRow(key, stop, segs, stop !== undefined && stop === cursor, w));
  const st = statusWord(session);

  row('name', undefined, [{text: session.name, bold: true}, {text: `  ${st.word}`, color: st.color, dim: st.dim}, {text: ` · ${formatAge(session.updatedAt, now)}`, dim: true}]);
  const where = [session.group ? `«${session.group}»` : 'no group', (session.cwd || '').replace(home, '~'), session.id].filter(Boolean).join(' · ');
  row('where', undefined, [{text: where, dim: true}]);
  L.push(blank('sp1'));

  const issue = ticket.primary ? issues[ticket.primary] : null;
  L.push(header('jira', trackerLabel, ticket.primary ? link(issueUrl(ticket.primary), ticket.primary) : 'no ticket in the name'));
  if (ticket.primary && !issue) row('jl', undefined, [{text: '  loading…', dim: true}]);
  if (issue) {
    const meta = [issue.status, issue.type, issue.priority, issue.sprint, issue.assignee].filter(Boolean).join(' · ');
    // Enter on the summary opens the ticket, like a PR row; the line below
    // the description unfolds it.
    row('js', 'ticket', [{text: '  '}, {text: issue.summary, bold: true}, {text: '  ↗', dim: true}]);
    row('jm', undefined, [{text: '  '}, {text: meta, color: issue.statusCategory === 'done' ? THEME.success : THEME.warning}]);
    const desc = issue.description ? wrapText(issue.description, w - 4) : [];
    if (expanded.jira) {
      desc.forEach((l, i) => row(`jd${i}`, `jira:${i}`, [{text: `  ${l}`}]));
      row('jd-end', `jira:${desc.length}`, [{text: '  ▲ enter to fold', dim: true}]);
    } else {
      desc.filter(Boolean).slice(0, 2).forEach((l, i) => row(`jd${i}`, undefined, [{text: `  ${l}`, dim: true}]));
      if (desc.filter(Boolean).length > 2) row('jd-more', 'jira', [{text: `  ▼ enter to read all ${desc.length} lines`, dim: true}]);
    }
  }
  if (ticket.related.length) {
    row('jr', undefined, [{text: `  related: ${ticket.related.map(k => `${k}${issues[k] ? ` (${issues[k].status})` : ''}`).join(' · ')}`, dim: true}]);
  }
  L.push(blank('sp2'));

  L.push(header('prs', 'PULL REQUESTS', prs.length ? `${prs.length}` : 'none'));
  prs.forEach((href, i) => {
    const s = statuses[href];
    const color = prColor(s);
    const style = color ? PR_STYLE[color] : {emoji: '⚪', label: 'loading'};
    const repo = (/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(href) || []).slice(1).join('#');
    const diff = s && s.additions != null ? `  +${s.additions} −${s.deletions}` : '';
    row(`pr${i}`, `pr:${href}`, [{text: `  ${i < 9 ? i + 1 : ' '} `, dim: true}, {text: style.emoji, href}, {text: ' '}, {text: repo, bold: true}, {text: `  ${s?.title || ''}`}, {text: ` · ${style.label}${diff}`, dim: true}]);
  });
  L.push(blank('sp3'));

  L.push(header('notes', 'NOTES', notes ? notes.path.replace(home, '~') : ticket.primary ? `no ~/.ticket-notes/${ticket.primary}.md` : 'none'));
  if (notes) {
    if (expanded.notes) {
      const all = wrapText(notes.text, w - 4);
      all.forEach((l, i) => row(`nf${i}`, `notes:${i}`, [{text: `  ${l}`}]));
      row('nf-end', `notes:${all.length}`, [{text: '  ▲ enter to fold', dim: true}]);
    } else {
      row('ntitle', 'notes', [{text: '  '}, {text: notes.section || notes.title || 'notes', bold: true}]);
      notes.lines.slice(0, 4).forEach((l, i) => row(`n${i}`, undefined, [{text: `  ${l}`}]));
      row('nmore', undefined, [{text: '  ▼ enter to read all', dim: true}]);
    }
  }
  L.push(blank('sp4'));

  const tokens = session.tokens ? ` · ${Math.round(session.tokens / 1000)}k tokens` : '';
  L.push(header('ai', 'AI SESSION', `started ${formatAge(session.startedAt, now)} ago${tokens}`));
  if (session.intent) row('intent', undefined, [{text: `  asked: ${session.intent}`, dim: true}]);
  row('now', 'ai', [{text: '  now: '}, {text: session.detail || '—', color: st.color}]);
  timeline.slice(0, -1).reverse().forEach((t, i) =>
    row(`t${i}`, undefined, [{text: `  ${formatAge(t.at, now).padStart(4)} ago  ${t.text}`, dim: true}]));

  const stops = L.filter(l => l.stop !== undefined).map(l => l.stop);
  return {lines: L, stops};
}

// FleetView's /resume picker: a rounded box at the bottom, over the list,
// eight entries at a time, title and age only.
export const RESUME_ROWS = 8;
export const resumeBoxHeight = n => 2 + 1 + Math.max(1, Math.min(n, RESUME_ROWS)) + 2 + 1;

export function ResumeBox({items, cursor, query, now, cols}) {
  const start = Math.max(0, Math.min(cursor - 3, items.length - RESUME_ROWS));
  const shown = items.slice(start, start + RESUME_ROWS);
  const more = items.length - start - shown.length;
  const inner = cols - 5;
  return html`<${Box} flexDirection="column" borderStyle="round" paddingX=${1}>
    <${Text}><${Text} bold>Resume a past session<//>${query ? html`<${Text} dimColor>   filter: ${query}<//>` : null}<//>
    ${items.length === 0 ? html`<${Text} dimColor>${query ? 'Nothing matches' : 'No past sessions to resume'}<//>` : null}
    ${start > 0 ? html`<${Text} dimColor>  … ${start} above<//>` : html`<${Text}> <//>`}
    ${shown.map((it, i) => {
      const sel = start + i === cursor;
      const age = formatAge(it.mtime, now);
      return html`<${Text} key=${it.key} wrap="truncate">
        <${Text} color=${sel ? THEME.suggestion : undefined} dimColor=${!sel}>${fit(`${sel ? '❯' : ' '} ${it.label}`, inner - age.length - 1)}<//>
        <${Text} dimColor> ${age}<//>
      <//>`;
    })}
    ${more > 0 ? html`<${Text} dimColor>  … ${more} more<//>` : html`<${Text}> <//>`}
    <${Text} dimColor>↑/↓ to navigate · enter to resume as a background session · type to filter · esc to close<//>
  <//>`;
}

// One search hit: the row itself, then where the words were found, with the
// match picked out.
export function searchLines({results, cursor, now, cols}) {
  const w = cols - 1;
  const L = [];
  let lastKind = null;
  results.forEach((r, i) => {
    if (r.kind !== lastKind) {
      lastKind = r.kind;
      const n = results.filter(x => x.kind === r.kind).length;
      if (L.length) L.push({key: `sp:${r.kind}`, el: html`<${Text} key=${`sp:${r.kind}`}> <//>`});
      L.push({key: `h:${r.kind}`, el: html`<${Text} key=${`h:${r.kind}`} bold color=${ACCENT}>${r.kind === 'session' ? 'SESSIONS' : 'PAST CONVERSATIONS'} <${Text} dimColor bold=${false}>${n}<//><//>`});
    }
    const sel = i === cursor;
    const bg = sel ? THEME.selection : undefined;
    const right = r.kind === 'session' ? `${statusWord(r.session).word} · ${formatAge(r.session.updatedAt, now)}` : formatAge(r.mtime, now);
    L.push({key: `r:${r.id}`, focus: true, el: html`<${Text} key=${`r:${r.id}`} wrap="truncate">
      <${Text} backgroundColor=${bg} bold=${sel} color=${sel ? THEME.text : undefined}>${fit(`${sel ? '❯' : ' '} ${r.title}`, w - right.length - 1)}<//>
      <${Text} backgroundColor=${bg} dimColor> ${right}<//>
    <//>`});
    if (r.snippet) {
      const label = r.where ? `${r.where}: ` : '';
      L.push({key: `s:${r.id}`, el: html`<${Text} key=${`s:${r.id}`} wrap="truncate">
        <${Text} dimColor>    ${label}${r.snippet.before}<//><${Text} bold color=${THEME.suggestion}>${r.snippet.match}<//><${Text} dimColor>${r.snippet.after}<//>
      <//>`});
    }
  });
  return L;
}
