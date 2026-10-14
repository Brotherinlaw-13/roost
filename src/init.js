import {createInterface} from 'node:readline/promises';
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {CONFIG_FILE, DEFAULTS, detect, onPath, readConfigFile, saveConfig} from './config.js';
import {jiraServer} from './trackers/jira.js';
import {fileURLToPath} from 'node:url';

const PANE_PYTHON = join(fileURLToPath(new URL('..', import.meta.url)), '.venv', 'bin', 'python');

// `roost init`: works out what this machine has (Jira CLI, a Linear key, the
// GitHub CLI and your orgs, a notes folder) and asks only what it cannot guess.
// `roost init --yes` takes every suggestion.

const sh = (cmd, args) => new Promise(resolve => {
  execFile(cmd, args, {timeout: 8000, encoding: 'utf8'}, (err, out) => resolve(err ? null : out.trim()));
});

async function probe() {
  const found = detect();
  const [jiraMe, ghUser, ghOrgs] = await Promise.all([
    onPath('jira') ? sh('jira', ['me']) : null,
    onPath('gh') ? sh('gh', ['api', 'user', '--jq', '.login']) : null,
    onPath('gh') ? sh('gh', ['api', 'user/orgs', '--jq', '.[].login']) : null,
  ]);
  return {
    found,
    jiraCli: !!jiraMe,
    jiraUrl: jiraServer(),
    linearKey: !!process.env.LINEAR_API_KEY,
    ghUser,
    ghOrgs: (ghOrgs || '').split('\n').filter(Boolean),
  };
}

export async function runInit({yes = process.argv.includes('--yes')} = {}) {
  const p = await probe();
  const prev = readConfigFile() || {};
  const rl = yes ? null : createInterface({input: process.stdin, output: process.stdout});
  const ask = async (question, suggestion) => {
    if (yes) return suggestion;
    const a = (await rl.question(`${question}${suggestion !== '' ? ` [${suggestion}]` : ''}: `)).trim();
    return a || suggestion;
  };
  const say = s => process.stdout.write(`${s}\n`);

  say('roost setup — enter keeps the suggestion.\n');
  say(`  Jira CLI: ${p.jiraCli ? `ready (${p.jiraUrl})` : 'not set up'} · Linear key: ${p.linearKey ? 'found' : 'none'} · GitHub CLI: ${p.ghUser ? `signed in as ${p.ghUser}` : 'not signed in'}\n`);

  const c = {...prev};
  const trackerGuess = prev.tracker || (p.jiraCli ? 'jira' : p.linearKey ? 'linear' : 'none');
  c.tracker = await ask('Ticket tracker: jira, linear or none', trackerGuess);
  if (c.tracker === 'jira') {
    const via = await ask('  Jira through the jira CLI or the REST API (cli/api)', prev.jira?.via || (p.jiraCli ? 'cli' : 'api'));
    c.jira = {...DEFAULTS.jira, ...prev.jira, via};
    if (via === 'api') {
      c.jira.url = await ask('  Jira URL', prev.jira?.url || p.jiraUrl || 'https://your-team.atlassian.net');
      c.jira.email = await ask('  Your Jira email', prev.jira?.email || '');
      c.jira.tokenEnv = await ask('  Env var that holds your Jira API token', c.jira.tokenEnv);
    }
  } else if (c.tracker === 'linear') {
    c.linear = {...DEFAULTS.linear, ...prev.linear};
    c.linear.apiKeyEnv = await ask('  Env var that holds your Linear API key', c.linear.apiKeyEnv);
  }
  if (c.tracker !== 'none') {
    const prefixes = await ask('  Ticket keys to look for, comma separated (empty = any KEY-123)', (prev.ticketPrefixes || []).join(','));
    c.ticketPrefixes = prefixes.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }

  c.codeHost = await ask('Code host: github or none', prev.codeHost || (p.ghUser ? 'github' : 'none'));
  if (c.codeHost === 'github') {
    const orgHint = p.ghOrgs.length ? ` (your orgs: ${p.ghOrgs.join(', ')})` : '';
    c.github = {org: await ask(`  GitHub org to find a ticket's PRs in${orgHint}`, prev.github?.org ?? p.ghOrgs[0] ?? '')};
  }

  const notes = await ask('Folder of <TICKET>.md notes to show on the card (none = off)', prev.notesDir ?? p.found.notesDir ?? 'none');
  c.notesDir = notes === 'none' ? null : notes;

  if (process.platform === 'darwin') {
    c.pet = /^y/i.test(await ask('Desktop pet that tells you when a session needs you (y/n)', prev.pet ? 'y' : 'n'));
  }

  rl?.close();
  saveConfig(c);
  say(`\nSaved ${CONFIG_FILE}.`);
  if (c.tracker === 'jira' && c.jira?.via === 'cli' && !p.jiraCli) say('  The Jira CLI is not set up yet: brew install jira-cli && jira init');
  if (c.tracker === 'jira' && c.jira?.via === 'api' && !process.env[c.jira.tokenEnv]) say(`  Set ${c.jira.tokenEnv} (https://id.atlassian.com/manage-profile/security/api-tokens).`);
  if (c.tracker === 'linear' && !process.env[c.linear.apiKeyEnv]) say(`  Set ${c.linear.apiKeyEnv} (Linear → Settings → Security & access → Personal API keys).`);
  if (c.codeHost === 'github' && !p.ghUser) say('  Sign in to GitHub: gh auth login');
  if (process.env.TERM_PROGRAM === 'iTerm.app' && !existsSync(PANE_PYTHON)) {
    say('  For the card pane: npm run setup-pane in the roost folder, and turn on iTerm2 → Settings → General → Magic → Enable Python API.');
  }
  if (c.pet) say('  Start the pet: roost pet');
  say('Run `roost` to see your sessions.');
}
