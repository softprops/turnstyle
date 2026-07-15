import { setOutput } from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionDeadline, systemDeadlineTiming } from '../../src/deadline';
import type { WorkflowJob, WorkflowRun, WorkflowStep } from '../../src/github';
import type { Input } from '../../src/input';
import { retryRequest } from '../../src/retry';
import { Waiter, type WaiterGitHubClient } from '../../src/wait';

vi.mock('@actions/core', () => ({
  setOutput: vi.fn(),
}));

const workflowId = 123;

const input = (overrides: Partial<Input> = {}): Input => ({
  githubToken: 'fake-token',
  owner: 'org',
  repo: 'repo',
  branch: 'master',
  workflowName: 'CI',
  workflowPath: undefined,
  runId: 2,
  runAttempt: 1,
  pollIntervalSeconds: 60,
  continueAfterSeconds: undefined,
  abortAfterSeconds: undefined,
  sameBranchOnly: false,
  jobToWaitFor: undefined,
  stepToWaitFor: undefined,
  initialWaitSeconds: 0,
  queueName: undefined,
  retries: 0,
  ...overrides,
});

const workflowRun = (overrides: Partial<WorkflowRun> = {}): WorkflowRun =>
  ({
    id: 1,
    status: 'in_progress',
    conclusion: null,
    head_branch: 'master',
    html_url: 'https://example.com/runs/1',
    created_at: '2026-07-15T10:00:00Z',
    run_started_at: '2026-07-15T10:00:00Z',
    ...overrides,
  }) as WorkflowRun;

const workflowJob = (overrides: Partial<WorkflowJob> = {}): WorkflowJob =>
  ({
    id: 7,
    name: 'deploy',
    status: 'in_progress',
    conclusion: null,
    html_url: 'https://example.com/jobs/7',
    ...overrides,
  }) as WorkflowJob;

const workflowStep = (overrides: Partial<WorkflowStep> = {}): WorkflowStep =>
  ({
    number: 1,
    name: 'publish',
    status: 'in_progress',
    conclusion: null,
    ...overrides,
  }) as WorkflowStep;

const deferredPromise = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const client = (overrides: Partial<WaiterGitHubClient> = {}): WaiterGitHubClient => ({
  run: async () => {
    throw new Error('current run unavailable');
  },
  runs: async () => [],
  activeRunsForRepo: async () => [],
  jobs: async () => [],
  steps: async () => [],
  ...overrides,
});

const waiter = (waiterInput: Input, githubClient: WaiterGitHubClient, messages: string[] = []) =>
  new Waiter(workflowId, githubClient, waiterInput, (message) => messages.push(message), vi.fn());

const observeSettlement = <T>(promise: Promise<T>) => {
  const settled = vi.fn();
  void promise.then(
    (value) => settled('fulfilled', value),
    (error: unknown) => settled('rejected', error),
  );
  return settled;
};

describe('wait deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    vi.mocked(setOutput).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['abort', { abortAfterSeconds: 1 }, 'rejected'],
    ['continue', { continueAfterSeconds: 1 }, 'fulfilled'],
  ] as const)(
    'enforces a one-second %s deadline during a longer poll interval',
    async (_mode, timeoutInput, expectedState) => {
      const waitPromise = waiter(
        input({ ...timeoutInput, pollIntervalSeconds: 60 }),
        client({ runs: vi.fn().mockResolvedValue([workflowRun()]) }),
      ).wait();
      const settled = observeSettlement(waitPromise);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(settled).toHaveBeenCalledWith(expectedState, expect.anything());
      if (expectedState === 'rejected') {
        await expect(waitPromise).rejects.toThrow('Aborted after waiting 1 seconds');
      } else {
        await expect(waitPromise).resolves.toBe(1);
      }
    },
  );

  it('describes initial wait as one discovery window instead of a new full-duration sleep', async () => {
    const messages: string[] = [];
    const waitPromise = waiter(
      input({ continueAfterSeconds: 1, initialWaitSeconds: 60 }),
      client({ runs: vi.fn().mockResolvedValue([]) }),
      messages,
    ).wait();

    await vi.advanceTimersByTimeAsync(0);

    expect(messages).toContain(
      '🔎 Waiting until the 60-second initial discovery window expires before checking again...',
    );
    expect(messages).not.toContain('🔎 Waiting for 60 seconds before checking for runs again...');

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(waitPromise).resolves.toBe(1);
  });

  it('starts the initial discovery window after pre-wait lifecycle work', async () => {
    const waiterInput = input({ continueAfterSeconds: 10, initialWaitSeconds: 1 });
    const deadline = ActionDeadline.fromInput(waiterInput);
    await vi.advanceTimersByTimeAsync(2_000);
    const runs = vi.fn().mockResolvedValue([]);
    const waitPromise = new Waiter(
      workflowId,
      client({ runs }),
      waiterInput,
      vi.fn(),
      vi.fn(),
      systemDeadlineTiming,
      deadline,
    ).wait();

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(runs).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(999);
      expect(runs).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      await expect(waitPromise).resolves.toBeUndefined();
      expect(runs).toHaveBeenCalledTimes(2);
    } finally {
      deadline.dispose();
      await waitPromise.catch(() => undefined);
    }

    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the separate initial discovery window by the remaining action deadline', async () => {
    const waiterInput = input({ continueAfterSeconds: 3, initialWaitSeconds: 5 });
    const deadline = ActionDeadline.fromInput(waiterInput);
    await vi.advanceTimersByTimeAsync(2_000);
    const runs = vi.fn().mockResolvedValue([]);
    const waitPromise = new Waiter(
      workflowId,
      client({ runs }),
      waiterInput,
      vi.fn(),
      vi.fn(),
      systemDeadlineTiming,
      deadline,
    ).wait();
    const settled = observeSettlement(waitPromise);

    try {
      await vi.advanceTimersByTimeAsync(999);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledWith('fulfilled', 3);
      await expect(waitPromise).resolves.toBe(3);
      expect(runs).toHaveBeenCalledOnce();
      expect(setOutput).toHaveBeenCalledWith('force_continued', '1');
    } finally {
      deadline.dispose();
      await waitPromise.catch(() => undefined);
    }

    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts discovery time against the deadline before polling', async () => {
    const currentRun = deferredPromise<WorkflowRun>();
    const waitPromise = waiter(
      input({ abortAfterSeconds: 1, pollIntervalSeconds: 60 }),
      client({
        run: vi.fn().mockReturnValue(currentRun.promise),
        runs: vi.fn().mockResolvedValue([workflowRun()]),
      }),
    ).wait();
    const settled = observeSettlement(waitPromise);

    await vi.advanceTimersByTimeAsync(800);
    currentRun.resolve(workflowRun({ id: 2 }));
    await vi.advanceTimersByTimeAsync(199);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toHaveBeenCalledWith('rejected', expect.any(Error));
    await expect(waitPromise).rejects.toThrow('Aborted after waiting 1 seconds');
  });

  it.each([
    ['abort', { abortAfterSeconds: 1 }, 'rejected'],
    ['continue', { continueAfterSeconds: 1 }, 'fulfilled'],
  ] as const)(
    'enforces a one-second %s deadline during a longer initial wait',
    async (_mode, timeoutInput, expectedState) => {
      const waitPromise = waiter(
        input({ ...timeoutInput, initialWaitSeconds: 60 }),
        client({ runs: vi.fn().mockResolvedValue([]) }),
      ).wait();
      const settled = observeSettlement(waitPromise);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(settled).toHaveBeenCalledWith(expectedState, expect.anything());
      if (expectedState === 'rejected') {
        await expect(waitPromise).rejects.toThrow('Aborted after waiting 1 seconds');
      } else {
        await expect(waitPromise).resolves.toBe(1);
      }
    },
  );

  it('continues when workflow-run discovery is pending at the deadline', async () => {
    const runs = vi.fn().mockReturnValue(new Promise<WorkflowRun[]>(() => {}));
    const waitPromise = waiter(input({ continueAfterSeconds: 1 }), client({ runs })).wait();
    const settled = observeSettlement(waitPromise);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(settled).toHaveBeenCalledWith('fulfilled', 1);
    await expect(waitPromise).resolves.toBe(1);
    expect(runs.mock.calls[0][4].signal.aborted).toBe(true);
  });

  it('aborts when repository queue discovery is pending at the deadline', async () => {
    const activeRunsForRepo = vi.fn().mockReturnValue(new Promise<WorkflowRun[]>(() => {}));
    const waitPromise = waiter(
      input({ abortAfterSeconds: 1, queueName: 'deploy' }),
      client({ runs: vi.fn().mockResolvedValue([]), activeRunsForRepo }),
    ).wait();
    const settled = observeSettlement(waitPromise);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(settled).toHaveBeenCalledWith('rejected', expect.any(Error));
    await expect(waitPromise).rejects.toThrow('Aborted after waiting 1 seconds');
    expect(activeRunsForRepo.mock.calls[0][3].signal.aborted).toBe(true);
  });

  it('aborts a pending jobs request and forwards the deadline signal', async () => {
    const jobs = vi.fn().mockReturnValue(new Promise<WorkflowJob[]>(() => {}));
    const waitPromise = waiter(
      input({ abortAfterSeconds: 1, jobToWaitFor: 'deploy' }),
      client({ runs: vi.fn().mockResolvedValue([workflowRun()]), jobs }),
    ).wait();
    const settled = observeSettlement(waitPromise);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(settled).toHaveBeenCalledWith('rejected', expect.any(Error));
    await expect(waitPromise).rejects.toThrow('Aborted after waiting 1 seconds');
    expect(jobs.mock.calls[0][3].signal.aborted).toBe(true);
  });

  it('aborts a pending steps request and forwards the deadline signal', async () => {
    const steps = vi.fn().mockReturnValue(new Promise<WorkflowStep[]>(() => {}));
    const waitPromise = waiter(
      input({ abortAfterSeconds: 1, jobToWaitFor: 'deploy', stepToWaitFor: 'publish' }),
      client({
        runs: vi.fn().mockResolvedValue([workflowRun()]),
        jobs: vi.fn().mockResolvedValue([workflowJob()]),
        steps,
      }),
    ).wait();
    const settled = observeSettlement(waitPromise);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(settled).toHaveBeenCalledWith('rejected', expect.any(Error));
    await expect(waitPromise).rejects.toThrow('Aborted after waiting 1 seconds');
    expect(steps.mock.calls[0][3].signal.aborted).toBe(true);
  });

  it('keeps the deadline outcome when an API promise resolves immediately afterward', async () => {
    const runs = deferredPromise<WorkflowRun[]>();
    const messages: string[] = [];
    const waitPromise = waiter(
      input({ abortAfterSeconds: 1 }),
      client({ runs: vi.fn().mockReturnValue(runs.promise) }),
      messages,
    ).wait();
    const settled = observeSettlement(waitPromise);

    await vi.advanceTimersByTimeAsync(1_000);
    runs.resolve([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toHaveBeenCalledWith('rejected', expect.any(Error));
    await expect(waitPromise).rejects.toThrow('Aborted after waiting 1 seconds');
    expect(messages).toEqual(['🛑Exceeded wait seconds. Aborting...']);
  });

  it('cleans up the deadline timer after successful completion', async () => {
    const run = vi.fn().mockResolvedValue(workflowRun({ id: 2 }));
    const runs = vi.fn().mockResolvedValue([]);
    const waitPromise = waiter(input({ abortAfterSeconds: 10 }), client({ run, runs })).wait();

    await expect(waitPromise).resolves.toBeUndefined();

    const signal = run.mock.calls[0][3].signal as AbortSignal;
    expect(runs.mock.calls[0][4].signal).toBe(signal);
    expect(signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(signal.aborted).toBe(false);
  });

  it('propagates API failures that happen before the deadline and cleans up', async () => {
    const runs = vi.fn().mockRejectedValue(new Error('API unavailable'));
    const waitPromise = waiter(input({ abortAfterSeconds: 10 }), client({ runs })).wait();

    await expect(waitPromise).rejects.toThrow('API unavailable');

    expect(runs.mock.calls[0][4].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels concurrent discovery work before propagating an owned-deadline failure', async () => {
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
    const waitPromise = waiter(input({ abortAfterSeconds: 10 }), client({ runs })).wait();

    await expect(waitPromise).rejects.toBe(originalError);

    expect(sharedSignal?.aborted).toBe(true);
    expect(pendingAborted).toHaveBeenCalledOnce();
    expect(serverOperation).toHaveBeenCalledOnce();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(serverOperation).toHaveBeenCalledOnce();
  });

  it('reuses one deadline signal and leaves no timers after repeated polling', async () => {
    const run = vi.fn().mockResolvedValue(workflowRun({ id: 3 }));
    const runs = vi
      .fn()
      .mockResolvedValueOnce([workflowRun({ id: 2 })])
      .mockResolvedValueOnce([workflowRun({ id: 1 })])
      .mockResolvedValue([]);
    const waitPromise = waiter(
      input({ runId: 3, abortAfterSeconds: 10, pollIntervalSeconds: 1 }),
      client({ run, runs }),
    ).wait();

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(waitPromise).resolves.toBeUndefined();

    const signals = [
      ...run.mock.calls.map((call) => call[3].signal as AbortSignal),
      ...runs.mock.calls.map((call) => call[4].signal as AbortSignal),
    ];
    expect(new Set(signals).size).toBe(1);
    expect(signals[0].aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
