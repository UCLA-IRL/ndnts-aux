// // Modified from @ndn/segmented-object/src/fetch/fetcher.ts
// // ISC License
// // Copyright (c) 2019-2024, Junxiao Shi
// import { Data, NamingConvention, Verifier } from '@ndn/packet';
// import * as Pattern from '../name-pattern.ts';
// import * as Schema from '../schema-tree.ts';
// // @deno-types="@ndn/segmented-object/lib/fetch/logic.d.ts"
// import { FetchLogic } from '@ndn/segmented-object/lib/fetch/logic_browser.js';
// import { LeafNode } from '../leaf-node.ts';
// import { NNI } from '@ndn/tlv';
// import { EventChain } from '../../utils/mod.ts';

// export type SegmentConvention = NamingConvention<number>;
// export type PipelineOptions = FetchLogic.Options;

// export interface EventMap {
//   /** Emitted when a Data segment arrives. Note: it is blocking */
//   segment(segNum: number, data: Data): Promise<void>;
//   /** Emitted after all data chunks arrive. */
//   end(): Promise<void>;
//   /** Emitted upon error. */
//   error(err: Error): Promise<void>;
// }

// type PipelinePacket = {
//   segNum: number;
//   matched: Schema.MatchedObject<LeafNode>;
//   lifetimeMs: number;
//   toCancel: boolean;
//   internalId: number;
// };

// /** Fetch Data packets as guided by FetchLogic. */
// export class Fetcher {
//   #count = 0;
//   #internalId = 0;
//   #hasFailed = false;
//   readonly #intSignals: Map<number, AbortController> = new Map();
//   readonly #mapping: Pattern.Mapping;
//   readonly #handleAbort;
//   readonly segmentPattern: string;
//   readonly verifier: Verifier | undefined;

//   public readonly onSegment = new EventChain<EventMap['segment']>();
//   public readonly onEnd = new EventChain<EventMap['end']>();
//   public readonly onError = new EventChain<EventMap['error']>();

//   /** Number of segments retrieved so far. */
//   public get count() {
//     return this.#count;
//   }

//   private readonly logic: FetchLogic;
//   private readonly signal?: AbortSignal;
//   private readonly lifetimeAfterRto!: number;

//   constructor(
//     /** The leaf node representing the segments */
//     readonly node: Schema.Node<LeafNode>,
//     prefixMapping: Pattern.Mapping,
//     opts: FetcherOptions,
//   ) {
//     this.signal = opts.signal;
//     this.lifetimeAfterRto = opts.lifetimeAfterRto ?? 1000;
//     this.segmentPattern = opts.segmentPattern ?? (node.upEdge as Pattern.PatternComponent).tag;
//     this.verifier = opts.verifier;
//     this.#mapping = { ...prefixMapping };

//     this.logic = new FetchLogic(opts);
//     this.logic.addEventListener('end', async () => {
//       await this.onEnd.emit();
//       this.close();
//     });
//     this.logic.addEventListener('exceedRetxLimit', ({ detail: segNum }) => {
//       this.fail(new Error(`cannot retrieve segment ${segNum}`));
//     });

//     this.#handleAbort = () => {
//       this.fail(new Error('fetch aborted'));
//     };
//     this.signal?.addEventListener('abort', this.#handleAbort);
//   }

//   public close(): void {
//     this.signal?.removeEventListener('abort', this.#handleAbort);
//     this.logic.close();
//   }

//   /**
//    * Pause outgoing Interests, for backpressure from Data consumer.
//    * @returns Function for resuming.
//    */
//   public pause() {
//     return this.logic.pause();
//   }

//   public async run() {
//     const sender = this.logic.outgoing(
//       ({ segNum, rto }) =>
//         ({
//           segNum,
//           matched: Schema.apply(this.node, { ...this.#mapping, [this.segmentPattern]: segNum }),
//           lifetimeMs: rto + this.lifetimeAfterRto,
//           toCancel: false,
//           internalId: this.#internalId++,
//         }) satisfies PipelinePacket,
//       ({ interest }) => ({ ...interest, toCancel: true }) satisfies PipelinePacket,
//     ) as AsyncGenerator<PipelinePacket>;

//     for await (const action of sender) {
//       if (action.toCancel) {
//         // TODO: Should use TX at NTSchema to avoid overhead
//         this.#intSignals.get(action.internalId)?.abort();
//         this.#intSignals.delete(action.internalId);
//       } else {
//         // Create Interest without waiting
//         this.shoot(action);
//       }
//     }
//   }

//   private async shoot({ segNum, matched, lifetimeMs, internalId }: PipelinePacket) {
//     const abortCtl = new AbortController();
//     const abortSignal = abortCtl.signal;
//     this.#intSignals.set(internalId, abortCtl);

//     try {
//       const verifier = this.verifier;
//       const data = await Schema.call(matched, 'need', { abortSignal, lifetimeMs, verifier });

//       const now = this.logic.now();
//       this.logic.satisfy(segNum, now, false); // TODO: congestionMark
//       if (data.isFinalBlock) {
//         this.logic.setFinalSegNum(segNum);
//       } else if (data.finalBlockId && data.finalBlockId.type === this.node.upEdge?.type) {
//         this.logic.setFinalSegNum(NNI.decode(data.finalBlockId.value), true);
//       }
//       ++this.#count;
//       await this.onSegment.emit(segNum, data);
//     } catch (err) {
//       if (err instanceof Error && err.message.startsWith('Interest rejected')) {
//         // Silently ignore timeouts
//       } else {
//         // Pass verification error
//         this.fail(new Error(`failed to fetch segment ${segNum}: ${err}`));
//       }
//     }
//   }

//   private fail(err: Error): void {
//     if (this.#hasFailed) {
//       return;
//     }
//     this.#hasFailed = true;
//     setTimeout(async () => {
//       await this.onError.emit(err);
//       this.close();
//     }, 0);
//   }
// }

// export interface FetcherOptions extends FetchLogic.Options {
//   /** AbortSignal that allows canceling the Interest via AbortController. */
//   signal?: AbortSignal;

//   /**
//    * InterestLifetime added to RTO.
//    * @defaultValue 1000ms
//    *
//    * @remarks
//    * Ignored if `lifetime` is set.
//    */
//   lifetimeAfterRto?: number;

//   /**
//    * The name of the pattern variable for segment
//    * @defaultValue parent edge of node
//    */
//   segmentPattern?: string;

//   /**
//    * The verifier to verify received segments.
//    * By default, the one configured at the LeafNode will be used.
//    */
//   verifier?: Verifier;
// }

// export interface SegmentData {
//   segNum: number;
//   data: Data;
// }

// export class SegmentDataEvent extends Event implements SegmentData {
//   constructor(type: string, public readonly segNum: number, public readonly data: Data) {
//     super(type);
//   }
// }
