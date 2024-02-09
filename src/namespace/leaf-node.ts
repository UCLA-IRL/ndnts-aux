import { Component, Data, Signer } from '@ndn/packet';
import { Encoder } from '@ndn/tlv';
import * as schemaTree from './schema-tree.ts';
import { EventChain } from '../utils/event-chain.ts';
import { ExpressingPointEvents, ExpressingPointOpts } from './expressing-point.ts';
import { ExpressingPoint } from './expressing-point.ts';

export interface LeafNodeEvents extends ExpressingPointEvents {
  saveStorage(
    args: {
      target: schemaTree.StrictMatch<LeafNode>;
      data: Data;
      wire: Uint8Array;
      validUntil: number;
    },
  ): Promise<Data | undefined>;
}

export type LeafNodeOpts = ExpressingPointOpts & {
  freshnessMs: number;
  signer: Signer;
  validityMs?: number;
  contentType?: number;
};

export class LeafNode extends ExpressingPoint {
  /** Save a Data into the storage */
  public readonly onSaveStorage = new EventChain<LeafNodeEvents['saveStorage']>();

  constructor(
    public readonly config: LeafNodeOpts,
  ) {
    super(config);
  }

  public override async storeData(
    matched: schemaTree.StrictMatch<LeafNode>,
    data: Data,
  ) {
    const wire = Encoder.encode(data);
    const validity = this.config.validityMs ?? 876000 * 3600000;
    const validUntil = Date.now() + validity;
    // Save Data into storage
    await this.onSaveStorage.emit({
      target: matched,
      data,
      wire,
      validUntil,
    });
  }

  public async provide(
    matched: schemaTree.StrictMatch<LeafNode>,
    content: Uint8Array | string,
    opts: {
      freshnessMs?: number;
      validityMs?: number;
      signer?: Signer;
      finalBlockId?: Component;
    } = {},
  ): Promise<Uint8Array> {
    const payload = content instanceof Uint8Array ? content : new TextEncoder().encode(content);

    // Create Data
    const dataName = this.handler!.attachedPrefix!.append(...matched.name.comps);
    const data = new Data(
      dataName,
      Data.ContentType(this.config.contentType ?? 0), // Default is BLOB
      Data.FreshnessPeriod(opts.freshnessMs ?? this.config.freshnessMs),
      payload,
    );
    if (opts.finalBlockId) {
      data.finalBlockId = opts.finalBlockId;
    }
    await this.config.signer.sign(data);

    const wire = Encoder.encode(data);
    const validity = this.config.validityMs ?? 876000 * 3600000;
    const validUntil = Date.now() + validity;

    // Save Data into storage
    await this.onSaveStorage.emit({
      target: matched,
      data,
      wire,
      validUntil,
    });

    return wire;
  }
}
