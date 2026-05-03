import { debug, info, setFailed } from '@actions/core';
import { env } from 'process';
import { OctokitGitHub } from './github';
import { parseInput } from './input';
import { Waiter } from './wait';
import { findWorkflowId } from './workflow';

async function run() {
  try {
    const input = parseInput(env);
    debug(
      `Parsed inputs (w/o token): ${(({ githubToken, ...inputs }) => JSON.stringify(inputs))(
        input,
      )}`,
    );
    const github = new OctokitGitHub(input.githubToken);
    debug(`Fetching workflows for ${input.owner}/${input.repo}...`);
    const workflows = await github.workflows(input.owner, input.repo);
    debug(`Found ${workflows.length} workflows in ${input.owner}/${input.repo}`);
    const workflow_id = findWorkflowId(workflows, input);
    if (workflow_id) {
      await new Waiter(workflow_id, github, input, info, debug, workflows).wait();
    } else {
      setFailed(
        `No workflow found matching workflow path or name: ${input.workflowPath || input.workflowName}`,
      );
    }
  } catch (error: any) {
    setFailed(error.message);
  }
}

if (require.main === module) {
  run();
}
