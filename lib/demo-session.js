#!/usr/bin/env node
// A stand-in for `claude attach` in `roost --demo`: draws a Claude Code-like
// screen (a conversation, the "❯" input between two rules, a status line),
// echoes what you type with a canned reply, and detaches on ctrl+z like the
// real thing. No real session is touched.
const id = process.argv[2] || 'demo';
const title = process.argv[3] || 'demo session';

const CONVERSATIONS = {
  demo0001: [
    ['you', 'The webhook consumer retries every failed message to every consumer group. Can you look?'],
    ['claude', 'Found it: a failed delivery is re-published to the shared topic, so every group gets it again. I changed the retry to go only to the group that failed and added a test that fails on the old behaviour.'],
    ['tool', 'Ran 3 shell commands · Edited 2 files'],
    ['claude', 'All 214 tests pass. PR #482 is open. Shall I merge the fix and deploy?'],
  ],
  demo0002: [
    ['you', 'The orders dashboard takes 9 seconds to load. Why?'],
    ['claude', 'The orders query scans the whole table: there is no index on created_at. I am adding one and checking the plan.'],
    ['tool', 'Ran 2 shell commands'],
  ],
};
const DEFAULT = [
  ['you', 'Pick this up where we left it.'],
  ['claude', 'On it. I have the branch checked out and the tests running.'],
];

const ESC = '\x1b';
const DIM = s => `${ESC}[2m${s}${ESC}[22m`;
const GREY = s => `${ESC}[38;2;153;153;153m${s}${ESC}[39m`;
const BOLD = s => `${ESC}[1m${s}${ESC}[22m`;
const lines = [...(CONVERSATIONS[id] || DEFAULT)];
let input = '';

function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > width) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

function draw() {
  const cols = process.stdout.columns || 100;
  const rows = process.stdout.rows || 30;
  const body = [];
  for (const [who, text] of lines) {
    if (who === 'tool') { body.push(`  ${GREY(text)}`, ''); continue; }
    const mark = who === 'you' ? GREY('❯ ') : '⏺ ';
    wrap(text, cols - 4).forEach((l, i) => body.push(`${i ? '  ' : mark}${who === 'you' ? GREY(l) : l}`));
    body.push('');
  }
  const footer = [
    `${'─'.repeat(Math.max(10, cols - title.length - 4))} ${title} ─`,
    `❯ ${input}${ESC}[7m \x1b[27m`,
    '─'.repeat(cols),
    `  ${GREY('🤖 Opus · demo session · nothing here is real')}`,
    `  ${DIM('? for shortcuts')}`,
  ];
  const room = rows - footer.length;
  const shown = body.slice(-room);
  while (shown.length < room) shown.unshift('');
  process.stdout.write(`${ESC}[?2026h${ESC}[H${[...shown, ...footer].map(l => `${l}${ESC}[K`).join('\r\n')}${ESC}[J${ESC}[?2026l`);
}

function leave(code = 0) {
  process.stdout.write(`${ESC}_cc-detach-msg;Detached${ESC}\\${ESC}[?25h${ESC}[?1049l`);
  process.exit(code);
}

process.stdout.write(`${ESC}[?1049h${ESC}[2J${ESC}[?25l`);
// Enough output at once for roost to know the session has painted.
process.stdout.write(`${ESC}[s${' '.repeat(1600)}${ESC}[u`);
draw();
process.stdout.on('resize', draw);
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', d => {
  const s = d.toString();
  if (s === '\x1a' || s === '\x03') return leave();
  if (s === '\r') {
    if (!input.trim()) return;
    lines.push(['you', input], ['claude', `Done — "${input}" is handled. (This is a demo session; nothing ran.)`]);
    input = '';
    return draw();
  }
  if (s === '\x7f') { input = input.slice(0, -1); return draw(); }
  if (s === '\x15') { input = ''; return draw(); }
  if (s.startsWith(ESC)) return;
  input += s.replace(/[\x00-\x1f]/g, '');
  draw();
});
