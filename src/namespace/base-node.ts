import { Endpoint } from '@ndn/endpoint';
import type { Data, Interest } from '@ndn/packet';
import * as namePattern from './name-pattern.ts';
import * as schemaTree from './schema-tree.ts';
import { EventChain } from '../utils/event-chain.ts';

export interface BaseNodeEvents {
  attach(path: namePattern.Pattern, endpoint: Endpoint): Promise<void>;
  detach(): Promise<void>;
}

export class BaseNode {
  public readonly onAttach = new EventChain<BaseNodeEvents['attach']>();
  public readonly onDetach = new EventChain<BaseNodeEvents['detach']>();
  protected endpoint: Endpoint | undefined = undefined;

  public processInterest(
    matched: schemaTree.MatchedObject<BaseNode>,
    interest: Interest,
  ): Promise<Data | undefined> {
    console.warn(`Silently drop unprocessable Interest ${matched.name}: ${interest.appParameters}`);
    return Promise.resolve(undefined);
  }

  public async processAttach(path: namePattern.Pattern, endpoint: Endpoint) {
    // All children's attach events are called
    this.endpoint = endpoint;
    await this.onAttach.emit(path, endpoint);
  }

  public async processDetach() {
    await this.onDetach.emit();
    this.endpoint = undefined;
    // Then call children's detach
  }
}
