import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scanLine} from '../src/ownprs.js';

const use = (id, command) => JSON.stringify({message: {content: [{type: 'tool_use', id, name: 'Bash', input: {command}}]}});
const result = (id, content) => JSON.stringify({message: {content: [{type: 'tool_result', tool_use_id: id, content}]}});

test('PRs opened by gh pr create, two in the same repo', () => {
  const scan = {pending: new Set(), prs: new Set()};
  scanLine(use('a', 'git push\ngh pr create --head x --title T'), scan);
  scanLine(result('a', 'remote: ...\nhttps://github.com/acme/app/pull/584\nhttps://github.com/acme/app/pull/585'), scan);
  scanLine(use('b', 'gh pr view 12'), scan);
  scanLine(result('b', 'https://github.com/acme/app/pull/12'), scan);
  assert.deepEqual([...scan.prs], ['https://github.com/acme/app/pull/584', 'https://github.com/acme/app/pull/585']);
});
