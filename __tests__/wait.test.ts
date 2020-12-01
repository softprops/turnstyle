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
          continueAfterSeconds: undefined,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 1,
          githubToken: "fake-token",
          owner: "org",
          repo: "repo",
          runId: 2,
          workflowName: workflow.name,
          sameBranchOnly: true,
          abortOnNewerRun: false
        };
      });

      it("will continue after a prescribed number of seconds", async () => {
        input.continueAfterSeconds = 1;
        const inProgressRuns = [
          {
            id: 1,
            status: "in_progress",
            html_url: ""
          },
          {
            id: 2,
            status: "in_progress",
            html_url: ""
          }
        ];
        const githubClient = {
          runs: async (
            owner: string,
            repo: string,
            branch: string | undefined,
            workflowId: number
          ) => Promise.resolve(inProgressRuns),
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
          "✋Awaiting run  ...",
          "🤙Exceeded wait seconds. Continuing..."
        ]);
      });

      it("will abort after a prescribed number of seconds", async () => {
        input.abortAfterSeconds = 1;
        const inProgressRuns = [
          {
            id: 1,
            status: "in_progress",
            html_url: ""
          },
          {
            id: 2,
            status: "in_progress",
            html_url: ""
          }
        ];
        const githubClient = {
          runs: async (
            owner: string,
            repo: string,
            branch: string | undefined,
            workflowId: number
          ) => Promise.resolve(inProgressRuns),
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
        await assert.rejects(waiter.wait(), {
          name: "Error",
          message: "Aborted after waiting 1 seconds"
        });
        assert.deepEqual(messages, [
          "✋Awaiting run  ...",
          "🛑Exceeded wait seconds. Aborting..."
        ]);
      });

      it("will return when a run is completed", async () => {
        const run1: Run = {
          id: 1,
          status: "in_progress",
          html_url: "1"
        };
        const run2: Run = {
          id: 2,
          status: "in_progress",
          html_url: ""
        };

        const mockedRunsFunc = jest
          .fn()
          .mockReturnValueOnce(Promise.resolve([run1, run2]))
          .mockReturnValue(Promise.resolve([run2]));
        const githubClient = {
          runs: mockedRunsFunc,
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
        assert.deepEqual(messages, ["✋Awaiting run 1 ..."]);
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
          },
          {
            id: 4,
            status: "in_progress",
            html_url: "4"
          },
          {
            id: 5,
            status: "in_progress",
            html_url: "5"
          }
        ];
        input.runId = 4;

        const mockedRunsFunc = jest.fn();
        mockedRunsFunc
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(0)))
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(1)))
          .mockReturnValueOnce(Promise.resolve(inProgressRuns.slice(2)))
          .mockReturnValue(Promise.resolve(inProgressRuns.slice(3)));

        const githubClient = {
          runs: mockedRunsFunc,
          run: jest.fn(),
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
        assert.deepEqual(messages[messages.length - 1], `✋Awaiting run 3 ...`);
      });

      it("will abort if newer run is available", async () => {
        const previousRun = {
          id: 1,
          status: "in_progress",
          html_url: "url_1"
        };
        const currentRun = {
          id: 2,
          status: "in_progress",
          html_url: "url_2"
        };
        const newerRun = {
          id: 3,
          status: "in_progress",
          html_url: "url_3"
        };
        input.runId = currentRun.id;
        input.abortOnNewerRun = true;

        const mockedRunsFunc = jest.fn();
        mockedRunsFunc
          .mockResolvedValueOnce([previousRun, currentRun])
          .mockResolvedValue([previousRun, currentRun, newerRun]);

        const githubClient = {
          runs: mockedRunsFunc,
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
        await expect(waiter.wait()).rejects.toThrow(
          "Aborted because newer run url_3 was detected."
        );
        expect(messages).toEqual([
          "✋Awaiting run url_1 ...",
          "🛑Newer run url_3 detected. Aborting..."
        ]);
      });

      it("will continue if newer run is available but no previous run", async () => {
        const previousRun = {
          id: 1,
          status: "in_progress",
          html_url: "url_1"
        };
        const currentRun = {
          id: 2,
          status: "in_progress",
          html_url: "url_2"
        };
        const newerRun = {
          id: 3,
          status: "in_progress",
          html_url: "url_3"
        };
        input.runId = currentRun.id;
        input.abortOnNewerRun = true;

        const mockedRunsFunc = jest.fn();
        mockedRunsFunc
          .mockResolvedValueOnce([previousRun, currentRun])
          .mockResolvedValue([currentRun, newerRun]);

        const githubClient = {
          runs: mockedRunsFunc,
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
        expect(messages[messages.length - 1]).toEqual(
          "✋Awaiting run url_1 ..."
        );
      });
    });
  });
});
