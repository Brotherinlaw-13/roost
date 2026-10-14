import {execDetached} from '../proc.js';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

// Jira, through the `jira` CLI as you set it up (via: 'cli') or the REST API
// with an API token (via: 'api').
const BATCH = 40;

export function jiraServer(cfg = {}) {
  if (cfg.url) return cfg.url.replace(/\/$/, '');
  try {
    const yml = readFileSync(join(homedir(), '.config', '.jira', '.config.yml'), 'utf8');
    return /^server:\s*(\S+)/m.exec(yml)?.[1]?.replace(/\/$/, '') || '';
  } catch { return ''; }
}

// Atlassian Document Format -> plain text, keeping the structure a reader
// needs: paragraphs, headings, bullet and numbered lists, code blocks.
export function adfText(node, depth = 0) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  const kids = (n, d = depth) => (n.content || []).map(c => adfText(c, d)).join('');
  switch (node.type) {
    case 'text': return node.text || '';
    case 'hardBreak': return '\n';
    case 'mention': return node.attrs?.text || '@someone';
    case 'emoji': return node.attrs?.text || '';
    case 'inlineCard': return node.attrs?.url || '';
    case 'paragraph': return `${kids(node)}\n`;
    case 'heading': return `\n${kids(node).toUpperCase()}\n`;
    case 'codeBlock': return `${kids(node).split('\n').map(l => `    ${l}`).join('\n')}\n`;
    case 'rule': return '────\n';
    case 'bulletList':
    case 'orderedList':
      return (node.content || []).map((li, i) => {
        const mark = node.type === 'orderedList' ? `${i + 1}.` : '•';
        const body = kids(li, depth + 1).replace(/\n+$/, '');
        const pad = '  '.repeat(depth);
        return `${pad}${mark} ${body.replace(/\n/g, `\n${pad}  `)}\n`;
      }).join('');
    default: return kids(node);
  }
}

export function toIssue(raw) {
  const f = raw.fields || {};
  const sprints = Object.values(f).find(v => Array.isArray(v) && v[0]?.state && v[0]?.name) || [];
  const sprint = sprints.find(s => s.state === 'active') || sprints.at(-1);
  return {
    key: raw.key,
    summary: f.summary || '',
    status: f.status?.name || '',
    statusCategory: f.status?.statusCategory?.key || '',
    type: f.issuetype?.name || '',
    priority: f.priority?.name || '',
    assignee: f.assignee?.displayName || '',
    sprint: sprint?.name || '',
    updated: f.updated || '',
    description: adfText(f.description).replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000),
  };
}

function listViaCli(keys) {
  return new Promise((resolve, reject) => {
    execDetached('jira', ['issue', 'list', '-q', `key in (${keys.join(',')})`, '--raw'],
      {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}, (err, out, errOut) => {
        if (err) return reject(new Error((errOut || err.message).trim()));
        try {
          const d = JSON.parse(out);
          resolve(Array.isArray(d) ? d : d.issues || []);
        } catch (e) { reject(e); }
      });
  });
}

async function listViaApi(keys, cfg) {
  const token = process.env[cfg.tokenEnv || 'JIRA_API_TOKEN'];
  if (!cfg.email || !token) throw new Error(`Jira API needs jira.email in the config and ${cfg.tokenEnv || 'JIRA_API_TOKEN'} in the environment`);
  const url = new URL(`${jiraServer(cfg)}/rest/api/3/search/jql`);
  url.searchParams.set('jql', `key in (${keys.join(',')})`);
  url.searchParams.set('fields', '*navigable');
  url.searchParams.set('maxResults', String(keys.length));
  const res = await fetch(url, {headers: {Authorization: `Basic ${Buffer.from(`${cfg.email}:${token}`).toString('base64')}`, Accept: 'application/json'}});
  if (!res.ok) throw new Error(`Jira API ${res.status}`);
  return (await res.json()).issues || [];
}

export function jiraTracker(cfg = {}) {
  return {
    label: 'JIRA',
    issueUrl: key => `${jiraServer(cfg)}/browse/${key}`,
    async fetchIssues(keys) {
      const out = {};
      for (let i = 0; i < keys.length; i += BATCH) {
        const batch = keys.slice(i, i + BATCH);
        const raws = cfg.via === 'api' ? await listViaApi(batch, cfg) : await listViaCli(batch);
        for (const raw of raws) out[raw.key] = toIssue(raw);
      }
      return out;
    },
  };
}
