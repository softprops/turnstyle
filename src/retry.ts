import { ActionDeadline } from './deadline';

interface RequestErrorResponse {
  headers?: Record<string, string | undefined>;
}

const errorStatus = (error: unknown): number | undefined =>
  typeof (error as { status?: unknown } | null)?.status === 'number'
    ? (error as { status: number }).status
    : undefined;

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof (error as { message?: unknown } | null)?.message === 'string'
      ? (error as { message: string }).message
      : '';

const isSecondaryRateLimit = (error: unknown): boolean =>
  /\bsecondary rate\b/i.test(errorMessage(error));

const primaryRateLimitDelaySeconds = (error: unknown): number | undefined => {
  if (isSecondaryRateLimit(error)) {
    return undefined;
  }

  const status = errorStatus(error);
  if (status !== 403 && status !== 429) {
    return undefined;
  }

  const response = (error as { response?: RequestErrorResponse }).response;
  if (response?.headers?.['x-ratelimit-remaining'] !== '0') {
    return undefined;
  }

  const resetHeader = response.headers['x-ratelimit-reset'];
  if (!resetHeader?.trim()) {
    return undefined;
  }

  const normalizedReset = resetHeader.trim();
  if (!/^\d+$/.test(normalizedReset)) {
    return undefined;
  }

  const resetAtSeconds = Number(normalizedReset);
  if (!Number.isSafeInteger(resetAtSeconds)) {
    return undefined;
  }

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
  operation: (requestAttemptCount: number) => Promise<T>,
  serverErrorRetries: number,
  signal?: AbortSignal,
  onPrimaryRateLimitRetry?: (delaySeconds: number) => void,
  checkDeadline?: () => void,
): Promise<T> => {
  let requestAttemptCount = 0;
  let serverErrorRetryCount = 0;
  let primaryRateLimitRetryCount = 0;
  while (true) {
    checkDeadline?.();
    signal?.throwIfAborted();
    let value: T;
    try {
      value = await operation(requestAttemptCount);
    } catch (error: unknown) {
      // A delayed deadline timer must not allow a completed request to start
      // another backoff or retry after the monotonic boundary.
      checkDeadline?.();
      signal?.throwIfAborted();
      const status = errorStatus(error);
      const primaryRateLimitDelay = primaryRateLimitDelaySeconds(error);
      let retryDelay: number | undefined;

      if (status !== undefined && status >= 500 && serverErrorRetryCount < serverErrorRetries) {
        serverErrorRetryCount += 1;
        retryDelay = serverErrorRetryCount ** 2;
      } else if (primaryRateLimitDelay !== undefined && primaryRateLimitRetryCount < 1) {
        primaryRateLimitRetryCount += 1;
        retryDelay = primaryRateLimitDelay;
        onPrimaryRateLimitRetry?.(retryDelay);
      }

      if (retryDelay === undefined) {
        throw error;
      }

      requestAttemptCount += 1;
      await waitForRetry(retryDelay, signal);
      continue;
    }

    // Pagination may use this response to issue another request. Check before
    // returning it to Octokit so a late timer callback cannot start that page.
    checkDeadline?.();
    signal?.throwIfAborted();
    return value;
  }
};
