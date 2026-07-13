import { debug, info, setFailed } from '@actions/core';
import { env } from 'process';
import { OctokitGitHub } from './github';
import { parseInput, type Input } from './input';
import { Waiter, type Wait, type WaiterGitHubClient } from './wait';
import { findWorkflowId, type Workflow } from './workflow';

export interface ActionGitHubClient extends WaiterGitHubClient {
  workflows(owner: string, repo: string): Promise<Workflow[]>;
}

export type GitHubClientFactory = (githubToken: string, retries: number) => ActionGitHubClient;
export type WaiterFactory = (workflowId: number, github: WaiterGitHubClient, input: Input) => Wait;

const createGitHubClient: GitHubClientFactory = (githubToken, retries) =>
  new OctokitGitHub(githubToken, retries);
const createWaiter: WaiterFactory = (workflowId, github, input) =>
  new Waiter(workflowId, github, input, info, debug);
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function run(
  environment: Record<string, string | undefined> = env,
  githubFactory: GitHubClientFactory = createGitHubClient,
  waiterFactory: WaiterFactory = createWaiter,
) {
  try {
    const input = parseInput(environment);
    debug(
      `Parsed inputs (w/o token): ${(({ githubToken, ...inputs }) => JSON.stringify(inputs))(
        input,
      )}`,
    );
    const github = githubFactory(input.githubToken, input.retries);
    debug(`Fetching workflows for ${input.owner}/${input.repo}...`);
    const workflows = await github.workflows(input.owner, input.repo);
    debug(`Found ${workflows.length} workflows in ${input.owner}/${input.repo}`);
    const workflowId = findWorkflowId(workflows, input);
    if (workflowId !== undefined) {
      await waiterFactory(workflowId, github, input).wait();
    } else {
      setFailed(
        `No workflow found matching workflow path or name: ${input.workflowPath || input.workflowName}`,
      );
    }
  } catch (error: unknown) {
    setFailed(errorMessage(error));
  }
}

if (require.main === module) {
  run();
}
