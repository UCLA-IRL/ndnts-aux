import { SyncAgent } from '../sync-agent/mod.ts';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import { Bundler } from './bundler.ts';
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
      // Adam Chen Injection point 1 override
      await this.publishUpdate(this.topic, content);
    }
  }

  // Adam Chen Injection point 1
  private async publishUpdate(topic: string, content: Uint8Array) {
    await this.syncAgent.publishUpdate(topic, content);

    const stateVector = this.syncAgent.getUpdateSyncSV();
    let count = 0;
    for (const [_id, seq] of stateVector) {
      count += seq;
    }
    // Snapshot Interval configuration: Currently hard-coded
    // TODO: make the interval configurable
    if (count % 5 == 0) {
      const encodedSV = Encoder.encode(stateVector);

      // NOTE: The following code depend on snapshot naming convention to work.
      // Verify this part if there's a change in naming convention.
      // TODO: Currently naming convention is hard-coded. May need organizing.
      const snapshotPrefix = this.syncAgent.appPrefix.append('32=snapshot');
      // New SVS encodings
      const snapshotName = snapshotPrefix.append(new Component(Version.type, encodedSV));

      // Snapshot content generation
      const content = Y.encodeStateAsUpdate(this.doc);
      // its already in UInt8Array (binary), transporting currently without any additional encoding.
      // use syncAgent's blob and publish mechanism
      await this.syncAgent.publishBlob('snapshot', content, snapshotName, true);

      // NOTE: The following code depend on snapshot naming convention to work.
      // Verify this part if there's a change in naming convention.
      // Race Condition note: Testing suggests that the write above with publishBlob()
      //                      is near certainly done before the read happens below.
      //                      Hence no delay is added.
      // first segmented object is at /50=%00
      const firstSegmentName = snapshotName.append('50=%00').toString();
      const firstSegmentPacketEncoded = await this.syncAgent.persistStorage.get(firstSegmentName);
      if (firstSegmentPacketEncoded) {
        const firstSegmentPacket = Decoder.decode(firstSegmentPacketEncoded, Data);
        await this.syncAgent.persistStorage.set(snapshotPrefix.toString(), Encoder.encode(firstSegmentPacket));
      }
    }
  }
  // End Injection point 1

  // -- Adam Chen Injection Point 3: HandleSnapshotUpdate --
  async handleSnapshotUpdate(snapshotName: Uint8Array) {
    // Maybe it's wise to put this under a try() because it might fail due to network issues.
    const decodedSnapshotName = Decoder.decode(snapshotName, Name);

    // NOTE: The following code depend on snapshot naming convention to work.
    // Verify this part if there's a change in naming convention.
    const snapshotPrefix = this.syncAgent.appPrefix.append('32=snapshot');

    // NOTE: The following code depend on snapshot naming convention to work.
    // Verify this part if there's a change in naming convention.
    const oldSnapshotFirstSegmentEncoded = await this.syncAgent.persistStorage.get(snapshotPrefix.toString());
    let oldSVCount = 0;
    if (oldSnapshotFirstSegmentEncoded) {
      const oldSnapshotFirstSegment = Decoder.decode(oldSnapshotFirstSegmentEncoded, Data);
      const oldSnapshotVector = Decoder.decode(oldSnapshotFirstSegment.name.at(-2).value, StateVector);
      for (const [_id, seq] of oldSnapshotVector) {
        oldSVCount += seq;
      }
    }

    // NOTE: The following code depend on snapshot naming convention to work.
    // Verify this part if there's a change in naming convention.
    const snapshotSV = Decoder.decode(decodedSnapshotName.at(-1).value, StateVector);
    let snapshotSVcount = 0;
    for (const [_id, seq] of snapshotSV) {
      snapshotSVcount += seq;
    }

    // NOTE: The following code depend on snapshot naming convention to work.
    // Verify this part if there's a change in naming convention.
    if (snapshotSVcount > oldSVCount) {
      const firstSegmentName = decodedSnapshotName.append('50=%00').toString();
      // Race Condition Note: The callback to here is faster than
      //                      fetchBlob() finish writing to persistStore.
      //                      (in syncAgent before listener callback to here)
      //                      Tested getBlob() to guarantee item arrival
      //                      But ends up having multiple active sessions of fetchBlob(). bad.
      //                      Hence a delay of 1 second.
      await new Promise((r) => setTimeout(r, 1000));
      const firstSegmentPacketEncoded = await this.syncAgent.persistStorage.get(firstSegmentName);
      if (firstSegmentPacketEncoded) {
        const firstSegmentPacket = Decoder.decode(firstSegmentPacketEncoded, Data);
        // utilize snapshotPrefix above, with the same namingConvention warning.
        // this is done to update the key of the prefix so program return latest when blind fetching.
        this.syncAgent.persistStorage.set(snapshotPrefix.toString(), Encoder.encode(firstSegmentPacket));
        // should set snapshotPrefix to the newest packet.
      } else {
        console.debug('PersistentStorage doesnt have the snapshot yet. Skipping update.');
        // If the above race condition fails (reads before data arrives),
        // 'endpoint's blind fetch mechanism' is not updated to latest, should be fine.
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
