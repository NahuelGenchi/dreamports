// GitHub's API for the Dreamports bot (docs/MODERATION.md): REST and GraphQL calls with the workflow's token, the posts
// it checks, always read fresh from GitHub, and the posts that wait for a model.
export const repository = process.env.GITHUB_REPOSITORY ?? '';
export const [owner, name] = repository.split('/');
// the workflow's own account, as REST and GraphQL name it
export const BOT = 'github-actions[bot]';
const root = `https://api.github.com/repos/${repository}`;
const headers = () => ({
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28'
});

// a REST call: its answer, true for an empty one, and null for a GET of something that isn't there
export async function api(path, method = 'GET', body) {
  const response = await fetch(path.startsWith('https:') ? path : root + path, {
    method, headers: headers(), signal: AbortSignal.timeout(30000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (method === 'GET' && response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`GitHub API ${method} ${path}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? true : response.json();
}
export async function list(path, limit = 1000) {
  const result = [];
  for (let page = 1; result.length < limit; page++) {
    const batch = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`) ?? [];
    result.push(...batch);
    if (batch.length < 100) break;
  }
  return result;
}
// a GraphQL call; with missing, a node that isn't there is null instead of an error
export async function graphql(query, variables, { missing = false } = {}) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST', headers: headers(), signal: AbortSignal.timeout(30000), body: JSON.stringify({ query, variables })
  });
  const out = await response.json();
  const errors = (out.errors ?? []).filter(error => !(missing && error.type === 'NOT_FOUND'));
  if (!response.ok || !out.data || errors.length) throw new Error(`GitHub GraphQL: HTTP ${response.status} ${JSON.stringify(errors).slice(0, 500)}`);
  return out.data;
}

// what the bot reads of each kind of post, and of the issue, pull request or thread it's in
const AUTHOR = 'author { login __typename } authorAssociation';
const PARENT = 'id number url closed locked labels(first: 30) { nodes { name } }';
const FIELDS = `__typename
  ... on Issue { ${PARENT} title body ${AUTHOR} repository { nameWithOwner } }
  ... on PullRequest { ${PARENT} title body ${AUTHOR} repository { nameWithOwner } }
  ... on Discussion { ${PARENT} title body ${AUTHOR} repository { nameWithOwner } }
  ... on IssueComment { id url body isMinimized ${AUTHOR} repository { nameWithOwner } issue { ${PARENT} } pullRequest { ${PARENT} } }
  ... on PullRequestReviewComment { id url body isMinimized ${AUTHOR} repository { nameWithOwner } pullRequest { ${PARENT} } }
  ... on PullRequestReview { id url body isMinimized ${AUTHOR} repository { nameWithOwner } pullRequest { ${PARENT} } }
  ... on DiscussionComment { id url body isMinimized ${AUTHOR} replyTo { id } replies { totalCount }
    discussion { ${PARENT} repository { nameWithOwner } } }`;
const KINDS = {
  Issue: 'issue', PullRequest: 'pull-request', Discussion: 'discussion', IssueComment: 'issue-comment',
  PullRequestReviewComment: 'review-comment', PullRequestReview: 'review', DiscussionComment: 'discussion-comment'
};
const POSTS = ['issue', 'pull-request', 'discussion'];

// A post as the bot works with it: what it is, where, who wrote it, its text, and the issue, pull request or thread
// it's in, which is the post itself for an issue, a pull request or a thread. where is issue, pull-request or
// discussion.
export function itemFrom(node) {
  const kind = KINDS[node?.__typename];
  if (!kind) return null;
  const post = POSTS.includes(kind);
  const parent = post ? node : node.discussion ?? node.pullRequest ?? node.issue;
  if (!parent) return null;
  const parentKind = post ? kind : node.discussion ? 'discussion' : node.pullRequest ? 'pull-request' : 'issue';
  return {
    node: node.id, kind,
    where: parentKind,
    author: node.author?.login ?? 'ghost', bot: node.author?.__typename === 'Bot', association: node.authorAssociation ?? 'NONE',
    url: node.url, text: post ? `${node.title}\n\n${node.body ?? ''}` : node.body ?? '', minimized: node.isMinimized === true,
    replies: node.replies?.totalCount ?? 0,
    repository: (node.repository ?? parent.repository)?.nameWithOwner ?? null,
    parent: {
      node: parent.id, kind: parentKind, number: parent.number, url: parent.url, closed: parent.closed === true,
      locked: parent.locked === true, labels: (parent.labels?.nodes ?? []).map(label => label.name)
    },
    // the comment a reply in Discussions goes under: a comment's own thread, since a reply can't have replies
    replyTo: kind === 'discussion-comment' ? node.replyTo?.id ?? node.id : null
  };
}

// the posts with these node ids, read from GitHub, leaving out any that are gone
export async function fetchItems(ids) {
  const items = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { nodes } = await graphql(`query($ids: [ID!]!) { nodes(ids: $ids) { ${FIELDS} } }`, { ids: ids.slice(i, i + 50) }, { missing: true });
    for (const node of nodes) {
      const item = itemFrom(node);
      if (item) items.push(item);
    }
  }
  return items;
}

// The posts that wait for a model: one comment each on the bot's alert issues, which says waiting while it waits
// and settled once it doesn't. Only the three alert issues updated last are read, which holds every post still waiting.
export const WAITING = /<!-- dreamports-moderation: (waiting|settled)=(\S+) parent=(\S+) -->/;
export async function alertIssues(state = 'all') {
  const issues = await api(`/issues?labels=moderation-alert&state=${state}&sort=updated&direction=desc&per_page=30`) ?? [];
  return issues.filter(issue => !issue.pull_request && issue.user?.login === BOT).slice(0, 3);
}
export async function waitingEntries() {
  const entries = [];
  for (const alert of await alertIssues()) {
    for (const comment of await list(`/issues/${alert.number}/comments`)) {
      const found = comment.user?.login === BOT && WAITING.exec(comment.body ?? '');
      if (found) {
        entries.push({
          alert: alert.number, open: alert.state === 'open', comment: comment.id, since: comment.created_at,
          settled: found[1] === 'settled', node: found[2], parent: found[3]
        });
      }
    }
  }
  return entries;
}
