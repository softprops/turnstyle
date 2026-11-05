import { warning } from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionDeadline, DeadlineReached, type DeadlineTiming } from '../src/deadline';
import {
  createThrottleOptions,
  OctokitGitHub,
  type GitHubRequestOptions,
  type WorkflowRun,
} from '../src/github';
import { parseInput } from '../src/input';
import { Waiter } from '../src/wait';

vi.mock('@actions/core', () => ({
  debug: vi.fn(),
  warning: vi.fn(),
  setOutput: vi.fn(),
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

const jsonResponse = (url: URL, data: unknown, init: ResponseInit): Response =>
  Object.defineProperty(new Response(JSON.stringify(data), init), 'url', { value: url.href });

type WorkflowRunPages = WorkflowRun[][];
type PageMapper = (response: { data: WorkflowRun[] }, done: () => void) => WorkflowRun[];
interface TestOctokit {
  actions: Record<string, ReturnType<typeof vi.fn>>;
  paginate: ReturnType<typeof vi.fn>;
}

const replaceOctokit = (client: OctokitGitHub, octokit: TestOctokit) => {
  (client as unknown as { octokit: TestOctokit }).octokit = octokit;
};

const mockRequestMethod = () => {
  const bound = vi.fn();
  const defaults = vi.fn().mockReturnValue(bound);
  const request = Object.assign(vi.fn(), { defaults });
  return { request, bound, defaults };
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

const manualTiming = () => {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, () => void>();
  const timing: DeadlineTiming = {
    now: () => now,
    setTimeout: (callback) => {
      const timer = nextTimer++;
      timers.set(timer, callback);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => {
      timers.delete(timer as unknown as number);
    },
  };

  return {
    timing,
    advanceTo: (milliseconds: number) => {
      now = milliseconds;
    },
    timerCount: () => timers.size,
  };
};

const clientWithRunPages = (...pagesByCall: WorkflowRunPages[]) => {
  const client = new OctokitGitHub('fake-token');
  const listWorkflowRuns = mockRequestMethod();
  const listWorkflowRunsForRepo = mockRequestMethod();
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
      listWorkflowRuns: listWorkflowRuns.request,
      listWorkflowRunsForRepo: listWorkflowRunsForRepo.request,
    },
    paginate,
  });

  return {
    client,
    listWorkflowRuns,
    listWorkflowRunsForRepo,
    paginate,
    pagesScanned: () => pagesScanned,
  };
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
      listWorkflowRuns: mockRequestMethod().request,
      listWorkflowRunsForRepo: mockRequestMethod().request,
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

    it('cancels a paginated retry backoff when its request signal is aborted', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
        if (controller.signal.aborted) {
          return new Response(JSON.stringify({ message: 'cleanup' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ message: 'server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      });
      const request = new OctokitGitHub('fake-token', 2).workflows('org', 'repo', {
        signal: controller.signal,
      });
      const settled = vi.fn();
      void request.then(settled, settled);

      try {
        await advanceUntilCalled(fetchMock);
        await flushUntilTimerScheduled();
        await flushMicrotasks();
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        controller.abort();
        await flushShortDelayWorkUntilCalled(settled);

        expect(settled).toHaveBeenCalledOnce();
        await request.catch(() => undefined);
        expect(vi.getTimerCount()).toBe(0);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchMock).toHaveBeenCalledOnce();
      } finally {
        controller.abort();
        await advanceUntilCalled(settled);
        await request.catch(() => undefined);
      }
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

    it('does not reinterpret a secondary limit as a primary limit', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
      const resetAtSeconds = Math.floor(Date.now() / 1000) + 600;
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit' }), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'retry-after': '60',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resetAtSeconds),
          },
        }),
      );
      const controller = new AbortController();
      const request = new OctokitGitHub('fake-token').run('org', 'repo', 42, {
        signal: controller.signal,
      });
      const rejection = request.then(
        () => undefined,
        (error: unknown) => error,
      );
      const settled = vi.fn();
      void request.then(settled, settled);

      try {
        await advanceUntilCalled(fetchMock);
        await flushShortDelayWorkUntilCalled(settled);

        expect(settled).toHaveBeenCalledOnce();
        await expect(rejection).resolves.toMatchObject({
          message: 'You have exceeded a secondary rate limit',
          status: 403,
        });
        expect(fetchMock).toHaveBeenCalledOnce();
        const messages = vi
          .mocked(warning)
          .mock.calls.map(([message]) => (typeof message === 'string' ? message : message.message));
        expect(
          messages.filter((message) =>
            message.startsWith('Secondary rate limit detected for request'),
          ),
        ).toHaveLength(1);
        expect(messages.filter((message) => message.startsWith('Retrying after'))).toEqual([]);

        await vi.advanceTimersByTimeAsync(600_000);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        controller.abort();
        await request.catch(() => undefined);
      }
    });
  });

  describe('API wrappers', () => {
    it.each([
      [
        'workflow',
        (client: OctokitGitHub, options: GitHubRequestOptions) =>
          client.workflows('org', 'repo', options),
        1,
      ],
      [
        'workflow-run',
        (client: OctokitGitHub, options: GitHubRequestOptions) =>
          client.runs('org', 'repo', 123, {}, options),
        ACTIVE_RUN_STATUSES.length,
      ],
      [
        'job',
        (client: OctokitGitHub, options: GitHubRequestOptions) =>
          client.jobs('org', 'repo', 42, options),
        1,
      ],
    ] as const)(
      'aborts pending %s pagination fetches',
      async (_description, startRequest, expectedFetches) => {
        vi.useFakeTimers();
        const pendingRejects: Array<(reason?: unknown) => void> = [];
        const observedSignals: Array<AbortSignal | null | undefined> = [];
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
          async (_url, options) =>
            new Promise<Response>((_resolve, reject) => {
              const signal = options?.signal;
              observedSignals.push(signal);
              pendingRejects.push(reject);
              signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
            }),
        );
        const controller = new AbortController();
        const request = startRequest(new OctokitGitHub('fake-token'), {
          signal: controller.signal,
        });
        const settled = vi.fn();
        void request.then(settled, settled);

        await advanceUntilCallCount(fetchMock, expectedFetches);
        expect(fetchMock).toHaveBeenCalledTimes(expectedFetches);

        controller.abort();
        try {
          await flushShortDelayWorkUntilCalled(settled);

          expect(observedSignals).toHaveLength(expectedFetches);
          expect(
            observedSignals.every((signal) => signal === controller.signal && signal.aborted),
          ).toBe(true);
          expect(settled).toHaveBeenCalledOnce();
          await request.catch(() => undefined);
          expect(vi.getTimerCount()).toBe(0);
        } finally {
          for (const reject of pendingRejects) {
            reject(new Error('test cleanup'));
          }
          await advanceUntilCalled(settled);
          await request.catch(() => undefined);
        }
      },
    );

    it('keeps the abort signal bound on subsequent pagination pages', async () => {
      vi.useFakeTimers();
      let rejectSecondPage: ((reason?: unknown) => void) | undefined;
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ total_count: 2, workflows: [{ id: 1, name: 'First' }] }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              link: '<https://api.github.com/repos/org/repo/actions/workflows?page=2>; rel="next"',
            },
          }),
        )
        .mockImplementationOnce(
          async (_url, options) =>
            new Promise<Response>((_resolve, reject) => {
              rejectSecondPage = reject;
              options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
                once: true,
              });
            }),
        );
      const controller = new AbortController();
      const request = new OctokitGitHub('fake-token').workflows('org', 'repo', {
        signal: controller.signal,
      });
      const settled = vi.fn();
      void request.then(settled, settled);

      await advanceUntilCallCount(fetchMock, 2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls.every(([, options]) => options?.signal === controller.signal),
      ).toBe(true);

      controller.abort();
      try {
        await flushShortDelayWorkUntilCalled(settled);

        expect(settled).toHaveBeenCalledOnce();
        await request.catch(() => undefined);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        rejectSecondPage?.(new Error('test cleanup'));
        await advanceUntilCalled(settled);
        await request.catch(() => undefined);
      }
    });

    it('does not start another pagination page after the monotonic deadline', async () => {
      const fake = manualTiming();
      const deadline = new ActionDeadline({ mode: 'abort', seconds: 1 }, fake.timing);
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementationOnce(async () => {
          fake.advanceTo(1_000);
          return new Response(
            JSON.stringify({ total_count: 2, workflows: [{ id: 1, name: 'First' }] }),
            {
              status: 200,
              headers: {
                'content-type': 'application/json',
                link: '<https://api.github.com/repos/org/repo/actions/workflows?page=2>; rel="next"',
              },
            },
          );
        })
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ total_count: 2, workflows: [{ id: 2, name: 'Second' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      const requestOptions = {
        signal: deadline.signal,
        checkDeadline: deadline.throwIfReached,
      } as GitHubRequestOptions;
      const request = new OctokitGitHub('fake-token').workflows('org', 'repo', requestOptions);

      try {
        await expect(request).rejects.toEqual(new DeadlineReached('abort', 1));
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(deadline.signal.aborted).toBe(true);
      } finally {
        deadline.dispose();
        await request.catch(() => undefined);
      }

      expect(fake.timerCount()).toBe(0);
    });

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
      const listRepoWorkflows = mockRequestMethod();
      const paginate = vi
        .fn()
        .mockResolvedValueOnce([{ id: 123, name: 'CI' }])
        .mockResolvedValueOnce([{ id: 456, name: 'Deploy' }]);
      const client = new OctokitGitHub('fake-token');
      replaceOctokit(client, {
        actions: { listRepoWorkflows: listRepoWorkflows.request },
        paginate,
      });

      await expect(client.workflows('org', 'repo')).resolves.toEqual([{ id: 123, name: 'CI' }]);
      const signal = new AbortController().signal;
      await expect(client.workflows('org', 'repo', { signal })).resolves.toEqual([
        { id: 456, name: 'Deploy' },
      ]);
      expect(paginate).toHaveBeenNthCalledWith(1, listRepoWorkflows.request, {
        owner: 'org',
        repo: 'repo',
        per_page: 100,
      });
      expect(listRepoWorkflows.defaults).toHaveBeenCalledWith({ request: { signal } });
      expect(paginate).toHaveBeenNthCalledWith(2, listRepoWorkflows.bound, {
        owner: 'org',
        repo: 'repo',
        per_page: 100,
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
      const listJobsForWorkflowRun = mockRequestMethod();
      const getJobForWorkflowRun = vi.fn().mockResolvedValue({ data: { steps: [] } });
      const paginate = vi.fn().mockResolvedValue([]);
      const client = new OctokitGitHub('fake-token');
      replaceOctokit(client, {
        actions: { listJobsForWorkflowRun: listJobsForWorkflowRun.request, getJobForWorkflowRun },
        paginate,
      });
      const signal = new AbortController().signal;

      await client.jobs('org', 'repo', 42, { signal });
      await client.steps('org', 'repo', 7, { signal });

      expect(listJobsForWorkflowRun.defaults).toHaveBeenCalledWith({ request: { signal } });
      expect(paginate).toHaveBeenCalledWith(listJobsForWorkflowRun.bound, {
        owner: 'org',
        repo: 'repo',
        run_id: 42,
        per_page: 100,
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
    it.each(['workflow', 'repository'] as const)(
      'limits stale-index recovery to five HTTP pages in a busy history (%s)',
      async (scope) => {
        const predecessor = run({ id: 1, status: 'in_progress', conclusion: null });
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          const page = Number(url.searchParams.get('page') || 1);
          const filtered = url.searchParams.has('status');
          const runs = filtered
            ? []
            : Array.from({ length: 100 }, (_, index) => run({ id: 1000 - page * 100 - index }));
          if (!filtered && page === 5) {
            runs[99] = predecessor;
          }
          url.searchParams.set('page', String(page + 1));
          return jsonResponse(
            url,
            { total_count: 10000, workflow_runs: runs },
            {
              headers: {
                'content-type': 'application/json',
                ...(!filtered ? { link: `<${url}>; rel="next"` } : {}),
              },
            },
          );
        });
        const client = new OctokitGitHub('fake-token');

        const runs =
          scope === 'workflow'
            ? await client.runs('org', 'repo', 123)
            : await client.activeRunsForRepo('org', 'repo');

        expect(runs).toEqual([predecessor]);
        expect(fetchMock).toHaveBeenCalledTimes(8);
        const urls = fetchMock.mock.calls.map(
          ([input]) => new URL(input instanceof Request ? input.url : String(input)),
        );
        expect(urls.filter((url) => !url.searchParams.has('status'))).toHaveLength(5);
        expect(urls.every((url) => !url.searchParams.has('branch'))).toBe(true);
        expect(
          urls.every(
            (url) =>
              url.pathname ===
              (scope === 'workflow'
                ? '/repos/org/repo/actions/workflows/123/runs'
                : '/repos/org/repo/actions/runs'),
          ),
        ).toBe(true);
      },
    );

    it.each(['workflow', 'repository'] as const)(
      'checks the deadline before another unfiltered page (%s)',
      async (scope) => {
        const fake = manualTiming();
        const deadline = new ActionDeadline({ mode: 'abort', seconds: 1 }, fake.timing);
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (!url.searchParams.has('status')) {
            fake.advanceTo(1000);
            url.searchParams.set('page', '2');
          }
          return jsonResponse(
            url,
            { total_count: 100, workflow_runs: [run({})] },
            {
              headers: {
                'content-type': 'application/json',
                ...(!url.searchParams.has('status') ? { link: `<${url}>; rel="next"` } : {}),
              },
            },
          );
        });
        const client = new OctokitGitHub('fake-token');
        const options = { signal: deadline.signal, checkDeadline: deadline.throwIfReached };
        const request =
          scope === 'workflow'
            ? client.runs('org', 'repo', 123, {}, options)
            : client.activeRunsForRepo('org', 'repo', {}, options);

        try {
          await expect(request).rejects.toEqual(new DeadlineReached('abort', 1));
          expect(fetchMock).toHaveBeenCalledTimes(4);
          expect(deadline.signal.aborted).toBe(true);
        } finally {
          deadline.dispose();
        }
        expect(fake.timerCount()).toBe(0);
      },
    );

    it.each(['workflow', 'repository'] as const)(
      'cancels a pending unfiltered pagination page (%s)',
      async (scope) => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const fetchMock = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (input, options) => {
            const url = new URL(input instanceof Request ? input.url : String(input));
            if (url.searchParams.get('page') === '2') {
              return new Promise<Response>((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
                  once: true,
                });
              });
            }
            const filtered = url.searchParams.has('status');
            url.searchParams.set('page', '2');
            return jsonResponse(
              url,
              { total_count: 2, workflow_runs: filtered ? [] : [run({})] },
              {
                headers: {
                  'content-type': 'application/json',
                  ...(!filtered ? { link: `<${url}>; rel="next"` } : {}),
                },
              },
            );
          });
        const client = new OctokitGitHub('fake-token');
        const options = { signal: controller.signal };
        const request =
          scope === 'workflow'
            ? client.runs('org', 'repo', 123, {}, options)
            : client.activeRunsForRepo('org', 'repo', {}, options);
        const settled = vi.fn();
        void request.then(settled, settled);

        await advanceUntilCallCount(fetchMock, 5);
        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(fetchMock.mock.calls[4][1]?.signal).toBe(controller.signal);
        controller.abort();
        await flushShortDelayWorkUntilCalled(settled);
        await expect(request).rejects.toBe(controller.signal.reason);
        await vi.runAllTimersAsync();
        expect(settled).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it('cancels an unfiltered 5xx retry at the action deadline', async () => {
      vi.useFakeTimers();
      const deadline = new ActionDeadline({ mode: 'abort', seconds: 1 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        return url.searchParams.has('status')
          ? jsonResponse(
              url,
              { total_count: 0, workflow_runs: [] },
              {
                headers: { 'content-type': 'application/json' },
              },
            )
          : jsonResponse(
              url,
              { message: 'server error' },
              {
                status: 500,
                headers: { 'content-type': 'application/json' },
              },
            );
      });
      const request = deadline.race((signal) =>
        new OctokitGitHub('fake-token', 3).runs(
          'org',
          'repo',
          123,
          {},
          {
            signal,
            checkDeadline: deadline.throwIfReached,
          },
        ),
      );
      const assertion = expect(request).rejects.toEqual(new DeadlineReached('abort', 1));
      try {
        await advanceUntilCallCount(fetchMock, 4);
        expect(fetchMock).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
        await vi.runAllTimersAsync();
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(deadline.signal.aborted).toBe(true);
      } finally {
        deadline.dispose();
      }
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['workflow', 'repository'] as const)(
      'discovers an active predecessor with stale status indexes (%s, issue #165)',
      async (scope) => {
        const predecessor = run({ id: 1, status: 'in_progress', conclusion: null });
        const { client } = clientWithDynamicRunPages((options) =>
          options.status ? [[]] : [[predecessor]],
        );

        const runs =
          scope === 'workflow'
            ? await client.runs('org', 'repo', 123)
            : await client.activeRunsForRepo('org', 'repo');

        expect(runs).toEqual([predecessor]);
      },
    );

    it.each([
      { queueName: undefined, attempt: 1 },
      { queueName: 'deploy', attempt: 1 },
      { queueName: undefined, attempt: 2 },
      { queueName: 'deploy', attempt: 2 },
    ])(
      'waits for the unfiltered predecessor to complete with stale status indexes ($queueName, attempt $attempt, issue #165)',
      async ({ queueName, attempt }) => {
        vi.useFakeTimers();
        let completed = false;
        const predecessor = run({
          id: attempt === 1 ? 1 : 3,
          status: 'in_progress',
          conclusion: null,
          name: 'deploy',
        });
        const current = run({
          id: 2,
          status: 'in_progress',
          conclusion: null,
          run_attempt: attempt,
          run_started_at: '2026-05-03T10:05:00Z',
        });
        const { client } = clientWithDynamicRunPages((options) =>
          options.status
            ? [[]]
            : [[current, { ...predecessor, status: completed ? 'completed' : 'in_progress' }]],
        );
        vi.spyOn(client, 'run').mockResolvedValue(current);
        const input = {
          ...parseInput({
            GITHUB_REPOSITORY: 'org/repo',
            GITHUB_RUN_ID: '2',
            GITHUB_RUN_ATTEMPT: String(attempt),
            'INPUT_SAME-BRANCH-ONLY': 'false',
            'INPUT_POLL-INTERVAL-SECONDS': '1',
          }),
          queueName,
        };
        const info = vi.fn();
        const settled = vi.fn();
        const waiting = new Waiter(123, client, input, info, vi.fn()).wait();
        void waiting.then(settled, settled);

        try {
          await flushMicrotasks();
          expect(info).toHaveBeenCalledWith('✋Awaiting run https://example.com/run ...');
          expect(settled).not.toHaveBeenCalled();
          completed = true;
          await vi.advanceTimersByTimeAsync(1000);
          await waiting;
          expect(settled).toHaveBeenCalledOnce();
        } finally {
          completed = true;
          await vi.runAllTimersAsync();
          await waiting;
        }
      },
    );

    it.each([undefined, 'success', 'failure', 'cancelled'] as const)(
      'exits normally for an absent or completed predecessor (%s)',
      async (conclusion) => {
        vi.useFakeTimers();
        const current = run({ id: 2, status: 'in_progress', conclusion: null });
        const previous = conclusion ? [run({ id: 1, status: 'completed', conclusion })] : [];
        const { client } = clientWithDynamicRunPages((options) =>
          options.status ? [[]] : [[current, ...previous]],
        );
        vi.spyOn(client, 'run').mockResolvedValue(current);
        const info = vi.fn();
        const input = parseInput({ GITHUB_REPOSITORY: 'org/repo', GITHUB_RUN_ID: '2' });

        await expect(new Waiter(123, client, input, info, vi.fn()).wait()).resolves.toBeUndefined();

        expect(info).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it('reconciles recent runs even when the status index has other candidates', async () => {
      const indexed = run({ id: 10, status: 'queued', conclusion: null });
      const missing = run({ id: 11, status: 'in_progress', conclusion: null });
      const { client } = clientWithDynamicRunPages((options) =>
        options.status ? [[indexed]] : [[missing]],
      );

      await expect(client.runs('org', 'repo', 123)).resolves.toEqual([indexed, missing]);
    });

    it.each(['success', 'failure', 'cancelled'] as const)(
      'does not retain an indexed active run now completed with %s',
      async (conclusion) => {
        const indexed = run({ id: 1, status: 'in_progress', conclusion: null });
        const { client } = clientWithDynamicRunPages((options) =>
          options.status ? [[indexed]] : [[{ ...indexed, status: 'completed', conclusion }]],
        );

        await expect(client.runs('org', 'repo', 123)).resolves.toEqual([]);
      },
    );

    it.each([
      [{}, [1, 2, 3, 4]],
      [{ branch: 'master' }, [1, 2]],
      [{ queueName: 'deploy' }, [1, 3]],
      [{ branch: 'master', queueName: 'deploy' }, [1]],
    ] as const)('filters unindexed runs client-side: %j', async (filters, expectedIds) => {
      const recent = [
        run({ id: 1, status: 'in_progress', conclusion: null, display_title: 'deploy' }),
        run({ id: 2, status: 'queued', conclusion: null }),
        run({
          id: 3,
          status: 'waiting',
          conclusion: null,
          head_branch: 'feature',
          name: 'deploy',
        }),
        run({ id: 4, status: 'in_progress', conclusion: null, head_branch: null }),
        ...(['success', 'failure', 'cancelled'] as const).map((conclusion, index) =>
          run({ id: 5 + index, status: 'completed', conclusion, display_title: 'deploy' }),
        ),
        run({ id: 8, status: null, conclusion: null }),
        run({ id: 9, status: 'cancelled', conclusion: 'cancelled' }),
      ];
      const { client } = clientWithDynamicRunPages((options) =>
        options.status || options.branch ? [[]] : [recent],
      );

      const runs = await client.runs('org', 'repo', 123, filters);

      expect(runs.map((run) => run.id)).toEqual(expectedIds);
    });

    it.each(['workflow', 'repository'] as const)(
      'finds the 500th recent run and older indexed runs without walking completed history (%s)',
      async (scope) => {
        const recent = run({
          id: 501,
          status: 'in_progress',
          conclusion: null,
          display_title: 'deploy',
        });
        const older = run({ ...recent, id: 1 });
        const historicalPages = Array.from({ length: 51 }, (_, page) =>
          Array.from({ length: 100 }, (_, index) => run({ id: 1000 - page * 100 - index })),
        );
        historicalPages[4][99] = recent;
        const { client, pagesScanned } = clientWithDynamicRunPages((options) =>
          options.status === 'queued' ? [[older]] : options.status ? [[]] : historicalPages,
        );

        const filters = { branch: 'master', queueName: 'deploy' };
        const runs =
          scope === 'workflow'
            ? await client.runs('org', 'repo', 123, filters)
            : await client.activeRunsForRepo('org', 'repo', filters);

        expect(runs).toEqual([older, recent]);
        expect(pagesScanned()).toBe(8);
      },
    );

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
      const missingStatusRun = run({
        id: 3,
        status: null,
        conclusion: null,
        display_title: 'deploy-api',
      });
      const { client } = clientWithRunPages(
        [],
        [[matchingRun, completedRun, missingStatusRun]],
        [],
      );

      await expect(client.runs('org', 'repo', 123, { queueName: 'deploy-api' })).resolves.toEqual([
        matchingRun,
      ]);
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
