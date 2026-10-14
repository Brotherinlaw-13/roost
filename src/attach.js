import {createRequire} from 'node:module';
import {rawWrite, SYNC_ON, SYNC_OFF} from './terminal.js';
import {promptState} from './prompt.js';

const {Terminal} = createRequire(import.meta.url)('@xterm/headless');
const ARROWS = {'\x1b[C': 'right', '\x1bOC': 'right', '\x1b[D': 'left', '\x1bOD': 'left'};
const DETACH = '\x1a';

// Runs `claude attach` inside roost's own pseudo-terminal and relays it to the
// real one, so roost controls every transition:
//  - entering: a sync block stays open until the session has painted, so the
//    screen goes from roost's view straight to the session, never blank;
//  - leaving: the block reopens before the alternate screen is dropped and
//    stays open until roost has drawn the next view (see resumeOutput).
// Plain text attach prints outside the session ("Waking session…") is kept
// off the screen: it would land on roost's view and break its line count.

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const ESC_SEQ = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[P^_X][\s\S]*?\x1b\\|[()][0-9A-Za-z]|[78=>cDEHMNOZ])/g;
const ESC_AT_START = new RegExp(`^(?:${ESC_SEQ.source})`);
const SETTLE_BYTES = 1500;
const SETTLE_QUIET_MS = 40;
const SETTLE_MAX_MS = 1500;

export const onlyEscapes = s => (s.match(ESC_SEQ) || []).join('');
export const textOf = s => s.replace(ESC_SEQ, '');
const dropSyncOff = s => s.split(SYNC_OFF).join('');

// Hold back an escape sequence cut in half at the end of a chunk.
export function splitPartial(s) {
  const i = s.lastIndexOf('\x1b');
  if (i < 0 || s.length - i > 64) return [s, ''];
  return ESC_AT_START.test(s.slice(i)) ? [s, ''] : [s.slice(0, i), s.slice(i)];
}

// The attach in progress, so a request to open another session can end it.
let current = null;
export function cancelAttach() {
  try { current?.kill('SIGTERM'); } catch {}
}

// attach says why it leaves just before it does: "ECARD:" for →, "Detached…"
// for ← or ctrl+z.
const DETACH_MSG = /\x1b_cc-detach-msg;([^\x1b]*)/;

// keepAlt(msg): when roost will go straight back into a session (→, or ← with
// the card pane open), the alternate screen is kept: the old session stays on
// screen until the new attach paints over it, never showing the list between.
// hotkeys: {sequence: fn}: keys roost handles itself while the session is
// open, never passed on to it (works with any Claude Code, patched or not).
// onArrow(dir): → or ← pressed while the session's input is empty (roost keeps
// a copy of its screen to know). It returns 'handled' (roost did something,
// e.g. the card pane), 'detach' (leave the session: Claude's own ctrl+z is
// sent, and the result says why: leaveReason 'card' for →, 'left' for ←), or
// anything else to pass the key on. It may return a promise.
export function attachProxied(pty, cmd, args, {env, cwd, stdin = process.stdin, stdout = process.stdout, keepAlt = () => false, hotkeys = {}, onArrow = null} = {}) {
  return new Promise(resolve => {
    const p = pty.spawn(cmd, args, {
      name: env.TERM || 'xterm-256color', cols: stdout.columns || 120, rows: stdout.rows || 40, cwd, env,
    });
    current = p;
    let phase = 'enter';
    let pending = '';
    let sinceAlt = -1;
    let quiet = null;
    let text = '';
    // Until the session has painted, its output is held here and then written
    // in one go: attach switches to the alternate screen and prints
    // "Attaching…" first, which showed as a blank flash. Holding it does not
    // depend on how long the terminal honours a synchronized update.
    let held = '';
    let shown = false;
    let tail = '';
    let detachMsg = '';
    let keptAlt = false;
    let leaveReason = null;
    const screen = onArrow ? new Terminal({cols: stdout.columns || 120, rows: stdout.rows || 40, allowProposedApi: true}) : null;

    const settle = () => {
      if (phase !== 'enter') return;
      phase = 'live';
      shown = true;
      clearTimeout(quiet);
      clearTimeout(hard);
      rawWrite(`${SYNC_ON}${held}${SYNC_OFF}`);
      held = '';
    };
    const hard = setTimeout(settle, SETTLE_MAX_MS);
    const keepEscapes = s => {
      text += textOf(s);
      const e = dropSyncOff(onlyEscapes(s));
      if (phase === 'enter') held += e; else rawWrite(e);
    };

    const leave = s => {
      const j = s.indexOf(ALT_OFF);
      clearTimeout(quiet);
      clearTimeout(hard);
      if (phase === 'enter') {
        // Nothing reached the screen yet: drop it, the alternate screen was
        // never entered.
        held = '';
        rawWrite(SYNC_ON);
      } else {
        rawWrite(s.slice(0, j));
        rawWrite(SYNC_ON);
        keptAlt = keepAlt(detachMsg);
        if (!keptAlt) rawWrite(ALT_OFF);
      }
      phase = 'leaving';
      keepEscapes(s.slice(j + ALT_OFF.length));
    };

    p.onData(chunk => {
      screen?.write(chunk);
      tail = (tail + chunk).slice(-8192);
      const dm = DETACH_MSG.exec(tail);
      if (dm) detachMsg = dm[1];
      let s;
      [s, pending] = splitPartial(pending + chunk);
      if (!s) return;
      if (phase === 'leaving') return keepEscapes(s);
      if (phase === 'enter' && sinceAlt < 0) {
        const i = s.indexOf(ALT_ON);
        if (i < 0) return keepEscapes(s);
        keepEscapes(s.slice(0, i));
        s = s.slice(i);
        sinceAlt = 0;
      }
      if (s.includes(ALT_OFF)) return leave(s);
      if (phase === 'enter') {
        held += dropSyncOff(s);
        sinceAlt += s.length;
        if (sinceAlt >= SETTLE_BYTES) { clearTimeout(quiet); quiet = setTimeout(settle, SETTLE_QUIET_MS); }
        return;
      }
      rawWrite(s);
    });

    const act = (result, dir, s) => {
      if (result === 'handled') return;
      if (result === 'detach') { leaveReason = dir === 'right' ? 'card' : 'left'; p.write(DETACH); return; }
      p.write(s);
    };
    const onKey = d => {
      const s = d.toString();
      if (hotkeys[s]) return void hotkeys[s]();
      const dir = ARROWS[s];
      if (dir && screen && promptState(screen).empty) {
        const r = onArrow(dir);
        return void (r?.then ? r.then(v => act(v, dir, s), () => p.write(s)) : act(r, dir, s));
      }
      p.write(s);
    };
    const onResize = () => {
      p.resize(stdout.columns || 120, stdout.rows || 40);
      screen?.resize(stdout.columns || 120, stdout.rows || 40);
    };
    stdin.setRawMode?.(true);
    stdin.on('data', onKey);
    stdin.resume();
    stdout.on('resize', onResize);

    p.onExit(({exitCode}) => {
      if (current === p) current = null;
      clearTimeout(quiet);
      clearTimeout(hard);
      stdin.removeListener('data', onKey);
      stdin.pause();
      stdout.removeListener('resize', onResize);
      if (pending && phase !== 'enter') keepEscapes(pending);
      // A block left open is closed by roost's next frame (resumeOutput).
      // shown: something reached the screen; keptAlt: it is still in the
      // alternate screen (see keepAlt).
      screen?.dispose();
      resolve({status: exitCode, text: text.trim(), syncOpen: phase !== 'live', shown, keptAlt, leaveReason});
    });
  });
}
