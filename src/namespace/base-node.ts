import type { Forwarder } from '@ndn/fw';
import type { Data, Interest, Verifier } from '@ndn/packet';
import * as namePattern from './name-pattern.ts';
import * as schemaTree from './schema-tree.ts';
import { EventChain } from '../utils/event-chain.ts';
import { NamespaceHandler } from './nt-schema.ts';

export interface BaseNodeEvents {
  attach(path: namePattern.Pattern, fw: Forwarder): Promise<void>;
  detach(fw: Forwarder): Promise<void>;
}

export class BaseNode {
  public readonly onAttach: EventChain<BaseNodeEvents['attach']> = new EventChain<BaseNodeEvents['attach']>();
  public readonly onDetach: EventChain<BaseNodeEvents['detach']> = new EventChain<BaseNodeEvents['detach']>();
  protected handler: NamespaceHandler | undefined = undefined;

  constructor(public readonly describe?: string) {
    this.describe ??= this.constructor.name;
  }

  public get namespaceHandler(): NamespaceHandler | undefined {
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
    deadline: number | undefined,
    context: Record<string, unknown>,
  ): Promise<boolean> {
    console.warn(`Silently drop unverified packet ${matched.name.toString()}`);
    pkt;
    deadline;
    context;
    return Promise.resolve(false);
  }

  public storeData(
    matched: schemaTree.StrictMatch<BaseNode>,
    data: Data,
  ): Promise<void> {
    console.warn(`Not store unexpected Data ${matched.name.toString()}`);
    data;
    return Promise.resolve();
  }

  public async processAttach(path: namePattern.Pattern, handler: NamespaceHandler) {
    // All children's attach events are called
    this.handler = handler;
    await this.onAttach.emit(path, handler.fw!);
  }

  public async processDetach() {
    await this.onDetach.emit(this.handler!.fw!);
    this.handler = undefined;
    // Then call children's detach
  }
}
