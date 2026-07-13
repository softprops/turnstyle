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

    it('falls back to workflow name when the requested path does not match', () => {
      const workflows = [
        { id: 1, name: 'CI', path: '.github/workflows/main.yml' },
        { id: 2, name: 'Other', path: '.github/workflows/other.yml' },
      ];
      const input = parseInput({
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REPOSITORY: 'softprops/turnstyle',
        GITHUB_WORKFLOW: 'CI',
        GITHUB_WORKFLOW_REF: 'softprops/turnstyle/.github/workflows/missing.yml@refs/heads/main',
        GITHUB_RUN_ID: '1',
        INPUT_TOKEN: 's3cr3t',
      });

      assert.equal(findWorkflowId(workflows, input), 1);
    });

    it.each([
      ['an empty workflow list', []],
      ['workflows with null metadata', [{ id: 1, name: null, path: null }]],
      ['workflows with missing metadata', [{ id: 1 }]],
      [
        'duplicate non-matching names',
        [
          { id: 1, name: 'Other' },
          { id: 2, name: 'Other' },
        ],
      ],
    ])('returns undefined for %s', (_description, workflows) => {
      const input = parseInput({
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REPOSITORY: 'softprops/turnstyle',
        GITHUB_WORKFLOW: 'CI',
        GITHUB_RUN_ID: '1',
        INPUT_TOKEN: 's3cr3t',
      });

      assert.equal(findWorkflowId(workflows, input), undefined);
    });
  });
});
