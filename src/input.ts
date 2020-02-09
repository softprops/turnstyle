export interface Input {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  workflowName: string;
  runId: number;
}

export const parseInput = (env: Record<string, string | undefined>): Input => {
  const githubToken = env.GITHUB_TOKEN || "";
  const [owner, repo] = (env.GITHUB_REPOSITORY || "").split("/");
  const workflowName = env.GITHUB_WORKFLOW || "";
  const branch = env.GITHUB_REF?.substring(11) || "master";
  const runId = parseInt(env.GITHUB_RUN_ID || "0", 10);
  return {
    githubToken,
    owner,
    repo,
    branch,
    workflowName,
    runId
  };
};
