import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ActionDeadline,
  DeadlineReached,
  MAX_TIMER_DELAY_MILLISECONDS,
  type DeadlineTiming,
} from '../src/deadline';

interface ScheduledTimer {
  callback: () => void;
  milliseconds: number;
}

const manualTiming = () => {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, ScheduledTimer>();
  const scheduledDelays: number[] = [];
  const clearedTimers: number[] = [];
  const timing: DeadlineTiming = {
    now: () => now,
    setTimeout: (callback, milliseconds) => {
      const timer = nextTimer++;
      timers.set(timer, { callback, milliseconds });
      scheduledDelays.push(milliseconds);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => {
      const timerId = timer as unknown as number;
      timers.delete(timerId);
      clearedTimers.push(timerId);
    },
  };

  return {
    timing,
    advanceTo: (milliseconds: number) => {
      now = milliseconds;
    },
    deliverNextTimer: () => {
      const entry = timers.entries().next().value as [number, ScheduledTimer] | undefined;
      if (!entry) {
        throw new Error('No timer is scheduled');
      }
      const [timer, scheduled] = entry;
      timers.delete(timer);
      scheduled.callback();
      return scheduled.milliseconds;
    },
    scheduledDelays,
    clearedTimers,
    timerCount: () => timers.size,
  };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe('ActionDeadline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['continue', 'abort'] as const)(
    'chunks a long %s deadline without expiring before monotonic time reaches it',
    async (mode) => {
      const fake = manualTiming();
      const seconds = 2_147_484;
      const deadline = new ActionDeadline({ mode, seconds }, fake.timing);

      expect(deadline.signal?.aborted).toBe(false);
      expect(fake.scheduledDelays).toEqual([MAX_TIMER_DELAY_MILLISECONDS]);

      fake.advanceTo(MAX_TIMER_DELAY_MILLISECONDS);
      expect(fake.deliverNextTimer()).toBe(MAX_TIMER_DELAY_MILLISECONDS);

      expect(deadline.signal?.aborted).toBe(false);
      expect(fake.scheduledDelays).toEqual([MAX_TIMER_DELAY_MILLISECONDS, 353]);

      fake.advanceTo(seconds * 1000);
      fake.deliverNextTimer();

      expect(deadline.signal?.aborted).toBe(true);
      await expect(deadline.race(async () => 'too late')).rejects.toEqual(
        new DeadlineReached(mode, seconds),
      );
      expect(fake.scheduledDelays.every((delay) => delay <= MAX_TIMER_DELAY_MILLISECONDS)).toBe(
        true,
      );
    },
  );

  it('clears the currently armed timer during cleanup after a chunk re-arms', () => {
    const fake = manualTiming();
    const deadline = new ActionDeadline({ mode: 'abort', seconds: 2_147_484 }, fake.timing);

    fake.advanceTo(MAX_TIMER_DELAY_MILLISECONDS);
    fake.deliverNextTimer();
    expect(fake.timerCount()).toBe(1);

    deadline.dispose();

    expect(fake.timerCount()).toBe(0);
    expect(fake.clearedTimers).toHaveLength(1);
  });

  it('chunks a long polling sleep without scheduling a timer beyond the Node limit', async () => {
    const fake = manualTiming();
    const seconds = 2_147_484;
    const deadline = new ActionDeadline(undefined, fake.timing);
    const sleep = deadline.sleepSeconds(seconds);

    expect(fake.scheduledDelays).toEqual([MAX_TIMER_DELAY_MILLISECONDS]);

    fake.advanceTo(MAX_TIMER_DELAY_MILLISECONDS);
    fake.deliverNextTimer();
    for (let microtask = 0; microtask < 8; microtask += 1) {
      await Promise.resolve();
    }

    expect(fake.scheduledDelays).toEqual([MAX_TIMER_DELAY_MILLISECONDS, 353]);

    fake.advanceTo(seconds * 1000);
    fake.deliverNextTimer();

    await expect(sleep).resolves.toBeUndefined();
    expect(fake.scheduledDelays.every((delay) => delay <= MAX_TIMER_DELAY_MILLISECONDS)).toBe(true);
  });

  it('re-checks monotonic time when an operation resolves before the timer callback is delivered', async () => {
    const fake = manualTiming();
    const operation = deferred<string>();
    const deadline = new ActionDeadline({ mode: 'abort', seconds: 1 }, fake.timing);
    const result = deadline.race(() => operation.promise);

    fake.advanceTo(1_001);
    operation.resolve('late value');

    await expect(result).rejects.toEqual(new DeadlineReached('abort', 1));
    expect(deadline.signal?.aborted).toBe(true);
  });

  it('re-checks monotonic time when an operation rejects before the timer callback is delivered', async () => {
    const fake = manualTiming();
    const operation = deferred<string>();
    const deadline = new ActionDeadline({ mode: 'continue', seconds: 1 }, fake.timing);
    const result = deadline.race(() => operation.promise);

    fake.advanceTo(1_001);
    operation.reject(new Error('late API failure'));

    await expect(result).rejects.toEqual(new DeadlineReached('continue', 1));
    expect(deadline.signal?.aborted).toBe(true);
  });

  it('allows an operation that resolves immediately before the deadline', async () => {
    const fake = manualTiming();
    const operation = deferred<string>();
    const deadline = new ActionDeadline({ mode: 'continue', seconds: 1 }, fake.timing);
    const result = deadline.race(() => operation.promise);

    fake.advanceTo(999);
    operation.resolve('on time');

    await expect(result).resolves.toBe('on time');
    expect(deadline.signal?.aborted).toBe(false);
  });

  it('treats the exact monotonic boundary as expired', async () => {
    const fake = manualTiming();
    const deadline = new ActionDeadline({ mode: 'continue', seconds: 1 }, fake.timing);

    fake.advanceTo(1_000);

    await expect(deadline.race(async () => 'boundary value')).rejects.toEqual(
      new DeadlineReached('continue', 1),
    );
    expect(deadline.signal?.aborted).toBe(true);
  });
});
