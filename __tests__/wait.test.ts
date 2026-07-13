import { setOutput } from '@actions/core';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Input } from '../src/input';
import { Waiter, type WaiterGitHubClient } from '../src/wait';

vi.mock('@actions/core', () => ({
  setOutput: vi.fn(),
}));

const setOutputMock = vi.mocked(setOutput);
const waiterClient = (overrides: Partial<WaiterGitHubClient> = {}): WaiterGitHubClient => ({
  run: async () => {
    throw new Error('current run unavailable');
  },
  runs: async () => [],
  activeRunsForRepo: async () => [],
  jobs: async () => [],
  steps: async () => [],
  ...overrides,
});

describe('wait', () => {
  describe('Waiter', () => {
    describe('wait', () => {
      let input: Input;
      const workflow = {
        id: 123124,
        name: 'Test workflow',
      };

      beforeEach(() => {
        setOutputMock.mockClear();
        input = {
          branch: 'master',
          continueAfterSeconds: undefined,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 0,
          githubToken: 'fake-token',
          owner: 'org',
          repo: 'repo',
          runId: 2,
          runAttempt: 1,
          workflowName: workflow.name,
          workflowPath: undefined,
          sameBranchOnly: false,
          jobToWaitFor: undefined,
          stepToWaitFor: undefined,
          initialWaitSeconds: 0,
          queueName: undefined,
          retries: 0,
        };
      });

      it('will continue after a prescribed number of seconds', async () => {
        vi.useFakeTimers();
        try {
          input.continueAfterSeconds = 1;
          input.pollIntervalSeconds = 1;
          const inProgressRun = {
            id: 1,
            status: 'in_progress',
            html_url: '',
          };
          const githubClient = {
            runs: vi.fn().mockResolvedValue([inProgressRun]),
            workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
          };

          const messages: Array<string> = [];
          const waiter = new Waiter(
            workflow.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            () => {},
          );
          const waitPromise = waiter.wait();

          await vi.advanceTimersByTimeAsync(1000);

          assert.equal(await waitPromise, 1);
          assert.deepEqual(messages, [
            '✋Awaiting run  ...',
            '🤙Exceeded wait seconds. Continuing...',
          ]);
        } finally {
          vi.useRealTimers();
        }
      });

      it('will continue immediately when continue-after-seconds is zero', async () => {
        input.continueAfterSeconds = 0;
        const githubClient = {
          runs: vi.fn(),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        assert.equal(await waiter.wait(), 0);
        expect(githubClient.runs).not.toHaveBeenCalled();
        assert.deepEqual(messages, ['🤙Exceeded wait seconds. Continuing...']);
      });

      it('will abort after a prescribed number of seconds', async () => {
        vi.useFakeTimers();
        try {
          input.abortAfterSeconds = 1;
          input.pollIntervalSeconds = 1;
          const inProgressRun = {
            id: 1,
            status: 'in_progress',
            html_url: '',
          };
          const githubClient = {
            runs: vi.fn().mockResolvedValue([inProgressRun]),
            workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
          };

          const messages: Array<string> = [];
          const waiter = new Waiter(
            workflow.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            () => {},
          );
          const waitPromise = waiter.wait();
          const assertion = expect(waitPromise).rejects.toMatchObject({
            name: 'Error',
            message: 'Aborted after waiting 1 seconds',
          });

          await vi.advanceTimersByTimeAsync(1000);

          await assertion;
          assert.deepEqual(messages, [
            '✋Awaiting run  ...',
            '🛑Exceeded wait seconds. Aborting...',
          ]);
        } finally {
          vi.useRealTimers();
        }
      });

      it('will abort immediately when abort-after-seconds is zero', async () => {
        input.abortAfterSeconds = 0;
        const githubClient = {
          runs: vi.fn(),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await expect(waiter.wait()).rejects.toMatchObject({
          name: 'Error',
          message: 'Aborted after waiting 0 seconds',
        });
        expect(githubClient.runs).not.toHaveBeenCalled();
        assert.deepEqual(messages, ['🛑Exceeded wait seconds. Aborting...']);
      });

      it('will abort while workflow run discovery is still pending', async () => {
        vi.useFakeTimers();
        try {
          input.abortAfterSeconds = 1;
          const currentRun = {
            id: input.runId,
            run_attempt: input.runAttempt,
            status: 'in_progress',
            html_url: 'current-run',
            created_at: '2026-05-03T10:00:00Z',
            run_started_at: '2026-05-03T10:00:00Z',
          };
          const githubClient = {
            run: vi.fn().mockResolvedValue(currentRun),
            runs: vi.fn().mockReturnValue(new Promise(() => {})),
            workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
          };

          const messages: Array<string> = [];
          const waiter = new Waiter(
            workflow.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            () => {},
          );
          const waitPromise = waiter.wait();
          const assertion = expect(waitPromise).rejects.toMatchObject({
            name: 'Error',
            message: 'Aborted after waiting 1 seconds',
          });

          await vi.advanceTimersByTimeAsync(1000);

          await assertion;
          expect(messages).toEqual(['🛑Exceeded wait seconds. Aborting...']);
        } finally {
          vi.useRealTimers();
        }
      });

      it('logs a non-Error current-run lookup failure and falls back to discovered runs', async () => {
        const debugMessages: string[] = [];
        const githubClient = waiterClient({
          run: vi.fn().mockRejectedValue('not found'),
          runs: vi.fn().mockResolvedValue([]),
        });
        const waiter = new Waiter(
          workflow.id,
          githubClient,
          input,
          () => {},
          (message) => debugMessages.push(message),
        );

        await waiter.wait();

        expect(debugMessages).toContain('Failed to fetch current run 2: not found');
        expect(githubClient.runs).toHaveBeenCalledOnce();
      });

      it('forwards one abort signal to run discovery and clears its timeout after success', async () => {
        vi.useFakeTimers();
        try {
          input.abortAfterSeconds = 10;
          input.queueName = 'deploy';
          const currentRun = {
            id: input.runId,
            run_attempt: input.runAttempt,
            status: 'in_progress',
            html_url: 'current-run',
            created_at: '2026-05-03T10:00:00Z',
            run_started_at: '2026-05-03T10:00:00Z',
          };
          const run = vi.fn().mockResolvedValue(currentRun);
          const runs = vi.fn().mockResolvedValue([currentRun]);
          const activeRunsForRepo = vi.fn().mockResolvedValue([currentRun]);
          const infoMessages: string[] = [];
          const waiter = new Waiter(
            workflow.id,
            waiterClient({ run, runs, activeRunsForRepo }),
            input,
            (message) => infoMessages.push(message),
            () => {},
          );

          await waiter.wait();

          const runSignal = run.mock.calls[0][3].signal;
          expect(runSignal).toBeInstanceOf(AbortSignal);
          expect(runs.mock.calls[0][4].signal).toBe(runSignal);
          expect(activeRunsForRepo.mock.calls[0][3].signal).toBe(runSignal);

          await vi.advanceTimersByTimeAsync(10_000);
          expect(runSignal.aborted).toBe(false);
          expect(infoMessages).not.toContain('🛑Exceeded wait seconds. Aborting...');
        } finally {
          vi.useRealTimers();
        }
      });

      it('will return when a run is completed', async () => {
        const run = {
          id: 1,
          status: 'in_progress',
          html_url: '1',
        };

        const mockedRunsFunc = vi
          .fn()
          .mockReturnValueOnce(Promise.resolve([run]))
          .mockReturnValue(Promise.resolve([]));
        const githubClient = {
          runs: mockedRunsFunc,
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await waiter.wait();
        assert.deepEqual(messages, ['✋Awaiting run 1 ...']);
        expect(setOutputMock).toHaveBeenCalledWith('previous_run_id', '1');
        expect(setOutputMock).toHaveBeenCalledWith('previous_run_url', '1');
      });

      it('will wait for all previous runs', async () => {
        const inProgressRuns = [
          {
            id: 1,
            status: 'in_progress',
            html_url: '1',
          },
          {
            id: 2,
            status: 'in_progress',
            html_url: '2',
          },
          {
            id: 3,
            status: 'in_progress',
            html_url: '3',
          },
        ];
        // Give the current run an id that makes it the last in the queue.
        input.runId = inProgressRuns.length + 1;
        // Add an in-progress run to simulate a run getting queued _after_ the one we
        // are interested in.
        inProgressRuns.push({
          id: input.runId + 1,
          status: 'in_progress',
          html_url: input.runId + 1 + '',
        });

        const mockedRunsFunc = vi.fn();
        mockedRunsFunc
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(0)))
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(0, 2)))
          .mockReturnValueOnce(Promise.resolve(inProgressRuns))
          // Finally return just the run that was queued _after_ the "input" run.
          .mockReturnValue(Promise.resolve(inProgressRuns.slice(inProgressRuns.length - 1)));

        const githubClient = {
          runs: mockedRunsFunc,
          run: vi.fn(),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await waiter.wait();
        // Verify that the last message printed is that the latest previous run
        // is complete and not the oldest one.
        const latestPreviousRun = inProgressRuns[inProgressRuns.length - 1];
        assert.deepEqual(messages[messages.length - 1], `✋Awaiting run ${input.runId - 1} ...`);
      });

      it('preserves the newest previous run output while a backlog drains', async () => {
        input.runId = 3;
        input.pollIntervalSeconds = 0;

        const olderRun = {
          id: 1,
          status: 'in_progress',
          html_url: 'older-run',
        };
        const newestPreviousRun = {
          id: 2,
          status: 'in_progress',
          html_url: 'newest-previous-run',
        };

        const githubClient = {
          runs: vi
            .fn()
            .mockResolvedValueOnce([olderRun, newestPreviousRun])
            .mockResolvedValueOnce([olderRun])
            .mockResolvedValue([]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );

        await waiter.wait();

        assert.deepEqual(messages, [
          '✋Awaiting run newest-previous-run ...',
          '✋Awaiting run older-run ...',
        ]);
        expect(
          setOutputMock.mock.calls
            .filter(([name]) => name === 'previous_run_id')
            .map(([, value]) => value),
        ).toEqual(['2']);
        expect(
          setOutputMock.mock.calls
            .filter(([name]) => name === 'previous_run_url')
            .map(([, value]) => value),
        ).toEqual(['newest-previous-run']);
      });

      it('will wait for an older predecessor behind newer active runs', async () => {
        input.runId = 1000;
        input.pollIntervalSeconds = 0;

        const newerActiveRuns = Array.from({ length: 500 }, (_, index) => ({
          id: input.runId + index + 1,
          status: 'in_progress',
          html_url: 'newer-' + (index + 1),
        }));
        const predecessorRun = {
          id: input.runId - 1,
          status: 'queued',
          html_url: 'predecessor-run',
        };

        const githubClient = {
          runs: vi
            .fn()
            .mockResolvedValueOnce([...newerActiveRuns, predecessorRun])
            .mockResolvedValue([]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );

        await waiter.wait();

        expect(messages[0]).toBe('✋Awaiting run predecessor-run ...');
      });

      it('will wait for in_progress, queued, and waiting runs', async () => {
        const existingRuns = [
          {
            id: 1,
            status: 'in_progress',
            html_url: '1',
          },
          {
            id: 2,
            status: 'queued',
            html_url: '2',
          },
          {
            id: 3,
            status: 'waiting',
            html_url: '3',
          },
        ];
        // Give the current run an id that makes it the last in the queue.
        input.runId = existingRuns.length + 1;
        // Add an in-progress run to simulate a run getting queued _after_ the one we
        // are interested in.
        existingRuns.push({
          id: input.runId + 1,
          status: 'queued',
          html_url: input.runId + 1 + '',
        });

        const mockedRunsFunc = vi.fn();
        mockedRunsFunc
          .mockReturnValueOnce(Promise.resolve(existingRuns.slice(0)))
          .mockReturnValueOnce(Promise.resolve(existingRuns.slice(0, 1)))
          .mockReturnValueOnce(Promise.resolve(existingRuns))
          // Finally return just the run that was queued _after_ the "input" run.
          .mockReturnValue(Promise.resolve(existingRuns.slice(existingRuns.length - 1)));

        const githubClient = {
          runs: mockedRunsFunc,
          run: vi.fn(),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await waiter.wait();
        // Verify that the last message printed is that the latest previous run
        // is complete and not the oldest one.
        const latestPreviousRun = existingRuns[existingRuns.length - 1];
        assert.deepEqual(messages[messages.length - 1], `✋Awaiting run ${input.runId - 1} ...`);
      });

      it('will wait for an active run that started before a rerun attempt', async () => {
        input.runId = 1;
        input.runAttempt = 2;

        const currentRun = {
          id: 1,
          run_attempt: 2,
          status: 'in_progress',
          html_url: 'current-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:02:00Z',
          created_at: '2026-05-03T10:02:00Z',
        };
        const earlierActiveRun = {
          id: 2,
          status: 'in_progress',
          html_url: 'earlier-active-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:01:00Z',
          created_at: '2026-05-03T10:01:00Z',
        };
        const laterActiveRun = {
          id: 3,
          status: 'in_progress',
          html_url: 'later-active-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:03:00Z',
          created_at: '2026-05-03T10:03:00Z',
        };

        const githubClient = {
          runs: vi
            .fn()
            .mockResolvedValueOnce([currentRun, earlierActiveRun, laterActiveRun])
            .mockResolvedValue([currentRun]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );

        await waiter.wait();

        expect(messages[0]).toBe('✋Awaiting run earlier-active-run ...');
      });

      it('will wait for an active run created before a rerun attempt that starts afterward', async () => {
        input.runId = 1;
        input.runAttempt = 2;
        input.pollIntervalSeconds = 0;

        const currentRun = {
          id: 1,
          run_attempt: 2,
          status: 'in_progress',
          html_url: 'current-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:02:00Z',
          created_at: '2026-05-03T10:02:00Z',
        };
        const queuedBeforeRerun = {
          id: 2,
          run_attempt: 1,
          status: 'in_progress',
          html_url: 'queued-before-rerun',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:03:00Z',
          created_at: '2026-05-03T10:01:00Z',
        };
        const laterActiveRun = {
          id: 3,
          status: 'in_progress',
          html_url: 'later-active-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:03:00Z',
          created_at: '2026-05-03T10:03:00Z',
        };

        const githubClient = {
          runs: vi
            .fn()
            .mockResolvedValueOnce([currentRun, queuedBeforeRerun, laterActiveRun])
            .mockResolvedValue([currentRun]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );

        await waiter.wait();

        expect(messages[0]).toBe('✋Awaiting run queued-before-rerun ...');
      });

      it('will not use original creation time to order later rerun attempts', async () => {
        input.runId = 1;
        input.runAttempt = 2;
        input.pollIntervalSeconds = 0;

        const currentRun = {
          id: 1,
          run_attempt: 2,
          status: 'in_progress',
          html_url: 'current-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:02:00Z',
          created_at: '2026-05-03T10:02:00Z',
        };
        const laterRerun = {
          id: 2,
          run_attempt: 2,
          status: 'in_progress',
          html_url: 'later-rerun',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:03:00Z',
          created_at: '2026-05-03T10:01:00Z',
        };

        const githubClient = {
          runs: vi.fn().mockResolvedValue([currentRun, laterRerun]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );

        await waiter.wait();

        expect(messages).toEqual([]);
        expect(setOutputMock).toHaveBeenCalledWith('previous_run_id', '');
        expect(setOutputMock).toHaveBeenCalledWith('previous_run_url', '');
      });

      it('will not wait for a lower-id rerun attempt that starts after the current run', async () => {
        input.runId = 3;
        input.runAttempt = 1;
        input.pollIntervalSeconds = 0;

        const currentRun = {
          id: 3,
          run_attempt: 1,
          status: 'in_progress',
          html_url: 'current-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:02:00Z',
          created_at: '2026-05-03T10:02:00Z',
        };
        const laterRerun = {
          id: 1,
          run_attempt: 2,
          status: 'in_progress',
          html_url: 'later-rerun',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:03:00Z',
          created_at: '2026-05-03T10:00:00Z',
        };

        const githubClient = {
          runs: vi.fn().mockResolvedValue([currentRun, laterRerun]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );

        await waiter.wait();

        expect(messages).toEqual([]);
      });

      it('will not wait for a run that starts after the current run', async () => {
        input.runId = 2;

        const currentRun = {
          id: 2,
          run_attempt: 1,
          status: 'in_progress',
          html_url: 'current-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:00:00Z',
          created_at: '2026-05-03T10:00:00Z',
        };
        const laterActiveRun = {
          id: 3,
          status: 'in_progress',
          html_url: 'later-active-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:01:00Z',
          created_at: '2026-05-03T10:01:00Z',
        };

        const githubClient = {
          runs: vi.fn().mockResolvedValue([currentRun, laterActiveRun]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );

        await waiter.wait();

        expect(messages).toEqual([]);
      });

      it('will wait for a lower-id first-attempt run that starts after the current run', async () => {
        input.runId = 2;
        input.runAttempt = 1;

        const currentRun = {
          id: 2,
          run_attempt: 1,
          status: 'in_progress',
          html_url: 'current-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:00:00Z',
          created_at: '2026-05-03T10:00:00Z',
        };
        const lowerIdActiveRun = {
          id: 1,
          status: 'in_progress',
          html_url: 'lower-id-active-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:01:00Z',
          created_at: '2026-05-03T10:01:00Z',
        };

        const githubClient = {
          runs: vi
            .fn()
            .mockResolvedValueOnce([currentRun, lowerIdActiveRun])
            .mockResolvedValue([currentRun]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );

        await waiter.wait();

        expect(messages[0]).toBe('✋Awaiting run lower-id-active-run ...');
      });

      it('filters active runs and branches client-side', async () => {
        input.runId = 5;
        input.sameBranchOnly = true;

        const currentRun = {
          id: 5,
          run_attempt: 1,
          status: 'in_progress',
          html_url: 'current-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:05:00Z',
          created_at: '2026-05-03T10:05:00Z',
        };
        const sameBranchActiveRun = {
          id: 1,
          status: 'queued',
          html_url: 'same-branch-active-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:01:00Z',
          created_at: '2026-05-03T10:01:00Z',
        };
        const sameBranchCompletedRun = {
          id: 2,
          status: 'completed',
          conclusion: null,
          html_url: 'same-branch-completed-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:02:00Z',
          created_at: '2026-05-03T10:02:00Z',
        };
        const otherBranchActiveRun = {
          id: 3,
          status: 'waiting',
          html_url: 'other-branch-active-run',
          head_branch: 'feature',
          run_started_at: '2026-05-03T10:03:00Z',
          created_at: '2026-05-03T10:03:00Z',
        };
        const unknownBranchActiveRun = {
          id: 4,
          status: 'in_progress',
          html_url: 'unknown-branch-active-run',
          head_branch: null,
          run_started_at: '2026-05-03T10:04:00Z',
          created_at: '2026-05-03T10:04:00Z',
        };

        const githubClient = {
          runs: vi
            .fn()
            .mockResolvedValueOnce([
              currentRun,
              sameBranchActiveRun,
              sameBranchCompletedRun,
              otherBranchActiveRun,
              unknownBranchActiveRun,
            ])
            .mockResolvedValue([currentRun]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );

        await waiter.wait();

        expect(messages[0]).toBe('✋Awaiting run same-branch-active-run ...');
      });

      it('will retry to get previous runs, if not found during first try', async () => {
        vi.useFakeTimers();
        try {
          input.initialWaitSeconds = 2;
          // give the current run a random id
          input.runId = 2;

          const run = {
            id: 1,
            status: 'in_progress',
            html_url: '1',
          };
          const completedRun = {
            ...run,
            status: 'completed',
            conclusion: 'success',
          };

          const mockedRunsFunc = vi
            .fn()
            // don't return any runs in the first attempt
            .mockReturnValueOnce(Promise.resolve([]))
            // return the inprogress run
            .mockReturnValueOnce(Promise.resolve([run]))
            // then return the same run as completed
            .mockReturnValue(Promise.resolve([completedRun]));

          const githubClient = {
            runs: mockedRunsFunc,
            workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
          };

          const messages: Array<string> = [];
          const waiter = new Waiter(
            workflow.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            () => {},
          );
          const waitPromise = waiter.wait();

          await vi.advanceTimersByTimeAsync(3000);
          await waitPromise;

          assert.deepStrictEqual(messages, [
            `🔎 Waiting for ${input.initialWaitSeconds} seconds before checking for runs again...`,
            '✋Awaiting run 1 ...',
          ]);
        } finally {
          vi.useRealTimers();
        }
      });

      it('will wait for a specific job to complete if wait-for-job is defined', async () => {
        input.jobToWaitFor = 'test-job';
        input.pollIntervalSeconds = 0;
        const run = {
          id: 1,
          status: 'in_progress',
          html_url: '1',
        };
        const job = {
          id: 1,
          name: 'test-job',
          status: 'in_progress',
          html_url: 'job-url',
        };

        const githubClient = {
          runs: vi.fn().mockResolvedValue([run]),
          jobs: vi
            .fn()
            .mockResolvedValueOnce([job])
            .mockResolvedValue([{ ...job, status: 'completed' }]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await waiter.wait();

        assert.deepEqual(messages, [
          '✋Awaiting job run completion from job job-url ...',
          'Job test-job completed from run 1',
        ]);
        expect(setOutputMock).toHaveBeenCalledWith('previous_run_id', '1');
        expect(setOutputMock).toHaveBeenCalledWith('previous_run_url', '1');
      });

      it('will keep checking previous runs after a rerun predecessor job is complete', async () => {
        input.runId = 3;
        input.runAttempt = 2;
        input.jobToWaitFor = 'test-job';
        input.pollIntervalSeconds = 0;

        const currentRun = {
          id: 3,
          run_attempt: 2,
          status: 'in_progress',
          html_url: 'current-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:05:00Z',
          created_at: '2026-05-03T10:05:00Z',
        };
        const olderRerun = {
          id: 1,
          status: 'in_progress',
          html_url: 'older-rerun',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:04:00Z',
          created_at: '2026-05-03T10:04:00Z',
        };
        const newerPreviousRun = {
          id: 2,
          status: 'in_progress',
          html_url: 'newer-previous-run',
          head_branch: 'master',
          run_started_at: '2026-05-03T10:03:00Z',
          created_at: '2026-05-03T10:03:00Z',
        };
        const completedJob = {
          id: 1,
          name: 'test-job',
          status: 'completed',
          html_url: 'completed-job-url',
        };
        const activeJob = {
          id: 2,
          name: 'test-job',
          status: 'in_progress',
          html_url: 'active-job-url',
        };

        const githubClient = {
          runs: vi
            .fn()
            .mockResolvedValueOnce([currentRun, olderRerun, newerPreviousRun])
            .mockResolvedValue([currentRun]),
          jobs: vi.fn().mockResolvedValueOnce([completedJob]).mockResolvedValueOnce([activeJob]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await waiter.wait();

        assert.deepEqual(messages, [
          'Job test-job completed from run older-rerun',
          '✋Awaiting job run completion from job active-job-url ...',
        ]);
      });

      it('will wait for a specific step to complete if wait-for-step is defined', async () => {
        input.jobToWaitFor = 'test-job';
        input.stepToWaitFor = 'test-step';
        input.pollIntervalSeconds = 0;
        const run = {
          id: 1,
          status: 'in_progress',
          html_url: '1',
        };
        const job = {
          id: 1,
          name: 'test-job',
          status: 'in_progress',
          html_url: 'job-url',
        };
        const step = {
          id: 1,
          name: 'test-step',
          status: 'in_progress',
          html_url: 'step-url',
        };

        const githubClient = {
          runs: vi.fn().mockResolvedValue([run]),
          jobs: vi.fn().mockResolvedValue([job]),
          steps: vi
            .fn()
            .mockResolvedValueOnce([step])
            .mockResolvedValue([{ ...step, status: 'completed' }]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await waiter.wait();

        assert.deepEqual(messages, [
          '✋Awaiting step completion from job job-url ...',
          'Step test-step completed from run 1',
        ]);
        expect(setOutputMock).toHaveBeenCalledWith('previous_run_id', '1');
        expect(setOutputMock).toHaveBeenCalledWith('previous_run_url', '1');
      });

      it('falls back to the job when the requested step is missing', async () => {
        input.jobToWaitFor = 'test-job';
        input.stepToWaitFor = 'missing-step';
        input.pollIntervalSeconds = 0;
        const run = {
          id: 1,
          status: 'in_progress',
          html_url: 'run-url',
        };
        const job = {
          id: 7,
          name: 'test-job',
          status: 'in_progress',
          html_url: 'job-url',
        };
        const githubClient = waiterClient({
          runs: vi.fn().mockResolvedValueOnce([run]).mockResolvedValue([]),
          jobs: vi.fn().mockResolvedValue([job]),
          steps: vi.fn().mockResolvedValue([{ number: 1, name: 'other-step' }]),
        });
        const messages: string[] = [];
        const waiter = new Waiter(
          workflow.id,
          githubClient,
          input,
          (message) => messages.push(message),
          () => {},
        );

        await waiter.wait();

        expect(messages).toEqual([
          'Step missing-step not found in job 7, awaiting full run for safety',
          '✋Awaiting job run completion from job job-url ...',
        ]);
      });

      it('will await the full run if the job is not found', async () => {
        input.runId = 2;
        input.jobToWaitFor = 'test-job';
        input.pollIntervalSeconds = 0;
        const run = {
          id: 1,
          status: 'in_progress',
          html_url: 'run1-url',
        };
        const run2 = {
          id: 2,
          status: 'in_progress',
          html_url: 'run2-url',
        };
        const notOurTestJob = {
          id: 1,
          name: 'another-job',
          status: 'in_progress',
          html_url: 'job-url',
        };

        const githubClient = {
          // On the first call have both runs in progress, on the second call have the first run completed
          runs: vi
            .fn()
            .mockResolvedValueOnce([run, run2])
            .mockResolvedValue([{ ...run, conclusion: 'success', status: 'success' }, run2]),
          // This workflow's jobs is not the one we are looking for (should be fine, we fall back to waiting the full run)
          jobs: vi.fn().mockResolvedValue([notOurTestJob]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const infoMessages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          waiterClient(githubClient),
          input,
          (message: string) => {
            infoMessages.push(message);
          },
          () => {},
        );

        await waiter.wait();
        assert.deepEqual(infoMessages, [
          `Job ${input.jobToWaitFor} not found in run ${run.id}, awaiting full run for safety`,
          `✋Awaiting run ${run.html_url} ...`,
        ]);
      });

      describe('queue-name cross-workflow behavior', () => {
        let input: Input;
        const workflow1 = {
          id: 123,
          name: 'random1 Workflow',
        };
        const workflow2 = {
          id: 456,
          name: 'random2 Workflow',
        };

        beforeEach(() => {
          input = {
            branch: 'master',
            continueAfterSeconds: undefined,
            abortAfterSeconds: undefined,
            pollIntervalSeconds: 0,
            githubToken: 'fake-token',
            owner: 'org',
            repo: 'repo',
            runId: 4,
            runAttempt: 1,
            workflowName: workflow1.name,
            workflowPath: undefined,
            sameBranchOnly: false,
            jobToWaitFor: undefined,
            stepToWaitFor: undefined,
            initialWaitSeconds: 0,
            queueName: undefined,
            retries: 0,
          };
        });

        it('should search active repo runs when queue-name is provided', async () => {
          input.queueName = 'repoa';
          input.runId = 4;

          const repoRuns = [
            {
              id: 1,
              status: 'in_progress',
              conclusion: null,
              html_url: '1',
              display_title: 'random1-repoa',
              name: 'random1-repoa',
            },
            {
              id: 3,
              status: 'in_progress',
              conclusion: null,
              html_url: '3',
              display_title: 'random2-repoa',
              name: 'random2-repoa',
            },
          ];

          const mockedRunsFunc = vi.fn().mockResolvedValue([]);
          const activeRunsForRepo = vi.fn().mockResolvedValueOnce(repoRuns).mockResolvedValue([]);

          const githubClient = {
            runs: mockedRunsFunc,
            activeRunsForRepo,
            workflows: async (owner: string, repo: string) =>
              Promise.resolve([workflow1, workflow2]),
          };

          const messages: Array<string> = [];
          const debugMessages: Array<string> = [];
          const waiter = new Waiter(
            workflow1.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            (message: string) => {
              debugMessages.push(message);
            },
          );

          await waiter.wait();

          expect(mockedRunsFunc).toHaveBeenCalledWith('org', 'repo', workflow1.id, {
            branch: undefined,
          });
          expect(activeRunsForRepo).toHaveBeenCalledWith('org', 'repo', {
            branch: undefined,
          });

          const hasSearchMessage = debugMessages.some((msg) =>
            msg.includes('Searching active workflow runs across repository'),
          );
          expect(hasSearchMessage).toBe(true);

          expect(messages.length).toBeGreaterThan(0);
          const hasQueueMessage = debugMessages.some(
            (msg) => msg.includes('queue:') && msg.includes('repoa'),
          );
          expect(hasQueueMessage).toBe(true);

          const awaitedRun3 = debugMessages.some((msg) => msg.includes('Run 3'));
          expect(awaitedRun3).toBe(true);
        });

        it('should filter runs by queue-name substring in display_title', async () => {
          input.queueName = 'repoa';
          input.runId = 4;

          const allRuns = [
            {
              id: 1,
              status: 'in_progress',
              conclusion: null,
              html_url: '1',
              display_title: 'random1 repoa',
              name: 'random1 repoa',
            },
            {
              id: 2,
              status: 'in_progress',
              conclusion: null,
              html_url: '2',
              display_title: 'random1 repob',
              name: 'random1 repob',
            },
            {
              id: 3,
              status: 'in_progress',
              conclusion: null,
              html_url: '3',
              display_title: 'random2 repoa',
              name: 'random2 repoa',
            },
          ];

          const githubClient = {
            runs: vi.fn().mockResolvedValue([]),
            activeRunsForRepo: vi.fn().mockResolvedValueOnce(allRuns).mockResolvedValue([]),
            workflows: async () => Promise.resolve([workflow1, workflow2]),
          };

          const messages: Array<string> = [];
          const debugMessages: Array<string> = [];
          const waiter = new Waiter(
            workflow1.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            (message: string) => {
              debugMessages.push(message);
            },
          );

          await waiter.wait();

          const matchDebugMessages = debugMessages.filter((msg) => msg.includes('matches queue'));

          expect(matchDebugMessages.some((msg) => msg.includes('Run 1'))).toBe(true);
          expect(matchDebugMessages.some((msg) => msg.includes('Run 3'))).toBe(true);

          const awaitedRepob = matchDebugMessages.some((msg) => msg.includes('Run 2'));
          expect(awaitedRepob).toBe(false);
        });

        it('should fallback to name field if display_title is not available', async () => {
          input.queueName = 'repoa';
          input.runId = 4;

          const allRuns = [
            {
              id: 1,
              status: 'in_progress',
              conclusion: null,
              html_url: '1',
              display_title: null,
              name: 'random1-repoa',
            },
          ];

          const githubClient = {
            runs: vi.fn().mockResolvedValue([]),
            activeRunsForRepo: vi.fn().mockResolvedValueOnce(allRuns).mockResolvedValue([]),
            workflows: async () => Promise.resolve([workflow1]),
          };

          const messages: Array<string> = [];
          const debugMessages: Array<string> = [];
          const waiter = new Waiter(
            workflow1.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            (message: string) => {
              debugMessages.push(message);
            },
          );

          await waiter.wait();

          const matchDebugMessage = debugMessages.find(
            (msg) => msg.includes('Run 1') && msg.includes('matches queue'),
          );
          expect(matchDebugMessage).toBeDefined();
        });

        it('should use original behavior when queue-name is not provided', async () => {
          input.queueName = undefined;
          input.runId = 4;

          const allRuns = [
            {
              id: 1,
              status: 'in_progress',
              html_url: '1',
              conclusion: null,
              display_title: 'random1-repoa',
            },
          ];

          const mockedRunsFunc = vi
            .fn()
            .mockResolvedValueOnce(allRuns)
            .mockResolvedValue(allRuns.map((r) => ({ ...r, conclusion: 'success' })))
            .mockResolvedValue([]);

          const githubClient = {
            runs: mockedRunsFunc,
            workflows: async (owner: string, repo: string) =>
              Promise.resolve([workflow1, workflow2]),
          };

          const messages: Array<string> = [];
          const debugMessages: Array<string> = [];
          const waiter = new Waiter(
            workflow1.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            (message: string) => {
              debugMessages.push(message);
            },
          );

          await waiter.wait();
          const hasSearchMessage = debugMessages.some((msg) => msg.includes('Searching across'));
          expect(hasSearchMessage).toBe(false);
          const hasQueueMessage = debugMessages.some((msg) => msg.includes('matches queue'));
          expect(hasQueueMessage).toBe(false);
          expect(mockedRunsFunc).toHaveBeenCalledWith('org', 'repo', workflow1.id, {
            branch: undefined,
          });
        });

        it('keeps queue-name discovery bounded on repositories with many workflows', async () => {
          input.queueName = 'repoa';

          const manyWorkflows = Array.from({ length: 39 }, (_, i) => ({
            id: i + 1,
            name: `Workflow ${i + 1}`,
          }));

          const mockedRunsFunc = vi.fn().mockResolvedValue([]);
          const activeRunsForRepo = vi.fn().mockResolvedValue([]);

          const githubClient = {
            runs: mockedRunsFunc,
            activeRunsForRepo,
            workflows: async (owner: string, repo: string) => Promise.resolve(manyWorkflows),
          };

          const messages: Array<string> = [];
          const debugMessages: Array<string> = [];
          const waiter = new Waiter(
            workflow1.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            (message: string) => {
              debugMessages.push(message);
            },
          );

          await waiter.wait();

          expect(mockedRunsFunc).toHaveBeenCalledTimes(1);
          expect(activeRunsForRepo).toHaveBeenCalledTimes(1);
          expect(debugMessages).not.toContain('Processing workflow batch');
        });

        it('should wait for previous runs across different workflows with same queue-name', async () => {
          input.queueName = 'repoa';
          input.runId = 4;

          const repoRuns = [
            {
              id: 1,
              status: 'in_progress',
              html_url: '1',
              display_title: 'random1-repoa',
            },
            {
              id: 3,
              status: 'in_progress',
              html_url: '3',
              display_title: 'random2-repoa',
            },
          ];

          const mockedRunsFunc = vi.fn().mockResolvedValue([]);
          const activeRunsForRepo = vi.fn().mockResolvedValueOnce(repoRuns).mockResolvedValue([]);

          const githubClient = {
            runs: mockedRunsFunc,
            activeRunsForRepo,
            workflows: async (owner: string, repo: string) =>
              Promise.resolve([workflow1, workflow2]),
          };

          const messages: Array<string> = [];
          const debugMessages: Array<string> = [];
          const waiter = new Waiter(
            workflow1.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            (message: string) => {
              debugMessages.push(message);
            },
          );
          await waiter.wait();

          expect(messages[0]).toContain('✋Awaiting run 3');
          const queueMessage = debugMessages.find((msg) => msg.includes('queue: "repoa"'));
          expect(queueMessage).toBeDefined();
        });

        it('should not wait for previous runs across different workflows with different queue-name', async () => {
          input.queueName = 'repoa';
          input.runId = 4;

          const repoRuns = [
            {
              id: 3,
              status: 'in_progress',
              html_url: '3',
              display_title: 'random2-repob',
            },
          ];

          const mockedRunsFunc = vi.fn().mockResolvedValue([]);
          const activeRunsForRepo = vi.fn().mockResolvedValue(repoRuns);

          const githubClient = {
            runs: mockedRunsFunc,
            activeRunsForRepo,
            workflows: async (owner: string, repo: string) =>
              Promise.resolve([workflow1, workflow2]),
          };

          const messages: Array<string> = [];
          const debugMessages: Array<string> = [];
          const waiter = new Waiter(
            workflow1.id,
            waiterClient(githubClient),
            input,
            (message: string) => {
              messages.push(message);
            },
            (message: string) => {
              debugMessages.push(message);
            },
          );
          await waiter.wait();

          expect(messages.length).toBe(0);
          const queueMessage = debugMessages.find((msg) =>
            msg.includes('0 runs match queue "repoa"'),
          );
          expect(queueMessage).toBeDefined();
        });
      });
    });
  });
});
