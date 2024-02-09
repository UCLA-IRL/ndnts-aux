import { Endpoint } from '@ndn/endpoint';
import type { Data, Interest, Verifier } from '@ndn/packet';
import * as namePattern from './name-pattern.ts';
import * as schemaTree from './schema-tree.ts';
import { EventChain } from '../utils/event-chain.ts';
import { NamespaceHandler } from './nt-schema.ts';

export interface BaseNodeEvents {
  attach(path: namePattern.Pattern, endpoint: Endpoint): Promise<void>;
  detach(endpoint: Endpoint): Promise<void>;
}

export class BaseNode {
  public readonly onAttach = new EventChain<BaseNodeEvents['attach']>();
  public readonly onDetach = new EventChain<BaseNodeEvents['detach']>();
  protected handler: NamespaceHandler | undefined = undefined;

  public get namespaceHandler() {
    return this.handler;
  }

  public processInterest(
    matched: schemaTree.StrictMatch<BaseNode>,
    interest: Interest,
    deadline: number,
  ): Promise<Data | undefined> {
    console.warn(`Silently drop unprocessable Interest ${matched.name.toString()}: ${interest.appParameters}`);
    deadline; // Silence warning
    return Promise.resolve(undefined);
  }

  public verifyPacket(
    matched: schemaTree.StrictMatch<BaseNode>,
    pkt: Verifier.Verifiable,
    deadline: number,
  ) {
    console.warn(`Silently drop unverified packet ${matched.name.toString()}`);
    pkt;
    deadline;
    return Promise.resolve(false);
  }

  public storeData(
    matched: schemaTree.StrictMatch<BaseNode>,
    data: Data,
  ) {
    console.warn(`Not store unexpected Data ${matched.name.toString()}`);
    data;
    return Promise.resolve();
  }

  public async processAttach(path: namePattern.Pattern, handler: NamespaceHandler) {
    // All children's attach events are called
    this.handler = handler;
    await this.onAttach.emit(path, handler.endpoint!);
  }

  public async processDetach() {
    await this.onDetach.emit(this.handler!.endpoint!);
    this.handler = undefined;
    // Then call children's detach
  }
}
