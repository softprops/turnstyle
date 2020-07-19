export interface Input {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  workflowName: string;
  runId: number;
  pollIntervalSeconds: number;
  continueAfterSeconds: number | undefined;
  sameBranchOnly: boolean;
  waitForJob: string | undefined;
}

export const parseInput = (env: Record<string, string | undefined>): Input => {
  const githubToken = env.GITHUB_TOKEN || "";
  const [owner, repo] = (env.GITHUB_REPOSITORY || "").split("/");
  const workflowName = env.GITHUB_WORKFLOW || "";
  const branch =
    env.GITHUB_HEAD_REF || env.GITHUB_REF?.substring(11) || "master";
  const runId = parseInt(env.GITHUB_RUN_ID || "0", 10);
  const pollIntervalSeconds = env["INPUT_POLL-INTERVAL-SECONDS"]
    ? parseInt(env["INPUT_POLL-INTERVAL-SECONDS"], 10)
    : 60;
  const continueAfterSeconds = env["INPUT_CONTINUE-AFTER-SECONDS"]
    ? parseInt(env["INPUT_CONTINUE-AFTER-SECONDS"], 10)
    : undefined;
  const sameBranchOnly =
    env["INPUT_SAME-BRANCH-ONLY"] === "true" ||
    env["INPUT_SAME-BRANCH-ONLY"] === undefined; // true if not specified
  const waitForJob = env["INPUT_WAIT-FOR-JOB"];
  return {
    githubToken,
    owner,
    repo,
    branch,
    workflowName,
    runId,
    pollIntervalSeconds,
    continueAfterSeconds,
    sameBranchOnly,
    waitForJob
  };
};
