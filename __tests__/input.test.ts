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
          "INPUT_SAME-BRANCH-ONLY": "false"
        }),
        {
          githubToken: "s3cr3t",
          owner: "softprops",
          repo: "turnstyle",
          branch: "foo",
          workflowName: "test",
          runId: 1,
          continueAfterSeconds: 10,
          pollIntervalSeconds: 5,
          sameBranchOnly: false
        }
      );
    });

    it("parses config from env with defaults", () => {
      assert.deepEqual(
        parseInput({
          GITHUB_TOKEN: "s3cr3t",
          GITHUB_REF: "refs/heads/foo",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1"
        }),
        {
          githubToken: "s3cr3t",
          owner: "softprops",
          repo: "turnstyle",
          branch: "foo",
          workflowName: "test",
          runId: 1,
          continueAfterSeconds: undefined,
          pollIntervalSeconds: 60,
          sameBranchOnly: true
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
          pollIntervalSeconds: 60
        }
      );
    });
  });
});
