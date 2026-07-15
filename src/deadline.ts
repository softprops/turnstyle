import { setOutput } from '@actions/core';

export const MAX_TIMER_DELAY_MILLISECONDS = 2_147_483_647;

export type DeadlineMode = 'continue' | 'abort';

export interface DeadlineConfig {
  mode: DeadlineMode;
  seconds: number;
}

export interface DeadlineInput {
  abortAfterSeconds: number | undefined;
  continueAfterSeconds: number | undefined;
}

export interface DeadlineTiming {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimeout(timeout: ReturnType<typeof setTimeout>): void;
}

export const systemDeadlineTiming: DeadlineTiming = {
  now: () => performance.now(),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (timeout) => clearTimeout(timeout),
};

type DeadlineOutcome = { kind: 'deadline' };
type OperationOutcome<T> = { kind: 'value'; value: T } | { kind: 'error'; error: unknown };

export class DeadlineReached extends Error {
  constructor(
    readonly mode: DeadlineMode,
    readonly seconds: number,
  ) {
    super(`Wait ${mode} deadline reached`);
  }
}

/**
 * One monotonic action-lifecycle deadline and timer scheduler shared by all
 * Actions API reads and sleeps.
 */
export class ActionDeadline {
  readonly signal: AbortSignal;

  private readonly controller: AbortController;
  private readonly deadlineAtSeconds: number | undefined;
  private readonly reached: Promise<DeadlineOutcome>;
  private readonly resolveReached: (outcome: DeadlineOutcome) => void;
  private readonly startedAtSeconds: number;
  private readonly timing: DeadlineTiming;
  private expired = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  static fromInput(
    input: DeadlineInput,
    timing: DeadlineTiming = systemDeadlineTiming,
    secondsSoFar: number = 0,
  ): ActionDeadline {
    const config: DeadlineConfig | undefined =
      input.continueAfterSeconds !== undefined
        ? { mode: 'continue', seconds: input.continueAfterSeconds }
        : input.abortAfterSeconds !== undefined
          ? { mode: 'abort', seconds: input.abortAfterSeconds }
          : undefined;
    return new ActionDeadline(config, timing, secondsSoFar);
  }

  constructor(
    readonly config: DeadlineConfig | undefined,
    timing: DeadlineTiming = systemDeadlineTiming,
    secondsSoFar: number = 0,
  ) {
    this.timing = timing;
    this.startedAtSeconds = timing.now() / 1000 - secondsSoFar;
    this.deadlineAtSeconds =
      config === undefined ? undefined : this.startedAtSeconds + config.seconds;
    this.controller = new AbortController();
    this.signal = this.controller.signal;

    let resolveReached!: (outcome: DeadlineOutcome) => void;
    this.reached = new Promise((resolve) => {
      resolveReached = resolve;
    });
    this.resolveReached = resolveReached;

    this.scheduleDeadlineChunk();
  }

  elapsedSeconds = (): number => Math.max(0, this.timing.now() / 1000 - this.startedAtSeconds);

  hasElapsedSeconds = (seconds: number): boolean => this.elapsedSeconds() >= seconds;

  private delayUntil = (targetSeconds: number): number => {
    const remainingSeconds = targetSeconds - this.timing.now() / 1000;
    if (remainingSeconds <= 0) {
      return 0;
    }

    const maximumTimerSeconds = MAX_TIMER_DELAY_MILLISECONDS / 1000;
    if (remainingSeconds > maximumTimerSeconds) {
      return MAX_TIMER_DELAY_MILLISECONDS;
    }

    // Multiplication happens only after the value is bounded to Node's timer
    // range. Keep a one-millisecond floor so an early fractional callback is
    // rechecked instead of creating a zero-delay loop.
    return Math.max(1, Math.round(remainingSeconds * 1000));
  };

  private deadlineReached = (): boolean =>
    this.expired ||
    (this.deadlineAtSeconds !== undefined && this.timing.now() / 1000 >= this.deadlineAtSeconds);

  private expire = (): void => {
    if (this.expired || !this.config) {
      return;
    }

    this.expired = true;
    this.resolveReached({ kind: 'deadline' });
    this.controller.abort();
  };

  private scheduleDeadlineChunk = (): void => {
    if (this.deadlineAtSeconds === undefined || this.expired) {
      return;
    }

    const delay = this.delayUntil(this.deadlineAtSeconds);
    if (delay === 0) {
      this.expire();
      return;
    }

    this.timer = this.timing.setTimeout(() => {
      this.timer = undefined;
      if (this.deadlineReached()) {
        this.expire();
      } else {
        this.scheduleDeadlineChunk();
      }
    }, delay);
  };

  throwIfReached = (): void => {
    const config = this.config;
    if (config && this.deadlineReached()) {
      this.expire();
      throw new DeadlineReached(config.mode, config.seconds);
    }
  };

  race = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    this.throwIfReached();
    this.signal.throwIfAborted();
    const config = this.config;
    if (!config) {
      return operation(this.signal);
    }

    const operationOutcome = Promise.resolve()
      .then(() => operation(this.signal))
      .then<OperationOutcome<T>, OperationOutcome<T>>(
        (value) => ({ kind: 'value', value }),
        (error: unknown) => ({ kind: 'error', error }),
      );
    const outcome = await Promise.race([operationOutcome, this.reached]);

    if (outcome.kind === 'deadline') {
      throw new DeadlineReached(config.mode, config.seconds);
    }
    // The monotonic boundary wins even if the event loop has not delivered the
    // timer callback yet. This check also makes API rejection at the boundary a
    // deadline result rather than an incidental abort error.
    this.throwIfReached();
    if (outcome.kind === 'error') {
      throw outcome.error;
    }
    return outcome.value;
  };

  private sleepUntilSeconds = async (
    sleepUntilSeconds: number,
    signal?: AbortSignal,
  ): Promise<void> => {
    signal?.throwIfAborted();
    this.throwIfReached();

    while (true) {
      this.throwIfReached();
      const delay = this.delayUntil(sleepUntilSeconds);
      if (delay === 0) {
        return;
      }

      let sleepTimer: ReturnType<typeof setTimeout> | undefined;
      const chunk = new Promise<void>((resolve) => {
        sleepTimer = this.timing.setTimeout(resolve, delay);
      });
      let rejectForAbort!: (reason: unknown) => void;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectForAbort = reject;
      });
      const onAbort = () => {
        if (sleepTimer !== undefined) {
          this.timing.clearTimeout(sleepTimer);
          sleepTimer = undefined;
        }
        rejectForAbort(signal?.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        await this.race(() => (signal ? Promise.race([chunk, aborted]) : chunk));
      } finally {
        signal?.removeEventListener('abort', onAbort);
        if (sleepTimer !== undefined) {
          this.timing.clearTimeout(sleepTimer);
        }
      }
    }
  };

  sleepSeconds = async (seconds: number, signal?: AbortSignal): Promise<void> =>
    this.sleepUntilSeconds(this.timing.now() / 1000 + seconds, signal);

  sleepUntilElapsedSeconds = async (seconds: number): Promise<void> =>
    this.sleepUntilSeconds(this.startedAtSeconds + seconds);

  cancel = (reason?: unknown): void => {
    this.controller.abort(reason);
  };

  dispose = (): void => {
    if (this.timer !== undefined) {
      this.timing.clearTimeout(this.timer);
      this.timer = undefined;
    }
  };
}

export const handleDeadline = (
  reached: DeadlineReached,
  info: (message: string) => void,
  clearPreviousRunOutput: () => void,
): number => {
  if (reached.mode === 'continue') {
    info(`🤙Exceeded wait seconds. Continuing...`);
    setOutput('force_continued', '1');
    clearPreviousRunOutput();
    return reached.seconds;
  }

  info(`🛑Exceeded wait seconds. Aborting...`);
  setOutput('force_continued', '');
  clearPreviousRunOutput();
  throw new Error(`Aborted after waiting ${reached.seconds} seconds`);
};
