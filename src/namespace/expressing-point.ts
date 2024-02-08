import { Endpoint, RetxPolicy } from '@ndn/endpoint';
import { Data, Interest, Name, Signer, type Verifier } from '@ndn/packet';
import * as namePattern from './name-pattern.ts';
import * as schemaTree from './schema-tree.ts';
import { BaseNode, BaseNodeEvents } from './base-node.ts';
import { EventChain } from '../utils/event-chain.ts';

export enum VerifyResult {
  Fail = -1,
  Unknown = 0,
  Pass = 1,
  Bypass = 2,
}

export interface ExpressingPointEvents extends BaseNodeEvents {
  interest(target: schemaTree.StrictMatch<ExpressingPoint>): Promise<Data | undefined>;
  verify(target: schemaTree.StrictMatch<ExpressingPoint>, pkt: Verifier.Verifiable): Promise<VerifyResult>;
  searchStorage(target: schemaTree.StrictMatch<ExpressingPoint>): Promise<Data | undefined>;
  saveStorage(target: schemaTree.StrictMatch<ExpressingPoint>): Promise<void>;
}

export type ExpressingPointOpts = {
  lifetimeMs: number;
  signer: Signer;
  supressInterest?: boolean;
  abortSignal?: AbortSignal;
  modifyInterest?: Interest.Modify;
  retx?: RetxPolicy;
};

export class ExpressingPoint extends BaseNode {
  public readonly onInterest = new EventChain<ExpressingPointEvents['interest']>();
  public readonly onVerify = new EventChain<ExpressingPointEvents['verify']>();
  public readonly onSearchStorage = new EventChain<ExpressingPointEvents['searchStorage']>();
  public readonly onSaveStorage = new EventChain<ExpressingPointEvents['saveStorage']>();

  // public async need(matched: schemaTree.MatchedObject<ExpressingPoint>): Promise<Data | undefined> {}

  // public override async processInterest(
  //   matched: schemaTree.MatchedObject<ExpressingPoint>,
  //   interest: Interest,
  // ): Promise<Data | undefined> {
  // }
}
