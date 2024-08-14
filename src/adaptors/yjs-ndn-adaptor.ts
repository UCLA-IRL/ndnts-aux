import { SyncAgent } from '../sync-agent/mod.ts';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import { Bundler } from './bundler.ts';

// Adam Chen Additional Imports
import { Decoder, Encoder } from '@ndn/tlv';
import { Component, Data, Name } from '@ndn/packet';
import { Version } from '@ndn/naming-convention2';
import { StateVector } from '@ndn/svs';

/**
 * NDN SVS Provider for Yjs. Wraps update into `SyncAgent`'s `update` channel.
 *
 * @example
 *   import * as Y from 'yjs'
 *   import { WebsocketProvider } from 'yjs-ndn-adaptor'
 *   const doc = new Y.Doc()
 *   const syncAgent = await SyncAgent.create(...)
 *   const provider = new WebsocketProvider(syncAgent, doc, 'doc-topic')
 */
export class NdnSvsAdaptor {
  private readonly callback = this.docUpdateHandler.bind(this);
  private readonly awarenessCallback = this.awarenessUpdateHandler.bind(this);

  #awarenessDocId: string | undefined;
  #awareness: Awareness | undefined;
  // Required as a Yjs provider
  public get awareness() {
    return this.#awareness;
  }

  #bundler: Bundler | undefined;

  constructor(
    public syncAgent: SyncAgent,
    public readonly doc: Y.Doc,
    public readonly topic: string,
    useBundler: boolean = false,
  ) {
    syncAgent.register('update', topic, (content) => this.handleSyncUpdate(content));
    // Adam Chen callback on receiving a snapshot blob for Injection Point 3
    syncAgent.register('blob', 'snapshot', (content) => this.handleSnapshotUpdate(content));
    doc.on('update', this.callback);
    if (useBundler) {
      // this.#bundler = new Bundler(
      //   Y.mergeUpdates,
      //   (content) => this.syncAgent.publishUpdate(this.topic, content),
      //   {
      //     thresholdSize: 3000,
      //     delayMs: 400,
      //     maxDelayMs: 1600,
      //   },
      // );

      // Adam Chen Injection Point 1 override
      this.#bundler = new Bundler(
        Y.mergeUpdates,
        (content) => this.publishUpdate(this.topic, content),
        {
          thresholdSize: 3000,
          delayMs: 400,
          maxDelayMs: 1600,
        },
      );
    }
  }

  public bindAwareness(subDoc: Y.Doc, docId: string) {
    this.#awarenessDocId = docId;
    this.#awareness = new Awareness(subDoc); // TODO: Should we do so?
    this.#awareness.on('update', this.awarenessCallback);
    this.syncAgent.register('status', this.topic, (content) => this.handleAwarenessUpdate(content));
  }

  public cancelAwareness() {
    this.#awarenessDocId = undefined;
    this.syncAgent.unregister('status', this.topic);
    this.#awareness?.off('update', this.awarenessCallback);
    this.#awareness?.destroy();
  }

  public destroy() {
    this.cancelAwareness();
    this.doc.off('update', this.callback);
    this.syncAgent.unregister('update', this.topic);
  }

  private docUpdateHandler(update: Uint8Array, origin: undefined) {
    if (origin !== this) {
      this.produce(update); // No need to await
    }
  }

  private awarenessUpdateHandler(_updatedClients: {
    added: number[];
    updated: number[];
    removed: number[];
  }, origin: unknown | 'local') {
    if (origin !== 'local') {
      // Only capture local updates
      return;
    }
    // Capture and publish local state
    const localState = this.#awareness!.getLocalState();
    const encodedState = JSON.stringify({
      clientId: this.#awareness!.clientID,
      docId: this.#awarenessDocId,
      state: localState,
    });
    this.syncAgent.publishStatus(this.topic, new TextEncoder().encode(encodedState));
  }

  private async produce(content: Uint8Array) {
    if (this.#bundler) {
      await this.#bundler.produce(content);
    } else {
      // await this.syncAgent.publishUpdate(this.topic, content);

      // Adam Chen Injection point 1 override
      await this.publishUpdate(this.topic, content);
    }
  }

  // Adam Chen Injection point 1
  private async publishUpdate(topic: string, content: Uint8Array) {
    await this.syncAgent.publishUpdate(topic, content);
    // await new Promise(r => setTimeout(r,500));
    // forced wait so that publishUpdate() is completed before we check SV.
    console.log('-- Injection point 1: Check StateVector / Create Snapshot --');
    const stateVector = this.syncAgent.getUpdateSyncSV();
    console.log('debug: stateVector object: ', stateVector);
    let count = 0;
    for (const [_id, seq] of stateVector) {
      count += seq;
    }
    console.log('Total count of state vector', count);
    console.log('The above number should match the state vector in the debug page');
    if (count % 5 == 0) {
      console.log("It's time to make a snapshot!");
      console.log('debug: group prefix: ', this.syncAgent.appPrefix.toString());
      const encodedSV = Encoder.encode(stateVector);
      const snapshotPrefix = this.syncAgent.appPrefix.append('32=snapshot');
      // New SVS encodings
      const snapshotName = snapshotPrefix.append(new Component(Version.type, encodedSV));
      console.log('debug: targeted snapshot Prefix (persistStore key): ', snapshotPrefix.toString());
      // /groupPrefix/32=snapshot/
      console.log('debug: targeted snapshot Name: ', snapshotName.toString());
      // /groupPrefix/32=snapshot/54=<stateVector>
      const decodedSV = Decoder.decode(snapshotName.at(-1).value, StateVector);
      console.log('debug: decoding encoded SV from snapshotName: ', decodedSV);
      let count = 0;
      for (const [_id, seq] of decodedSV) {
        count += seq;
      }
      console.log('debug: decoding encoded SV total packet count: ', count);
      console.log('This should match the state vector in the debug page and the previous count before encoding');

      const content = Y.encodeStateAsUpdate(this.doc);
      // its already in UTF8, transporting currently without any additional encoding.
      console.log('yjs backend data: ', content);

      // use syncAgent's blob and publish mechanism - use a different topic.

      await this.syncAgent.publishBlob('snapshot', content, snapshotName, true);

      //first segmented object is at /50=%00
      const firstSegmentName = snapshotName.append('50=%00').toString();
      console.log('debugTargetName: ', firstSegmentName);
      const firstSegmentPacketEncoded = await this.syncAgent.persistStorage.get(firstSegmentName);
      if (firstSegmentPacketEncoded) {
        const firstSegmentPacket = Decoder.decode(firstSegmentPacketEncoded, Data);
        console.log('persistentStore check: ', firstSegmentPacket);
        console.log('persistentStore check Data Name:', firstSegmentPacket.name.toString());
        await this.syncAgent.persistStorage.set(snapshotPrefix.toString(), Encoder.encode(firstSegmentPacket));
      }
    }
  }
  // End Injection point 1

  // -- Adam Chen Injection Point 3: HandleSnapshotUpdate --
  async handleSnapshotUpdate(snapshotName: Uint8Array) {
    // Maybe it's wise to put this under a try() because it might fail due to network issues.
    const decodedSnapshotName = Decoder.decode(snapshotName, Name);
    console.log('-- Adam Chen Injection Point 3: Update Latest Snapshot (Received) --');
    console.log('Handling received snapshot packet with name: ', decodedSnapshotName.toString());

    const snapshotPrefix = this.syncAgent.appPrefix.append('32=snapshot');
    console.log('snapshot prefix in persistStorage: ', snapshotPrefix.toString());
    const oldSnapshotFirstSegmentEncoded = await this.syncAgent.persistStorage.get(snapshotPrefix.toString());
    let oldSVCount = 0;
    if (oldSnapshotFirstSegmentEncoded) {
      const oldSnapshotFirstSegment = Decoder.decode(oldSnapshotFirstSegmentEncoded, Data);
      const oldSnapshotVector = Decoder.decode(oldSnapshotFirstSegment.name.at(-2).value, StateVector);
      for (const [_id, seq] of oldSnapshotVector) {
        oldSVCount += seq;
      }
    }

    const snapshotSV = Decoder.decode(decodedSnapshotName.at(-1).value, StateVector);
    let snapshotSVcount = 0;
    for (const [_id, seq] of snapshotSV) {
      snapshotSVcount += seq;
    }

    console.log('current state vector total count: ', oldSVCount);
    console.log('snapshot state vector total count: ', snapshotSVcount);

    if (snapshotSVcount > oldSVCount) {
      const firstSegmentName = decodedSnapshotName.append('50=%00').toString();
      console.log('Retrieving the following from persist Storage: ', firstSegmentName);
      // await this.syncAgent.getBlob(decodedSnapshotName)
      await new Promise((r) => setTimeout(r, 1000));
      const firstSegmentPacketEncoded = await this.syncAgent.persistStorage.get(firstSegmentName);
      if (firstSegmentPacketEncoded) {
        console.log('Debug: Retrieval results: ', firstSegmentPacketEncoded);
        const firstSegmentPacket = Decoder.decode(firstSegmentPacketEncoded, Data);
        console.log('Writing this packet: ', firstSegmentPacket.name.toString());
        console.log('To this location: ', snapshotPrefix.toString());
        // this is done to update the key of the prefix so program return latest when blind fetching.
        this.syncAgent.persistStorage.set(snapshotPrefix.toString(), Encoder.encode(firstSegmentPacket));
        // should set snapshotPrefix to the newest packet.
      } else {
        console.log('PersistentStorage doesnt have the snapshot yet. Skipping update.');
      }
    }
  }
  // End Injection point 3

  public handleSyncUpdate(content: Uint8Array) {
    // Apply patch
    // Remark: `applyUpdate` will trigger a transaction after the update is decoded.
    // We can register "beforeTransaction" event and throw an exception there to do access control.
    // The exception is supposed to abort `applyUpdate` and propagated out of this call.
    // This is the way we planned to implement access control.
    // SA: https://docs.yjs.dev/api/y.doc#order-of-events
    // https://github.com/yjs/yjs/blob/fe36ffd122a6f2384293098afd52d2c0025fce2a/src/utils/encoding.js#L384-L384
    // https://github.com/yjs/yjs/blob/fe36ffd122a6f2384293098afd52d2c0025fce2a/src/utils/Transaction.js#L415-L426
    Y.applyUpdate(this.doc, content, this);
  }

  public handleAwarenessUpdate(content: Uint8Array) {
    const encodedState = JSON.parse(new TextDecoder().decode(content));
    const { clientId, docId, state } = encodedState as {
      clientId: number;
      docId: string;
      state: Record<string, unknown> | null;
    };
    const awareness = this.#awareness;
    if (!awareness) {
      return;
    }

    const prevMeta = awareness.meta.get(clientId);
    let op: 'added' | 'updated' | 'removed';
    if (prevMeta === undefined && docId === this.#awarenessDocId && state !== null) {
      op = 'added';
    } else if (prevMeta !== undefined && (docId !== this.#awarenessDocId || state === null)) {
      op = 'removed';
    } else if (docId === this.#awarenessDocId) {
      op = 'updated';
    } else {
      return;
    }

    if (op === 'removed' || !state) {
      awareness.states.delete(clientId);
    } else {
      awareness.states.set(clientId, state);
    }
    awareness.meta.set(clientId, {
      clock: 0,
      lastUpdated: Date.now(),
    });
    awareness.emit('change', [{ added: [], updated: [], removed: [], [op]: [clientId] }, this]);
  }
}
