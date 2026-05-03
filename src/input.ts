export interface Input {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  workflowName: string;
  runId: number;
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

export const parseInput = (env: Record<string, string | undefined>): Input => {
  const githubToken = env['INPUT_TOKEN'] || '';
  const [owner, repo] = (env.GITHUB_REPOSITORY || '').split('/');
  const workflowName = env.GITHUB_WORKFLOW || '';
  const branch = env.GITHUB_HEAD_REF || env.GITHUB_REF?.substring(11) || 'master';
  const runId = parseInt(env.GITHUB_RUN_ID || '0', 10);
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
    runId,
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
