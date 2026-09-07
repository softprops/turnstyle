const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validate, update } = require('./dependabot-bundle.cjs');

function fixture() {
  const run = {
    id: 1,
    event: 'pull_request',
    head_repository: { full_name: 'softprops/turnstyle' },
    head_branch: 'dependabot/npm_and_yarn/npm-group',
    head_sha: 'abc',
    pull_requests: [{ number: 161 }],
  };
  const pr = {
    number: 161,
    state: 'open',
    user: { login: 'dependabot[bot]' },
    head: { repo: { full_name: 'softprops/turnstyle' }, ref: run.head_branch, sha: run.head_sha },
    base: { ref: 'master' },
  };
  const files = [{ filename: 'package-lock.json', status: 'modified' }];
  const artifacts = [{ name: 'dependabot-bundle-abc', expired: false }];
  const calls = [];
  const github = {
    rest: {
      pulls: { get: async () => ({ data: pr }), listFiles: 'files' },
      repos: {
        getContent: async () => ({ data: { content: Buffer.from('old').toString('base64') } }),
      },
      actions: {
        listWorkflowRunArtifacts: 'artifacts',
        createWorkflowDispatch: async (input) => calls.push(['dispatch', input]),
      },
    },
    paginate: async (endpoint) => (endpoint === 'files' ? files : artifacts),
    graphql: async (query, input) => calls.push(['commit', input.input]),
  };
  return {
    run,
    pr,
    files,
    artifacts,
    github,
    calls,
    context: { repo: { owner: 'softprops', repo: 'turnstyle' }, payload: { workflow_run: run } },
  };
}

test('accepts an open same-repository Dependabot dependency update', async () => {
  const f = fixture();
  assert.equal(await validate(f.github, f.context), f.pr);
});

for (const [name, change] of Object.entries({
  'non-PR run': (f) => {
    f.run.event = 'push';
  },
  'fork run': (f) => {
    f.run.head_repository.full_name = 'other/turnstyle';
  },
  'non-npm branch': (f) => {
    f.run.head_branch = 'feature';
  },
  'missing PR': (f) => {
    f.run.pull_requests = [];
  },
  'closed PR': (f) => {
    f.pr.state = 'closed';
  },
  'human author': (f) => {
    f.pr.user.login = 'human';
  },
  'fork PR': (f) => {
    f.pr.head.repo.full_name = 'other/turnstyle';
  },
  'changed branch': (f) => {
    f.pr.head.ref = 'master';
  },
  'stale head': (f) => {
    f.pr.head.sha = 'new';
  },
  'different base': (f) => {
    f.pr.base.ref = 'release';
  },
  'source changes': (f) => {
    f.files.push({ filename: 'src/main.ts', status: 'modified' });
  },
  'workflow changes': (f) => {
    f.files.push({ filename: '.github/workflows/main.yml', status: 'modified' });
  },
  'renamed manifest': (f) => {
    f.files[0].status = 'renamed';
  },
  'empty diff': (f) => {
    f.files.length = 0;
  },
  'missing artifact': (f) => {
    f.artifacts.length = 0;
  },
  'wrong artifact SHA': (f) => {
    f.artifacts[0].name = 'dependabot-bundle-old';
  },
  'expired artifact': (f) => {
    f.artifacts[0].expired = true;
  },
})) {
  test(`rejects ${name}`, async () => {
    const f = fixture();
    change(f);
    assert.equal(await validate(f.github, f.context), undefined);
    await update(f.github, f.context);
    assert.deepEqual(f.calls, []);
  });
}

async function withBundle(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
  const previous = process.env.RUNNER_TEMP;
  process.env.RUNNER_TEMP = dir;
  fs.mkdirSync(path.join(dir, 'dependabot-bundle'));
  fs.writeFileSync(path.join(dir, 'dependabot-bundle/index.js'), contents);
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('unchanged bundle does not create a commit or dispatch', async () => {
  await withBundle('old', async () => {
    const f = fixture();
    await update(f.github, f.context);
    assert.deepEqual(f.calls, []);
  });
});

test('commits only the bundle with expected head and sign-off, then dispatches CI', async () => {
  await withBundle('new', async () => {
    const f = fixture();
    await update(f.github, f.context);
    assert.equal(f.calls[0][0], 'commit');
    const commit = f.calls[0][1];
    assert.equal(commit.expectedHeadOid, 'abc');
    assert.equal(commit.branch.branchName, f.pr.head.ref);
    assert.match(commit.message.body, /^Signed-off-by:/);
    assert.deepEqual(commit.fileChanges, {
      additions: [{ path: 'dist/index.js', contents: Buffer.from('new').toString('base64') }],
    });
    assert.deepEqual(f.calls[1], [
      'dispatch',
      { owner: 'softprops', repo: 'turnstyle', workflow_id: 'main.yml', ref: f.pr.head.ref },
    ]);
  });
});

test('a concurrent head update fails without dispatching CI', async () => {
  await withBundle('new', async () => {
    const f = fixture();
    f.github.graphql = async () => {
      throw new Error('expectedHeadOid mismatch');
    };
    await assert.rejects(update(f.github, f.context), /expectedHeadOid/);
    assert.deepEqual(f.calls, []);
  });
});
