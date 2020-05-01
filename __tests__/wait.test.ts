import * as assert from "assert";

import { Waiter } from "../src/wait";
import { Input } from "../src/input";
import { Workflow, Run } from "../src/github";

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
          continueAfterSeconds: 1,
          pollIntervalSeconds: 1,
          githubToken: "fake-token",
          owner: "org",
          repo: "repo",
          runId: 2,
          workflowName: workflow.name
        };
      });

      it("will continue after a prescribed number of seconds", async () => {
        const inProgressRun = {
          id: 1,
          status: "in_progress",
          html_url: ""
        };
        const githubClient = {
          runs: async (
            owner: string,
            repo: string,
            branch: string,
            workflowId: number
          ) => Promise.resolve([inProgressRun]),
          run: async (owner: string, repo: string, runId: number) =>
            Promise.resolve(inProgressRun),
          workflows: async (owner: string, repo: string) =>
            Promise.resolve([workflow])
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
        const completedRun: Run = {
          id: 1,
          status: "completed",
          html_url: ""
        };
        const githubClient = {
          runs: async (
            owner: string,
            repo: string,
            branch: string,
            workflowId: number
          ) => Promise.resolve([completedRun]),
          run: async (owner: string, repo: string, runId: number) =>
            Promise.resolve(completedRun),
          workflows: async (owner: string, repo: string) =>
            Promise.resolve([workflow])
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
        assert.equal(await waiter.wait(), 0);
        assert.deepEqual(messages, ["👍 Run  complete."]);
      });

      it("will wait for all previous runs", async () => {
        // Set continueAfterSeconds to `undefined` to simulate waiting
        // for all runs to complete before proceeding.
        input.continueAfterSeconds = undefined;
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
        const mockedRunsFunc = jest.fn();
        mockedRunsFunc
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(0)))
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(0, 2)))
          .mockReturnValue(Promise.resolve(inProgressRuns));

        /**
         * Simulate waiting for a previous run for 3s and then completing
         * the previous run.
         *
         * Setup the "run" function to return the run information as-is,
         * which means the previous run will appear as "in-progress" until
         * we mutate the "status" ourselves.
         */
        const mockedRunFunc = jest
          .fn()
          .mockImplementationOnce(
            async (owner: string, repo: string, runId: number) => {
              const r = inProgressRuns.find(v => v.id === runId);
              return Promise.resolve(r!);
            }
          )
          .mockImplementationOnce(
            async (owner: string, repo: string, runId: number) => {
              const r = inProgressRuns.find(v => v.id === runId);
              return Promise.resolve(r!);
            }
          )
          .mockImplementationOnce(
            async (owner: string, repo: string, runId: number) => {
              const r = inProgressRuns.find(v => v.id === runId);
              return Promise.resolve(r!);
            }
          )
          .mockImplementation(
            async (owner: string, repo: string, runId: number) => {
              const r = inProgressRuns.find(v => v.id === runId);
              // Modify the run status to completed to simulate a run completing.
              r!.status = "completed";
              return Promise.resolve(r!);
            }
          );

        const githubClient = {
          runs: mockedRunsFunc,
          run: mockedRunFunc,
          workflows: async (owner: string, repo: string) =>
            Promise.resolve([workflow])
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
          `👍 Run ${latestPreviousRun.html_url} complete.`
        );
      });
    });
  });
});
