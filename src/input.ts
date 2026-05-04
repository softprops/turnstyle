export interface Input {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  workflowName: string;
  workflowPath: string | undefined;
  runId: number;
  runAttempt: number;
  pollIntervalSeconds: number;
  continueAfterSeconds: number | undefined;
  abortAfterSeconds: number | undefined;
  sameBranchOnly: boolean;
  jobToWaitFor: string | undefined;
  stepToWaitFor: string | undefined;
  initialWaitSeconds: number;
  queueName: string | undefined;
}

const parseSecondsInput = (
  env: Record<string, string | undefined>,
  envName: string,
  defaultValue: number | undefined,
  minimum: number,
): number | undefined => {
  const rawValue = env[envName];
  if (rawValue === undefined || rawValue.trim() === '') {
    return defaultValue;
  }

  const inputName = envName.replace(/^INPUT_/, '').toLowerCase();
  if (!/^\d+$/.test(rawValue.trim())) {
    throw new Error(`${inputName} must be an integer greater than or equal to ${minimum}`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${inputName} must be an integer greater than or equal to ${minimum}`);
  }

  return value;
};

const parseRefName = (ref: string | undefined): string | undefined => {
  if (!ref) {
    return undefined;
  }

  const prefixes = ['refs/heads/', 'refs/tags/'];
  const prefix = prefixes.find((candidate) => ref.startsWith(candidate));
  if (!prefix) {
    return ref;
  }

  return ref.substring(prefix.length);
};

const parseWorkflowPath = (
  workflowRef: string | undefined,
  owner: string,
  repo: string,
): string | undefined => {
  if (!workflowRef || !owner || !repo) {
    return undefined;
  }

  const workflowRefPath = workflowRef.split('@')[0];
  const repoPrefix = `${owner}/${repo}/`;

  if (!workflowRefPath.startsWith(repoPrefix)) {
    return undefined;
  }

  return workflowRefPath.substring(repoPrefix.length);
};

const parseRunAttempt = (runAttempt: string | undefined): number => {
  const value = Number(runAttempt || '1');
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
};

export const parseInput = (env: Record<string, string | undefined>): Input => {
  const githubToken = env['INPUT_TOKEN'] || '';
  const [owner, repo] = (env.GITHUB_REPOSITORY || '').split('/');
  const workflowName = env.GITHUB_WORKFLOW || '';
  const workflowPath = parseWorkflowPath(env.GITHUB_WORKFLOW_REF, owner, repo);
  const branch =
    env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || parseRefName(env.GITHUB_REF) || 'master';
  const runId = parseInt(env.GITHUB_RUN_ID || '0', 10);
  const runAttempt = parseRunAttempt(env.GITHUB_RUN_ATTEMPT);
  const pollIntervalSeconds = parseSecondsInput(env, 'INPUT_POLL-INTERVAL-SECONDS', 60, 1) ?? 60;
  const continueAfterSeconds = parseSecondsInput(env, 'INPUT_CONTINUE-AFTER-SECONDS', undefined, 0);
  const abortAfterSeconds = parseSecondsInput(env, 'INPUT_ABORT-AFTER-SECONDS', undefined, 0);
  if (continueAfterSeconds !== undefined && abortAfterSeconds !== undefined) {
    throw new Error('Only one of continue-after-seconds and abort-after-seconds may be defined');
  }
  const initialWaitSeconds = parseSecondsInput(env, 'INPUT_INITIAL-WAIT-SECONDS', 0, 0) ?? 0;

  const sameBranchOnly = env['INPUT_SAME-BRANCH-ONLY'] === 'true' || !env['INPUT_SAME-BRANCH-ONLY']; // true if not specified

  const jobToWaitFor = env['INPUT_JOB-TO-WAIT-FOR'];
  const stepToWaitFor = env['INPUT_STEP-TO-WAIT-FOR'];
  const queueName = env['INPUT_QUEUE-NAME'];

  if (stepToWaitFor && !jobToWaitFor) {
    throw new Error('step-to-wait-for requires job-to-wait-for to be defined');
  }
  return {
    githubToken,
    owner,
    repo,
    branch,
    workflowName,
    workflowPath,
    runId,
    runAttempt,
    pollIntervalSeconds,
    continueAfterSeconds,
    abortAfterSeconds,
    sameBranchOnly,
    jobToWaitFor,
    stepToWaitFor,
    initialWaitSeconds,
    queueName,
  };
};
