import * as assert from "assert";
import { parseConfig } from "../src/main";

describe("main", () => {
  describe("parseConfig", () => {
    it("parses config from env", () => {
      assert.deepEqual(
        parseConfig({
          GITHUB_TOKEN: "s3cr3t",
          GITHUB_REF: "refs/heads/master",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1"
        }),
        {
          githubToken: "s3cr3t",
          owner: "softprops",
          repo: "turnstyle",
          branch: "refs/heads/master",
          workflowName: "test",
          runId: 1
        }
      );
    });
  });
});
