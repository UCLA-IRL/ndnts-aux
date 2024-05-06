// import { Component, Data, Signer, Verifier } from '@ndn/packet';
// import { assert, concatBuffers, Reorder } from '@ndn/util';
// import type { ChunkSource } from '@ndn/segmented-object';
// import { Encoder, NNI } from '@ndn/tlv';
// import { collect, map, type WritableStreamish, writeToStream } from 'streaming-iterables';
// import type { Promisable } from 'type-fest';
// import { EventIterator } from 'event-iterator';
// import { BaseNode } from '../base-node.ts';
// import * as Pattern from '../name-pattern.ts';
// import * as Schema from '../schema-tree.ts';
// import { LeafNode } from '../leaf-node.ts';
// import { Fetcher, FetcherOptions, PipelineOptions } from './fetcher.ts';

// export interface Result extends PromiseLike<Uint8Array>, AsyncIterable<Data> {
//   /** Iterate over Data packets as they arrive, not sorted in segment number order. */
//   unordered: () => AsyncIterable<Data & { readonly segNum: number }>;

//   /** Iterate over payload chunks in segment number order. */
//   chunks: () => AsyncIterable<Uint8Array>;

//   /** Write all chunks to the destination stream. */
//   pipe: (dest: WritableStreamish) => Promise<void>;

//   /** Number of segments retrieved so far. */
//   readonly count: number;
// }

// type SegmentData = {
//   segNum: number;
//   data: Data;
// };

// class FetchResult implements Result {
//   constructor(
//     private readonly node: Schema.Node<LeafNode>,
//     private readonly prefixMapping: Pattern.Mapping,
//     private readonly opts: FetcherOptions,
//   ) {}

//   public get count(): number {
//     return this.ctx?.count ?? 0;
//   }
//   private ctx?: Fetcher;
//   private promise?: Promise<Uint8Array>;

//   private startFetcher() {
//     assert(!this.ctx, 'FetchResult is already used');
//     const ctx = new Fetcher(this.node, this.prefixMapping, this.opts);
//     this.ctx = ctx;
//     ctx.run();
//     return new EventIterator<SegmentData>(({ push, stop, fail, on }) => {
//       let resume: (() => void) | undefined;
//       on('highWater', () => {
//         resume = ctx.pause();
//       });
//       on('lowWater', () => {
//         resume?.();
//       });

//       const abort = new AbortController();
//       ctx.onSegment.addListener((segNum, data) => Promise.resolve(push({ segNum, data })));
//       ctx.onEnd.addListener(() => Promise.resolve(stop()));
//       // ctx.addEventListener('error', ({ detail }) => fail(detail), { signal: abort.signal });
//       const errorListener = (err: Error) => Promise.resolve(fail(err));
//       ctx.onError.addListener(errorListener);
//       abort.signal.addEventListener('abort', () => {
//         ctx.onError.removeListener(errorListener);
//       });
//       return () => {
//         resume?.();
//         abort.abort();
//       };
//     });
//   }

//   public unordered() {
//     return map(
//       ({ data, segNum }) => Object.assign(data, { segNum }),
//       this.startFetcher(),
//     );
//   }

//   private async *ordered() {
//     const reorder = new Reorder<Data>(this.opts.segmentRange?.[0]);
//     for await (const { segNum, data } of this.startFetcher()) {
//       reorder.push(segNum, data);
//       yield* reorder.shift();
//     }
//     assert(reorder.empty, `${reorder.size} leftover segments`);
//   }

//   public chunks() {
//     return map((data) => data.content, this.ordered());
//   }

//   public pipe(dest: WritableStreamish) {
//     return writeToStream(dest, this.chunks());
//   }

//   private async startPromise() {
//     const chunks = await collect(this.chunks());
//     return concatBuffers(chunks);
//   }

//   public then<R, J>(
//     onfulfilled?: ((value: Uint8Array) => Promisable<R>) | null,
//     onrejected?: ((reason: unknown) => Promisable<J>) | null,
//   ) {
//     this.promise ??= this.startPromise();
//     return this.promise.then(onfulfilled, onrejected);
//   }

//   public [Symbol.asyncIterator]() {
//     return this.ordered()[Symbol.asyncIterator]();
//   }
// }

// export type SegmentedObjectOpts = {
//   /** The leaf node representing the segments */
//   leafNode: Schema.Node<LeafNode>;

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
//    * The Component type of the segment
//    * @defaultValue parent edge of node
//    */
//   segmentType?: number;

//   pipelineOpts?: PipelineOptions;
// };

// export class SegmentedObjectNode extends BaseNode {
//   lifetimeAfterRto: number;
//   segmentPattern: string;
//   segmentType: number;
//   leafNode: Schema.Node<LeafNode>;
//   pipelineOpts: PipelineOptions;

//   constructor(
//     config: SegmentedObjectOpts,
//     describe?: string,
//   ) {
//     super(describe);
//     this.leafNode = config.leafNode;
//     this.lifetimeAfterRto = config.lifetimeAfterRto ?? 1000;
//     this.segmentPattern = config.segmentPattern ?? (this.leafNode.upEdge as Pattern.PatternComponent).tag;
//     this.segmentType = config.segmentType ?? this.leafNode.upEdge!.type;
//     this.pipelineOpts = config.pipelineOpts ?? {};
//   }

//   public async provide(
//     matched: Schema.StrictMatch<SegmentedObjectNode>,
//     source: ChunkSource,
//     opts: {
//       freshnessMs?: number;
//       validityMs?: number;
//       signer?: Signer;
//     } = {},
//   ) {
//     const results = [];
//     for await (const chunk of source.listChunks()) {
//       const leaf = Schema.apply(this.leafNode, {
//         ...matched.mapping,
//         [this.segmentPattern]: chunk.i,
//       }) as Schema.StrictMatch<LeafNode>;
//       results.push(
//         await Schema.call(leaf, 'provide', chunk.payload, {
//           freshnessMs: opts.freshnessMs,
//           validityMs: opts.validityMs,
//           signer: opts.signer,
//           finalBlockId: chunk.final ? new Component(this.segmentType, Encoder.encode(NNI(chunk.final))) : undefined,
//         }),
//       );
//     }
//     return results;
//   }

//   public need(
//     matched: Schema.StrictMatch<SegmentedObjectNode>,
//     opts: {
//       abortSignal?: AbortSignal;
//       lifetimeAfterRto?: number;
//       verifier?: Verifier;
//     } = {},
//   ): Result {
//     return new FetchResult(this.leafNode, matched.mapping, {
//       ...this.pipelineOpts,
//       ...opts,
//       segmentPattern: this.segmentPattern,
//     });
//   }
// }
