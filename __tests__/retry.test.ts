import { afterEach, describe, expect, it, vi } from 'vitest';

import { retryRequest } from '../src/retry';

const flushMicrotasks = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await Promise.resolve();
  }
};

const primaryRateLimitError = (resetAtSeconds?: string) =>
  Object.assign(new Error('rate limited'), {
    status: 403,
    response: {
      headers: {
        'x-ratelimit-remaining': '0',
        ...(resetAtSeconds === undefined ? {} : { 'x-ratelimit-reset': resetAtSeconds }),
      },
    },
  });

describe('abortable retry scheduling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('preserves quadratic 5xx retry delays for deadline-bound requests', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi
      .fn<(retryCount: number) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('first failure'), { status: 500 }))
      .mockRejectedValueOnce(Object.assign(new Error('second failure'), { status: 502 }))
      .mockResolvedValue('ok');
    const result = retryRequest(operation, 2, controller.signal);

    await vi.advanceTimersByTimeAsync(999);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenNthCalledWith(2, 1);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe('ok');
    expect(operation).toHaveBeenNthCalledWith(1, 0);
    expect(operation).toHaveBeenNthCalledWith(3, 2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['a client error', Object.assign(new Error('client error'), { status: 429 })],
    ['an error without a status', new Error('network error')],
    ['a non-Error rejection', { status: 429 }],
  ])('does not retry %s', async (_description, error) => {
    const operation = vi.fn().mockRejectedValue(error);

    await expect(retryRequest(operation, 2, new AbortController().signal)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('stops after the configured number of server-error retries', async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error('server error'), { status: 503 });
    const operation = vi.fn().mockRejectedValue(error);
    const result = retryRequest(operation, 1, new AbortController().signal);
    const rejection = expect(result).rejects.toBe(error);

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(operation).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending server-error retry timer when the signal aborts', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }));
    const result = retryRequest(operation, 2, controller.signal);

    await flushMicrotasks();
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    await expect(result).rejects.toBe(controller.signal.reason);

    expect(operation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves one primary-rate-limit retry using the reset header', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const error = Object.assign(new Error('rate limited'), {
      status: 403,
      response: {
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30),
        },
      },
    });
    const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('ok');
    const result = retryRequest(operation, 0);

    await vi.advanceTimersByTimeAsync(30_999);
    expect(operation).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe('ok');
    expect(operation).toHaveBeenNthCalledWith(2, 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a primary limit independently after a server-error retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const primaryError = primaryRateLimitError(String(Math.floor(Date.now() / 1000) + 5));
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('server error'), { status: 500 }))
      .mockRejectedValueOnce(primaryError)
      .mockResolvedValue('ok');
    const result = retryRequest(operation, 1);
    void result.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(999);
    expect(operation).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenNthCalledWith(2, 1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe('ok');
    expect(operation).toHaveBeenNthCalledWith(3, 2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the first server-error delay after a primary-limit retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const primaryError = primaryRateLimitError(String(Math.floor(Date.now() / 1000) + 5));
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(primaryError)
      .mockRejectedValueOnce(Object.assign(new Error('server error'), { status: 500 }))
      .mockResolvedValue('ok');
    const result = retryRequest(operation, 1);

    await vi.advanceTimersByTimeAsync(5_999);
    expect(operation).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenNthCalledWith(2, 1);
    await vi.advanceTimersByTimeAsync(999);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe('ok');
    expect(operation).toHaveBeenNthCalledWith(3, 2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps primary and server retry limits and delays independent in a longer sequence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const primaryError = primaryRateLimitError(String(Math.floor(Date.now() / 1000) + 10));
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('first server error'), { status: 500 }))
      .mockRejectedValueOnce(primaryError)
      .mockRejectedValueOnce(Object.assign(new Error('second server error'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('third server error'), { status: 503 }))
      .mockResolvedValue('ok');
    const result = retryRequest(operation, 3);
    void result.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(operation).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(operation).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(8_999);
    expect(operation).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(5);
    expect(operation.mock.calls.map(([attempt]) => attempt)).toEqual([0, 1, 2, 3, 4]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('permits only one primary-limit retry and reports scheduling once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const primaryError = primaryRateLimitError(String(Math.floor(Date.now() / 1000) - 1));
    const operation = vi.fn().mockRejectedValue(primaryError);
    const onPrimaryRateLimitRetry = vi.fn();

    await expect(retryRequest(operation, 0, undefined, onPrimaryRateLimitRetry)).rejects.toBe(
      primaryError,
    );

    expect(operation).toHaveBeenCalledTimes(2);
    expect(onPrimaryRateLimitRetry).toHaveBeenCalledOnce();
    expect(onPrimaryRateLimitRetry).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['You have exceeded a secondary rate limit', 403],
    ['SECONDARY RATE LIMIT', 429],
    ['secondary rate', 403],
  ])(
    'does not reinterpret secondary-limit message %j as a primary limit',
    async (message, status) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
      const controller = new AbortController();
      const details = {
        status,
        response: {
          headers: {
            'retry-after': '60',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600),
          },
        },
      };
      const error =
        status === 429 ? { message, ...details } : Object.assign(new Error(message), details);
      const operation = vi.fn().mockRejectedValue(error);
      const onPrimaryRateLimitRetry = vi.fn();
      const result = retryRequest(operation, 0, controller.signal, onPrimaryRateLimitRetry);
      const settled = vi.fn();
      void result.then(settled, (reason: unknown) => settled('rejected', reason));

      try {
        await flushMicrotasks();

        expect(settled).toHaveBeenCalledWith('rejected', error);
        expect(operation).toHaveBeenCalledOnce();
        expect(onPrimaryRateLimitRetry).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        controller.abort();
        await result.catch(() => undefined);
      }
    },
  );

  it.each([
    ['a missing reset header', undefined],
    ['an empty reset header', ''],
    ['a malformed reset header', 'not-a-number'],
    ['a whitespace-only reset header', ' '],
    ['a negative reset header', '-1'],
    ['a fractional reset header', '1.5'],
    ['an exponential reset header', '1e9'],
    ['a hexadecimal reset header', '0x10'],
    ['an unsafe-integer reset header', String(Number.MAX_SAFE_INTEGER + 1)],
  ])('does not schedule a primary retry for %s', async (_description, resetAtSeconds) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const error = primaryRateLimitError(resetAtSeconds);
    const operation = vi.fn().mockRejectedValue(error);
    const onPrimaryRateLimitRetry = vi.fn();
    const result = retryRequest(operation, 0, controller.signal, onPrimaryRateLimitRetry);
    const settled = vi.fn();
    void result.then(settled, (reason: unknown) => settled('rejected', reason));

    try {
      await flushMicrotasks();

      expect(settled).toHaveBeenCalledWith('rejected', error);
      expect(operation).toHaveBeenCalledOnce();
      expect(onPrimaryRateLimitRetry).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.abort();
      await result.catch(() => undefined);
    }
  });
});
