import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attention} from '../src/attention.js';
import {mergePrs, prItems} from '../src/myprs.js';

const node = (url, review) => ({url, number: 1, title: 'HS-1: fix', state: 'OPEN', isDraft: false,
  latestOpinionatedReviews: {nodes: review ? [{state: review}] : []}});

test('mergePrs: the first run announces nothing, a new verdict is stamped, an old one keeps its time', () => {
  const first = mergePrs(null, [node('a', 'APPROVED'), node('b', null)], 100);
  assert.equal(first.prs.a.changedAt, 0);
  const second = mergePrs(first, [node('a', 'APPROVED'), node('b', 'CHANGES_REQUESTED')], 200);
  assert.equal(second.prs.a.changedAt, 0);
  assert.equal(second.prs.b.changedAt, 200);
  const third = mergePrs(second, [node('b', 'CHANGES_REQUESTED')], 300);
  assert.equal(third.prs.b.changedAt, 200);
  assert.equal(third.prs.a, undefined);
});

test('prItems: only verdicts newer than the last look', () => {
  const my = {prs: {a: {title: 't', number: 5, review: 'APPROVED', changedAt: 100}, b: {title: 'u', number: 6, review: 'CHANGES_REQUESTED', changedAt: 100}}};
  const items = prItems(my, {'pr:a': 150});
  assert.deepEqual(items.map(i => [i.id, i.kind, i.url]), [['pr:b', 'changes', 'b']]);
});

test('attention: muted sessions are left out; PR news sorts between failed and done', () => {
  const sessions = [
    {id: 's1', name: 'one', state: 'done', detail: 'all green'},
    {id: 's2', name: 'two', state: 'blocked', detail: 'Approve the delete?'},
    {id: 's3', name: 'three', state: 'failed'},
  ];
  const myPrs = {prs: {u: {title: 'pr', number: 9, review: 'CHANGES_REQUESTED', changedAt: 50}}};
  const r = attention(sessions, {seen: {}, muted: {s3: 0}, since: () => 10, myPrs});
  assert.deepEqual(r.items.map(i => i.id), ['s2', 'pr:u', 's1']);
  assert.equal(r.items[0].detail, 'Approve the delete?');
  assert.equal(r.items[1].label, 'changes requested');
  assert.deepEqual(r.muted.map(m => [m.id, m.name]), [['s3', 'three']]);
});
