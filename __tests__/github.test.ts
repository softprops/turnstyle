import { describe, expect, it, vi } from 'vitest';

import { OctokitGitHub, WorkflowRun } from '../src/github';

const run = (overrides: Partial<WorkflowRun>): WorkflowRun =>
  ({
    id: 1,
    status: 'completed',
    conclusion: 'success',
    head_branch: 'master',
    display_title: 'default-title',
    name: 'default-name',
    html_url: 'https://example.com/run',
    created_at: '2026-05-03T10:00:00Z',
    run_started_at: '2026-05-03T10:00:00Z',
    ...overrides,
  }) as WorkflowRun;

type WorkflowRunPages = WorkflowRun[][];

const clientWithRunPages = (...pagesByCall: WorkflowRunPages[]) => {
  const client = new OctokitGitHub('fake-token');
  let paginateCalls = 0;
  let pagesScanned = 0;
  const paginate = vi.fn(async (_endpoint, _options, mapFunction) => {
    const pages = pagesByCall[paginateCalls] || [];
    paginateCalls += 1;
    const results: WorkflowRun[] = [];
    let doneCalled = false;
    const done = () => {
      doneCalled = true;
    };

    for (const page of pages) {
      pagesScanned += 1;
      results.push(...mapFunction({ data: page }, done));
      if (doneCalled) {
        break;
      }
    }

    return results;
  });

  (client as any).octokit = {
    actions: {
      listWorkflowRuns: vi.fn(),
    },
    paginate,
  };

  return { client, paginate, pagesScanned: () => pagesScanned };
};

describe('github', () => {
  describe('runs', () => {
    it('does not stop pagination after newer completed runs', async () => {
      const completedPages = Array.from({ length: 5 }, (_, pageIndex) =>
        Array.from({ length: 100 }, (_, runIndex) =>
          run({
            id: pageIndex * 100 + runIndex + 1,
            status: 'completed',
            conclusion: 'success',
          }),
        ),
      );
      const activeRun = run({
        id: 501,
        status: 'queued',
        conclusion: null,
        head_branch: 'master',
      });
      const { client, paginate } = clientWithRunPages([...completedPages, [activeRun]]);

      await expect(client.runs('org', 'repo', 123, { branch: 'master' })).resolves.toEqual([
        activeRun,
      ]);
    });

    it('does not stop pagination after newer active runs outside the queue', async () => {
      const otherQueuePages = Array.from({ length: 5 }, (_, pageIndex) =>
        Array.from({ length: 100 }, (_, runIndex) =>
          run({
            id: pageIndex * 100 + runIndex + 1,
            status: 'in_progress',
            conclusion: null,
            display_title: 'other-queue',
            name: 'other-queue',
          }),
        ),
      );
      const queuedRun = run({
        id: 501,
        status: 'in_progress',
        conclusion: null,
        display_title: 'deploy-api',
        name: 'deploy-api',
      });
      const { client } = clientWithRunPages([...otherQueuePages, [queuedRun]]);

      await expect(
        client.runs('org', 'repo', 123, { branch: 'master', queueName: 'deploy-api' }),
      ).resolves.toEqual([queuedRun]);
    });

    it('excludes active runs with unknown branches from branch-filtered results', async () => {
      const unknownBranchRun = run({
        id: 1,
        status: 'queued',
        conclusion: null,
        head_branch: null,
      });
      const masterRun = run({
        id: 2,
        status: 'queued',
        conclusion: null,
        head_branch: 'master',
      });
      const { client } = clientWithRunPages([[unknownBranchRun, masterRun]], [], [], []);

      await expect(client.runs('org', 'repo', 123, { branch: 'master' })).resolves.toEqual([
        masterRun,
      ]);
    });

    it('splits branch discovery into unfiltered and active branch queries', async () => {
      const activeRun = run({
        id: 1,
        status: 'queued',
        conclusion: null,
        head_branch: 'master',
      });
      const { client, paginate } = clientWithRunPages([], [], [[activeRun]], []);

      await expect(client.runs('org', 'repo', 123, { branch: 'master' })).resolves.toEqual([
        activeRun,
      ]);
      expect(paginate.mock.calls[0][1]).not.toHaveProperty('branch');
      expect(paginate.mock.calls[0][1]).not.toHaveProperty('status');
      expect(paginate.mock.calls.slice(1).map(([, options]) => options)).toEqual([
        expect.objectContaining({ branch: 'master', status: 'in_progress' }),
        expect.objectContaining({ branch: 'master', status: 'queued' }),
        expect.objectContaining({ branch: 'master', status: 'waiting' }),
      ]);
    });

    it('finds branch active runs after the unfiltered page cap', async () => {
      const completedPages = Array.from({ length: 50 }, (_, pageIndex) =>
        Array.from({ length: 100 }, (_, runIndex) =>
          run({
            id: pageIndex * 100 + runIndex + 1,
            status: 'completed',
            conclusion: 'success',
            head_branch: 'feature',
          }),
        ),
      );
      const activeRun = run({
        id: 5001,
        status: 'queued',
        conclusion: null,
        head_branch: 'master',
      });
      const { client } = clientWithRunPages(completedPages, [], [[activeRun]], []);

      await expect(client.runs('org', 'repo', 123, { branch: 'master' })).resolves.toEqual([
        activeRun,
      ]);
    });

    it('keeps active status queries when no branch filter is provided', async () => {
      const activeRun = run({
        id: 1,
        status: 'queued',
        conclusion: null,
        head_branch: 'feature',
      });
      const { client, paginate } = clientWithRunPages([], [], [[activeRun]], []);

      await expect(client.runs('org', 'repo', 123)).resolves.toEqual([activeRun]);
      const statusOptions = paginate.mock.calls.slice(1).map(([, options]) => options);
      expect(statusOptions.map((options) => options.status)).toEqual([
        'in_progress',
        'queued',
        'waiting',
      ]);
      for (const options of statusOptions) {
        expect(options).not.toHaveProperty('branch');
      }
    });

    it('does not cap discovered active runs before predecessor filtering', async () => {
      const newerActivePages = Array.from({ length: 5 }, (_, pageIndex) =>
        Array.from({ length: 100 }, (_, runIndex) =>
          run({
            id: pageIndex * 100 + runIndex + 1,
            status: 'queued',
            conclusion: null,
          }),
        ),
      );
      const olderActiveRun = run({
        id: 501,
        status: 'queued',
        conclusion: null,
      });
      const { client } = clientWithRunPages([...newerActivePages, [olderActiveRun]], [], [], []);

      const runs = await client.runs('org', 'repo', 123);

      expect(runs).toHaveLength(501);
      expect(runs).toContain(olderActiveRun);
    });

    it('stops pagination when no eligible active runs are found', async () => {
      const completedPages = Array.from({ length: 51 }, (_, pageIndex) =>
        Array.from({ length: 100 }, (_, runIndex) =>
          run({
            id: pageIndex * 100 + runIndex + 1,
            status: 'completed',
            conclusion: 'success',
          }),
        ),
      );
      const { client, pagesScanned } = clientWithRunPages(completedPages, [], [], []);

      await expect(client.runs('org', 'repo', 123, { branch: 'master' })).resolves.toEqual([]);
      expect(pagesScanned()).toBe(50);
    });
  });
});
