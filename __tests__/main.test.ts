import { debug, setFailed } from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  run,
  type ActionGitHubClient,
  type GitHubClientFactory,
  type WaiterFactory,
} from '../src/main';

vi.mock('@actions/core', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
}));

const environment = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  GITHUB_REF: 'refs/heads/master',
  GITHUB_REPOSITORY: 'softprops/turnstyle',
  GITHUB_WORKFLOW: 'CI',
  GITHUB_RUN_ID: '42',
  INPUT_TOKEN: 'secret',
  INPUT_RETRIES: '2',
  ...overrides,
});

const actionClient = (overrides: Partial<ActionGitHubClient> = {}): ActionGitHubClient => ({
  workflows: async () => [],
  run: async () => {
    throw new Error('current run unavailable');
  },
  runs: async () => [],
  activeRunsForRepo: async () => [],
  jobs: async () => [],
  steps: async () => [],
  ...overrides,
});

describe('main', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads workflows and waits for the matching workflow', async () => {
    const workflows = vi.fn().mockResolvedValue([{ id: 123, name: 'CI' }]);
    const github = actionClient({ workflows });
    const githubFactory: GitHubClientFactory = vi.fn(() => github);
    const wait = vi.fn().mockResolvedValue(undefined);
    const waiterFactory: WaiterFactory = vi.fn(() => ({ wait }));

    await run(environment(), githubFactory, waiterFactory);

    expect(githubFactory).toHaveBeenCalledWith('secret', 2);
    expect(workflows).toHaveBeenCalledWith('softprops', 'turnstyle');
    expect(waiterFactory).toHaveBeenCalledWith(
      123,
      github,
      expect.objectContaining({
        owner: 'softprops',
        repo: 'turnstyle',
        workflowName: 'CI',
        runId: 42,
        retries: 2,
      }),
    );
    expect(wait).toHaveBeenCalledOnce();
    expect(setFailed).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith('Found 1 workflows in softprops/turnstyle');
  });

  it('reports a missing workflow without starting a waiter', async () => {
    const github = actionClient({ workflows: async () => [{ id: 1, name: 'Other' }] });
    const githubFactory: GitHubClientFactory = () => github;
    const waiterFactory: WaiterFactory = vi.fn();

    await run(environment(), githubFactory, waiterFactory);

    expect(setFailed).toHaveBeenCalledWith('No workflow found matching workflow path or name: CI');
    expect(waiterFactory).not.toHaveBeenCalled();
  });

  it('reports input parsing failures', async () => {
    const githubFactory: GitHubClientFactory = vi.fn();
    const waiterFactory: WaiterFactory = vi.fn();

    await run(
      environment({ 'INPUT_STEP-TO-WAIT-FOR': 'deploy', 'INPUT_JOB-TO-WAIT-FOR': undefined }),
      githubFactory,
      waiterFactory,
    );

    expect(setFailed).toHaveBeenCalledWith(
      'step-to-wait-for requires job-to-wait-for to be defined',
    );
    expect(githubFactory).not.toHaveBeenCalled();
    expect(waiterFactory).not.toHaveBeenCalled();
  });

  it('reports GitHub API failures', async () => {
    const github = actionClient({
      workflows: async () => {
        throw new Error('API unavailable');
      },
    });

    await run(environment(), () => github, vi.fn());

    expect(setFailed).toHaveBeenCalledWith('API unavailable');
  });

  it.each([
    ['an Error', new Error('wait failed'), 'wait failed'],
    ['a non-Error value', 'wait failed', 'wait failed'],
  ])('reports waiter rejection from %s', async (_description, rejection, expectedMessage) => {
    const github = actionClient({ workflows: async () => [{ id: 123, name: 'CI' }] });
    const waiterFactory: WaiterFactory = () => ({
      wait: vi.fn().mockRejectedValue(rejection),
    });

    await run(environment(), () => github, waiterFactory);

    expect(setFailed).toHaveBeenCalledWith(expectedMessage);
  });
});
