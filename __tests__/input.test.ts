import * as assert from "assert";
import { parseInput } from "../src/input";

describe("input", () => {
  describe("parseInput", () => {
    it("parses config from env", () => {
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
          runId: 1
        }
      );
    });
  });
});
