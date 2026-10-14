// Linear, through its GraphQL API with a personal API key
// (Settings → Security & access → Personal API keys).
const ENDPOINT = 'https://api.linear.app/graphql';
const BATCH = 25;

const CATEGORY = {backlog: 'new', unstarted: 'new', triage: 'new', started: 'indeterminate', completed: 'done', canceled: 'done'};

export function toIssue(n) {
  return {
    key: n.identifier,
    summary: n.title || '',
    status: n.state?.name || '',
    statusCategory: CATEGORY[n.state?.type] || '',
    type: (n.labels?.nodes || []).map(l => l.name).join(', '),
    priority: n.priorityLabel && n.priorityLabel !== 'No priority' ? n.priorityLabel : '',
    assignee: n.assignee?.name || '',
    sprint: n.cycle ? (n.cycle.name || `Cycle ${n.cycle.number}`) : '',
    updated: n.updatedAt || '',
    url: n.url || '',
    description: (n.description || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000),
  };
}

const FIELDS = 'identifier title url description priorityLabel updatedAt state { name type } assignee { name } cycle { number name } labels { nodes { name } }';

export function buildQuery(keys) {
  return `query { ${keys.map((k, i) => `i${i}: issue(id: ${JSON.stringify(k)}) { ${FIELDS} }`).join(' ')} }`;
}

export function linearTracker(cfg = {}) {
  const urls = {};
  return {
    label: 'LINEAR',
    // Linear URLs carry the workspace; the first fetch learns it.
    issueUrl: key => urls[key] || (urls._base ? `${urls._base}/issue/${key}` : `https://linear.app/issue/${key}`),
    async fetchIssues(keys) {
      const apiKey = process.env[cfg.apiKeyEnv || 'LINEAR_API_KEY'];
      if (!apiKey) throw new Error(`Linear needs ${cfg.apiKeyEnv || 'LINEAR_API_KEY'} in the environment`);
      const out = {};
      for (let i = 0; i < keys.length; i += BATCH) {
        const batch = keys.slice(i, i + BATCH);
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', Authorization: apiKey},
          body: JSON.stringify({query: buildQuery(batch)}),
        });
        if (!res.ok) throw new Error(`Linear API ${res.status}`);
        const data = (await res.json()).data || {};
        batch.forEach((k, j) => {
          const n = data[`i${j}`];
          if (!n) return;
          const issue = toIssue(n);
          out[issue.key] = issue;
          if (issue.url) {
            urls[issue.key] = issue.url;
            urls._base ||= issue.url.replace(/\/issue\/.*$/, '');
          }
        });
      }
      return out;
    },
  };
}
