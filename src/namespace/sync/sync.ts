import { Signer, Verifier } from '@ndn/packet';
import { StateVector, SvSync } from '@ndn/svs';
import { BaseNode } from '../base-node.ts';
import * as Schema from '../schema-tree.ts';
import { EventChain } from '../../utils/event-chain.ts';
import { ExpressingPointEvents } from '../expressing-point.ts';

export type SvsInstNodeEvents = Pick<ExpressingPointEvents, 'verify'>;

export type SvsInstNodeOpts = {
  lifetimeMs?: number;
  steadyTimerMs?: number;
  suppressionTimerMs?: number;
  interestSigner?: Signer;
};

/**
 * SVS works more like a separated component from NTSchema, because
 * it runs at some specific prefix(es) instead of a general pattern.
 * Each SVS instance has its own state, and there is little to share.
 */
export class SvsInstNode extends BaseNode {
  /** Verify Interest event. */
  public readonly onVerify = new EventChain<SvsInstNodeEvents['verify']>();

  constructor(
    public readonly config: SvsInstNodeOpts,
    describe?: string,
  ) {
    super(describe);
  }

  public static readonly fireSvsInstance = (inst: SvSync) => {
    (inst as unknown as { resetTimer: (immediate?: boolean) => void }).resetTimer(true);
  };

  public async createSvsInst(
    matched: Schema.StrictMatch<SvsInstNode>,
    opts: {
      lifetimeMs?: number;
      steadyTimerMs?: number;
      suppressionTimerMs?: number;
      signer?: Signer;
      verifier?: Verifier;
      initialStateVector?: StateVector;
      initialize?: (sync: SvSync) => PromiseLike<void>;
    } = {},
  ): Promise<SvSync> {
    const signer = opts.signer ?? this.config.interestSigner;
    const verifier = opts.verifier ?? this.handler!.getVerifier(undefined, {});
    const lifetimeMs = opts.lifetimeMs ?? this.config.lifetimeMs;
    if (!signer || !verifier || lifetimeMs === undefined) {
      throw new Error(
        `[${this.describe}:createSvsInst] Unable to create SVS instance when signer, ` +
          `verifier or lifetimeMs is missing in config.`,
      );
    }
    const steadyTimer = [opts.steadyTimerMs ?? this.config.steadyTimerMs ?? 30000, 0.1] satisfies SvSync.Timer;
    const suppressionTimer = [
      opts.suppressionTimerMs ?? this.config.suppressionTimerMs ?? 200,
      0.5,
    ] satisfies SvSync.Timer;
    const describe = this.describe ? `${this.describe}(${matched.name.toString()})` : undefined;

    const ret = await SvSync.create({
      fw: this.handler!.fw!,
      syncPrefix: matched.name,
      signer: signer,
      verifier: verifier,
      syncInterestLifetime: lifetimeMs,
      steadyTimer: steadyTimer,
      suppressionTimer: suppressionTimer,
      describe: describe,
      initialStateVector: new StateVector(opts.initialStateVector),
      initialize: opts.initialize,
    });
    return ret;
  }
}
