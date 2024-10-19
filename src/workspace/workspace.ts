import { Storage } from '../storage/mod.ts';
import type { Forwarder } from '@ndn/fw';
import type { Name, Signer, Verifier } from '@ndn/packet';
import { encodeSyncState, parseSyncState, SyncAgent } from '../sync-agent/mod.ts';
import { NdnSvsAdaptor, YjsStateManager } from '../adaptors/mod.ts';
import * as Y from 'yjs';

export class Workspace implements AsyncDisposable {
  private constructor(
    public readonly nodeId: Name,
    public readonly persistStore: Storage,
    public readonly fw: Forwarder,
    public readonly onReset: (() => void) | undefined,
    public readonly syncAgent: SyncAgent,
    public readonly yjsSnapshotMgr: YjsStateManager,
    public readonly yjsAdaptor: NdnSvsAdaptor,
  ) {
  }

  public static async create(opts: {
    nodeId: Name;
    persistStore: Storage;
    fw: Forwarder;
    rootDoc: Y.Doc;
    signer: Signer;
    verifier: Verifier;
    onReset?: () => void;
    createNewDoc?: () => Promise<void>;
    useBundler?: boolean;
    groupKeyBits?: Uint8Array;
    snapshotInterval?: number;
  }) {
    // Always init a new one, and then load.
    if (opts.createNewDoc) {
      await opts.createNewDoc();
      const clientID = opts.rootDoc.clientID;
      opts.rootDoc.clientID = 0;
      opts.rootDoc.clientID = clientID;
    }

    // Sync Agents
    const syncAgent = await SyncAgent.create(
      opts.nodeId,
      opts.persistStore,
      opts.fw,
      opts.signer,
      opts.verifier,
      opts.onReset,
      opts.groupKeyBits,
    );

    // Root doc using CRDT and Sync
    const yjsAdaptor = new NdnSvsAdaptor(
      syncAgent,
      opts.rootDoc,
      'doc',
      opts.useBundler ?? false,
      opts.snapshotInterval ?? 100,
    );
    const yjsSnapshotMgr = new YjsStateManager(
      () => encodeSyncState(syncAgent!.getUpdateSyncSV()),
      opts.rootDoc,
      // No key conflict in this case. If we are worried, use anothe sub-folder.
      opts.persistStore,
    );

    // Load local state
    const state = await yjsSnapshotMgr.loadLocalSnapshot((update) => {
      yjsAdaptor!.handleSyncUpdate(update);
      return Promise.resolve();
    });
    await syncAgent.replayUpdates('doc', state ? parseSyncState(state) : undefined);

    // Start Sync
    syncAgent.ready = true;

    return new Workspace(
      opts.nodeId,
      opts.persistStore,
      opts.fw,
      opts.onReset,
      syncAgent,
      yjsSnapshotMgr,
      yjsAdaptor,
    );
  }

  public fireUpdate() {
    this.syncAgent.fire();
  }

  public async destroy() {
    await this.syncAgent.destroy();
    await this.yjsSnapshotMgr.destroy();
    // persistStore is not created by workspace
  }

  async [Symbol.asyncDispose]() {
    return await this.destroy();
  }
}
