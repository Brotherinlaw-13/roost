// Ink redraws by erasing every line of the previous frame, then writing the new
// one. Between the two the terminal can show blank lines: that is the flicker.
// Rewrite each Ink frame so it never erases first: move the cursor back to the
// top, overwrite each line in place, clear only what is left over, and wrap it
// in a synchronized update (DEC 2026) so iTerm2 paints the frame in one go.
// Lines that did not change are skipped: the header ghost blinks every few
// seconds, and rewriting all 55 lines for it was heavy work for iTerm.

const ERASE = /^((?:\x1b\[2K\x1b\[1A)*)\x1b\[2K\x1b\[G([\s\S]*)$/;
export const SYNC_ON = '\x1b[?2026h';
export const SYNC_OFF = '\x1b[?2026l';
// A session shows the cursor again when it is left; a visible cursor jumps to
// the top and back on every redraw. Each frame hides it.
const HIDE_CURSOR = '\x1b[?25l';

export const frameLines = chunk => ERASE.exec(chunk)?.[2].split('\n') ?? null;

// prev: the lines on screen now, or null when they are unknown.
export function rewriteFrame(chunk, prev = null) {
  const m = ERASE.exec(chunk);
  if (!m) return chunk;
  const ups = m[1].length / 8;
  const lines = m[2].split('\n');
  const same = prev && prev.length === lines.length && ups === prev.length - 1;
  const body = same
    ? lines.map((l, i) => (l === prev[i] ? '' : `\x1b[G${l}\x1b[K`)).join('\n')
    : `\x1b[G${lines.join('\x1b[K\n')}\x1b[K`;
  return `${SYNC_ON}${HIDE_CURSOR}${ups ? `\x1b[${ups}A` : ''}${body}\x1b[J${SYNC_OFF}`;
}

// While a session is open, roost must not paint (it would draw over the
// session). Coming back, the session's exit and roost's next frame have to
// reach the screen as one update, so the sync block opened by the attach proxy
// stays open until that frame is written.
const gate = {suspended: false, closeSync: false, timer: null, held: null, shown: null};
let rawOut = s => process.stdout.write(s);

export function rawWrite(s) {
  rawOut(s);
}

export function suspendOutput() {
  gate.suspended = true;
  gate.shown = null;
}

// Back from a session, the sync block stays open until roost's next frame:
// the screen then goes from the session straight to the new view. Ink may have
// rendered that view while output was suspended (held below) or may render it
// a moment later, so wait for the next frame; if none comes (the view did not
// change), write the last held one.
const CLOSE_WAIT_MS = 80;

export function resumeOutput({closeSync = false} = {}) {
  gate.suspended = false;
  if (!closeSync) {
    if (gate.held !== null) rawOut(rewriteFrame(gate.held));
    gate.held = null;
    return;
  }
  gate.closeSync = true;
  clearTimeout(gate.timer);
  gate.timer = setTimeout(() => {
    if (!gate.closeSync) return;
    gate.closeSync = false;
    const held = gate.held;
    gate.held = null;
    rawOut(held !== null ? `${rewriteFrame(held)}${SYNC_OFF}` : SYNC_OFF);
  }, CLOSE_WAIT_MS);
}

export function installFlickerFreeOutput(stdout = process.stdout) {
  const write = stdout.write.bind(stdout);
  rawOut = s => write(s);
  stdout.on?.('resize', () => { gate.shown = null; });
  stdout.write = (chunk, ...rest) => {
    if (gate.suspended) {
      if (typeof chunk === 'string') gate.held = chunk;
      rest.find(f => typeof f === 'function')?.();
      return true;
    }
    if (typeof chunk !== 'string') return write(chunk, ...rest);
    let out = rewriteFrame(chunk, gate.shown);
    gate.shown = frameLines(chunk) ?? gate.shown;
    if (gate.closeSync) {
      gate.closeSync = false;
      gate.held = null;
      clearTimeout(gate.timer);
      if (!out.endsWith(SYNC_OFF)) out += SYNC_OFF;
    }
    return write(out, ...rest);
  };
}
