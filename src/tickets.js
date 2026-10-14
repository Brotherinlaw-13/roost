import {config} from './config.js';

// Ticket keys like HS-123 or ENG-42. With ticketPrefixes set, only those.
export function keyPattern(prefixes = config().ticketPrefixes) {
  const p = prefixes?.length ? `(?:${prefixes.map(x => x.replace(/[^A-Za-z0-9]/g, '')).join('|')})` : '[A-Z][A-Z0-9]{1,9}';
  return new RegExp(`\\b${p}-\\d{1,6}\\b`, 'g');
}

const keysIn = text => [...new Set(String(text || '').match(keyPattern()) || [])];

// The tag in the session name wins: it is what you see and curate. The cwd
// is the weakest hint, since sessions are often started inside another
// ticket's worktree. Other keys in the opening prompt are shown as related.
export function sessionTickets(session) {
  const tag = /\[([A-Z][A-Z0-9]{1,9}-\d{1,6})\]/.exec(session.name || '')?.[1];
  const primary = tag || keysIn(session.name)[0] || keysIn(session.intent)[0] || keysIn(session.cwd)[0] || null;
  const related = keysIn(session.intent).filter(k => k !== primary);
  return {primary, related};
}

export function allTicketKeys(sessions) {
  const keys = new Set();
  for (const s of sessions) {
    const {primary, related} = sessionTickets(s);
    if (primary) keys.add(primary);
    for (const k of related) keys.add(k);
  }
  return [...keys].sort();
}

export {keysIn};
