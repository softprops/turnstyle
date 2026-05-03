import { Input } from './input';

interface Workflow {
  id?: number;
  name?: string | null;
  path?: string | null;
}

export const findWorkflowId = (workflows: Workflow[], input: Input) => {
  const workflowByPath = input.workflowPath
    ? workflows.find((workflow) => workflow.path === input.workflowPath)
    : undefined;

  return (workflowByPath || workflows.find((workflow) => workflow.name === input.workflowName))?.id;
};
