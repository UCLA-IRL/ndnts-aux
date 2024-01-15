import { createEVDFromStruct, encodeStruct, NNIField, StringField, StructField } from '../utils/field-descriptors.ts';
import type { Decoder, Encoder } from '@ndn/tlv';

/** NFD Management the TLV Value of FaceQueryFilter struct. */
export class FaceQueryFilterValue {
  static readonly Descriptor = [
    NNIField(0x69, 'faceId' as const),
    StringField(0x83, 'uriScheme' as const),
    StringField(0x72, 'uri' as const),
    StringField(0x81, 'localUri' as const),
    NNIField(0x84, 'faceScope' as const),
    NNIField(0x85, 'facePersistency' as const),
    NNIField(0x86, 'linkType' as const),
  ];

  constructor(
    public faceId?: number,
    public uriScheme?: string,
    public uri?: string,
    public localUri?: string,
    public faceScope?: number,
    public facePersistency?: number,
    public linkType?: number,
  ) {}

  static readonly EVD = createEVDFromStruct<FaceQueryFilterValue>(
    'FaceQueryFilterValue',
    FaceQueryFilterValue.Descriptor,
  );

  public static decodeFrom(decoder: Decoder): FaceQueryFilterValue {
    return FaceQueryFilterValue.EVD.decodeValue(new FaceQueryFilterValue(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as FaceQueryFilterValue, FaceQueryFilterValue.Descriptor));
  }
}

/** NFD Management FaceQueryFilter struct. */
export class FaceQueryFilter {
  static readonly Descriptor = [
    StructField(0x96, 'value' as const, FaceQueryFilterValue.Descriptor, FaceQueryFilterValue),
  ];

  constructor(public value = new FaceQueryFilterValue()) {}

  static readonly EVD = createEVDFromStruct<FaceQueryFilter>('FaceQueryFilter', FaceQueryFilter.Descriptor);

  public static decodeFrom(decoder: Decoder): FaceQueryFilter {
    return FaceQueryFilter.EVD.decodeValue(new FaceQueryFilter(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as FaceQueryFilter, FaceQueryFilter.Descriptor));
  }
}
