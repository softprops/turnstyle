import { debug, info, setFailed, setOutput } from '@actions/core';
import { env } from 'process';
import { ActionDeadline, DeadlineReached, handleDeadline } from './deadline';
import { OctokitGitHub, type GitHubRequestOptions } from './github';
import { parseInput, type Input } from './input';
import { Waiter, type Wait, type WaiterGitHubClient } from './wait';
import { findWorkflowId, type Workflow } from './workflow';

export interface ActionGitHubClient extends WaiterGitHubClient {
  workflows(
    owner: string,
    repo: string,
    requestOptions?: GitHubRequestOptions,
  ): Promise<Workflow[]>;
}

export type GitHubClientFactory = (githubToken: string, retries: number) => ActionGitHubClient;
export type WaiterFactory = (
  workflowId: number,
  github: WaiterGitHubClient,
  input: Input,
  deadline: ActionDeadline,
) => Wait;
export type DeadlineFactory = (input: Input) => ActionDeadline;

const createGitHubClient: GitHubClientFactory = (githubToken, retries) =>
  new OctokitGitHub(githubToken, retries);
const createWaiter: WaiterFactory = (workflowId, github, input, deadline) =>
  new Waiter(workflowId, github, input, info, debug, undefined, deadline);
const createDeadline: DeadlineFactory = (input) => ActionDeadline.fromInput(input);
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function run(
  environment: Record<string, string | undefined> = env,
  githubFactory: GitHubClientFactory = createGitHubClient,
  waiterFactory: WaiterFactory = createWaiter,
  deadlineFactory: DeadlineFactory = createDeadline,
) {
  let deadline: ActionDeadline | undefined;
  try {
    const input = parseInput(environment);
    const actionDeadline = deadlineFactory(input);
    deadline = actionDeadline;
    debug(
      `Parsed inputs (w/o token): ${(({ githubToken, ...inputs }) => JSON.stringify(inputs))(
        input,
      )}`,
    );
    actionDeadline.throwIfReached();
    const github = githubFactory(input.githubToken, input.retries);
    debug(`Fetching workflows for ${input.owner}/${input.repo}...`);
    const workflows = await actionDeadline.race((signal) =>
      github.workflows(input.owner, input.repo, {
        signal,
        checkDeadline: actionDeadline.throwIfReached,
      }),
    );
    debug(`Found ${workflows.length} workflows in ${input.owner}/${input.repo}`);
    actionDeadline.throwIfReached();
    const workflowId = findWorkflowId(workflows, input);
    if (workflowId !== undefined) {
      const result = await waiterFactory(workflowId, github, input, actionDeadline).wait();
      if (result === undefined) {
        actionDeadline.throwIfReached();
      }
    } else {
      actionDeadline.throwIfReached();
      setFailed(
        `No workflow found matching workflow path or name: ${input.workflowPath || input.workflowName}`,
      );
    }
  } catch (error: unknown) {
    if (error instanceof DeadlineReached) {
      try {
        handleDeadline(error, info, () => {
          setOutput('previous_run_id', '');
          setOutput('previous_run_url', '');
        });
      } catch (deadlineError: unknown) {
        setFailed(errorMessage(deadlineError));
      }
    } else {
      deadline?.cancel(error);
      setFailed(errorMessage(error));
    }
  } finally {
    deadline?.dispose();
  }
}

if (require.main === module) {
  run();
}
