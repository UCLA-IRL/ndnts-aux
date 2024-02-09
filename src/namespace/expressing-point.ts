import { RetxPolicy } from '@ndn/endpoint';
import { Data, Interest, Signer, type Verifier } from '@ndn/packet';
import * as schemaTree from './schema-tree.ts';
import { BaseNode, BaseNodeEvents } from './base-node.ts';
import { EventChain, Stop } from '../utils/event-chain.ts';
import { VerifyResult } from './nt-schema.ts';

export interface ExpressingPointEvents extends BaseNodeEvents {
  interest(
    args: {
      target: schemaTree.StrictMatch<ExpressingPoint>;
      interest: Interest;
      deadline: number;
    },
  ): Promise<Data | undefined>;

  verify(
    args: {
      target: schemaTree.StrictMatch<ExpressingPoint>;
      deadline: number;
      pkt: Verifier.Verifiable;
    },
  ): Promise<VerifyResult>;

  searchStorage(
    args: {
      target: schemaTree.StrictMatch<ExpressingPoint>;
      interest: Interest;
      deadline: number;
    },
  ): Promise<Data | undefined>;
}

export type ExpressingPointOpts = {
  lifetimeMs: number;
  interestSigner?: Signer;
  canBePrefix?: boolean;
  mustBeFresh?: boolean;
  supressInterest?: boolean;
  retx?: RetxPolicy;
};

export class ExpressingPoint extends BaseNode {
  /** Called when Interest received */
  public readonly onInterest = new EventChain<ExpressingPointEvents['interest']>();

  /** Verify Interest event. Also verifies Data if this is a LeafNode */
  public readonly onVerify = new EventChain<ExpressingPointEvents['verify']>();

  /** Searching stored data from the storage */
  public readonly onSearchStorage = new EventChain<ExpressingPointEvents['searchStorage']>();

  constructor(
    public readonly config: ExpressingPointOpts,
  ) {
    super();
  }

  public searchCache(target: schemaTree.StrictMatch<ExpressingPoint>, interest: Interest, deadline: number) {
    return this.onSearchStorage.chain(
      undefined,
      (ret) => Promise.resolve(ret ? Stop : [{ target, interest, deadline }]),
      { target, interest, deadline },
    );
  }

  public override async verifyPacket(
    matched: schemaTree.StrictMatch<ExpressingPoint>,
    pkt: Verifier.Verifiable,
    deadline: number,
  ) {
    const verifyResult = await this.onVerify.chain(
      VerifyResult.Unknown,
      (ret, args) => Promise.resolve((ret < VerifyResult.Unknown || ret >= VerifyResult.Bypass) ? Stop : [args]),
      { target: matched, pkt, deadline },
    );
    return verifyResult >= VerifyResult.Pass;
  }

  public override async processInterest(
    matched: schemaTree.StrictMatch<ExpressingPoint>,
    interest: Interest,
    deadline: number,
  ): Promise<Data | undefined> {
    // Search storage
    // Reply if there is data (including AppNack). No further callback will be called if hit.
    // This is the same behavior as a forwarder.
    const cachedData = await this.searchCache(matched, interest, deadline);
    if (cachedData) {
      return cachedData;
    }

    // Validate Interest
    // Only done when there is a sigInfo or appParam.
    // Signed Interests are required to carry AppParam, but may be zero length.
    // To guarantee everything is good in case the underlying library returns `undefined` when zero length, check both.
    if (interest.appParameters || interest.sigInfo) {
      if (!await this.verifyPacket(matched, interest, deadline)) {
        // Unverified Interest. Drop
        return;
      }
    }

    // PreRecvInt
    // Used to decrypt AppParam or handle before onInterest hits, if applicable.
    // Do we need them? Hold for now.

    // OnInt
    const result = await this.onInterest.chain(
      undefined,
      (ret, args) => Promise.resolve(ret ? Stop : [args]),
      { target: matched, interest, deadline },
    );

    // PreSendData
    // Used to encrypt Data or handle after onInterest hits, if applicable.
    // Do we need them? Hold for now.
    return result;
  }

  public async need(
    matched: schemaTree.StrictMatch<ExpressingPoint>,
    opts: {
      appParam?: Uint8Array | string;
      supressInterest?: boolean;
      abortSignal?: AbortSignal;
      signer?: Signer;
      lifetimeMs?: number;
      deadline?: number;
    } = {},
  ): Promise<Data | undefined> {
    // Construct Interest, but without signing, so the parameter digest is not there
    const interestName = this.handler!.attachedPrefix!.append(...matched.name.comps);
    const interestArgs = [interestName] as Array<Interest.CtorArg>;
    if (this.config.canBePrefix) {
      // Be aware that if CanBePrefix is set, you may need to also validate the data against the LeafNode's validator.
      interestArgs.push(Interest.CanBePrefix);
    }
    if (this.config.mustBeFresh ?? true) {
      interestArgs.push(Interest.MustBeFresh);
    }
    const appParam = opts.appParam instanceof Uint8Array
      ? opts.appParam
      : typeof opts.appParam === 'string'
      ? new TextEncoder().encode(opts.appParam)
      : undefined;
    if (appParam) {
      interestArgs.push(appParam);
    }
    // TODO: FwHint is not supported for now. Who should provide this info?
    const lifetimeMs = opts.lifetimeMs ?? this.config.lifetimeMs;
    interestArgs.push(Interest.Lifetime(lifetimeMs));
    const interest = new Interest(...interestArgs);

    // Compute deadline
    const deadline = opts.deadline ?? (Date.now() + lifetimeMs);

    // Get a signer for this interest
    const signer = opts.signer ?? this.config.interestSigner;

    // If appParam is empty and not signed, the Interest name is final.
    // Otherwise, we have to construct the Interest first before searching storage.
    // Get a signer for Interest.
    let cachedData: Data | undefined = undefined;
    if (!appParam && !signer) {
      cachedData = await this.searchCache(matched, interest, deadline);
      if (cachedData) {
        return cachedData;
      }
    }

    // After signing the digest is there
    if (signer) {
      await signer.sign(interest);
    }
    // We may search the storage if not yet. However, it seems not useful for now.

    // Express the Interest if not surpressed
    const supressInterest = opts.supressInterest ?? this.config.supressInterest;
    if (supressInterest) {
      return undefined;
    }

    const data = await this.handler!.endpoint!.consume(interest, {
      // deno-lint-ignore no-explicit-any
      signal: opts.abortSignal as any,
      retx: this.config.retx,
      // Note: the verifier is at the LeafNode if CanBePrefix is set
      verifier: this.handler!.getVerifier(deadline),
    });

    // (no await) Save (cache) the data in the storage
    this.handler!.storeData(data);

    return data;
  }
}
