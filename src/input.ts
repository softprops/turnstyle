export interface Input {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  workflowName: string;
  runId: number;
  pollIntervalSeconds: number;
  continueAfterSeconds: number | undefined;
  abortAfterSeconds: number | undefined;
  sameBranchOnly: boolean;
  abortOnNewerRun: boolean;
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
  const abortAfterSeconds = env["INPUT_ABORT-AFTER-SECONDS"]
    ? parseInt(env["INPUT_ABORT-AFTER-SECONDS"], 10)
    : undefined;
  if (continueAfterSeconds !== undefined && abortAfterSeconds !== undefined) {
    throw new Error(
      "Only one of continue-after-seconds and abort-after-seconds may be defined"
    );
  }
  const sameBranchOnly =
    env["INPUT_SAME-BRANCH-ONLY"] === "true" || !env["INPUT_SAME-BRANCH-ONLY"]; // true if not specified
  const abortOnNewerRun = env["INPUT_ABORT-ON-NEWER-RUN"] === "true";
  return {
    githubToken,
    owner,
    repo,
    branch,
    workflowName,
    runId,
    pollIntervalSeconds,
    continueAfterSeconds,
    abortAfterSeconds,
    sameBranchOnly,
    abortOnNewerRun: abortOnNewerRun
  };
};
