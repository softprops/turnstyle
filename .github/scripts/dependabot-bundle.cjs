const fs = require('node:fs');
const path = require('node:path');

async function validate(github, context) {
  const run = context.payload.workflow_run;
  if (
    run.event !== 'pull_request' ||
    run.head_repository.full_name !== `${context.repo.owner}/${context.repo.repo}`
  )
    return;
  if (!run.head_branch.startsWith('dependabot/npm_and_yarn/')) return;
  if (run.pull_requests.length !== 1) return;
  const { data: pr } = await github.rest.pulls.get({
    ...context.repo,
    pull_number: run.pull_requests[0].number,
  });
  if (
    pr.state !== 'open' ||
    pr.user.login !== 'dependabot[bot]' ||
    pr.head.repo.full_name !== run.head_repository.full_name ||
    pr.head.ref !== run.head_branch ||
    pr.head.sha !== run.head_sha ||
    pr.base.ref !== 'master'
  )
    return;
  const files = await github.paginate(github.rest.pulls.listFiles, {
    ...context.repo,
    pull_number: pr.number,
    per_page: 100,
  });
  // Never write to PRs that change source, workflows, or automation scripts.
  const allowed = new Set(['package.json', 'package-lock.json', 'dist/index.js']);
  if (
    !files.length ||
    files.some((file) => !allowed.has(file.filename) || file.status !== 'modified')
  )
    return;
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
    ...context.repo,
    run_id: run.id,
    per_page: 100,
  });
  if (
    !artifacts.some(
      (artifact) => artifact.name === `dependabot-bundle-${run.head_sha}` && !artifact.expired,
    )
  )
    return;
  return pr;
}

async function update(github, context) {
  // Recheck the live head after downloading; the commit API also rejects races.
  const pr = await validate(github, context);
  if (!pr) return;
  const bundlePath = path.join(process.env.RUNNER_TEMP, 'dependabot-bundle', 'index.js');
  if (!fs.lstatSync(bundlePath).isFile()) throw new Error('Expected a regular bundle file');
  const contents = fs.readFileSync(bundlePath).toString('base64');
  const { data: current } = await github.rest.repos.getContent({
    ...context.repo,
    path: 'dist/index.js',
    ref: pr.head.sha,
  });
  if (current.content && current.content.replace(/\s/g, '') === contents) return;
  await github.graphql(
    `mutation($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) { commit { oid } }
  }`,
    {
      input: {
        branch: {
          repositoryNameWithOwner: `${context.repo.owner}/${context.repo.repo}`,
          branchName: pr.head.ref,
        },
        expectedHeadOid: pr.head.sha,
        message: {
          headline: 'chore(deps): rebuild action bundle',
          body: 'Signed-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>',
        },
        fileChanges: { additions: [{ path: 'dist/index.js', contents }] },
      },
    },
  );
  // GITHUB_TOKEN commits do not trigger pull_request CI automatically.
  await github.rest.actions.createWorkflowDispatch({
    ...context.repo,
    workflow_id: 'main.yml',
    ref: pr.head.ref,
  });
}

module.exports = { validate, update };
