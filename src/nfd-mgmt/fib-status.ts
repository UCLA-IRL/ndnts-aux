import { Name, TT } from '@ndn/packet';
import {
  ArrayField,
  createEVDFromStruct,
  DescriptorType,
  encodeStruct,
  NameField,
  NNIField,
  StructField,
} from '../utils/field-descriptors.ts';
import type { Decoder, Encoder, EvDecoder } from '@ndn/tlv';

/** NFD Management NextHopRecord struct. */
export class NextHopRecord {
  static readonly Descriptor: DescriptorType<NextHopRecord> = [
    NNIField(0x69, 'faceId' as const),
    NNIField(0x6a, 'cost' as const),
  ];

  constructor(
    public faceId = 0,
    public cost = 0,
  ) {}

  static readonly EVD: EvDecoder<NextHopRecord> = createEVDFromStruct<NextHopRecord>(
    'NextHopRecord',
    NextHopRecord.Descriptor,
  );

  public static decodeFrom(decoder: Decoder): NextHopRecord {
    return NextHopRecord.EVD.decodeValue(new NextHopRecord(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as NextHopRecord, NextHopRecord.Descriptor));
  }
}

/** NFD Management FibEntry struct. */
export class FibEntry {
  static readonly Descriptor: DescriptorType<FibEntry> = [
    NameField(TT.Name, 'name' as const),
    ArrayField(StructField(0x81, 'nextHopRecords' as const, NextHopRecord.Descriptor, NextHopRecord)),
  ];

  constructor(
    public name: Name = new Name(),
    public nextHopRecords: NextHopRecord[] = [],
  ) {}

  static readonly EVD: EvDecoder<FibEntry> = createEVDFromStruct<FibEntry>('FibEntry', FibEntry.Descriptor);

  public static decodeFrom(decoder: Decoder): FibEntry {
    return FibEntry.EVD.decodeValue(new FibEntry(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as FibEntry, FibEntry.Descriptor));
  }
}

/** NFD Management FibStatus struct, which is a list of FibEntry. */
export class FibStatus {
  static readonly Descriptor: DescriptorType<FibStatus> = [
    ArrayField(StructField(0x80, 'fibEntries' as const, FibEntry.Descriptor, FibEntry)),
  ];

  constructor(public fibEntries: FibEntry[] = []) {}

  static readonly EVD: EvDecoder<FibStatus> = createEVDFromStruct<FibStatus>('FibStatus', FibStatus.Descriptor);

  public static decodeFrom(decoder: Decoder): FibStatus {
    return FibStatus.EVD.decodeValue(new FibStatus(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as FibStatus, FibStatus.Descriptor));
  }
}
