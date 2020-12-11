import * as assert from "assert";
import { parseInput } from "../src/input";

describe("input", () => {
  describe("parseInput", () => {
    it("parses config from env with custom inputs", () => {
      assert.deepEqual(
        parseInput({
          GITHUB_TOKEN: "s3cr3t",
          GITHUB_REF: "refs/heads/foo",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1",
          "INPUT_CONTINUE-AFTER-SECONDS": "10",
          "INPUT_POLL-INTERVAL-SECONDS": "5",
          "INPUT_SAME-BRANCH-ONLY": "false",
          "INPUT_INITIAL-WAIT-SECONDS": "5"
        }),
        {
          githubToken: "s3cr3t",
          owner: "softprops",
          repo: "turnstyle",
          branch: "foo",
          workflowName: "test",
          runId: 1,
          continueAfterSeconds: 10,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 5,
          sameBranchOnly: false,
          initialWaitSeconds: 5
        }
      );
    });

    it("parses config from env with abortAfterSeconds", () => {
      assert.deepEqual(
        parseInput({
          GITHUB_TOKEN: "s3cr3t",
          GITHUB_REF: "refs/heads/foo",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1",
          "INPUT_ABORT-AFTER-SECONDS": "10",
          "INPUT_POLL-INTERVAL-SECONDS": "5",
          "INPUT_SAME-BRANCH-ONLY": "false",
          "INPUT_INITIAL-WAIT-SECONDS": "0"
        }),
        {
          githubToken: "s3cr3t",
          owner: "softprops",
          repo: "turnstyle",
          branch: "foo",
          workflowName: "test",
          runId: 1,
          continueAfterSeconds: undefined,
          abortAfterSeconds: 10,
          pollIntervalSeconds: 5,
          sameBranchOnly: false,
          initialWaitSeconds: 0
        }
      );
    });

    it("rejects env with continueAfterSeconds and abortAfterSeconds", () => {
      assert.throws(() =>
        parseInput({
          GITHUB_TOKEN: "s3cr3t",
          GITHUB_REF: "refs/heads/foo",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1",
          "INPUT_CONTINUE-AFTER-SECONDS": "10",
          "INPUT_ABORT-AFTER-SECONDS": "2"
        })
      );
    });

    it("parses config from env with defaults", () => {
      assert.deepEqual(
        parseInput({
          GITHUB_TOKEN: "s3cr3t",
          GITHUB_REF: "refs/heads/foo",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1",
          "INPUT_CONTINUE-AFTER-SECONDS": "",
          "INPUT_POLL-INTERVAL-SECONDS": "",
          "INPUT_SAME-BRANCH-ONLY": "",
          "INPUT_INITIAL-WAIT-SECONDS": ""
        }),
        {
          githubToken: "s3cr3t",
          owner: "softprops",
          repo: "turnstyle",
          branch: "foo",
          workflowName: "test",
          runId: 1,
          continueAfterSeconds: undefined,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 60,
          sameBranchOnly: true,
          initialWaitSeconds: 0
        }
      );
    });

    it("favours GITHUB_HEAD_REF when present (pull requests)", () => {
      assert.deepEqual(
        parseInput({
          GITHUB_TOKEN: "s3cr3t",
          GITHUB_HEAD_REF: "pr-branch-name",
          GITHUB_REF: "refs/heads/foo",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1"
        }),
        {
          githubToken: "s3cr3t",
          owner: "softprops",
          repo: "turnstyle",
          branch: "pr-branch-name",
          workflowName: "test",
          runId: 1,
          continueAfterSeconds: undefined,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 60,
          sameBranchOnly: true,
          initialWaitSeconds: 0
        }
      );
    });
  });
});
