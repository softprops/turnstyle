import { setOutput } from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowRun } from '../../src/github';
import type { Input } from '../../src/input';
import { Waiter, type WaiterGitHubClient } from '../../src/wait';

vi.mock('@actions/core', () => ({
  setOutput: vi.fn(),
}));

const input = (overrides: Partial<Input> = {}): Input => ({
  githubToken: 'fake-token',
  owner: 'org',
  repo: 'repo',
  branch: 'master',
  workflowName: 'CI',
  workflowPath: undefined,
  runId: 2,
  runAttempt: 1,
  pollIntervalSeconds: 0,
  continueAfterSeconds: undefined,
  abortAfterSeconds: undefined,
  sameBranchOnly: false,
  jobToWaitFor: undefined,
  stepToWaitFor: undefined,
  initialWaitSeconds: 0,
  queueName: undefined,
  retries: 0,
  ...overrides,
});

const workflowRun = (overrides: Partial<WorkflowRun> = {}): WorkflowRun =>
  ({
    id: 1,
    run_attempt: 1,
    status: 'in_progress',
    conclusion: null,
    head_branch: 'master',
    html_url: 'https://example.com/runs/1',
    created_at: '2026-07-15T10:00:00Z',
    run_started_at: '2026-07-15T10:00:00Z',
    ...overrides,
  }) as WorkflowRun;

const client = (overrides: Partial<WaiterGitHubClient>): WaiterGitHubClient => ({
  run: async () => {
    throw new Error('current run unavailable');
  },
  runs: async () => [],
  activeRunsForRepo: async () => [],
  jobs: async () => [],
  steps: async () => [],
  ...overrides,
});

describe('predecessor selection edge cases', () => {
  beforeEach(() => {
    vi.mocked(setOutput).mockClear();
  });

  it('does not block on active status metadata with a successful conclusion', async () => {
    const successfulRun = workflowRun({ conclusion: 'success' });
    const debugMessages: string[] = [];
    const waiter = new Waiter(
      123,
      client({ runs: vi.fn().mockResolvedValue([successfulRun]) }),
      input(),
      vi.fn(),
      (message) => debugMessages.push(message),
    );

    await waiter.wait();

    expect(debugMessages).toContain('Skipping run 1, status: in_progress, conclusion: success');
    expect(setOutput).toHaveBeenCalledWith('previous_run_id', '');
  });

  it.each([
    [
      'a rerun missing its actual start time',
      input({ runId: 2, runAttempt: 1 }),
      workflowRun({ id: 2, run_attempt: 1 }),
      workflowRun({ id: 1, run_attempt: 2, run_started_at: undefined }),
    ],
    [
      'a higher-ID first attempt missing all timestamps before a current rerun',
      input({ runId: 1, runAttempt: 2 }),
      workflowRun({ id: 1, run_attempt: 2 }),
      workflowRun({ id: 2, run_attempt: 1, run_started_at: undefined, created_at: undefined }),
    ],
  ])('conservatively ignores %s', async (_description, waiterInput, currentRun, candidate) => {
    const infoMessages: string[] = [];
    const waiter = new Waiter(
      123,
      client({
        run: vi.fn().mockResolvedValue(currentRun),
        runs: vi.fn().mockResolvedValue([candidate]),
      }),
      waiterInput,
      (message) => infoMessages.push(message),
      vi.fn(),
    );

    await waiter.wait();

    expect(infoMessages).toEqual([]);
    expect(setOutput).toHaveBeenCalledWith('previous_run_id', '');
  });
});
