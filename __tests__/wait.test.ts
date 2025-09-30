import { assert, beforeEach, describe, expect, it, vi } from 'vitest';

import { Input } from '../src/input';
import { Waiter } from '../src/wait';

describe('wait', () => {
  describe('Waiter', () => {
    describe('wait', () => {
      let input: Input;
      const workflow = {
        id: 123124,
        name: 'Test workflow',
      };

      beforeEach(() => {
        input = {
          branch: 'master',
          continueAfterSeconds: undefined,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 1,
          githubToken: 'fake-token',
          owner: 'org',
          repo: 'repo',
          runId: 2,
          workflowName: workflow.name,
          sameBranchOnly: true,
          jobToWaitFor: undefined,
          stepToWaitFor: undefined,
          initialWaitSeconds: 0,
          exponentialBackoffRetries: false,
        };
      });

      it('will continue after a prescribed number of seconds', async () => {
        input.continueAfterSeconds = 1;
        const inProgressRun = {
          id: 1,
          status: 'in_progress',
          html_url: '',
        };
        const githubClient = {
          runs: async (
            owner: string,
            repo: string,
            branch: string | undefined,
            workflowId: number,
          ) => Promise.resolve([inProgressRun]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          // @ts-ignore
          githubClient,
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        assert.equal(await waiter.wait(), 1);
        assert.deepEqual(messages, [
          '✋Awaiting run  ...',
          '🤙Exceeded wait seconds. Continuing...',
        ]);
      });

      it('will abort after a prescribed number of seconds', async () => {
        input.abortAfterSeconds = 1;
        const inProgressRun = {
          id: 1,
          status: 'in_progress',
          html_url: '',
        };
        const githubClient = {
          runs: async (
            owner: string,
            repo: string,
            branch: string | undefined,
            workflowId: number,
          ) => Promise.resolve([inProgressRun]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          // @ts-ignore
          githubClient,
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await expect(waiter.wait()).rejects.toMatchObject({
          name: 'Error',
          message: 'Aborted after waiting 1 seconds',
        });
        assert.deepEqual(messages, ['✋Awaiting run  ...', '🛑Exceeded wait seconds. Aborting...']);
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
          // @ts-ignore
          githubClient,
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await waiter.wait();
        assert.deepEqual(messages, ['✋Awaiting run 1 ...']);
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
          // @ts-ignore
          githubClient,
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

      it('will wait for in_progress, queued, waiting, pending, requested, and action_required runs', async () => {
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
          {
            id: 4,
            status: 'pending',
            html_url: '4',
          },
          {
            id: 5,
            status: 'requested',
            html_url: '5',
          },
          {
            id: 6,
            status: 'action_required',
            html_url: '6',
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
          // @ts-ignore
          githubClient,
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

      it('will retry to get previous runs, if not found during first try', async () => {
        // see discussions in https://github.com/vitest-dev/vitest/discussions/7890
        vi.setConfig({ testTimeout: 10_1000 });
        input.initialWaitSeconds = 2;
        // give the current run a random id
        input.runId = 2;

        const run = {
          id: 1,
          status: 'in_progress',
          html_url: '1',
        };

        const mockedRunsFunc = vi
          .fn()
          // don't return any runs in the first attempt
          .mockReturnValueOnce(Promise.resolve([]))
          // return the inprogress run
          .mockReturnValueOnce(Promise.resolve([run]))
          // then return the same run as completed
          .mockReturnValue(Promise.resolve([(run.status = 'completed')]));

        const githubClient = {
          runs: mockedRunsFunc,
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          // @ts-ignore
          githubClient,
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await waiter.wait();
        assert.deepStrictEqual(messages, [
          `🔎 Waiting for ${input.initialWaitSeconds} seconds before checking for runs again...`,
          '✋Awaiting run 1 ...',
        ]);
      });

      it('will wait for a specific job to complete if wait-for-job is defined', async () => {
        input.jobToWaitFor = 'test-job';
        input.pollIntervalSeconds = 1;
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
          runs: async (
            owner: string,
            repo: string,
            branch: string | undefined,
            workflowId: number,
          ) => Promise.resolve([run]),
          jobs: vi
            .fn()
            .mockResolvedValueOnce([job])
            .mockResolvedValue([{ ...job, status: 'completed' }]),
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          // @ts-ignore
          githubClient,
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
      });

      it('will wait for a specific step to complete if wait-for-step is defined', async () => {
        input.jobToWaitFor = 'test-job';
        input.stepToWaitFor = 'test-step';
        input.pollIntervalSeconds = 1;
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
          runs: async (
            owner: string,
            repo: string,
            branch: string | undefined,
            workflowId: number,
          ) => Promise.resolve([run]),
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
          // @ts-ignore
          githubClient,
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
      });

      it('will await the full run if the job is not found', async () => {
        input.runId = 2;
        input.jobToWaitFor = 'test-job';
        input.pollIntervalSeconds = 1;
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
          // @ts-ignore
          githubClient,
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

      it('will skip failed and cancelled runs', async () => {
        input.runId = 4;
        const existingRuns = [
          {
            id: 1,
            status: 'completed',
            conclusion: 'failure',
            html_url: '1',
          },
          {
            id: 2,
            status: 'completed',
            conclusion: 'cancelled',
            html_url: '2',
          },
          {
            id: 3,
            status: 'in_progress',
            html_url: '3',
          },
        ];

        const mockedRunsFunc = vi
          .fn()
          .mockReturnValueOnce(Promise.resolve(existingRuns))
          .mockReturnValue(Promise.resolve(existingRuns.slice(0, 2)));

        const githubClient = {
          runs: mockedRunsFunc,
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const debugMessages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          // @ts-ignore
          githubClient,
          input,
          () => {},
          (message: string) => {
            debugMessages.push(message);
          },
        );
        await waiter.wait();

        // Verify that failed and cancelled runs were skipped
        const skippedMessages = debugMessages.filter((msg) =>
          msg.includes('already completed'),
        );
        assert.equal(skippedMessages.length, 2);
        assert(skippedMessages.some((msg) => msg.includes('run 1')));
        assert(skippedMessages.some((msg) => msg.includes('run 2')));
      });

      it('will wait for all previous runs with exponential backoff', async () => {
        input.exponentialBackoffRetries = true;
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
            status: 'queued',
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

        const mockedRunsFunc = vi
          .fn()
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(0)))
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(1)))
          .mockReturnValue(Promise.resolve(inProgressRuns.slice(inProgressRuns.length - 1)));

        const githubClient = {
          runs: mockedRunsFunc,
          workflows: async (owner: string, repo: string) => Promise.resolve([workflow]),
        };

        const messages: Array<string> = [];

        const waiter = new Waiter(
          workflow.id,
          // @ts-ignore
          githubClient,
          input,
          (message: string) => {
            messages.push(message);
          },
          () => {},
        );
        await waiter.wait();
        assert.deepEqual(messages, [
          `✋Awaiting run ${input.runId - 1} ...`,
          `🔁 Attempt 1, next will be in 1 seconds`,
          `✋Awaiting run ${input.runId - 1} ...`,
          `🔁 Attempt 2, next will be in 2 seconds`,
        ]);
      });
    });
  });
});
