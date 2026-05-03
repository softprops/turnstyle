import { parseInput } from '../src/input';

import { assert, describe, it } from 'vitest';

describe('input', () => {
  describe('parseInput', () => {
    it('parses config from env with custom inputs', () => {
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
        }),
        {
          githubToken: 's3cr3t',
          owner: 'softprops',
          repo: 'turnstyle',
          branch: 'foo',
          workflowName: 'test',
          workflowPath: undefined,
          runId: 1,
          runAttempt: 1,
          continueAfterSeconds: 10,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 5,
          sameBranchOnly: false,
          jobToWaitFor: 'job-name',
          stepToWaitFor: 'step-name',
          initialWaitSeconds: 5,
          queueName: undefined,
        },
      );
    });

    it('parses config from env with abortAfterSeconds', () => {
      assert.deepEqual(
        parseInput({
          GITHUB_REF: 'refs/heads/foo',
          GITHUB_REPOSITORY: 'softprops/turnstyle',
          GITHUB_WORKFLOW: 'test',
          GITHUB_RUN_ID: '1',
          INPUT_TOKEN: 's3cr3t',
          'INPUT_ABORT-AFTER-SECONDS': '10',
          'INPUT_POLL-INTERVAL-SECONDS': '5',
          'INPUT_SAME-BRANCH-ONLY': 'false',
          'INPUT_INITIAL-WAIT-SECONDS': '0',
        }),
        {
          githubToken: 's3cr3t',
          owner: 'softprops',
          repo: 'turnstyle',
          branch: 'foo',
          workflowName: 'test',
          workflowPath: undefined,
          runId: 1,
          runAttempt: 1,
          continueAfterSeconds: undefined,
          abortAfterSeconds: 10,
          pollIntervalSeconds: 5,
          sameBranchOnly: false,
          jobToWaitFor: undefined,
          stepToWaitFor: undefined,
          initialWaitSeconds: 0,
          queueName: undefined,
        },
      );
    });

    it('rejects env with continueAfterSeconds and abortAfterSeconds', () => {
      assert.throws(() =>
        parseInput({
          GITHUB_REF: 'refs/heads/foo',
          GITHUB_REPOSITORY: 'softprops/turnstyle',
          GITHUB_WORKFLOW: 'test',
          GITHUB_RUN_ID: '1',
          INPUT_TOKEN: 's3cr3t',
          'INPUT_CONTINUE-AFTER-SECONDS': '10',
          'INPUT_ABORT-AFTER-SECONDS': '2',
          queueName: undefined,
        }),
      );
    });

    it('parses zero second timeout inputs', () => {
      const baseEnv = {
        GITHUB_REF: 'refs/heads/foo',
        GITHUB_REPOSITORY: 'softprops/turnstyle',
        GITHUB_WORKFLOW: 'test',
        GITHUB_RUN_ID: '1',
        INPUT_TOKEN: 's3cr3t',
      };

      assert.equal(
        parseInput({
          ...baseEnv,
          'INPUT_CONTINUE-AFTER-SECONDS': '0',
        }).continueAfterSeconds,
        0,
      );
      assert.equal(
        parseInput({
          ...baseEnv,
          'INPUT_ABORT-AFTER-SECONDS': '0',
        }).abortAfterSeconds,
        0,
      );
    });

    it('rejects invalid seconds inputs', () => {
      const baseEnv = {
        GITHUB_REF: 'refs/heads/foo',
        GITHUB_REPOSITORY: 'softprops/turnstyle',
        GITHUB_WORKFLOW: 'test',
        GITHUB_RUN_ID: '1',
        INPUT_TOKEN: 's3cr3t',
      };

      const invalidInputs: Array<[string, string, RegExp]> = [
        ['INPUT_CONTINUE-AFTER-SECONDS', '-1', /continue-after-seconds/],
        ['INPUT_ABORT-AFTER-SECONDS', '1.5', /abort-after-seconds/],
        ['INPUT_INITIAL-WAIT-SECONDS', 'abc', /initial-wait-seconds/],
        ['INPUT_POLL-INTERVAL-SECONDS', '0', /poll-interval-seconds/],
        ['INPUT_POLL-INTERVAL-SECONDS', '5s', /poll-interval-seconds/],
      ];

      invalidInputs.forEach(([inputName, value, expectedMessage]) => {
        assert.throws(
          () =>
            parseInput({
              ...baseEnv,
              [inputName]: value,
            }),
          expectedMessage,
        );
      });
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
          GITHUB_REF: 'refs/heads/foo',
          GITHUB_REPOSITORY: 'softprops/turnstyle',
          GITHUB_WORKFLOW: 'test',
          GITHUB_RUN_ID: '1',
          INPUT_TOKEN: 's3cr3t',
          'INPUT_CONTINUE-AFTER-SECONDS': '',
          'INPUT_POLL-INTERVAL-SECONDS': '',
          'INPUT_SAME-BRANCH-ONLY': '',
          'INPUT_INITIAL-WAIT-SECONDS': '',
          'INPUT_JOB-TO-WAIT-FOR': '',
          'INPUT_STEP-TO-WAIT-FOR': '',
        }),
        {
          githubToken: 's3cr3t',
          owner: 'softprops',
          repo: 'turnstyle',
          branch: 'foo',
          workflowName: 'test',
          workflowPath: undefined,
          runId: 1,
          runAttempt: 1,
          continueAfterSeconds: undefined,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 60,
          sameBranchOnly: true,
          jobToWaitFor: '',
          stepToWaitFor: '',
          initialWaitSeconds: 0,
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
          workflowPath: undefined,
          runId: 1,
          runAttempt: 1,
          continueAfterSeconds: undefined,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 60,
          sameBranchOnly: true,
          jobToWaitFor: undefined,
          stepToWaitFor: undefined,
          initialWaitSeconds: 0,
          queueName: undefined,
        },
      );
    });

    it('parses branch from GITHUB_REF_NAME when available', () => {
      assert.equal(
        parseInput({
          GITHUB_REF: 'refs/heads/foo',
          GITHUB_REF_NAME: 'release/branch-name',
          GITHUB_REPOSITORY: 'softprops/turnstyle',
          GITHUB_WORKFLOW: 'test',
          GITHUB_RUN_ID: '1',
          INPUT_TOKEN: 's3cr3t',
        }).branch,
        'release/branch-name',
      );
    });

    it('parses tags from GITHUB_REF without truncating the tag name', () => {
      assert.equal(
        parseInput({
          GITHUB_REF: 'refs/tags/v3.2.3',
          GITHUB_REPOSITORY: 'softprops/turnstyle',
          GITHUB_WORKFLOW: 'test',
          GITHUB_RUN_ID: '1',
          INPUT_TOKEN: 's3cr3t',
        }).branch,
        'v3.2.3',
      );
    });

    it('parses workflow path from GITHUB_WORKFLOW_REF', () => {
      assert.equal(
        parseInput({
          GITHUB_REF: 'refs/heads/foo',
          GITHUB_REPOSITORY: 'softprops/turnstyle',
          GITHUB_WORKFLOW: 'test',
          GITHUB_WORKFLOW_REF: 'softprops/turnstyle/.github/workflows/main.yml@refs/heads/foo',
          GITHUB_RUN_ID: '1',
          INPUT_TOKEN: 's3cr3t',
        }).workflowPath,
        '.github/workflows/main.yml',
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
          workflowPath: undefined,
          runId: 1,
          runAttempt: 1,
          continueAfterSeconds: 10,
          abortAfterSeconds: undefined,
          pollIntervalSeconds: 5,
          sameBranchOnly: false,
          jobToWaitFor: 'job-name',
          stepToWaitFor: 'step-name',
          initialWaitSeconds: 5,
          queueName: 'queue-name',
        },
      );
    });

    it('parses run attempt from GITHUB_RUN_ATTEMPT', () => {
      assert.equal(
        parseInput({
          GITHUB_REF: 'refs/heads/foo',
          GITHUB_REPOSITORY: 'softprops/turnstyle',
          GITHUB_WORKFLOW: 'test',
          GITHUB_RUN_ID: '1',
          GITHUB_RUN_ATTEMPT: '3',
          INPUT_TOKEN: 's3cr3t',
        }).runAttempt,
        3,
      );
    });
  });
});
