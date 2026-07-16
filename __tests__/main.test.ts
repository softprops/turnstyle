import { debug, setFailed, setOutput } from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionDeadline } from '../src/deadline';
import {
  run,
  type ActionGitHubClient,
  type GitHubClientFactory,
  type WaiterFactory,
} from '../src/main';
import { retryRequest } from '../src/retry';

vi.mock('@actions/core', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

const environment = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  GITHUB_REF: 'refs/heads/master',
  GITHUB_REPOSITORY: 'softprops/turnstyle',
  GITHUB_WORKFLOW: 'CI',
  GITHUB_RUN_ID: '42',
  INPUT_TOKEN: 'secret',
  INPUT_RETRIES: '2',
  ...overrides,
});

const actionClient = (overrides: Partial<ActionGitHubClient> = {}): ActionGitHubClient => ({
  workflows: async () => [],
  run: async () => {
    throw new Error('current run unavailable');
  },
  runs: async () => [],
  activeRunsForRepo: async () => [],
  jobs: async () => [],
  steps: async () => [],
  ...overrides,
});

describe('main', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('loads workflows and waits for the matching workflow', async () => {
    const workflows = vi.fn().mockResolvedValue([{ id: 123, name: 'CI' }]);
    const github = actionClient({ workflows });
    const githubFactory: GitHubClientFactory = vi.fn(() => github);
    const wait = vi.fn().mockResolvedValue(undefined);
    const waiterFactory: WaiterFactory = vi.fn(() => ({ wait }));

    await run(environment(), githubFactory, waiterFactory);

    expect(githubFactory).toHaveBeenCalledWith('secret', 2);
    expect(workflows).toHaveBeenCalledWith('softprops', 'turnstyle', {
      checkDeadline: expect.any(Function),
      signal: expect.any(AbortSignal),
    });
    expect(waiterFactory).toHaveBeenCalledWith(
      123,
      github,
      expect.objectContaining({
        owner: 'softprops',
        repo: 'turnstyle',
        workflowName: 'CI',
        runId: 42,
        retries: 2,
      }),
      expect.any(ActionDeadline),
    );
    expect(wait).toHaveBeenCalledOnce();
    expect(setFailed).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith('Found 1 workflows in softprops/turnstyle');
  });

  it('uses the default GitHub client factory', async () => {
    const response = new Response(
      JSON.stringify({
        total_count: 1,
        workflows: [{ id: 123, name: 'CI', path: '.github/workflows/main.yml' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    Object.defineProperty(response, 'url', {
      value: 'https://api.github.com/repos/softprops/turnstyle/actions/workflows',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const wait = vi.fn().mockResolvedValue(undefined);
    const waiterFactory: WaiterFactory = vi.fn(() => ({ wait }));

    await run(environment(), undefined, waiterFactory);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(setFailed).not.toHaveBeenCalled();
    expect(waiterFactory).toHaveBeenCalledWith(
      123,
      expect.any(Object),
      expect.any(Object),
      expect.any(ActionDeadline),
    );
    expect(wait).toHaveBeenCalledOnce();
  });

  it('uses the default waiter factory', async () => {
    const runs = vi.fn().mockResolvedValue([]);
    const github = actionClient({
      workflows: async () => [{ id: 123, name: 'CI' }],
      runs,
    });

    await run(environment(), () => github);

    expect(runs).toHaveBeenCalledOnce();
    expect(setFailed).not.toHaveBeenCalled();
  });

  it('reports a missing workflow without starting a waiter', async () => {
    const github = actionClient({ workflows: async () => [{ id: 1, name: 'Other' }] });
    const githubFactory: GitHubClientFactory = () => github;
    const waiterFactory: WaiterFactory = vi.fn();

    await run(environment(), githubFactory, waiterFactory);

    expect(setFailed).toHaveBeenCalledWith('No workflow found matching workflow path or name: CI');
    expect(waiterFactory).not.toHaveBeenCalled();
  });

  it('reports input parsing failures', async () => {
    const githubFactory: GitHubClientFactory = vi.fn();
    const waiterFactory: WaiterFactory = vi.fn();

    await run(
      environment({ 'INPUT_STEP-TO-WAIT-FOR': 'deploy', 'INPUT_JOB-TO-WAIT-FOR': undefined }),
      githubFactory,
      waiterFactory,
    );

    expect(setFailed).toHaveBeenCalledWith(
      'step-to-wait-for requires job-to-wait-for to be defined',
    );
    expect(githubFactory).not.toHaveBeenCalled();
    expect(waiterFactory).not.toHaveBeenCalled();
  });

  it('reports GitHub API failures', async () => {
    const github = actionClient({
      workflows: async () => {
        throw new Error('API unavailable');
      },
    });

    await run(environment(), () => github, vi.fn());

    expect(setFailed).toHaveBeenCalledWith('API unavailable');
  });

  it.each([
    ['abort', 'INPUT_ABORT-AFTER-SECONDS', 'Aborted after waiting 1 seconds'],
    ['continue', 'INPUT_CONTINUE-AFTER-SECONDS', undefined],
  ] as const)(
    'bounds a pending workflow lookup in %s mode from the start of the action',
    async (mode, inputName, expectedFailure) => {
      vi.useFakeTimers();
      let workflowSignal: AbortSignal | undefined;
      const workflows = vi.fn(
        async (_owner: string, _repo: string, options?: { signal?: AbortSignal }) => {
          workflowSignal = options?.signal;
          return new Promise<never>(() => undefined);
        },
      );
      const waiterFactory: WaiterFactory = vi.fn();
      const result = run(
        environment({ [inputName]: '1' }),
        () => actionClient({ workflows }),
        waiterFactory,
      );

      await vi.advanceTimersByTimeAsync(999);
      expect(setFailed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await result;

      expect(workflows).toHaveBeenCalledOnce();
      expect(workflowSignal).toBeDefined();
      expect(workflowSignal?.aborted).toBe(true);
      expect(waiterFactory).not.toHaveBeenCalled();
      expect(setOutput).toHaveBeenCalledWith('force_continued', mode === 'continue' ? '1' : '');
      expect(setOutput).toHaveBeenCalledWith('previous_run_id', '');
      expect(setOutput).toHaveBeenCalledWith('previous_run_url', '');
      if (expectedFailure) {
        expect(setFailed).toHaveBeenCalledWith(expectedFailure);
      } else {
        expect(setFailed).not.toHaveBeenCalled();
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    ['abort', 'INPUT_ABORT-AFTER-SECONDS', 'Aborted after waiting 0 seconds'],
    ['continue', 'INPUT_CONTINUE-AFTER-SECONDS', undefined],
  ] as const)(
    'does not start workflow lookup for an already-expired zero-second %s deadline',
    async (mode, inputName, expectedFailure) => {
      vi.useFakeTimers();
      const githubFactory: GitHubClientFactory = vi.fn();
      const waiterFactory: WaiterFactory = vi.fn();

      await run(environment({ [inputName]: '0' }), githubFactory, waiterFactory);

      expect(githubFactory).not.toHaveBeenCalled();
      expect(waiterFactory).not.toHaveBeenCalled();
      expect(setOutput).toHaveBeenCalledWith('force_continued', mode === 'continue' ? '1' : '');
      expect(setOutput).toHaveBeenCalledWith('previous_run_id', '');
      expect(setOutput).toHaveBeenCalledWith('previous_run_url', '');
      if (expectedFailure) {
        expect(setFailed).toHaveBeenCalledWith(expectedFailure);
      } else {
        expect(setFailed).not.toHaveBeenCalled();
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('shares workflow lookup elapsed time with the waiter deadline', async () => {
    vi.useFakeTimers();
    const workflows = vi.fn(
      async (_owner: string, _repo: string, options?: { signal?: AbortSignal }) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        options?.signal?.throwIfAborted();
        return [{ id: 123, name: 'CI' }];
      },
    );
    const waiterStarted = vi.fn();
    const waiterFactory: WaiterFactory = vi.fn((_workflowId, _github, _input, deadline) => ({
      wait: async () => {
        waiterStarted();
        await deadline.race(() => new Promise<never>(() => undefined));
        return undefined;
      },
    }));
    const result = run(
      environment({ 'INPUT_CONTINUE-AFTER-SECONDS': '1' }),
      () => actionClient({ workflows }),
      waiterFactory,
    );

    await vi.advanceTimersByTimeAsync(800);
    expect(waiterStarted).toHaveBeenCalledOnce();
    expect(setOutput).not.toHaveBeenCalledWith('force_continued', '1');

    await vi.advanceTimersByTimeAsync(199);
    expect(setOutput).not.toHaveBeenCalledWith('force_continued', '1');

    await vi.advanceTimersByTimeAsync(1);
    await result;

    expect(setOutput).toHaveBeenCalledWith('force_continued', '1');
    expect(setFailed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['an Error', new Error('wait failed'), 'wait failed'],
    ['a non-Error value', 'wait failed', 'wait failed'],
  ])('reports waiter rejection from %s', async (_description, rejection, expectedMessage) => {
    const github = actionClient({ workflows: async () => [{ id: 123, name: 'CI' }] });
    const waiterFactory: WaiterFactory = () => ({
      wait: vi.fn().mockRejectedValue(rejection),
    });

    await run(environment(), () => github, waiterFactory);

    expect(setFailed).toHaveBeenCalledWith(expectedMessage);
  });

  it('cancels concurrent discovery work before reporting the original API failure', async () => {
    vi.useFakeTimers();
    const originalError = Object.assign(new Error('Bad credentials'), { status: 401 });
    const serverOperation = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }));
    const pendingAborted = vi.fn();
    let sharedSignal: AbortSignal | undefined;
    const runs = vi.fn(
      async (
        _owner: string,
        _repo: string,
        _workflowId: number,
        _filters?: unknown,
        requestOptions?: { signal?: AbortSignal },
      ) => {
        sharedSignal = requestOptions?.signal;
        if (!sharedSignal) {
          throw new Error('missing shared signal');
        }

        const retryingStatus = retryRequest(serverOperation, 1, sharedSignal);
        const pendingStatus = new Promise<never>((_resolve, reject) => {
          sharedSignal?.addEventListener(
            'abort',
            () => {
              pendingAborted();
              reject(sharedSignal?.reason);
            },
            { once: true },
          );
        });
        await Promise.all([retryingStatus, pendingStatus, Promise.reject(originalError)]);
        return [];
      },
    );
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await run(environment({ 'INPUT_ABORT-AFTER-SECONDS': '10', INPUT_RETRIES: '1' }), () =>
      actionClient({
        workflows: async () => [{ id: 123, name: 'CI' }],
        runs,
      }),
    );

    expect(setFailed).toHaveBeenCalledWith('Bad credentials');
    expect(sharedSignal?.aborted).toBe(true);
    expect(pendingAborted).toHaveBeenCalledOnce();
    expect(serverOperation).toHaveBeenCalledOnce();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(serverOperation).toHaveBeenCalledOnce();
  });
});
