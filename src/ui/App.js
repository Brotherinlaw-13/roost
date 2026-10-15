import {useState, useEffect, useRef, useMemo} from 'react';
import {Box, Text, useInput, useApp, useStdout} from 'ink';
import {homedir} from 'node:os';
import {html, Header, Picker, Rule, listLines, windowLines, cardLines, ResumeBox, resumeBoxHeight, searchLines} from './components.js';
import {matchSession, termsOf} from '../search.js';
import {sessionTickets, allTicketKeys} from '../tickets.js';
import {suspendOutput, resumeOutput} from '../terminal.js';
import {
  ACCENT, NO_GROUP, buildGroups, orderedSessions, filterGroups,
  pickPr, ghostPose, msToNextPose, formatAge, shortCwd,
} from '../model.js';

const SESSIONS_MS = 3000;
const SETTINGS_MS = 5000;
const PR_MS = 60000;
const TICKETS_MS = 5 * 60000;
const EXIT_WORDS = new Set(['exit', 'quit', '/exit', '/quit']);

const SHORTCUTS = [
  ['enter or →', 'open the session (empty prompt) · enter with text launches a new session'],
  ['↑ ↓', 'move'],
  ['ctrl+f', 'search sessions and past conversations, including what was said'],
  ['tab', 'session card: Jira, PRs, notes and AI session in one place'],
  ['→ (inside a session)', 'show or hide its card beside it (iTerm2; empty prompt)'],
  ['← (inside a session)', 'hide the card, else come back here (empty prompt)'],
  ['ctrl+e', 'move to a group · ctrl+x there deletes a group'],
  ['ctrl+r', 'rename'],
  ['ctrl+x', 'stop and delete the session'],
  ['ctrl+o', 'open its PR in the browser (or cmd+click the emoji)'],
  ['/resume', 'resume a past conversation'],
  ['/auto-panel [on|off]', 'open the card beside every session you open (iTerm2); saved'],
  ['esc', 'clear the prompt · close'],
  ['ctrl+c', 'quit'],
];

// Replies the terminal sends to a session's queries (version, device
// attributes, mode and cursor reports) can arrive after the session is left;
// they must not land in the prompt as if typed.
const TERMINAL_REPLY = /\x1b?P>\|[^\x1b]*(?:\x1b\\)?|\x1b?\[\??[\d;]*(?:\$y|[cRn])/g;
const stripReplies = v => (v || '').replace(TERMINAL_REPLY, '');

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function usePolling(fn, ms, deps = []) {
  useEffect(() => {
    let alive = true;
    const tick = () => alive && fn();
    tick();
    const t = setInterval(tick, ms);
    return () => { alive = false; clearInterval(t); };
  }, deps);
}

// Renders only when the ghost changes pose (4 frames every 2.6 s): Ink rewrites
// the whole frame on every render, so a fixed fast tick would flicker.
function useGhostPose() {
  const [pose, setPose] = useState('o');
  useEffect(() => {
    let t;
    const step = () => {
      const now = Date.now();
      setPose(ghostPose(now));
      t = setTimeout(step, msToNextPose(now) + 1);
    };
    step();
    return () => clearTimeout(t);
  }, []);
  return pose;
}

// How far off to the right the card still is: 1 (hidden) until it has data,
// then down to 0 over ~230 ms with an ease-out (Ink paints ~30 frames a second).
// Always 0 when turned off.
const SLIDE_FRAMES = 7;
const SLIDE_MS = 33;
function useSlideIn(enabled, ready) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!enabled || !ready || frame >= SLIDE_FRAMES) return undefined;
    const t = setTimeout(() => setFrame(f => f + 1), SLIDE_MS);
    return () => clearTimeout(t);
  }, [enabled, ready, frame]);
  if (!enabled) return 0;
  if (!ready) return 1;
  return (1 - frame / SLIDE_FRAMES) ** 3;
}

export function App({services, initial = {}}) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const [sessions, setSessions] = useState(initial.sessions || null);
  const [settings, setSettings] = useState(initial.settings || {groups: [], ignored: [], quota: ''});
  const [statuses, setStatuses] = useState(initial.statuses || {});
  const [issues, setIssues] = useState(initial.issues || {});
  const [ticketPrs, setTicketPrs] = useState(initial.ticketPrs || {});
  // `roost --card <id>`: only that session's card, in the iTerm pane beside it.
  const paneId = initial.paneId || null;
  const [selectedId, setSelectedId] = useState(initial.selectedId || paneId);
  const [mode, setMode] = useState(paneId ? 'card' : 'list');
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [past, setPast] = useState([]);
  const [hint, setHint] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  // Deleted ids stay hidden while `stop` + `rm` run, and after: a refresh can
  // still list the session for a few seconds.
  const [hidden, setHidden] = useState(() => new Set());
  // Where the card was opened from: ← goes back there (the session for →
  // inside a session, the list for tab).
  const [cardFrom, setCardFrom] = useState('list');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const [cardCursor, setCardCursor] = useState(null);
  const [expanded, setExpanded] = useState({});
  const pose = useGhostPose();
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;

  const reloadSessions = () => services.loadSessions()
    .then(list => setSessions(prev => (same(prev, list) ? prev : list)))
    .catch(e => setError(e.message));
  usePolling(reloadSessions, SESSIONS_MS);
  usePolling(() => {
    try {
      const next = services.loadSettings();
      setSettings(prev => (same(prev, next) ? prev : next));
    } catch (e) { setError(e.message); }
  }, SETTINGS_MS);
  usePolling(() => setNow(Date.now()), 30000);

  // A session carries its ticket's PRs too, not only the ones it opened itself.
  const withPrs = useMemo(() => (sessions || []).map(s => {
    const {primary} = sessionTickets(s);
    const own = new Set((s.children || []).filter(c => c.kind === 'pr').map(c => c.href));
    const extra = (ticketPrs[primary] || []).filter(h => !own.has(h)).map(href => ({kind: 'pr', href}));
    return extra.length ? {...s, children: [...(s.children || []), ...extra]} : s;
  }), [sessions, ticketPrs]);

  const ticketKeys = useMemo(() => allTicketKeys(sessions || []), [sessions]);
  const ticketKey = ticketKeys.join(' ');
  usePolling(() => {
    if (!ticketKeys.length) return;
    services.refreshIssues(ticketKeys, issues).then(next => setIssues(prev => (same(prev, next) ? prev : next))).catch(() => {});
    services.searchTicketPrs(ticketKeys).then(next => setTicketPrs(prev => (same(prev, next) ? prev : next))).catch(() => {});
  }, TICKETS_MS, [ticketKey]);

  const hrefs = useMemo(() => withPrs.flatMap(s => (s.children || []).filter(c => c.kind === 'pr').map(c => c.href)).sort(), [withPrs]);
  const hrefKey = hrefs.join(' ');
  usePolling(() => {
    if (!hrefs.length) return;
    services.refreshStatuses(hrefs, statusesRef.current)
      .then(next => setStatuses(prev => (same(prev, next) ? prev : next)))
      .catch(() => {});
  }, PR_MS, [hrefKey]);

  const list = useMemo(() => withPrs.filter(s => !hidden.has(s.id)), [withPrs, hidden]);
  const groups = useMemo(() => buildGroups(list), [list]);
  const ordered = useMemo(() => orderedSessions(groups), [groups]);
  const focusIndex = Math.max(0, ordered.findIndex(s => s.id === selectedId));
  const focused = ordered[focusIndex] || null;
  const focusedGroup = focused?.group || NO_GROUP;

  const allGroupNames = useMemo(() => {
    const names = new Set(settings.groups.filter(g => !settings.ignored.includes(g)));
    for (const s of list) if (s.group) names.add(s.group);
    return [...names];
  }, [list, settings]);

  const groupItems = useMemo(() => {
    const q = input.trim();
    const items = filterGroups(allGroupNames, q).map(g => ({key: `g:${g}`, label: g, value: g, note: g === focused?.group ? 'current' : ''}));
    if (q && !allGroupNames.some(g => g.toLowerCase() === q.toLowerCase())) items.push({key: 'new', label: `+ create «${q}»`, value: q, isNew: true});
    if (!q) items.push({key: 'none', label: 'No group', value: NO_GROUP, dim: true});
    return items;
  }, [input, allGroupNames, focused]);

  const pastItems = useMemo(() => {
    const q = input.trim().toLowerCase();
    return past
      .filter(p => !q || p.title.toLowerCase().includes(q))
      .map(p => ({key: p.sessionId, label: p.title, value: p, mtime: p.mtime}));
  }, [past, input, now]);

  // Looking at a session's card counts as having seen it (the desktop pet
  // stops flagging it).
  useEffect(() => {
    if (mode === 'card' && focused) services.markSeen?.([focused.id]);
  }, [mode, focused?.id]);

  // `roost --open <id>` (from the pet): open that session once it is listed.
  const openedInitial = useRef(false);
  // No waiting for the list: attach reports an unknown id itself.
  useEffect(() => {
    if (openedInitial.current || !initial.openId) return;
    openedInitial.current = true;
    setSelectedId(initial.openId);
    openSession(initial.openId);
  }, []);

  const openSearch = () => {
    services.refreshIndex?.();
    setPast(services.loadPastSessions(new Set(list.map(s => s.sessionId))));
    setMode('search'); setInput(''); setCursor(0); setResults([]); setHint(null);
  };

  // Live sessions first (a hit in the name, ticket, Jira title or PRs ranks
  // above one only found in the conversation), then past conversations.
  useEffect(() => {
    if (mode !== 'search') return;
    const terms = termsOf(input);
    const seq = ++searchSeq.current;
    if (!terms.length) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const hits = await services.searchTranscripts(input).catch(() => new Map());
      if (seq !== searchSeq.current) return;
      const listed = new Set(list.map(x => x.sessionId));
      const sessions = [];
      for (const ses of list) {
        const m = matchSession(ses, terms, {issues, statuses});
        const h = hits.get(ses.sessionId);
        if (!m && !h) continue;
        sessions.push({kind: 'session', id: ses.id, session: ses, title: ses.name, rank: m ? 0 : 1,
          where: m ? m.field : `${h.who || 'conversation'} said`, snippet: m ? m.snippet : h.snippet});
      }
      sessions.sort((a, b) => a.rank - b.rank);
      const pastById = new Map(past.map(x => [x.sessionId, x]));
      const pastHits = new Map();
      for (const x of past) {
        if (terms.every(term => x.title.toLowerCase().includes(term))) pastHits.set(x.sessionId, {rank: 0, where: 'title', snippet: null});
      }
      for (const [id, h] of hits) {
        if (listed.has(id)) continue;
        const prev = pastHits.get(id);
        pastHits.set(id, {rank: prev ? 0 : 1, where: `${h.who || 'conversation'} said`, snippet: h.snippet, mtime: h.mtime});
      }
      const pastRes = [...pastHits].map(([id, h]) => {
        const known = pastById.get(id);
        const meta = known || {...services.transcriptTitle(services.pastTranscriptPath(id), id), mtime: h.mtime};
        return {kind: 'past', id, sessionId: id, title: meta.title, cwd: meta.cwd, mtime: meta.mtime || h.mtime, ...h};
      }).sort((a, b) => a.rank - b.rank || b.mtime - a.mtime).slice(0, 30);
      setResults([...sessions, ...pastRes]);
      setCursor(0);
      setSearching(false);
    }, 150);
    return () => clearTimeout(t);
  }, [mode, input]);

  const move = delta => {
    if (!ordered.length) return;
    const i = Math.max(0, Math.min(ordered.length - 1, focusIndex + delta));
    setSelectedId(ordered[i].id);
  };

  const toList = (msg = null) => { setMode('list'); setInput(''); setCursor(0); setConfirm(false); setHint(msg); };

  // Opening a session hands the terminal to the attach proxy: roost stops
  // reading keys (useInput is inactive) and stops painting (suspendOutput).
  // Back from it, the next frame closes the sync block the proxy left open,
  // so the session's exit and the new view reach the screen together.
  const [attaching, setAttaching] = useState(null);
  const [reattach, setReattach] = useState(0);
  const goingBackIn = useRef(false);
  const [autoPane, setAutoPane] = useState(!!initial.paneAlwaysOpen);
  // attach can leave the terminal in the session's alternate screen when roost
  // goes straight back in (see keepAlt in attach.js).
  const screenInAlt = useRef(false);
  const keepAlt = msg => !!services.paneSupported?.() && (msg.startsWith('ECARD') || !!services.hasPanes?.());
  // A session re-sends its "→" to the next client that attaches: a card exit
  // right after going back in is that echo, not a new key press.
  const ECHO_MS = 1000;
  const openSession = id => { if (!attaching && !paneId) { goingBackIn.current = false; setAttaching(id); } };

  // → inside a session opens its card in a pane beside it and goes straight
  // back into the session; → again, or ←, closes the pane. Leaving the session
  // closes it too. The session comes back at once and narrows when the pane
  // appears.
  // The session is frozen while the pane opens or closes (see freezeSession).
  const frozen = async work => {
    services.freezeSession?.(true);
    try { return await work(); } finally { services.freezeSession?.(false); }
  };
  const closeSidePane = () => (services.hasPanes?.() ? frozen(() => services.closeAllPanes()) : Promise.resolve());
  const panesOpen = async () => {
    await services.prunePanes?.();
    return !!services.hasPanes?.();
  };
  const toggleSidePane = async id => {
    if (await panesOpen()) { closeSidePane(); return; }
    const s = ordered.find(x => x.id === id);
    frozen(() => services.openPane(id, s ? `card · ${s.name}` : 'card'));
  };

  // "open <id>" from the desktop pet. Inside another session, leave it and go
  // straight to the new one: output stays suspended and the sync block open,
  // so the screen jumps from one session to the other without the list.
  const pendingOpen = useRef(null);
  const openFromPet = useRef(() => {});
  openFromPet.current = id => {
    if (attaching) {
      if (attaching === id) return;
      pendingOpen.current = id;
      services.cancelAttach?.();
      return;
    }
    setSelectedId(id);
    openSession(id);
  };
  useEffect(() => {
    if (paneId) return undefined;
    let close = null;
    let gone = false;
    Promise.resolve(services.listen?.(id => openFromPet.current(id))).then(c => { if (gone) c?.(); else close = c; });
    return () => { gone = true; close?.(); };
  }, []);
  useEffect(() => {
    if (!attaching) return;
    const id = attaching;
    services.markSeen?.([id]);
    suspendOutput();
    let startedAt = Date.now();
    // With the session's input empty: → shows or hides the card beside it
    // (iTerm2), or leaves for the full card elsewhere; ← hides the card, else
    // goes back to the list. Works with any Claude Code. paneKey, if set, is an
    // extra key for the pane.
    const panes = !!services.paneSupported?.();
    const paneSeq = panes ? services.paneKeySequence?.() : null;
    const hotkeys = paneSeq ? {[paneSeq]: () => { toggleSidePane(id); }} : {};
    const onArrow = async dir => {
      if (dir === 'right') {
        if (!panes) return 'detach';
        toggleSidePane(id);
        return 'handled';
      }
      if (panes && await panesOpen()) { closeSidePane(); return 'handled'; }
      return 'detach';
    };
    // paneAlwaysOpen: the card pane opens before the session, so the session
    // paints once, at its final width. → still hides it for this visit.
    const openFirst = async () => {
      if (!autoPane || goingBackIn.current || !panes || services.hasPanes?.()) return;
      const s = ordered.find(x => x.id === id);
      await Promise.race([services.openPane(id, s ? `card · ${s.name}` : 'card'), new Promise(res => setTimeout(res, 1500))]);
    };
    openFirst().then(() => { startedAt = Date.now(); return services.attach(id, {keepAlt, hotkeys, onArrow}); }).then(r => r || {}, e => ({error: e.message})).then(async r => {
      if (r.shown) screenInAlt.current = !!r.keptAlt;
      if (pendingOpen.current) {
        const next = pendingOpen.current;
        pendingOpen.current = null;
        await closeSidePane();
        goingBackIn.current = false;
        services.markSeen?.([id]);
        setSelectedId(next);
        setAttaching(next);
        return;
      }
      const backIn = () => { goingBackIn.current = true; setReattach(n => n + 1); };
      if (r.card && services.paneSupported?.()) {
        if (!(goingBackIn.current && Date.now() - startedAt < (initial.echoMs ?? ECHO_MS))) await toggleSidePane(id);
        return backIn();
      }
      // ← with the card open closes the card and stays in the session.
      if (r.viaArrow && services.paneSupported?.() && await panesOpen()) {
        closeSidePane();
        return backIn();
      }
      // The pane closes before the next view is drawn, so it is drawn once,
      // at full width (the sync block stays open meanwhile).
      await Promise.race([closeSidePane(), new Promise(res => setTimeout(res, 400))]);
      let closeSync = !!r.syncOpen;
      if (screenInAlt.current) { services.restoreScreen?.(); screenInAlt.current = false; closeSync = true; }
      setError(r.error || null);
      setSelectedId(id);
      setInput('');
      setMode(r.card ? 'card' : 'list');
      setCardFrom(r.card ? 'session' : 'list');
      if (r.card) { setCardCursor(null); setExpanded({}); }
      resumeOutput({closeSync});
      services.markSeen?.([id]);
      setAttaching(null);
      reloadSessions();
    });
  }, [attaching, reattach]);

  const runAsync = (label, promise, done) => {
    setHint(label);
    setError(null);
    promise.then(r => { done?.(r); reloadSessions(); }).catch(e => { setHint(null); setError(e.message); });
  };

  const submit = () => {
    const text = input.trim();
    if (!text) { if (focused) openSession(focused.id); return; }
    if (EXIT_WORDS.has(text.toLowerCase())) return exit();
    const auto = /^\/auto-panel(?:\s+(on|off))?$/i.exec(text);
    if (auto) {
      const on = auto[1] ? auto[1].toLowerCase() === 'on' : !autoPane;
      setAutoPane(on);
      services.setConfigValue?.('paneAlwaysOpen', on);
      setInput('');
      const note = on && !services.paneSupported?.() ? ' (needs iTerm2 and npm run setup-pane)' : '';
      setHint(on ? `auto panel on: the card opens beside every session you open${note}` : 'auto panel off: → shows the card');
      return;
    }
    if (text === '/resume') {
      setPast(services.loadPastSessions(new Set(list.map(s => s.sessionId))));
      setMode('resume'); setInput(''); setCursor(0);
      return;
    }
    setInput('');
    runAsync('launching…', services.dispatch(text, focusedGroup), id => {
      if (id) setSelectedId(id);
      setHint(id ? `launched ${id}${focusedGroup ? ` in «${focusedGroup}»` : ''}` : 'launched');
    });
  };

  const editInput = (value, key) => {
    if (key.backspace || key.delete) { setInput(s => s.slice(0, -1)); setCursor(0); return true; }
    if (key.ctrl && value === 'u') { setInput(''); setCursor(0); return true; }
    if (value && !key.ctrl && !key.meta && !key.return && !key.escape && !key.tab) {
      setInput(s => s + value.replace(/[\r\n]+/g, ' '));
      setCursor(0);
      return true;
    }
    return false;
  };

  useInput((raw, key) => {
    const value = stripReplies(raw);
    if (raw && !value) return;
    if (mode === 'help') { setMode('list'); return; }

    if (mode === 'search') {
      const r = results[Math.min(cursor, results.length - 1)];
      if (key.escape) { setMode('list'); setInput(''); return; }
      if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCursor(c => Math.min(results.length - 1, c + 1)); return; }
      if (key.tab && r?.kind === 'session') { setSelectedId(r.id); setCardFrom('list'); setCardCursor(null); setExpanded({}); setInput(''); setMode('card'); return; }
      if (key.return && r) {
        setInput('');
        if (r.kind === 'session') { setSelectedId(r.id); openSession(r.id); return; }
        setMode('list');
        runAsync('resuming…', services.resume(r.sessionId, r.cwd), id => { setHint(null); if (id) { setSelectedId(id); openSession(id); } });
        return;
      }
      editInput(value, key);
      return;
    }

    if (mode === 'card') {
      const stops = cardModel?.stops || [];
      const at = Math.max(0, stops.indexOf(cardCursor ?? stops[0]));
      const stop = stops[at];
      const fold = (part, on) => { setExpanded(e => ({...e, [part]: on})); setCardCursor(part); };
      const paneSeq = services.paneKeySequence?.();
      if (paneId && (key.escape || key.leftArrow || key.rightArrow || value === 'q' || (paneSeq && raw === paneSeq))) { services.closeOwnPane?.(); exit(); return; }
      if (paneId && (key.tab || key.ctrl)) return;
      if (key.leftArrow && cardFrom === 'session' && focused) { openSession(focused.id); return; }
      if (key.ctrl && value === 'f') { openSearch(); return; }
      if (key.escape || key.leftArrow || key.tab) { setMode('list'); return; }
      if (key.rightArrow && focused) { openSession(focused.id); return; }
      if (key.upArrow) { if (stops.length) setCardCursor(stops[Math.max(0, at - 1)]); return; }
      if (key.downArrow) { if (stops.length) setCardCursor(stops[Math.min(stops.length - 1, at + 1)]); return; }
      if (key.return || value === ' ') {
        if (!stop) return;
        if (stop === 'ticket') {
          const {primary} = sessionTickets(focused);
          return primary ? services.openUrl(services.issueUrl(primary)) : undefined;
        }
        // Unfolded, the cursor goes into the text; folded, back to the ▼ line.
        if (stop.startsWith('jira')) {
          setExpanded(e => ({...e, jira: !expanded.jira}));
          return setCardCursor(expanded.jira ? 'jira' : 'jira:0');
        }
        if (stop.startsWith('notes')) return fold('notes', !expanded.notes);
        if (stop.startsWith('pr:')) return services.openUrl(stop.slice(3));
        if (stop === 'ai' && focused) return openSession(focused.id);
        return;
      }
      if (value === 'o' && focused) {
        if (stop?.startsWith('pr:')) return services.openUrl(stop.slice(3));
        const {primary} = sessionTickets(focused);
        if (primary) services.openUrl(services.issueUrl(primary)); else setHint('no ticket linked');
        return;
      }
      if (/^[1-9]$/.test(value) && focused) {
        const href = (focused.children || []).filter(c => c.kind === 'pr')[Number(value) - 1]?.href;
        if (href) services.openUrl(href);
        return;
      }
      return;
    }

    if (mode === 'list') {
      if (key.upArrow) return move(-1);
      if (key.downArrow) return move(1);
      if (key.rightArrow && !input && focused) { openSession(focused.id); return; }
      if (key.tab && focused) { setHint(null); setCardFrom('list'); setCardCursor(null); setExpanded({}); setMode('card'); return; }
      if (key.return) return submit();
      if (key.escape) { setInput(''); setHint(null); setError(null); return; }
      if (value === '?' && !input) { setMode('help'); return; }
      if (key.ctrl && value === 'f') { openSearch(); return; }
      if (key.ctrl && value === 'e' && focused) { setMode('group'); setInput(''); setCursor(0); setConfirm(false); return; }
      if (key.ctrl && value === 'r' && focused) { setMode('rename'); setInput(focused.name); return; }
      if (key.ctrl && value === 'x' && focused) { setMode('delete'); return; }
      if (key.ctrl && value === 'o' && focused) {
        const pr = pickPr(focused, statuses);
        if (pr) services.openUrl(pr.href); else setHint('this session has no PR');
        return;
      }
      editInput(value, key);
      return;
    }

    if (key.escape) return toList();

    if (mode === 'delete') {
      if ((key.ctrl && value === 'x') || value === 'y') {
        const target = focused;
        const next = ordered[focusIndex + 1] || ordered[focusIndex - 1];
        setHidden(h => new Set(h).add(target.id));
        if (next) setSelectedId(next.id);
        toList(`deleted ${target.name}`);
        services.stopAndRemove(target.id).catch(e => {
          setHidden(h => { const n = new Set(h); n.delete(target.id); return n; });
          setHint(null);
          setError(`could not delete ${target.name}: ${e.message}`);
        });
      } else if (value === 'n') toList();
      return;
    }

    if (mode === 'rename') {
      if (key.return) {
        const name = input.trim();
        if (name && focused) {
          try { services.rename(focused.id, name); reloadSessions(); toList('renamed'); } catch (e) { toList(); setError(e.message); }
        } else toList();
        return;
      }
      editInput(value, key);
      return;
    }

    const items = mode === 'group' ? groupItems : pastItems;
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); setConfirm(false); return; }
    if (key.downArrow) { setCursor(c => Math.min(items.length - 1, c + 1)); setConfirm(false); return; }

    if (mode === 'group') {
      const it = groupItems[Math.min(cursor, groupItems.length - 1)];
      if (key.ctrl && value === 'x' && it && !it.isNew && it.value !== NO_GROUP) {
        if (!confirm) { setConfirm(true); return; }
        toList();
        runAsync(`deleting group «${it.value}»…`, services.removeGroup(it.value), () => {
          setSettings(s => ({...s, groups: s.groups.filter(g => g !== it.value)}));
          setHint(`group «${it.value}» deleted`);
        });
        return;
      }
      if (key.return && it && focused) {
        const target = focused;
        toList();
        runAsync('moving…', services.setGroup(target.id, it.value), () => setHint(it.value ? `moved to «${it.value}»` : 'removed from its group'));
        return;
      }
      editInput(value, key);
      return;
    }

    if (mode === 'resume') {
      const it = pastItems[Math.min(cursor, pastItems.length - 1)];
      if (key.return && it) {
        toList();
        runAsync('resuming…', services.resume(it.value.sessionId, it.value.cwd), id => {
          setHint(null);
          if (id) { setSelectedId(id); openSession(id); }
        });
        return;
      }
      editInput(value, key);
    }
  }, {isActive: !attaching});

  // Read from disk only when the card opens or its session changes.
  const cardKey = mode === 'card' && focused ? `${focused.id}:${focused.updatedAt}` : null;
  const cardExtras = useMemo(() => {
    if (!cardKey) return {notes: null, timeline: []};
    const k = sessionTickets(focused).primary;
    return {notes: k ? services.loadNotes(k) : null, timeline: services.loadTimeline(focused.id)};
  }, [cardKey]);

  const rows = stdout?.rows || 40;
  // Two spare columns: if the terminal draws a symbol wider than string-width
  // says (⏵, emoji), a line that reached the edge would wrap, the frame would
  // grow one line and the whole screen would jump on every repaint.
  const cols = Math.max(40, (stdout?.columns || 120) - 2);

  const cardModel = mode === 'card' && focused ? cardLines({
    session: focused, ticket: sessionTickets(focused), issues, statuses, now, cols, home: homedir(),
    prs: (focused.children || []).filter(c => c.kind === 'pr').map(c => c.href),
    notes: cardExtras.notes, timeline: cardExtras.timeline, issueUrl: services.issueUrl,
    cursor: cardCursor, expanded, trackerLabel: services.trackerLabel?.(),
  }) : null;
  if (cardModel && cardCursor === null && cardModel.stops.length) {
    cardModel.lines = cardLines({
      session: focused, ticket: sessionTickets(focused), issues, statuses, now, cols, home: homedir(),
      prs: (focused.children || []).filter(c => c.kind === 'pr').map(c => c.href),
      notes: cardExtras.notes, timeline: cardExtras.timeline, issueUrl: services.issueUrl,
      cursor: cardModel.stops[0], expanded, trackerLabel: services.trackerLabel?.(),
    }).lines;
  }
  // header 4 + blank 1 + rule, prompt, rule, status 4, and one spare line so the
  // frame never reaches the last row (that scrolls it).
  const room = paneId ? Math.max(4, rows - 3) : Math.max(4, rows - 10);
  const slide = useSlideIn(!!paneId && initial.animations !== false, !!cardModel);

  let body;
  if (mode === 'group') {
    body = html`<${Picker} title=${`Move «${focused?.name}» to…`} items=${groupItems}
      cursor=${Math.min(cursor, Math.max(0, groupItems.length - 1))} room=${room - 2} cols=${cols} />`;
  } else if (mode === 'resume') {
    // The list stays behind the box, like FleetView.
    const boxH = resumeBoxHeight(pastItems.length);
    const lines = listLines({groups, statuses, selectedId: focused?.id, now, cols});
    const {visible} = windowLines(lines, focused?.id, Math.max(1, room - boxH));
    body = html`<${Box} flexDirection="column" flexGrow=${1}>
      <${Box} flexDirection="column" flexGrow=${1}>${visible.map(l => l.el)}<//>
      <${ResumeBox} items=${pastItems} cursor=${Math.min(cursor, Math.max(0, pastItems.length - 1))} query=${input} now=${now} cols=${cols} />
    <//>`;
  } else if (mode === 'card' && cardModel) {
    const stop = cardCursor ?? cardModel.stops[0];
    const focusKey = cardModel.lines.find(l => l.stop === stop)?.key;
    const {visible, above, below} = windowLines(cardModel.lines, focusKey, room);
    body = html`<${Box} flexDirection="column">
      ${above ? html`<${Text} dimColor>  ↑ more<//>` : null}
      ${visible.map(l => l.el)}
      ${below ? html`<${Text} dimColor>  ↓ more<//>` : null}
    <//>`;
  } else if (mode === 'search') {
    const lines = searchLines({results, cursor: Math.min(cursor, Math.max(0, results.length - 1)), now, cols});
    const focusKey = results.length ? `r:${results[Math.min(cursor, results.length - 1)].id}` : undefined;
    const {visible, above, below} = windowLines(lines, focusKey, room - 1);
    const note = !termsOf(input).length ? 'type to search names, tickets, Jira titles, PRs and what was said in every conversation'
      : searching ? 'searching…' : results.length ? '' : 'nothing found';
    body = html`<${Box} flexDirection="column">
      ${note ? html`<${Text} dimColor>${note}<//>` : null}
      ${above ? html`<${Text} dimColor>  ↑ more<//>` : null}
      ${visible.map(l => l.el)}
      ${below ? html`<${Text} dimColor>  ↓ more<//>` : null}
    <//>`;
  } else if (mode === 'help') {
    body = html`<${Box} flexDirection="column">
      <${Text} bold color=${ACCENT}>Shortcuts<//>
      <${Text}> <//>
      ${SHORTCUTS.map(([k, d]) => html`<${Text} key=${k}>  <${Text} bold>${k.padEnd(22)}<//><${Text} dimColor>${d}<//><//>`)}
    <//>`;
  } else {
    const lines = listLines({groups, statuses, selectedId: focused?.id, now, cols});
    const {visible, above, below} = windowLines(lines, focused?.id, room);
    body = html`<${Box} flexDirection="column">
      ${sessions === null ? html`<${Text} dimColor>loading sessions…<//>` : null}
      ${sessions && !lines.length ? html`<${Text} dimColor>no sessions · type a task below to launch one<//>` : null}
      ${above ? html`<${Text} dimColor>  ↑ more<//>` : null}
      ${visible.map(l => l.el)}
      ${below ? html`<${Text} dimColor>  ↓ more<//>` : null}
    <//>`;
  }

  const typed = placeholder => (input
    ? html`<${Text}>${input}<${Text} inverse> <//><//>`
    : html`<${Text}><${Text} inverse>${placeholder[0]}<//><${Text} dimColor>${placeholder.slice(1)}<//><//>`);

  let prompt;
  if (mode === 'rename') prompt = html`<${Text}><${Text} color=${ACCENT}>rename › <//>${typed('new name')}<//>`;
  else if (mode === 'delete') prompt = html`<${Text} color="yellow">Stop and delete «${focused?.name}»? ctrl+x or y to confirm · esc to cancel<//>`;
  else if (mode === 'group') prompt = html`<${Text}>› ${typed('search or create a group')}<//>`;
  else if (mode === 'search') prompt = html`<${Text}><${Text} color=${ACCENT}>search › <//>${typed('words to find')}<//>`;
  else if (mode === 'resume') prompt = html`<${Text}>› <${Text} dimColor>describe a task for a new session<//><//>`;
  else prompt = html`<${Text}>› ${typed('describe a task for a new session')}${!input && focusedGroup ? html`<${Text} dimColor>  → «${focusedGroup}»<//>` : null}<//>`;

  let status;
  if (error) status = html`<${Text} color="red" wrap="truncate">${error}<//>`;
  else if (hint) status = html`<${Text} dimColor wrap="truncate">${hint}<//>`;
  else if (mode === 'group') status = html`<${Text} dimColor>${confirm ? `ctrl+x again to delete «${groupItems[Math.min(cursor, groupItems.length - 1)]?.value}» · esc to cancel` : 'enter to move · ctrl+x to delete group · esc to cancel'}<//>`;
  else if (mode === 'resume') status = html`<${Text} dimColor>esc to close<//>`;
  else if (mode === 'search') status = html`<${Text} dimColor>↑↓ move · enter open / resume · tab card · esc close<//>`;
  else if (mode === 'rename') status = html`<${Text} dimColor>enter to save · esc to cancel<//>`;
  else if (mode === 'help') status = html`<${Text} dimColor>any key to close<//>`;
  else if (mode === 'card') status = html`<${Text} dimColor>↑↓ move · enter open ticket or PR / unfold · o open in browser · → session · ← back · esc list<//>`;
  else {
    // The permission mode new sessions start in, when it is not Claude Code's default.
    const mode = initial.launchMode ? html`<${Text} color=${initial.launchMode === 'bypassPermissions' ? 'red' : 'yellow'}>⏵⏵ ${initial.launchMode} · <//>` : null;
    status = html`<${Text} wrap="truncate">${mode}<${Text} dimColor>enter open · tab card · ^f search · ^e group · ^x delete · ? help<//><//>`;
  }

  if (paneId) {
    // The card slides in from the right edge, like a drawer.
    const offset = Math.round(cols * slide);
    return html`<${Box} flexDirection="column" height=${rows - 1} width=${cols}>
      <${Box} flexDirection="column" height=${rows - 1} marginLeft=${offset} width=${cols - offset} overflowX="hidden">
        <${Box} flexDirection="column" flexGrow=${1} width=${cols}>${body}<//>
        <${Rule} cols=${cols} />
        <${Text} dimColor wrap="truncate">↑↓ move · enter open ticket or PR / unfold · → or esc close<//>
      <//>
    <//>`;
  }

  return html`<${Box} flexDirection="column" height=${rows - 1} width=${cols}>
    <${Header} sessions=${list} statuses=${statuses} quota=${settings.quota} pose=${pose} />
    <${Text}> <//>
    <${Box} flexDirection="column" flexGrow=${1}>${body}<//>
    <${Rule} cols=${cols} />
    ${prompt}
    <${Rule} cols=${cols} />
    ${status}
  <//>`;
}
