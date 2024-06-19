import { setFailed, debug, info } from "@actions/core";
import { env } from "process";
import { parseInput } from "./input";
import { OctokitGitHub } from "./github";
import { Waiter } from "./wait";

async function run() {
  try {
    const input = parseInput(env);
    debug(
      `Parsed inputs (w/o token): ${(({ githubToken, ...inputs }) =>
        JSON.stringify(inputs))(input)}`,
    );
    const github = new OctokitGitHub(input.githubToken);
    debug(`Fetching workflows for ${input.owner}/${input.repo}...`);
    const workflows = await github.workflows(input.owner, input.repo);
    debug(
      `Found ${workflows.length} workflows in ${input.owner}/${input.repo}`,
    );
    const workflow_id = workflows.find(
      (workflow) => workflow.name == input.workflowName,
    )?.id;
    if (workflow_id) {
      await new Waiter(workflow_id, github, input, info, debug).wait();
    } else {
      setFailed(`No workflow found matching workflow_id: ${workflow_id}`);
    }
  } catch (error: any) {
    setFailed(error.message);
  }
}

if (require.main === module) {
  run();
}
