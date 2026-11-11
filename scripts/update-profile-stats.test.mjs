import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectStats, updateReadme } from './update-profile-stats.mjs';

const now = new Date('2025-01-02T00:00:00.000Z');
const identity = { viewer: { login: 'Joaofonsecaf' }, user: { createdAt: '2024-12-30T00:00:00.000Z' } };
const contribution = (id, count = 1) => ({
  totalCommitContributions: count,
  totalIssueContributions: 1,
  totalPullRequestContributions: 2,
  totalPullRequestReviewContributions: 3,
  commitContributionsByRepository: [{ repository: { id } }],
  issueContributionsByRepository: [{ repository: { id } }],
  pullRequestContributionsByRepository: [],
  pullRequestReviewContributionsByRepository: [],
});

test('soma anos e conta cada repositório apenas uma vez', async () => {
  const ranges = [];
  const stats = await collectStats(async (query, variables) => {
    if (!variables.from) return identity;
    ranges.push(variables);
    return { user: { contributionsCollection: contribution('same-repo', 5) } };
  }, now);

  assert.equal(stats.repositories.size, 1);
  assert.deepEqual([stats.commits, stats.issues, stats.pullRequests, stats.reviews], [10, 2, 4, 6]);
  assert.equal(ranges[0].to, '2024-12-31T23:59:59.999Z');
  assert.equal(ranges[1].from, '2025-01-01T00:00:00.000Z');
});

test('divide períodos ao alcançar o limite da API sem somar resultados truncados', async () => {
  let calls = 0;
  const stats = await collectStats(async (query, variables) => {
    if (!variables.from) return { ...identity, user: { createdAt: '2025-01-01T00:00:00.000Z' } };
    calls++;
    const collection = contribution('repo', 2);
    if (calls === 1) collection.commitContributionsByRepository = Array.from({ length: 100 }, () => ({ repository: { id: 'repo' } }));
    return { user: { contributionsCollection: collection } };
  }, now);
  assert.equal(calls, 3);
  assert.equal(stats.commits, 4);
  assert.equal(stats.repositories.size, 1);
});

test('rejeita token de outra conta e repositório inacessível', async () => {
  await assert.rejects(collectStats(async () => ({ ...identity, viewer: { login: 'other' } }), now), /pertencer/);
  await assert.rejects(collectStats(async (query, variables) => {
    if (!variables.from) return identity;
    const collection = contribution('repo');
    collection.commitContributionsByRepository = [{ repository: null }];
    return { user: { contributionsCollection: collection } };
  }, now), /inacessível/);
});

test('atualiza somente a seção de métricas e valida os marcadores', () => {
  const readme = 'Antes\n<!-- github-stats:start -->\nantigo\n<!-- github-stats:end -->\nDepois';
  const result = updateReadme(readme, {
    repositories: new Set(['a', 'b']), commits: 1234, issues: 1, pullRequests: 2, reviews: 3,
  }, now);
  assert.match(result, /\*\*2\*\* \| \*\*1\.234\*\* \| \*\*6\*\*/);
  assert.match(result, /Antes\n<!-- github-stats:start -->/);
  assert.match(result, /<!-- github-stats:end -->\nDepois$/);
  assert.throws(() => updateReadme('sem marcadores', {}, now), /Marcadores/);
});
