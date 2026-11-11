import {openSync, readSync, closeSync, statSync} from 'node:fs';

// Claude Code keeps one PR per repo in a session's state: a second PR in the
// same repo replaces the first. The PRs a session opened are also in its
// transcript, as the output of its `gh pr create` commands. Read incrementally.
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const scans = new Map();

function readFrom(path, from, to) {
  const buf = Buffer.alloc(to - from);
  const fd = openSync(path, 'r');
  try { readSync(fd, buf, 0, buf.length, from); } finally { closeSync(fd); }
  return buf.toString('utf8');
}

export function scanLine(line, scan) {
  if (!line.includes('gh pr create') && !line.includes('tool_result')) return;
  let content;
  try { content = JSON.parse(line).message?.content; } catch { return; }
  if (!Array.isArray(content)) return;
  for (const c of content) {
    if (c.type === 'tool_use' && /(^|[\s;&|(])gh pr create\b/.test(String(c.input?.command || ''))) scan.pending.add(c.id);
    if (c.type === 'tool_result' && scan.pending.has(c.tool_use_id)) {
      scan.pending.delete(c.tool_use_id);
      const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
      for (const url of text.match(PR_URL) || []) scan.prs.add(url);
    }
  }
}

export function openedPrs(path) {
  if (!path) return [];
  let size;
  try { size = statSync(path).size; } catch { return []; }
  let scan = scans.get(path);
  if (!scan || size < scan.offset) scan = {offset: 0, pending: new Set(), prs: new Set()};
  if (size > scan.offset) {
    const text = readFrom(path, scan.offset, size);
    const end = text.lastIndexOf('\n');
    if (end >= 0) {
      for (const line of text.slice(0, end).split('\n')) scanLine(line, scan);
      scan.offset += Buffer.byteLength(text.slice(0, end + 1));
    }
  }
  scans.set(path, scan);
  return [...scan.prs];
}
