// Planned to use Evt: https://docs.evt.land/
// Unfortunately it does not satisfy our need for now
// Write a simplified version of https://github.com/primus/eventemitter3

// deno-lint-ignore no-explicit-any
export type Callback<Args extends any[], Ret> = (...args: Args) => Promise<Ret>;

export const Stop = Symbol('Stop');

// deno-lint-ignore no-explicit-any
export class EventChain<F extends Callback<any[], unknown>> {
  protected _listeners: Array<F> = [];

  get listeners(): F[] {
    return this._listeners;
  }

  public addListener(fn: F): this {
    this._listeners.push(fn);
    return this;
  }

  public removeListener(fn: F): this {
    this._listeners = this._listeners.filter((v) => v !== fn);
    return this;
  }

  public removeAllListeners(): this {
    this._listeners = [];
    return this;
  }

  public async emit(...args: Parameters<F>): Promise<void> {
    for (const fn of this._listeners) {
      await fn(...args);
    }
  }

  public async chain(
    initial: Awaited<ReturnType<F>>,
    pipe: (ret: Awaited<ReturnType<F>>, ...lastArgs: Parameters<F>) => Promise<Parameters<F> | typeof Stop>,
    ...initArgs: Parameters<F>
  ): Promise<Awaited<ReturnType<F>>> {
    let args = initArgs;
    let ret = initial;
    for (const fn of this._listeners) {
      ret = await fn(...args) as Awaited<ReturnType<F>>;
      const next = await pipe(ret, ...args);
      if (next === Stop) {
        break;
      } else {
        args = next;
      }
    }
    return ret;
  }
}
