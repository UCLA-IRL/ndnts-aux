import { produce, Producer } from '@ndn/endpoint';
import type { Forwarder } from '@ndn/fw';
import { Data, Interest, Name, type Verifier } from '@ndn/packet';
import * as namePattern from './name-pattern.ts';
import * as schemaTree from './schema-tree.ts';
import { type BaseNode } from './base-node.ts';

export enum VerifyResult {
  Fail = -2,
  Timeout = -1,
  Unknown = 0,
  Pass = 1,
  Bypass = 2,
  CachedData = 3,
}

export interface NamespaceHandler {
  get fw(): Forwarder | undefined;
  get attachedPrefix(): Name | undefined;
  getVerifier(deadline: number | undefined, verificationContext?: Record<string, unknown>): Verifier;
  storeData(data: Data): Promise<void>;
}

export class NtSchema implements NamespaceHandler, AsyncDisposable {
  public readonly tree = schemaTree.create<BaseNode>();
  protected _fw: Forwarder | undefined;
  protected _attachedPrefix: Name | undefined;
  protected _producer: Producer | undefined;

  get fw() {
    return this._fw;
  }

  get attachedPrefix() {
    return this._attachedPrefix;
  }

  public match(name: Name) {
    if (!this._attachedPrefix?.isPrefixOf(name)) {
      return undefined;
    }
    const prefixLength = this._attachedPrefix!.length;
    return schemaTree.match(this.tree, name.slice(prefixLength));
  }

  public getVerifier(deadline: number | undefined, verificationContext?: Record<string, unknown>): Verifier {
    return {
      verify: async (pkt: Verifier.Verifiable) => {
        const matched = this.match(pkt.name);
        if (!matched || !matched.resource) {
          throw new Error('Unexpected packet');
        }
        if (!await schemaTree.call(matched, 'verifyPacket', pkt, deadline, verificationContext ?? {})) {
          throw new Error('Unverified packet');
        }
      },
    };
  }

  public async storeData(data: Data): Promise<void> {
    const matched = this.match(data.name);
    if (matched && matched.resource) {
      await schemaTree.call(matched, 'storeData', data);
    }
  }

  public async onInterest(interest: Interest): Promise<Data | undefined> {
    const matched = this.match(interest.name);
    if (matched && matched.resource) {
      return await schemaTree.call(matched, 'processInterest', interest, Date.now() + interest.lifetime);
    }
    return undefined;
  }

  public async attach(prefix: Name, fw: Forwarder) {
    if (this._fw !== undefined) {
      if (this._fw !== fw) {
        throw new Error('You cannot attach a running NTSchema to another forwarder');
      }
      return;
    }
    this._attachedPrefix = prefix;
    this._fw = fw;
    await schemaTree.traverse(this.tree, {
      post: async (node, path) => await node.resource?.processAttach(path, this),
    });

    this._producer = produce(prefix, this.onInterest.bind(this), {
      describe: `NtSchema[${prefix.toString()}]`,
      routeCapture: false,
      announcement: prefix,
      fw: fw,
    });
  }

  public async detach() {
    this._producer!.close();
    await schemaTree.traverse(this.tree, {
      pre: async (node) => await node.resource?.processDetach(),
    });
    this._fw = undefined;
    this._attachedPrefix = undefined;
  }

  public set<Args extends Array<unknown>, T extends BaseNode>(
    path: string | namePattern.Pattern,
    klass: new (...args: Args) => T,
    ...args: Args
  ): schemaTree.Node<T> {
    if (typeof path === 'string') {
      path = namePattern.fromString(path);
    }
    return schemaTree.touch<BaseNode, T>(
      this.tree,
      path,
      new klass(...args),
    );
  }

  async [Symbol.asyncDispose]() {
    if (this._producer) {
      await this.detach();
    }
  }
}
