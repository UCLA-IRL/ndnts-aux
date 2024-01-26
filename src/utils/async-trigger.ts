export class AsyncTrigger implements Disposable {
  #promise: Promise<boolean>;
  #resolve: (value: boolean) => void;
  #abortListener;

  constructor(
    readonly abortSignal: AbortSignal,
  ) {
    ({ promise: this.#promise, resolve: this.#resolve } = Promise.withResolvers<boolean>());
    this.#abortListener = () => {
      this.#resolve(false);
    };
    abortSignal.addEventListener('abort', this.#abortListener, { once: true });
  }

  [Symbol.dispose](): void {
    this.abortSignal.removeEventListener('abort', this.#abortListener);
    this.#resolve(false);
  }

  async *[Symbol.asyncIterator]() {
    while (!this.abortSignal.aborted) {
      const value = await this.#promise;
      if (this.abortSignal.aborted || !value) {
        return;
      }
      ({ promise: this.#promise, resolve: this.#resolve } = Promise.withResolvers<boolean>());
      yield value;
    }
  }

  trigger() {
    this.#resolve(true);
  }
}
