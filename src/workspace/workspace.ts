import { Storage } from '../storage/mod.ts';
import { Endpoint } from '@ndn/endpoint';
import type { Name, Signer, Verifier } from '@ndn/packet';
import { encodeSyncState, parseSyncState, SyncAgent } from '../sync-agent/mod.ts';
import { NdnSvsAdaptor, YjsStateManager } from '../adaptors/mod.ts';
import * as Y from 'yjs';

export class Workspace implements AsyncDisposable {
  private constructor(
    public readonly nodeId: Name,
    public readonly persistStore: Storage,
    public readonly endpoint: Endpoint,
    public readonly onReset: (() => void) | undefined,
    public readonly syncAgent: SyncAgent,
    public readonly yjsSnapshotMgr: YjsStateManager,
    public readonly yjsAdaptor: NdnSvsAdaptor,
  ) {
  }

  public static async create(opts: {
    nodeId: Name;
    persistStore: Storage;
    endpoint: Endpoint;
    rootDoc: Y.Doc;
    signer: Signer;
    verifier: Verifier;
    onReset?: () => void;
    createNewDoc?: () => Promise<void>;
  }) {
    // Sync Agents
    const syncAgent = await SyncAgent.create(
      opts.nodeId,
      opts.persistStore,
      opts.endpoint,
      opts.signer,
      opts.verifier,
      opts.onReset,
    );

    // Root doc using CRDT and Sync
    const yjsAdaptor = new NdnSvsAdaptor(
      syncAgent,
      opts.rootDoc,
      'doc',
    );
    const yjsSnapshotMgr = new YjsStateManager(
      () => encodeSyncState(syncAgent!.getUpdateSyncSV()),
      opts.rootDoc,
      // No key conflict in this case. If we are worried, use anothe sub-folder.
      opts.persistStore,
    );

    // Load or create
    if (opts.createNewDoc) {
      await opts.createNewDoc();
    } else {
      const state = await yjsSnapshotMgr.loadLocalSnapshot((update) => {
        yjsAdaptor!.handleSyncUpdate(update);
        return Promise.resolve();
      });
      await syncAgent.replayUpdates('doc', state ? parseSyncState(state) : undefined);
    }

    // Start Sync
    syncAgent.ready = true;

    return new Workspace(
      opts.nodeId,
      opts.persistStore,
      opts.endpoint,
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
    this.syncAgent.ready = false;
    await Promise.all([
      this.yjsSnapshotMgr.destroy(),
      this.syncAgent.destroy(),
    ]);
    // persistStore is not created by workspace
  }

  async [Symbol.asyncDispose]() {
    return await this.destroy();
  }
}
