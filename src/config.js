import {readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, cpSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, delimiter} from 'node:path';

// roost's own state lives in one folder (ROOST_HOME, else ~/.roost): caches,
// what you have seen, muted sessions, the search index, the control socket.
// config.json there says which tools to use; anything left on "auto" is
// worked out from what is installed.
const HOME = homedir();
export const STATE = process.env.ROOST_HOME || join(HOME, '.roost');
export const statePath = name => join(STATE, name);
export const CONFIG_FILE = statePath('config.json');

// Before it had a name, roost kept its state with the FleetView tools.
const LEGACY = join(HOME, '.claude', 'fleet');
const LEGACY_FILES = ['seen.json', 'muted.json', 'my-prs.json', 'jira-cache.json', 'pr-status.json', 'ticket-prs.json', 'search-index'];

function ensureState() {
  if (existsSync(STATE)) return;
  // Only you: the folder holds the socket the desktop pet talks to.
  mkdirSync(STATE, {recursive: true, mode: 0o700});
  if (process.env.ROOST_HOME) return;
  for (const f of LEGACY_FILES) {
    try { cpSync(join(LEGACY, f), join(STATE, f), {recursive: true}); } catch {}
  }
}
ensureState();

export const DEFAULTS = {
  // 'jira' | 'linear' | 'none' | 'auto'
  tracker: 'auto',
  // via 'cli': the `jira` CLI (ankitpokhrel/jira-cli) as you set it up.
  // via 'api': url + email, the token in the env var named by tokenEnv.
  jira: {via: 'cli', url: '', email: '', tokenEnv: 'JIRA_API_TOKEN'},
  linear: {apiKeyEnv: 'LINEAR_API_KEY'},
  // Ticket keys to look for in session names, e.g. ["HS", "BUG"]; empty = any KEY-123.
  ticketPrefixes: [],
  // 'github' | 'none' | 'auto'
  codeHost: 'auto',
  // org: where to look for PRs that carry a ticket key in the title; empty = only yours.
  github: {org: ''},
  // A folder of <TICKET>.md notes shown on the card; 'auto' = ~/.ticket-notes if it exists; null = off.
  notesDir: 'auto',
  // The 5-hour quota from the fleet-quota tool; 'auto' = shown when it is installed.
  quota: 'auto',
  // 'fleet' = the fleet-group tools; 'roost' = roost's own store; 'auto' = fleet when installed.
  groups: 'auto',
  // Inside a session → (empty input) shows the card in a pane beside it (iTerm2).
  // paneKey adds another key for it, e.g. 'ctrl+]'; empty = arrows only.
  paneKey: '',
  // Open the card pane with every session you open (→ still hides it).
  paneAlwaysOpen: false,
  // Links you open (PRs, tickets) bring the browser to the front; false keeps
  // you in the terminal (handy with a second screen).
  followLinks: true,
  // Small animations, e.g. the card sliding into its pane.
  animations: true,
  // The desktop pet (macOS); build it with `roost pet`.
  pet: false,
  // When a session opens from a launch link (roost pet), the group it goes in by issue type: {"Bug": "Bugs", "*": "Working on"}.
  dispatchGroups: {},
  // Permission mode for sessions roost starts or resumes, e.g. 'acceptEdits' or
  // 'bypassPermissions'; empty = Claude Code's own default (it asks).
  launchPermissionMode: '',
  // Extra environment variables that get roost's pid while a session is open,
  // for a patched Claude Code that looks for another name.
  parentPidEnv: [],
};

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function onPath(cmd) {
  return (process.env.PATH || '').split(delimiter).some(dir => dir && existsSync(join(dir, cmd)));
}

const JIRA_CLI_CONFIG = join(HOME, '.config', '.jira', '.config.yml');
const FLEET_TOOLS = join(HOME, '.claude', 'tools');
export const LEGACY_DIR = LEGACY;

// What "auto" means on this machine.
export function detect(env = process.env) {
  return {
    tracker: existsSync(JIRA_CLI_CONFIG) ? 'jira' : env.LINEAR_API_KEY ? 'linear' : 'none',
    codeHost: onPath('gh') ? 'github' : 'none',
    notesDir: existsSync(join(HOME, '.ticket-notes')) ? join(HOME, '.ticket-notes') : null,
    quota: existsSync(join(LEGACY, 'quota.json')) || onPath('fleet-quota') || existsSync(join(FLEET_TOOLS, 'fleet-quota')),
    groups: existsSync(join(FLEET_TOOLS, 'fleet-group-set')) ? 'fleet' : 'roost',
  };
}

const deep = (base, over) => {
  const out = {...base};
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? {...base[k], ...v} : v;
  }
  return out;
};

export function resolveConfig(file, found) {
  const c = deep(DEFAULTS, file);
  for (const k of ['tracker', 'codeHost', 'notesDir', 'quota', 'groups']) if (c[k] === 'auto') c[k] = found[k];
  if (typeof c.notesDir === 'string') c.notesDir = c.notesDir.replace(/^~(?=\/|$)/, HOME);
  return c;
}

let cached = null;
export function config() {
  if (!cached) cached = resolveConfig(readJson(CONFIG_FILE), detect());
  return cached;
}

export function saveConfig(values) {
  mkdirSync(STATE, {recursive: true});
  writeFileSync(`${CONFIG_FILE}.tmp`, `${JSON.stringify(values, null, 2)}\n`);
  renameSync(`${CONFIG_FILE}.tmp`, CONFIG_FILE);
  cached = null;
}

export const readConfigFile = () => readJson(CONFIG_FILE);

// Changes one setting in config.json, keeping the others.
export function setConfigValue(key, value) {
  saveConfig({...(readJson(CONFIG_FILE) || {}), [key]: value});
}

// 'ctrl+]' -> '\x1d', 'ctrl+t' -> '\x14', 'alt+p' -> '\x1bp'.
export function keySequence(name) {
  const m = /^(ctrl|alt)\+(.)$/i.exec(String(name || '').trim());
  if (!m) return null;
  const ch = m[2];
  if (m[1].toLowerCase() === 'alt') return `\x1b${ch}`;
  const code = ch.toUpperCase().charCodeAt(0);
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : null;
}
