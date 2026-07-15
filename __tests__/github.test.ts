import { warning } from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createThrottleOptions, OctokitGitHub, type WorkflowRun } from '../src/github';

vi.mock('@actions/core', () => ({
  debug: vi.fn(),
  warning: vi.fn(),
}));

const run = (overrides: Partial<WorkflowRun>): WorkflowRun =>
  ({
    id: 1,
    status: 'completed',
    conclusion: 'success',
    head_branch: 'master',
    display_title: 'default-title',
    name: 'default-name',
    html_url: 'https://example.com/run',
    created_at: '2026-05-03T10:00:00Z',
    run_started_at: '2026-05-03T10:00:00Z',
    ...overrides,
  }) as WorkflowRun;

type WorkflowRunPages = WorkflowRun[][];
type PageMapper = (response: { data: WorkflowRun[] }, done: () => void) => WorkflowRun[];
interface TestOctokit {
  actions: Record<string, ReturnType<typeof vi.fn>>;
  paginate: ReturnType<typeof vi.fn>;
}

const replaceOctokit = (client: OctokitGitHub, octokit: TestOctokit) => {
  (client as unknown as { octokit: TestOctokit }).octokit = octokit;
};

const CLIENT_ERROR_STATUSES = Array.from({ length: 100 }, (_, index) => 400 + index);
const ACTIVE_RUN_STATUSES = ['in_progress', 'queued', 'waiting'];

const advanceUntilCalled = async (mock: ReturnType<typeof vi.fn>) => {
  for (let attempt = 0; attempt < 10 && mock.mock.calls.length === 0; attempt += 1) {
    await vi.advanceTimersToNextTimerAsync();
  }
};

const advanceUntilCallCount = async (mock: ReturnType<typeof vi.fn>, count: number) => {
  for (let attempt = 0; attempt < 20 && mock.mock.calls.length < count; attempt += 1) {
    await vi.advanceTimersToNextTimerAsync();
  }
};

const flushUntilTimerScheduled = async () => {
  for (let attempt = 0; attempt < 50 && vi.getTimerCount() === 0; attempt += 1) {
    await Promise.resolve();
  }
};

const flushMicrotasks = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await Promise.resolve();
  }
};

const flushShortDelayWorkUntilCalled = async (mock: ReturnType<typeof vi.fn>) => {
  for (let attempt = 0; attempt < 20 && mock.mock.calls.length === 0; attempt += 1) {
    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
  }
};

const clientWithRunPages = (...pagesByCall: WorkflowRunPages[]) => {
  const client = new OctokitGitHub('fake-token');
  let paginateCalls = 0;
  let pagesScanned = 0;
  const paginate = vi.fn(
    async (_endpoint: unknown, _options: Record<string, unknown>, mapFunction: PageMapper) => {
      const pages = pagesByCall[paginateCalls] || [];
      paginateCalls += 1;
      const results: WorkflowRun[] = [];
      let doneCalled = false;
      const done = () => {
        doneCalled = true;
      };

      for (const page of pages) {
        pagesScanned += 1;
        results.push(...mapFunction({ data: page }, done));
        if (doneCalled) {
          break;
        }
      }

      return results;
    },
  );

  replaceOctokit(client, {
    actions: {
      listWorkflowRuns: vi.fn(),
      listWorkflowRunsForRepo: vi.fn(),
    },
    paginate,
  });

  return { client, paginate, pagesScanned: () => pagesScanned };
};

const clientWithDynamicRunPages = (
  pagesForOptions: (options: Record<string, unknown>) => WorkflowRunPages,
) => {
  const client = new OctokitGitHub('fake-token');
  let pagesScanned = 0;
  const paginate = vi.fn(
    async (_endpoint: unknown, options: Record<string, unknown>, mapFunction: PageMapper) => {
      const pages = pagesForOptions(options);
      const results: WorkflowRun[] = [];
      let doneCalled = false;
      const done = () => {
        doneCalled = true;
      };

      for (const page of pages) {
        pagesScanned += 1;
        results.push(...mapFunction({ data: page }, done));
        if (doneCalled) {
          break;
        }
      }

      return results;
    },
  );

  replaceOctokit(client, {
    actions: {
      listWorkflowRuns: vi.fn(),
      listWorkflowRunsForRepo: vi.fn(),
    },
    paginate,
  });

  return { client, paginate, pagesScanned: () => pagesScanned };
};

describe('github', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('retry', () => {
    it('does not retry any 4xx responses when retries are enabled', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      for (const status of CLIENT_ERROR_STATUSES) {
        fetchMock.mockReset();
        fetchMock.mockImplementation(
          async () =>
            new Response(JSON.stringify({ message: 'Request failed with status ' + status }), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
        );

        const client = new OctokitGitHub('fake-token', 2);

        await expect(client.run('org', 'repo-' + status, status)).rejects.toMatchObject({ status });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    });

    it('cancels a pending 5xx retry backoff when its request signal is aborted', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
        options?.signal?.throwIfAborted();
        return new Response(JSON.stringify({ message: 'server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      });
      const controller = new AbortController();
      const client = new OctokitGitHub('fake-token', 2);
      const request = client.run('org', 'repo', 42, { signal: controller.signal });
      const settled = vi.fn();
      void request.then(settled, settled);

      await advanceUntilCalled(fetchMock);
      await flushUntilTimerScheduled();
      await flushMicrotasks();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      expect(settled).not.toHaveBeenCalled();

      controller.abort();
      await flushShortDelayWorkUntilCalled(settled);

      expect(settled).toHaveBeenCalledOnce();
      await request.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('cancels a pending primary-rate-limit backoff when its request signal is aborted', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
      const resetAtSeconds = Math.floor(Date.now() / 1000) + 600;
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
        options?.signal?.throwIfAborted();
        return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resetAtSeconds),
          },
        });
      });
      const controller = new AbortController();
      const client = new OctokitGitHub('fake-token');
      const request = client.run('org', 'repo', 42, { signal: controller.signal });
      const settled = vi.fn();
      void request.then(settled, settled);

      await advanceUntilCalled(fetchMock);
      await flushUntilTimerScheduled();
      await flushMicrotasks();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      expect(settled).not.toHaveBeenCalled();

      controller.abort();
      await flushShortDelayWorkUntilCalled(settled);

      expect(settled).toHaveBeenCalledOnce();
      await request.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('logs only the one primary-rate-limit retry that is actually scheduled', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
      const resetAtSeconds = Math.floor(Date.now() / 1000) - 1;
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resetAtSeconds),
          },
        }),
      );
      const request = new OctokitGitHub('fake-token').run('org', 'repo', 42);
      const rejection = expect(request).rejects.toMatchObject({ status: 403 });
      const settled = vi.fn();
      void request.then(settled, settled);

      await advanceUntilCalled(fetchMock);
      await advanceUntilCallCount(fetchMock, 2);
      await flushShortDelayWorkUntilCalled(settled);
      await rejection;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const messages = vi
        .mocked(warning)
        .mock.calls.map(([message]) => (typeof message === 'string' ? message : message.message));
      expect(
        messages.filter((message) => message.startsWith('Request quota exhausted for request')),
      ).toHaveLength(2);
      expect(messages.filter((message) => message.startsWith('Retrying after'))).toEqual([
        'Retrying after 0 seconds!',
      ]);
    });
  });

  describe('API wrappers', () => {
    it.each([
      ['the default GitHub API', undefined, 'https://api.github.com'],
      [
        'a configured GitHub Enterprise API',
        'https://github.example/api/v3',
        'https://github.example/api/v3',
      ],
    ] as const)('uses %s base URL', async (_description, configuredUrl, expectedUrl) => {
      vi.stubEnv('GITHUB_API_URL', configuredUrl);
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 42 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      await new OctokitGitHub('fake-token').run('org', 'repo', 42);

      const request = fetchMock.mock.calls[0]?.[0];
      expect(request).toBeDefined();
      expect(request instanceof Request ? request.url : String(request)).toBe(
        `${expectedUrl}/repos/org/repo/actions/runs/42`,
      );
    });

    it('paginates workflows with repository coordinates and forwards an abort signal', async () => {
      const listRepoWorkflows = vi.fn();
      const paginate = vi
        .fn()
        .mockResolvedValueOnce([{ id: 123, name: 'CI' }])
        .mockResolvedValueOnce([{ id: 456, name: 'Deploy' }]);
      const client = new OctokitGitHub('fake-token');
      replaceOctokit(client, {
        actions: { listRepoWorkflows },
        paginate,
      });

      await expect(client.workflows('org', 'repo')).resolves.toEqual([{ id: 123, name: 'CI' }]);
      const signal = new AbortController().signal;
      await expect(client.workflows('org', 'repo', { signal })).resolves.toEqual([
        { id: 456, name: 'Deploy' },
      ]);
      expect(paginate).toHaveBeenNthCalledWith(1, listRepoWorkflows, {
        owner: 'org',
        repo: 'repo',
        per_page: 100,
      });
      expect(paginate).toHaveBeenNthCalledWith(2, listRepoWorkflows, {
        owner: 'org',
        repo: 'repo',
        per_page: 100,
        request: { signal },
      });
    });

    it('fetches a workflow run with and without an abort signal', async () => {
      const workflowRun = run({ id: 42, status: 'in_progress', conclusion: null });
      const getWorkflowRun = vi.fn().mockResolvedValue({ data: workflowRun });
      const client = new OctokitGitHub('fake-token');
      replaceOctokit(client, {
        actions: { getWorkflowRun },
        paginate: vi.fn(),
      });

      await expect(client.run('org', 'repo', 42)).resolves.toBe(workflowRun);
      const signal = new AbortController().signal;
      await expect(client.run('org', 'repo', 42, { signal })).resolves.toBe(workflowRun);

      expect(getWorkflowRun).toHaveBeenNthCalledWith(1, {
        owner: 'org',
        repo: 'repo',
        run_id: 42,
      });
      expect(getWorkflowRun).toHaveBeenNthCalledWith(2, {
        owner: 'org',
        repo: 'repo',
        run_id: 42,
        request: { signal },
      });
    });

    it('paginates jobs and returns present or missing job steps', async () => {
      const listJobsForWorkflowRun = vi.fn();
      const getJobForWorkflowRun = vi
        .fn()
        .mockResolvedValueOnce({ data: { steps: [{ number: 1, name: 'Build' }] } })
        .mockResolvedValueOnce({ data: {} });
      const paginate = vi.fn().mockResolvedValue([{ id: 7, name: 'build' }]);
      const client = new OctokitGitHub('fake-token');
      replaceOctokit(client, {
        actions: { listJobsForWorkflowRun, getJobForWorkflowRun },
        paginate,
      });

      await expect(client.jobs('org', 'repo', 42)).resolves.toEqual([{ id: 7, name: 'build' }]);
      expect(paginate).toHaveBeenCalledWith(listJobsForWorkflowRun, {
        owner: 'org',
        repo: 'repo',
        run_id: 42,
        per_page: 100,
      });
      await expect(client.steps('org', 'repo', 7)).resolves.toEqual([{ number: 1, name: 'Build' }]);
      await expect(client.steps('org', 'repo', 8)).resolves.toEqual([]);
      expect(getJobForWorkflowRun).toHaveBeenNthCalledWith(2, {
        owner: 'org',
        repo: 'repo',
        job_id: 8,
      });
    });

    it('forwards abort signals for job and step reads', async () => {
      const listJobsForWorkflowRun = vi.fn();
      const getJobForWorkflowRun = vi.fn().mockResolvedValue({ data: { steps: [] } });
      const paginate = vi.fn().mockResolvedValue([]);
      const client = new OctokitGitHub('fake-token');
      replaceOctokit(client, {
        actions: { listJobsForWorkflowRun, getJobForWorkflowRun },
        paginate,
      });
      const signal = new AbortController().signal;

      await client.jobs('org', 'repo', 42, { signal });
      await client.steps('org', 'repo', 7, { signal });

      expect(paginate).toHaveBeenCalledWith(listJobsForWorkflowRun, {
        owner: 'org',
        repo: 'repo',
        run_id: 42,
        per_page: 100,
        request: { signal },
      });
      expect(getJobForWorkflowRun).toHaveBeenCalledWith({
        owner: 'org',
        repo: 'repo',
        job_id: 7,
        request: { signal },
      });
    });
  });

  describe('runs', () => {
    it('de-duplicates the same active run returned by multiple status queries', async () => {
      const duplicateRun = run({ id: 7, status: 'queued', conclusion: null });
      const { client } = clientWithRunPages([[duplicateRun]], [[duplicateRun]], []);

      await expect(client.runs('org', 'repo', 123)).resolves.toEqual([duplicateRun]);
    });

    it('matches queue names against the workflow name and excludes inactive runs', async () => {
      const matchingRun = run({
        id: 1,
        status: 'queued',
        conclusion: null,
        display_title: 'other-title',
        name: 'deploy-api',
      });
      const completedRun = run({
        id: 2,
        status: 'completed',
        conclusion: 'success',
        display_title: 'deploy-api',
      });
      const { client } = clientWithRunPages([], [[matchingRun, completedRun]], []);

      await expect(client.runs('org', 'repo', 123, { queueName: 'deploy-api' })).resolves.toEqual([
        matchingRun,
      ]);
    });

    it('does not perform an unfiltered historical walk when only active runs can be eligible', async () => {
      const completedHistoricalPages = Array.from({ length: 51 }, (_, pageIndex) =>
        Array.from({ length: 100 }, (_, runIndex) =>
          run({
            id: pageIndex * 100 + runIndex + 1,
            status: 'completed',
            conclusion: 'success',
          }),
        ),
      );
      const activeRun = run({
        id: 5101,
        status: 'queued',
        conclusion: null,
        head_branch: 'master',
      });
      const { client, paginate, pagesScanned } = clientWithDynamicRunPages((options) => {
        if (!options.status) {
          return completedHistoricalPages;
        }
        return options.status === 'queued' ? [[activeRun]] : [];
      });

      await expect(client.runs('org', 'repo', 123, { branch: 'master' })).resolves.toEqual([
        activeRun,
      ]);
      expect(paginate).toHaveBeenCalledTimes(ACTIVE_RUN_STATUSES.length);
      expect(paginate.mock.calls.map(([, options]) => options.status)).toEqual(ACTIVE_RUN_STATUSES);
      expect(paginate.mock.calls.every(([, options]) => options.branch === 'master')).toBe(true);
      expect(pagesScanned()).toBe(1);
    });

    it('does not stop pagination after newer active runs outside the queue', async () => {
      const otherQueuePages = Array.from({ length: 5 }, (_, pageIndex) =>
        Array.from({ length: 100 }, (_, runIndex) =>
          run({
            id: pageIndex * 100 + runIndex + 1,
            status: 'in_progress',
            conclusion: null,
            display_title: 'other-queue',
            name: 'other-queue',
          }),
        ),
      );
      const queuedRun = run({
        id: 501,
        status: 'in_progress',
        conclusion: null,
        display_title: 'deploy-api',
        name: 'deploy-api',
      });
      const { client } = clientWithRunPages([...otherQueuePages, [queuedRun]], [], []);

      await expect(
        client.runs('org', 'repo', 123, { branch: 'master', queueName: 'deploy-api' }),
      ).resolves.toEqual([queuedRun]);
    });

    it('excludes active runs with unknown branches from branch-filtered results', async () => {
      const unknownBranchRun = run({
        id: 1,
        status: 'queued',
        conclusion: null,
        head_branch: null,
      });
      const masterRun = run({
        id: 2,
        status: 'queued',
        conclusion: null,
        head_branch: 'master',
      });
      const { client } = clientWithRunPages([], [[unknownBranchRun, masterRun]], []);

      await expect(client.runs('org', 'repo', 123, { branch: 'master' })).resolves.toEqual([
        masterRun,
      ]);
    });

    it('queries only active statuses with the branch filter', async () => {
      const activeRun = run({
        id: 1,
        status: 'queued',
        conclusion: null,
        head_branch: 'master',
      });
      const { client, paginate } = clientWithRunPages([], [[activeRun]], []);

      await expect(client.runs('org', 'repo', 123, { branch: 'master' })).resolves.toEqual([
        activeRun,
      ]);
      expect(paginate.mock.calls.map(([, options]) => options)).toEqual([
        expect.objectContaining({ branch: 'master', status: 'in_progress' }),
        expect.objectContaining({ branch: 'master', status: 'queued' }),
        expect.objectContaining({ branch: 'master', status: 'waiting' }),
      ]);
    });

    it('keeps active status queries when no branch filter is provided', async () => {
      const activeRun = run({
        id: 1,
        status: 'queued',
        conclusion: null,
        head_branch: 'feature',
      });
      const { client, paginate } = clientWithRunPages([], [[activeRun]], []);

      await expect(client.runs('org', 'repo', 123)).resolves.toEqual([activeRun]);
      const statusOptions = paginate.mock.calls.map(([, options]) => options);
      expect(statusOptions.map((options) => options.status)).toEqual([
        'in_progress',
        'queued',
        'waiting',
      ]);
      for (const options of statusOptions) {
        expect(options).not.toHaveProperty('branch');
      }
    });

    it('does not cap discovered active runs before predecessor filtering', async () => {
      const newerActivePages = Array.from({ length: 5 }, (_, pageIndex) =>
        Array.from({ length: 100 }, (_, runIndex) =>
          run({
            id: pageIndex * 100 + runIndex + 1,
            status: 'queued',
            conclusion: null,
          }),
        ),
      );
      const olderActiveRun = run({
        id: 501,
        status: 'queued',
        conclusion: null,
      });
      const { client } = clientWithRunPages([...newerActivePages, [olderActiveRun]], [], []);

      const runs = await client.runs('org', 'repo', 123);

      expect(runs).toHaveLength(501);
      expect(runs).toContain(olderActiveRun);
    });

    it('stops active status pagination at the page cap', async () => {
      const nonMatchingQueuePages = Array.from({ length: 51 }, (_, pageIndex) =>
        Array.from({ length: 100 }, (_, runIndex) =>
          run({
            id: pageIndex * 100 + runIndex + 1,
            status: 'in_progress',
            conclusion: null,
            display_title: 'other-queue',
            name: 'other-queue',
          }),
        ),
      );
      const { client, pagesScanned } = clientWithRunPages(nonMatchingQueuePages, [], []);

      await expect(client.runs('org', 'repo', 123, { queueName: 'deploy-api' })).resolves.toEqual(
        [],
      );
      expect(pagesScanned()).toBe(50);
    });

    it('uses the repo-level active runs endpoint for cross-workflow queue discovery', async () => {
      const activeRun = run({
        id: 1,
        status: 'queued',
        conclusion: null,
        display_title: 'deploy-api',
        name: 'deploy-api',
      });
      const { client, paginate } = clientWithRunPages([], [[activeRun]], []);

      await expect(
        client.activeRunsForRepo('org', 'repo', { queueName: 'deploy-api' }),
      ).resolves.toEqual([activeRun]);
      expect(paginate).toHaveBeenCalledTimes(ACTIVE_RUN_STATUSES.length);
      expect(paginate.mock.calls.every(([, options]) => !('workflow_id' in options))).toBe(true);
      expect(paginate.mock.calls.map(([, options]) => options.status)).toEqual(ACTIVE_RUN_STATUSES);
    });

    it('forwards abort signals through workflow and repository run pagination', async () => {
      const signal = new AbortController().signal;
      const { client, paginate } = clientWithRunPages([], [], [], [], [], []);

      await client.runs('org', 'repo', 123, {}, { signal });
      await client.activeRunsForRepo('org', 'repo', {}, { signal });

      expect(paginate).toHaveBeenCalledTimes(ACTIVE_RUN_STATUSES.length * 2);
      expect(
        paginate.mock.calls.every(([, options]) => {
          const request = options.request as { signal?: AbortSignal } | undefined;
          return request?.signal === signal;
        }),
      ).toBe(true);
    });
  });

  describe('rate-limit logging', () => {
    it('logs primary and secondary rate-limit messages as visible warnings', () => {
      const throttleOptions = createThrottleOptions();

      expect(throttleOptions.onRateLimit(30, { method: 'GET', url: '/rate-limited' }, {}, 0)).toBe(
        true,
      );
      throttleOptions.onSecondaryRateLimit(60, { method: 'GET', url: '/secondary-limited' });

      expect(warning).toHaveBeenCalledWith('Request quota exhausted for request GET /rate-limited');
      expect(warning).toHaveBeenCalledWith('Retrying after 30 seconds!');
      expect(warning).toHaveBeenCalledWith(
        'Secondary rate limit detected for request GET /secondary-limited',
      );
    });

    it('does not retry after the first primary rate-limit retry', () => {
      const throttleOptions = createThrottleOptions();

      expect(
        throttleOptions.onRateLimit(30, { method: 'GET', url: '/rate-limited' }, {}, 1),
      ).toBeUndefined();
      expect(warning).toHaveBeenCalledWith('Request quota exhausted for request GET /rate-limited');
      expect(warning).not.toHaveBeenCalledWith('Retrying after 30 seconds!');
    });

    it('can defer primary retry scheduling to the abortable request hook', () => {
      const throttleOptions = createThrottleOptions(false);

      expect(
        throttleOptions.onRateLimit(30, { method: 'GET', url: '/rate-limited' }, {}, 0),
      ).toBeUndefined();
      expect(warning).toHaveBeenCalledWith('Request quota exhausted for request GET /rate-limited');
      expect(warning).not.toHaveBeenCalledWith('Retrying after 30 seconds!');
    });
  });
});
