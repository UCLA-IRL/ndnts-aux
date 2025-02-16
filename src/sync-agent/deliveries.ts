import * as endpoint from '@ndn/endpoint';
import { type Forwarder } from '@ndn/fw';
import { StateVector, SvSync, type SyncNode, type SyncUpdate } from '@ndn/svs';
import { Data, digestSigning, Name, Signer, type Verifier } from '@ndn/packet';
import { SequenceNum } from '@ndn/naming-convention2';
import { Decoder, Encoder } from '@ndn/tlv';
import { fetch as fetchSegments, TcpCubic } from '@ndn/segmented-object';
import { getNamespace } from './namespace.ts';
import { Storage } from '../storage/mod.ts';
import { LimitedCwnd, panic } from '../utils/mod.ts';

export function encodeSyncState(state: StateVector): Uint8Array {
  return Encoder.encode(state);
}

export function parseSyncState(vector: Uint8Array): StateVector {
  try {
    const ret = Decoder.decode(vector, StateVector);
    return ret;
  } catch (e) {
    console.error(`Unable to parse StateVector: `, e);
    return new StateVector();
  }
}

export type UpdateEvent = (content: Uint8Array, id: Name, instance: SyncDelivery) => Promise<void>;

const fireSvSync = (inst: SvSync) => {
  (inst as unknown as { resetTimer: (immediate?: boolean) => void }).resetTimer(true);
};

/**
 * SyncDelivery is a SVS Sync instance associated with a storage.
 * It handles update notification and production, but does not serve Data packets.
 */
export abstract class SyncDelivery implements AsyncDisposable {
  readonly baseName: Name;
  protected _syncInst?: SvSync;
  protected _syncNode?: SyncNode;
  protected _ready = false;
  protected _startPromise: Promise<void>;
  protected _onUpdate?: UpdateEvent;
  private _startPromiseResolve?: () => void;
  protected _onReset?: () => void;
  protected _abortController: AbortController;
  protected _lastTillNow: StateVector;

  // TODO: Use options to configure parameters
  constructor(
    readonly nodeId: Name,
    readonly fw: Forwarder,
    readonly syncPrefix: Name,
    readonly signer: Signer,
    readonly verifier: Verifier,
    onUpdatePromise: Promise<UpdateEvent>,
    protected state?: StateVector,
  ) {
    // const nodeId = getNamespace().nodeIdFromSigner(this.signer.name)
    this.baseName = getNamespace().baseName(nodeId, syncPrefix);
    this._startPromise = new Promise((resolve) => {
      this._startPromiseResolve = resolve;
      if (this._ready) {
        resolve();
      }
    });
    this._abortController = new AbortController();
    this._lastTillNow = new StateVector(this.state);

    SvSync.create({
      fw: fw,
      syncPrefix: syncPrefix,
      signer: signer,
      verifier: verifier,
      initialStateVector: new StateVector(state),
      initialize: async (svSync) => {
        this._syncInst = svSync;
        this._syncInst.addEventListener('update', (update) => this.handleSyncUpdate(update));
        this._syncNode = this._syncInst.add(nodeId);
        this._onUpdate = await onUpdatePromise;
        await this._startPromise;
      },
    }).then((value) => {
      // Force triggering the SvSync to fire
      // NOTE: NDNts does not expose a way to trigger the SVS manually
      fireSvSync(value);
    });
  }

  /**
   * True if the Sync has started, even in reset state.
   */
  public get ready(): boolean {
    return this._ready;
  }

  public get syncInst(): SvSync | undefined {
    return this._syncInst;
  }

  public get syncNode(): SyncNode<SvSync.ID> | undefined {
    return this._syncNode;
  }

  public get syncState(): StateVector {
    return new StateVector(this.state);
  }

  /**
   * The callback on Sync updates. Note that AtLeastOnce requires all callbacks to be registered before Sync starts.
   * Therefore, we fix the number of callbacks to one and leave demultiplexing to the SyncAgent.
   */
  public get onUpdate(): UpdateEvent | undefined {
    return this._onUpdate;
  }

  public get onReset(): (() => void) | undefined {
    return this._onReset;
  }

  public set onReset(value: (() => void) | undefined) {
    this._onReset = value;
  }

  start() {
    if (!this._ready) {
      this._ready = true;
      if (this._startPromiseResolve !== undefined) {
        this._startPromiseResolve();
      }
    }
  }

  async destroy(storage?: Storage) {
    // Note: the abstract class does not know where is the storage to store SVS vector.
    // Derived classes will override this with `destroy()`
    this._ready = false;
    this._abortController.abort('SvsDelivery Destroyed');
    if (this._syncInst !== undefined) {
      this._syncInst.close();
      if (storage !== undefined) {
        await this.storeSyncState(storage);
      }
    } else {
      throw new Error('Current implementation does not support destroy before start.');
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    return await this.destroy();
  }

  public async reset(): Promise<void> {
    if (this._syncInst === undefined || !this._ready) {
      throw new Error('Please do not reset before start.');
    }
    console.warn('A Sync reset is scheduled.');
    this._abortController.abort('Reset');
    this._abortController = new AbortController();
    this._lastTillNow = new StateVector(this.state);
    this._syncInst.close();
    this._syncNode = undefined;
    const svSync = await SvSync.create({
      fw: this.fw,
      syncPrefix: this.syncPrefix,
      signer: digestSigning,
      // We can do so because the state has not been set
      initialStateVector: new StateVector(this.state),
      initialize: (svSync) => {
        this._syncInst = svSync;
        this._syncInst.addEventListener('update', (update) => this.handleSyncUpdate(update));
        // const nodeId = getNamespace().nodeIdFromSigner(this.signer.name)
        this._syncNode = this._syncInst.add(this.nodeId);
        // this._ready should already be true
        return Promise.resolve();
      },
    });
    // Force trigger the SvSync to fire
    fireSvSync(svSync);
  }

  /** Trigger the SVS to send a Sync Interest so that one can get latest updates. */
  public fire() {
    if (this._syncInst !== undefined && this._ready) {
      fireSvSync(this._syncInst);
    }
  }

  protected async setSyncState(nodeId: Name, seq: number, storage?: Storage) {
    if (this.state !== undefined) {
      this.state.set(nodeId, seq);
      if (storage !== undefined) {
        await this.storeSyncState(storage);
      }
    }
  }

  protected async storeSyncState(storage: Storage) {
    if (this.state !== undefined) {
      await storage.set(
        getNamespace().syncStateKey(this.baseName),
        encodeSyncState(this.state),
      );
    }
  }

  get seqNum(): number {
    return this.syncNode!.seqNum;
  }

  // get nodeId() {
  //   return this.syncNode!.id
  // }

  abstract handleSyncUpdate(update: SyncUpdate<Name>): Promise<void>;

  abstract produce(content: Uint8Array): Promise<void>;
}

// At least once delivery (closer to exactly once). Used for Y.Doc updates and large blob.
// This class does not handle segmentation and reordering.
// Note: storage is not necessarily a real storage.
export class AtLeastOnceDelivery extends SyncDelivery {
  constructor(
    override readonly nodeId: Name,
    override readonly fw: Forwarder,
    override readonly syncPrefix: Name,
    override readonly signer: Signer,
    override readonly verifier: Verifier,
    readonly storage: Storage,
    onUpdatePromise: Promise<UpdateEvent>,
    protected override state?: StateVector,
  ) {
    super(nodeId, fw, syncPrefix, signer, verifier, onUpdatePromise, state);
  }

  override async handleSyncUpdate(update: SyncUpdate<Name>) {
    // Note: No guarantee this function is single entry. Need to separate delivery thread with the fetcher.
    // Updated: since it is hard to do so, I did a quick fix by dropping the ordering requirement.

    const prefix = getNamespace().baseName(update.id, this.syncPrefix);
    // Modify NDNts's segmented object fetching pipeline to fetch sequences.
    // fetchSegments is not supposed to be working with sequence numbers, but I can abuse the convention
    const continuation = fetchSegments(prefix, {
      segmentNumConvention: SequenceNum,
      segmentRange: [update.loSeqNum, update.hiSeqNum + 1],
      retxLimit: 600,
      lifetimeAfterRto: 1000, // Lifetime = RTO + 1000
      // The true timeout timer is the RTO, specified below
      rtte: {
        initRto: 50,
        // Minimal RTO is 50ms
        // Note: This has to be small enough to quickly trigger the path switch of BestRoute strategy
        // However, due to an implementation flaw of SegmentFetcher, RTO only doubles once per window.
        // Thus, maxRTO does not make any sense most of the time: the RTT in Workspace can only be very small
        // (when Interest is forwarded to right path) or very large (when wrong path or Data missing).
        // Therefore, before the SegmentFetcher issue can get resolved, we use the retxLimit to control the
        // maximum timeout: retxLimit = Expected Timeout / (2 * minRto)
        // Default expected timeout is 1 min, thus retxLimit == 600
        minRto: 50,
        maxRto: 2000,
      },
      ca: new LimitedCwnd(new TcpCubic(), 10),
      verifier: this.verifier,
      fw: this.fw,
      // WARN: an abort controller is required! NDNts's fetcher cannot close itself even after
      // the face is destroyed and there exists no way to send the Interest.
      // deno-lint-ignore no-explicit-any
      signal: this._abortController.signal as any,
    });
    let lastHandled: number | undefined;
    try {
      for await (const data of continuation.unordered()) {
        lastHandled = data.name.get(data.name.length - 1)?.as(SequenceNum);
        // Put into storage
        // Note: even though endpoint.consume does not give me the raw Data packet,
        //       the encode result will be the same.
        await this.storage.set(data.name.toString(), Encoder.encode(data));

        // Callback
        // AtLeastOnce is required to have the callback acknowledged
        // before writing the new StateVector into the storage
        await this._onUpdate!(data.content, update.id, this);
      }
    } catch (error) {
      // If it is due to destroy, silently shutdown.
      if (!this._ready) {
        return;
      }

      // TODO: Find a better way to handle this
      console.error(`Unable to fetch or verify ${prefix}:${lastHandled} due to: `, error);
      console.warn('The current SVS protocol cannot recover from this error. A reset will be triggered');

      this._syncInst?.close();
      this._syncNode = undefined;

      if (this._onReset) {
        this._onReset();
      } else {
        this.reset();
      }

      return;
    }

    // // Putting this out of the loop makes it not exactly once:
    // // If the application is down before all messages in the update is handled,
    // // some may be redelivered the next time the application starts.
    // // Sinc Yjs allows an update to be applied multiple times, this should be fine.
    // await this.setSyncState(update.id, lastHandled, this.storage);

    // Updated: the original design contravened the AtLeastOnce guarantee due to gap and multi-entry of this function.
    let lastSeen = this._lastTillNow.get(update.id);
    if (lastSeen < update.hiSeqNum) {
      this._lastTillNow.set(update.id, update.hiSeqNum);
      lastSeen = update.hiSeqNum;
    }
    const front = this.syncState.get(update.id);
    // We don't know if update is next to front. If there is a gap, we must not do anything.
    if (update.loSeqNum > front + 1) {
      return;
    }
    // Otherwise, we move to hiSeqNum first, and check if there is anything further.
    let newSeq = update.hiSeqNum;
    const updateBaseName = getNamespace().baseName(update.id, this.syncPrefix);
    for (; newSeq < lastSeen; newSeq++) {
      // This can be optimized with some data structure like C++ set, but not now.
      const dataName = updateBaseName.append(SequenceNum.create(newSeq + 1));
      if (!await this.storage.has(dataName.toString())) {
        break;
      }
    }
    await this.setSyncState(update.id, newSeq, this.storage);
  }

  override async produce(content: Uint8Array) {
    if (this.syncNode === undefined) {
      throw new Error('[AtLeastOnceDelivery] Cannot produce before sync starts');
    }
    // REQUIRE ATOMIC {
    const seqNum = this.syncNode.seqNum + 1;
    this.syncNode.seqNum = seqNum; // This line must be called immediately to prevent race condition
    // }
    const name = this.baseName.append(SequenceNum.create(seqNum));
    const data = new Data(
      name,
      Data.FreshnessPeriod(60000),
      content,
    );
    await this.signer.sign(data);

    // NOTE: There is actually a small chance that the system is broken, since it is not locked.
    // However, I don't think it will happen in real life.
    // The time for `await this.storage.set` to return should always be shorter than
    // the time for the Agent to respond with this piece of Data
    await this.storage.set(name.toString(), Encoder.encode(data));

    // Save my own state to prevent reuse the sync number
    if (this.state!.get(this.syncNode.id) < seqNum) {
      this.setSyncState(this.syncNode.id, seqNum, this.storage);
    }
  }

  static async create(
    nodeId: Name,
    fw: Forwarder,
    syncPrefix: Name,
    signer: Signer,
    verifier: Verifier,
    storage: Storage,
    onUpdatePromise: Promise<UpdateEvent>,
  ): Promise<AtLeastOnceDelivery> {
    // const nodeId = getNamespace().nodeIdFromSigner(signer.name)
    const baseName = getNamespace().baseName(nodeId, syncPrefix);
    const encoded = await storage.get(getNamespace().syncStateKey(baseName));
    let syncState = new StateVector();
    if (encoded) {
      syncState = parseSyncState(encoded);
    }
    return new AtLeastOnceDelivery(nodeId, fw, syncPrefix, signer, verifier, storage, onUpdatePromise, syncState);
  }

  override async destroy(): Promise<void> {
    return await super.destroy(this.storage);
  }

  async replay(startFrom: StateVector, callback: UpdateEvent) {
    for (const [key, last] of this.syncState) {
      const first = startFrom.get(key);
      const prefix = getNamespace().baseName(key, this.syncPrefix);
      for (let i = first + 1; i <= last; i++) {
        const name = prefix.append(SequenceNum.create(i));
        const wire = await this.storage.get(name.toString());
        if (wire === undefined || wire.length === 0) {
          const errMsg = `[AtLeastOnceDelivery] FATAL: data missing from local storage: ${name}`;
          console.error(errMsg);
          panic(errMsg);
        } else if (wire.length > 0) {
          const data = Decoder.decode(wire, Data);
          await callback(data.content, key, this);
        }
      }
    }
  }
}

// Latest only delivery. Used for status and awareness.
// This delivery does not persists anything.
export class LatestOnlyDelivery extends SyncDelivery {
  constructor(
    override readonly nodeId: Name,
    override readonly fw: Forwarder,
    override readonly syncPrefix: Name,
    override readonly signer: Signer,
    override readonly verifier: Verifier,
    readonly pktStorage: Storage,
    readonly stateStorage: Storage,
    readonly onUpdatePromise: Promise<UpdateEvent>,
    protected override state?: StateVector,
  ) {
    super(nodeId, fw, syncPrefix, signer, verifier, onUpdatePromise, state);
  }

  override async handleSyncUpdate(update: SyncUpdate<Name>) {
    const prefix = getNamespace().baseName(update.id, this.syncPrefix);
    const name = prefix.append(SequenceNum.create(update.hiSeqNum));
    try {
      const data = await endpoint.consume(name, { verifier: this.verifier, fw: this.fw });

      // Update the storage
      // Note that this will overwrite old data
      // TODO: How to serve?
      this.pktStorage.set(getNamespace().latestOnlyKey(name), Encoder.encode(data));

      // Save Sync state
      await this.setSyncState(update.id, update.hiSeqNum, this.stateStorage);

      // Callback
      // LatestOnlyDelivery does not need to wait for this callback
      this._onUpdate!(data.content, update.id, this);
    } catch {
      // console.error(`Unable to fetch or verify ${name.toString()} due to: `, error);
      // Silently continue
    }
  }

  override async produce(content: Uint8Array) {
    if (this.syncNode === undefined) {
      throw new Error('[AtLeastOnceDelivery] Cannot produce before sync starts');
    }
    // REQUIRE ATOMIC {
    const seqNum = this.syncNode.seqNum + 1;
    this.syncNode.seqNum = seqNum; // This line must be called immediately to prevent race condition
    // }
    const name = this.baseName.append(SequenceNum.create(seqNum));
    const data = new Data(
      name,
      Data.FreshnessPeriod(60000),
      content,
    );
    await this.signer.sign(data);

    this.pktStorage.set(getNamespace().latestOnlyKey(name), Encoder.encode(data));

    // Save my own state to prevent reuse the sync number
    if (this.state!.get(this.syncNode.id) < seqNum) {
      this.setSyncState(this.syncNode.id, seqNum, this.stateStorage);
    }
  }

  static async create(
    nodeId: Name,
    fw: Forwarder,
    syncPrefix: Name,
    signer: Signer,
    verifier: Verifier,
    pktStorage: Storage,
    stateStorage: Storage,
    onUpdatePromise: Promise<UpdateEvent>,
  ): Promise<LatestOnlyDelivery> {
    // Load state is still required to avoid sequence number conflict
    // const nodeId = getNamespace().nodeIdFromSigner(signer.name)
    const baseName = getNamespace().baseName(nodeId, syncPrefix);
    const encoded = await stateStorage.get(getNamespace().syncStateKey(baseName));
    let syncState = new StateVector();
    if (encoded) {
      syncState = parseSyncState(encoded);
    }
    return new LatestOnlyDelivery(
      nodeId,
      fw,
      syncPrefix,
      signer,
      verifier,
      pktStorage,
      stateStorage,
      onUpdatePromise,
      syncState,
    );
  }

  override async destroy(): Promise<void> {
    return await super.destroy(this.stateStorage);
  }
}
