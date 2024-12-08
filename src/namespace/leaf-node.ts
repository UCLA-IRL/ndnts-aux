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
  ): Promise<void>;
}

export type LeafNodeOpts = ExpressingPointOpts & {
  freshnessMs?: number;
  signer?: Signer;
  validityMs?: number;
  contentType?: number;
};

export class LeafNode extends ExpressingPoint {
  /** Save a Data into the storage */
  public readonly onSaveStorage = new EventChain<LeafNodeEvents['saveStorage']>();

  constructor(
    public override readonly config: LeafNodeOpts,
    describe?: string,
  ) {
    super(config, describe);
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
  ): Promise<Data> {
    const payload = content instanceof Uint8Array ? content : new TextEncoder().encode(content);

    const signer = opts.signer ?? this.config.signer;
    const freshnessMs = opts.freshnessMs ?? this.config.freshnessMs;
    if (!signer || freshnessMs === undefined) {
      throw new Error(
        `[${this.describe}:provide] Unable to generate Data when signer or freshnessMs is missing in config.`,
      );
    }

    // Create Data
    const dataName = this.handler!.attachedPrefix!.append(...matched.name.comps);
    const data = new Data(
      dataName,
      Data.ContentType(this.config.contentType ?? 0), // Default is BLOB
      Data.FreshnessPeriod(freshnessMs),
      payload,
    );
    if (opts.finalBlockId) {
      data.finalBlockId = opts.finalBlockId;
    }
    await signer.sign(data);

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

    return data;
  }
}
