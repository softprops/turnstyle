import { ActionDeadline } from './deadline';

interface RequestErrorResponse {
  headers?: Record<string, string | undefined>;
}

const errorStatus = (error: unknown): number | undefined =>
  typeof (error as { status?: unknown } | null)?.status === 'number'
    ? (error as { status: number }).status
    : undefined;

const primaryRateLimitDelaySeconds = (error: unknown): number | undefined => {
  const status = errorStatus(error);
  if (status !== 403 && status !== 429) {
    return undefined;
  }

  const response = (error as { response?: RequestErrorResponse }).response;
  if (response?.headers?.['x-ratelimit-remaining'] !== '0') {
    return undefined;
  }

  const resetAtSeconds = Number(response.headers['x-ratelimit-reset']);
  return Math.max(Math.ceil(resetAtSeconds - Date.now() / 1000) + 1, 0);
};

const waitForRetry = async (seconds: number, signal: AbortSignal | undefined) => {
  const scheduler = new ActionDeadline(undefined);
  try {
    await scheduler.sleepSeconds(seconds, signal);
  } finally {
    scheduler.dispose();
  }
};

/**
 * Preserves Turnstyle's retry policy without leaving Octokit's private
 * Bottleneck retry timers alive after the action lifecycle signal aborts.
 */
export const retryRequest = async <T>(
  operation: (retryCount: number) => Promise<T>,
  serverErrorRetries: number,
  signal?: AbortSignal,
): Promise<T> => {
  let retryCount = 0;
  let serverErrorRetryCount = 0;
  while (true) {
    signal?.throwIfAborted();
    try {
      return await operation(retryCount);
    } catch (error: unknown) {
      signal?.throwIfAborted();
      const status = errorStatus(error);
      const primaryRateLimitDelay = primaryRateLimitDelaySeconds(error);
      let retryDelay: number | undefined;

      if (status !== undefined && status >= 500 && serverErrorRetryCount < serverErrorRetries) {
        serverErrorRetryCount += 1;
        retryDelay = (retryCount + 1) ** 2;
      } else if (primaryRateLimitDelay !== undefined && retryCount < 1) {
        retryDelay = primaryRateLimitDelay;
      }

      if (retryDelay === undefined) {
        throw error;
      }

      retryCount += 1;
      await waitForRetry(retryDelay, signal);
    }
  }
};
