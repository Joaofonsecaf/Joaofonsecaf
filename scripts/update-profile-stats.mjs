import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const LOGIN = 'Joaofonsecaf';
const START = '<!-- github-stats:start -->';
const END = '<!-- github-stats:end -->';
const repositoryFields = [
  'commitContributionsByRepository',
  'issueContributionsByRepository',
  'pullRequestContributionsByRepository',
  'pullRequestReviewContributionsByRepository',
];
const totalFields = [
  'totalCommitContributions',
  'totalIssueContributions',
  'totalPullRequestContributions',
  'totalPullRequestReviewContributions',
];

const identityQuery = `
  query($login: String!) {
    viewer { login }
    user(login: $login) { createdAt }
  }
`;
const contributionsQuery = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        ${totalFields.join('\n')}
        ${repositoryFields.map(field => `${field}(maxRepositories: 100) { repository { id } }`).join('\n')}
      }
    }
  }
`;

export async function collectStats(graphql, now = new Date()) {
  const identity = await graphql(identityQuery, { login: LOGIN });
  if (identity.viewer?.login.toLowerCase() !== LOGIN.toLowerCase() || !identity.user) {
    throw new Error(`PROFILE_STATS_TOKEN deve pertencer à conta ${LOGIN}.`);
  }

  const stats = { repositories: new Set(), commits: 0, issues: 0, pullRequests: 0, reviews: 0 };

  async function collectRange(from, to) {
    const data = await graphql(contributionsQuery, {
      login: LOGIN,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    const collection = data.user?.contributionsCollection;
    if (!collection) throw new Error('Não foi possível consultar as contribuições.');

    if (repositoryFields.some(field => collection[field].length >= 100)) {
      if (from >= to) throw new Error('O limite de repositórios da API foi atingido.');
      const midpoint = Math.floor((from + to) / 2);
      await collectRange(from, midpoint);
      await collectRange(midpoint + 1, to);
      return;
    }

    for (const field of repositoryFields) {
      for (const contribution of collection[field]) {
        if (!contribution.repository?.id) {
          throw new Error('Um repositório de contribuição está inacessível ao token.');
        }
        stats.repositories.add(contribution.repository.id);
      }
    }
    stats.commits += collection.totalCommitContributions;
    stats.issues += collection.totalIssueContributions;
    stats.pullRequests += collection.totalPullRequestContributions;
    stats.reviews += collection.totalPullRequestReviewContributions;
  }

  const created = new Date(identity.user.createdAt);
  if (Number.isNaN(created.getTime()) || created > now) throw new Error('Data de criação da conta inválida.');
  for (let year = created.getUTCFullYear(); year <= now.getUTCFullYear(); year++) {
    const from = Math.max(created.getTime(), Date.UTC(year, 0, 1));
    const to = Math.min(now.getTime(), Date.UTC(year + 1, 0, 1) - 1);
    await collectRange(from, to);
  }
  return stats;
}

export function updateReadme(readme, stats, now = new Date()) {
  if (readme.split(START).length !== 2 || readme.split(END).length !== 2 || readme.indexOf(START) > readme.indexOf(END)) {
    throw new Error('Marcadores de métricas ausentes, duplicados ou fora de ordem no README.');
  }
  const number = value => new Intl.NumberFormat('pt-BR').format(value);
  const interactions = stats.issues + stats.pullRequests + stats.reviews;
  const content = [
    START,
    '',
    `| 📁 Repositórios trabalhados | 💻 Commits | 🤝 Interações |`,
    `| :---: | :---: | :---: |`,
    `| **${number(stats.repositories.size)}** | **${number(stats.commits)}** | **${number(interactions)}** |`,
    '',
    `Issues: **${number(stats.issues)}** · Pull requests: **${number(stats.pullRequests)}** · Revisões: **${number(stats.reviews)}**`,
    '',
    `*Atualizado em ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(now)} (UTC).*`,
    END,
  ].join('\n');
  return readme.slice(0, readme.indexOf(START)) + content + readme.slice(readme.indexOf(END) + END.length);
}

async function main() {
  const token = process.env.PROFILE_STATS_TOKEN;
  if (!token) throw new Error('Configure o secret PROFILE_STATS_TOKEN antes de executar o workflow.');

  async function graphql(query, variables) {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'profile-stats',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`GitHub GraphQL retornou HTTP ${response.status}.`);
    const result = await response.json();
    if (result.errors?.length) throw new Error(`GitHub GraphQL: ${result.errors.map(error => error.message).join('; ')}`);
    return result.data;
  }

  const now = new Date();
  const stats = await collectStats(graphql, now);
  const readme = await readFile('README.md', 'utf8');
  await writeFile('README.md', updateReadme(readme, stats, now));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
