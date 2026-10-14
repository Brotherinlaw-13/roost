// Is Claude Code's input empty? Its prompt row is "❯ " between two rules; what
// follows the marker is what you typed, or a dim suggestion. A list cursor
// ("❯ 1. Yes" in a menu) has no rules around it, so it never counts.
const RULE = /─{10,}/;

// A suggestion is drawn dim or in grey; what you type is in the normal colour.
function isGrey(rgb) {
  const r = rgb >> 16 & 255, g = rgb >> 8 & 255, b = rgb & 255;
  return Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && r < 200;
}
function isSuggestion(cell) {
  if (cell.isDim()) return true;
  if (cell.isFgRGB()) return isGrey(cell.getFgColor());
  if (cell.isFgPalette()) { const n = cell.getFgColor(); return n === 8 || (n >= 240 && n <= 250); }
  return false;
}

export function promptState(term) {
  const buf = term.buffer.active;
  for (let y = term.rows - 1; y > 0; y--) {
    const line = buf.getLine(buf.viewportY + y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (!text.startsWith('❯')) continue;
    const above = buf.getLine(buf.viewportY + y - 1)?.translateToString(true) || '';
    const below = buf.getLine(buf.viewportY + y + 1)?.translateToString(true) || '';
    if (!RULE.test(above) || !RULE.test(below)) continue;
    for (let x = 1; x < line.length; x++) {
      const cell = line.getCell(x);
      const ch = cell?.getChars();
      // trim(): the marker is followed by a no-break space, not a plain one.
      if (ch && ch.trim() && !isSuggestion(cell)) return {found: true, empty: false};
    }
    return {found: true, empty: true};
  }
  return {found: false, empty: false};
}
