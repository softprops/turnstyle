import { assert, describe, it } from 'vitest';

import { parseInput } from '../src/input';
import { findWorkflowId } from '../src/workflow';

describe('workflow', () => {
  describe('findWorkflowId', () => {
    it('prefers the workflow path over duplicate workflow names', () => {
      const workflows = [
        { id: 1, name: 'CI', path: '.github/workflows/first.yml' },
        { id: 2, name: 'CI', path: '.github/workflows/second.yml' },
      ];
      const input = parseInput({
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REPOSITORY: 'softprops/turnstyle',
        GITHUB_WORKFLOW: 'CI',
        GITHUB_WORKFLOW_REF: 'softprops/turnstyle/.github/workflows/second.yml@refs/heads/main',
        GITHUB_RUN_ID: '1',
        INPUT_TOKEN: 's3cr3t',
      });

      assert.equal(findWorkflowId(workflows, input), 2);
    });

    it('falls back to workflow name when workflow path is unavailable', () => {
      const workflows = [{ id: 1, name: 'CI', path: '.github/workflows/main.yml' }];
      const input = parseInput({
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REPOSITORY: 'softprops/turnstyle',
        GITHUB_WORKFLOW: 'CI',
        GITHUB_RUN_ID: '1',
        INPUT_TOKEN: 's3cr3t',
      });

      assert.equal(findWorkflowId(workflows, input), 1);
    });
  });
});
