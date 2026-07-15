import { afterEach, describe, expect, it, vi } from 'vitest';

import { retryRequest } from '../src/retry';

const flushMicrotasks = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await Promise.resolve();
  }
};

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
});
