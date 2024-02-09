export type BundlerOpts = {
  thresholdSize?: number;
  delayMs?: number;
};

export class Bundler {
  protected _bundle: Array<Uint8Array> = [];
  protected _timerId: number | undefined;
  protected _cumulativeSize = 0;
  protected _opts: Required<BundlerOpts>;

  constructor(
    public readonly merge: (updates: Array<Uint8Array>) => Uint8Array,
    public readonly emit: (update: Uint8Array) => Promise<void>,
    opts: {
      thresholdSize?: number;
      delayMs?: number;
    } = {},
  ) {
    this._opts = {
      thresholdSize: 3000,
      delayMs: 200,
      ...opts,
    };
  }

  public async produce(update: Uint8Array) {
    this._bundle.push(update);
    this._cumulativeSize += update.byteLength;
    if (this._cumulativeSize > this._opts.thresholdSize) {
      // Emit immediately
      await this.issue();
    } else if (!this._timerId) {
      // Schedule emit
      this._timerId = setTimeout(() => this.issue(), this._opts.delayMs);
    }
  }

  public async issue() {
    if (this._timerId) {
      clearTimeout(this._timerId);
    }
    this._timerId = undefined;
    const output = this._bundle.length === 1 ? this._bundle[0] : this.merge(this._bundle);
    this._bundle = [];
    this._cumulativeSize = 0;
    await this.emit(output);
  }
}
