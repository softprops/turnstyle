import { parseInput } from '../src/input';

import { assert, describe, it } from 'vitest';

describe('input', () => {
  describe('parseInput', () => {
    it('parses config from env with custom inputs', () => {
      assert.deepEqual(
        parseInput({
          GITHUB_REF: "refs/heads/foo",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1",
          INPUT_TOKEN: "s3cr3t",
          "INPUT_CONTINUE-AFTER-SECONDS": "10",
          "INPUT_POLL-INTERVAL-SECONDS": "5",
          "INPUT_SAME-BRANCH-ONLY": "false",
          "INPUT_INITIAL-WAIT-SECONDS": "5",
          "INPUT_EXPONENTIAL-BACKOFF-RETRIES": "true",
          'INPUT_JOB-TO-WAIT-FOR': 'job-name',
          'INPUT_STEP-TO-WAIT-FOR': 'step-name',
        }),
        {
          githubToken: 's3cr3t',
          owner: 'softprops',
          repo: 'turnstyle',
          branch: 'foo',
          workflowName: 'test',
          runId: 1,
          continueAfterSeconds: 10,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 5,
          sameBranchOnly: false,
          jobToWaitFor: 'job-name',
          stepToWaitFor: 'step-name',
          initialWaitSeconds: 5,
          exponentialBackoffRetries: true,
          queueName: undefined,
        },
      );
    });

    it('parses config from env with abortAfterSeconds', () => {
      assert.deepEqual(
        parseInput({
          GITHUB_REF: "refs/heads/foo",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1",
          INPUT_TOKEN: "s3cr3t",
          "INPUT_ABORT-AFTER-SECONDS": "10",
          "INPUT_POLL-INTERVAL-SECONDS": "5",
          "INPUT_SAME-BRANCH-ONLY": "false",
          "INPUT_INITIAL-WAIT-SECONDS": "0",
          "INPUT_EXPONENTIAL-BACKOFF-RETRIES": "false",
        }),
        {
          githubToken: 's3cr3t',
          owner: 'softprops',
          repo: 'turnstyle',
          branch: 'foo',
          workflowName: 'test',
          runId: 1,
          continueAfterSeconds: undefined,
          abortAfterSeconds: 10,
          pollIntervalSeconds: 5,
          sameBranchOnly: false,
          jobToWaitFor: undefined,
          stepToWaitFor: undefined,
          initialWaitSeconds: 0,
          exponentialBackoffRetries: false,
          queueName: undefined,
        },
      );
    });

    it('rejects env with continueAfterSeconds and abortAfterSeconds', () => {
      assert.throws(() =>
        parseInput({
          GITHUB_REF: "refs/heads/foo",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1",
          INPUT_TOKEN: "s3cr3t",
          "INPUT_CONTINUE-AFTER-SECONDS": "10",
          "INPUT_ABORT-AFTER-SECONDS": "2",
          "INPUT_EXPONENTIAL-BACKOFF-RETRIES": "false",
          queueName: undefined,
        }),
      );
    });

    it('rejects env with stepToWaitFor but no jobToWaitFor', () => {
      assert.throws(() =>
        parseInput({
          GITHUB_REF: 'refs/heads/foo',
          GITHUB_REPOSITORY: 'softprops/turnstyle',
          GITHUB_WORKFLOW: 'test',
          GITHUB_RUN_ID: '1',
          INPUT_TOKEN: 's3cr3t',
          'INPUT_STEP-TO-WAIT-FOR': 'step-name',
        }),
      );
    });

    it('parses config from env with defaults', () => {
      assert.deepEqual(
        parseInput({
          GITHUB_REF: "refs/heads/foo",
          GITHUB_REPOSITORY: "softprops/turnstyle",
          GITHUB_WORKFLOW: "test",
          GITHUB_RUN_ID: "1",
          INPUT_TOKEN: "s3cr3t",
          "INPUT_CONTINUE-AFTER-SECONDS": "",
          "INPUT_POLL-INTERVAL-SECONDS": "",
          "INPUT_SAME-BRANCH-ONLY": "",
          "INPUT_INITIAL-WAIT-SECONDS": "",
          "INPUT_EXPONENTIAL-BACKOFF-RETRIES": "",
          'INPUT_JOB-TO-WAIT-FOR': '',
          'INPUT_STEP-TO-WAIT-FOR': '',
        }),
        {
          githubToken: 's3cr3t',
          owner: 'softprops',
          repo: 'turnstyle',
          branch: 'foo',
          workflowName: 'test',
          runId: 1,
          continueAfterSeconds: undefined,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 60,
          sameBranchOnly: true,
          jobToWaitFor: '',
          stepToWaitFor: '',
          initialWaitSeconds: 0,
          exponentialBackoffRetries: false,
          queueName: undefined,
        },
      );
    });

    it('favours GITHUB_HEAD_REF when present (pull requests)', () => {
      assert.deepEqual(
        parseInput({
          GITHUB_HEAD_REF: 'pr-branch-name',
          GITHUB_REF: 'refs/heads/foo',
          GITHUB_REPOSITORY: 'softprops/turnstyle',
          GITHUB_WORKFLOW: 'test',
          GITHUB_RUN_ID: '1',
          INPUT_TOKEN: 's3cr3t',
        }),
        {
          githubToken: 's3cr3t',
          owner: 'softprops',
          repo: 'turnstyle',
          branch: 'pr-branch-name',
          workflowName: 'test',
          runId: 1,
          continueAfterSeconds: undefined,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 60,
          sameBranchOnly: true,
          jobToWaitFor: undefined,
          stepToWaitFor: undefined,
          initialWaitSeconds: 0,
          exponentialBackoffRetries: false,
          queueName: undefined,
        },
      );
    });

    it('parses config from env with queueName', () => {
      assert.deepEqual(
        parseInput({
          GITHUB_REF: 'refs/heads/foo',
          GITHUB_REPOSITORY: 'softprops/turnstyle',
          GITHUB_WORKFLOW: 'test',
          GITHUB_RUN_ID: '1',
          INPUT_TOKEN: 's3cr3t',
          'INPUT_CONTINUE-AFTER-SECONDS': '10',
          'INPUT_POLL-INTERVAL-SECONDS': '5',
          'INPUT_SAME-BRANCH-ONLY': 'false',
          'INPUT_INITIAL-WAIT-SECONDS': '5',
          'INPUT_JOB-TO-WAIT-FOR': 'job-name',
          'INPUT_STEP-TO-WAIT-FOR': 'step-name',
          'INPUT_QUEUE-NAME': 'queue-name',
        }),
        {
          githubToken: 's3cr3t',
          owner: 'softprops',
          repo: 'turnstyle',
          branch: 'foo',
          workflowName: 'test',
          runId: 1,
          continueAfterSeconds: 10,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 5,
          sameBranchOnly: false,
          jobToWaitFor: 'job-name',
          stepToWaitFor: 'step-name',
          initialWaitSeconds: 5,
          exponentialBackoffRetries: false,
          queueName: 'queue-name',
        },
      );
    });
  });
});
