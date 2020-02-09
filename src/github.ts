import { Octokit } from "@octokit/rest";

export interface Workflow {
  id: string;
  name: string;
}

export interface Run {
  id: string;
  status: string;
}

export interface GitHub {
  workflows: (owner: string, repo: string) => Promise<Array<Workflow>>;
  runs: (
    owner: string,
    repo: string,
    branch: string,
    workflow_id: number
  ) => Promise<Array<Run>>;
}

export class OctokitGitHub implements GitHub {
  private readonly octokit: Octokit;
  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  workflows = async (owner: string, repo: string) =>
    this.octokit.paginate(
      this.octokit.actions.listRepoWorkflows.endpoint.merge({
        owner,
        repo
      })
    );

  runs = async (
    owner: string,
    repo: string,
    branch: string | undefined,
    workflow_id: number
  ) =>
    this.octokit.paginate(
      this.octokit.actions.listWorkflowRuns.endpoint.merge({
        owner,
        repo,
        branch,
        workflow_id,
        status: "in_progress"
      })
    );
}
