import { SyncAgent } from '../sync-agent/mod.ts';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import { Bundler } from './bundler.ts';

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
    doc.on('update', this.callback);
    if (useBundler) {
      this.#bundler = new Bundler(
        Y.mergeUpdates,
        (content) => this.syncAgent.publishUpdate(this.topic, content),
        {
          thresholdSize: 3000,
          delayMs: 200,
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
      await this.syncAgent.publishUpdate(this.topic, content);
    }
  }

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
