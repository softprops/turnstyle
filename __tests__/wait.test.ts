import * as assert from "assert";

import { Waiter } from "../src/wait";
import { Input } from "../src/input";
import { Workflow, Run, Job } from "../src/github";

describe("wait", () => {
  describe("Waiter", () => {
    describe("wait", () => {
      let input: Input;
      const workflow: Workflow = {
        id: 123124,
        name: "Test workflow"
      };

      beforeEach(() => {
        input = {
          branch: "master",
          continueAfterSeconds: undefined,
          pollIntervalSeconds: 1,
          githubToken: "fake-token",
          owner: "org",
          repo: "repo",
          runId: 2,
          workflowName: workflow.name,
          sameBranchOnly: true,
          waitForJob: undefined
        };
      });

      it("will continue after a prescribed number of seconds", async () => {
        input.continueAfterSeconds = 1;
        const inProgressRun = {
          id: 1,
          status: "in_progress",
          html_url: ""
        };
        const githubClient = {
          runs: async (
            owner: string,
            repo: string,
            branch: string | undefined,
            workflowId: number
          ) => Promise.resolve([inProgressRun]),
          workflows: async (owner: string, repo: string) =>
            Promise.resolve([workflow]),
          jobs: jest.fn()
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          githubClient,
          input,
          (message: string) => {
            messages.push(message);
          }
        );
        assert.equal(await waiter.wait(), 1);
        assert.deepEqual(messages, [
          "✋Awaiting run ...",
          "🤙Exceeded wait seconds. Continuing..."
        ]);
      });

      it("will return when a run is completed", async () => {
        const run: Run = {
          id: 1,
          status: "in_progress",
          html_url: "1"
        };

        const mockedRunsFunc = jest
          .fn()
          .mockReturnValueOnce(Promise.resolve([run]))
          .mockReturnValue(Promise.resolve([]));
        const githubClient = {
          runs: mockedRunsFunc,
          workflows: async (owner: string, repo: string) =>
            Promise.resolve([workflow]),
          jobs: jest.fn()
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          githubClient,
          input,
          (message: string) => {
            messages.push(message);
          }
        );
        await waiter.wait();
        assert.deepEqual(messages, ["✋Awaiting run 1..."]);
      });

      it("will wait for all previous runs", async () => {
        const inProgressRuns = [
          {
            id: 1,
            status: "in_progress",
            html_url: "1"
          },
          {
            id: 2,
            status: "in_progress",
            html_url: "2"
          },
          {
            id: 3,
            status: "in_progress",
            html_url: "3"
          }
        ];
        // Give the current run an id that makes it the last in the queue.
        input.runId = inProgressRuns.length + 1;
        // Add an in-progress run to simulate a run getting queued _after_ the one we
        // are interested in.
        inProgressRuns.push({
          id: input.runId + 1,
          status: "in_progress",
          html_url: input.runId + 1 + ""
        });

        const mockedRunsFunc = jest.fn();
        mockedRunsFunc
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(0)))
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(0, 2)))
          .mockReturnValueOnce(Promise.resolve(inProgressRuns))
          // Finally return just the run that was queued _after_ the "input" run.
          .mockReturnValue(
            Promise.resolve(inProgressRuns.slice(inProgressRuns.length - 1))
          );

        const githubClient = {
          runs: mockedRunsFunc,
          run: jest.fn(),
          workflows: async (owner: string, repo: string) =>
            Promise.resolve([workflow]),
          jobs: jest.fn()
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          githubClient,
          input,
          (message: string) => {
            messages.push(message);
          }
        );
        await waiter.wait();
        // Verify that the last message printed is that the latest previous run
        // is complete and not the oldest one.
        const latestPreviousRun = inProgressRuns[inProgressRuns.length - 1];
        assert.deepEqual(
          messages[messages.length - 1],
          `✋Awaiting run ${input.runId - 1}...`
        );
      });

      it("will return when a wait-for-job is completed", async () => {
        const run: Run = {
          id: 1,
          status: "in_progress",
          html_url: "1"
        };

        const job1: Omit<Job, "status"> = {
          id: 1,
          html_url: "j1",
          name: "job-1"
        };
        const job2: Omit<Job, "status"> = {
          id: 2,
          html_url: "j2",
          name: "job-2"
        };
        const withStatus = (job: Omit<Job, "status">, status: string): Job => ({
          ...job,
          status
        });

        const mockedRunsFunc = jest
          .fn()
          .mockReturnValue(Promise.resolve([run]));
        const mockedJobsFunc = jest
          .fn()
          .mockResolvedValueOnce([
            withStatus(job1, "in_progress"),
            withStatus(job2, "queued")
          ])
          .mockResolvedValueOnce([
            withStatus(job1, "completed"),
            withStatus(job2, "in_progress")
          ]);
        const githubClient = {
          runs: mockedRunsFunc,
          workflows: async (owner: string, repo: string) =>
            Promise.resolve([workflow]),
          jobs: mockedJobsFunc
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          githubClient,
          { ...input, waitForJob: "job-1" },
          (message: string) => {
            messages.push(message);
          }
        );
        await waiter.wait();
        assert.deepEqual(messages, ["✋Awaiting job j1..."]);
      });

      it("will wait for entire workflow if wait-for-job is not found", async () => {
        const run: Run = {
          id: 1,
          status: "in_progress",
          html_url: "1"
        };

        const job1: Job = {
          id: 1,
          html_url: "j1",
          name: "job-1",
          status: "completed"
        };
        const job2: Job = {
          id: 2,
          html_url: "j2",
          name: "job-2",
          status: "completed"
        };

        const mockedRunsFunc = jest
          .fn()
          .mockResolvedValueOnce([run])
          .mockResolvedValueOnce([]);
        const mockedJobsFunc = jest.fn().mockResolvedValue([job1, job2]);
        const githubClient = {
          runs: mockedRunsFunc,
          workflows: async (owner: string, repo: string) =>
            Promise.resolve([workflow]),
          jobs: mockedJobsFunc
        };

        const messages: Array<string> = [];
        const waiter = new Waiter(
          workflow.id,
          githubClient,
          { ...input, waitForJob: "job-not-exists" },
          (message: string) => {
            messages.push(message);
          }
        );
        await waiter.wait();
        assert.deepEqual(messages, ["✋Awaiting run 1..."]);
      });
    });
  });
});
