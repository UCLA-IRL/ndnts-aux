import type { Decoder, Encoder } from '@ndn/tlv';
import { createEVDFromStruct, encodeStruct, NNIField, StringField } from '../utils/field-descriptors.ts';

/** NFD Management GeneralStatus struct. */
export class GeneralStatus {
  static readonly Descriptor = [
    StringField(0x80, 'nfdVersion' as const),
    NNIField(0x81, 'startTimestamp' as const),
    NNIField(0x82, 'currentTimestamp' as const),
    NNIField(0x83, 'nNameTreeEntries' as const),
    NNIField(0x84, 'nFibEntries' as const),
    NNIField(0x85, 'nPitEntries' as const),
    NNIField(0x86, 'nMeasurementsEntries' as const),
    NNIField(0x87, 'nCsEntries' as const),
    NNIField(0x90, 'nInInterests' as const),
    NNIField(0x91, 'nInData' as const),
    NNIField(0x97, 'nInNacks' as const),
    NNIField(0x92, 'nOutInterests' as const),
    NNIField(0x93, 'nOutData' as const),
    NNIField(0x98, 'nOutNacks' as const),
    NNIField(0x99, 'nSatisfiedInterests' as const),
    NNIField(0x9a, 'nUnsatisfiedInterests' as const),
  ];

  static readonly EVD = createEVDFromStruct<GeneralStatus>('GeneralStatus', GeneralStatus.Descriptor);

  public static decodeFrom(decoder: Decoder): GeneralStatus {
    return GeneralStatus.EVD.decodeValue(new GeneralStatus(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as GeneralStatus, GeneralStatus.Descriptor));
  }

  public constructor(
    public nfdVersion = '',
    public startTimestamp = 0,
    public currentTimestamp = 0,
    public nNameTreeEntries = 0,
    public nFibEntries = 0,
    public nPitEntries = 0,
    public nMeasurementsEntries = 0,
    public nCsEntries = 0,
    public nInInterests = 0,
    public nInData = 0,
    public nInNacks = 0,
    public nOutInterests = 0,
    public nOutData = 0,
    public nOutNacks = 0,
    public nSatisfiedInterests = 0,
    public nUnsatisfiedInterests = 0,
  ) {}
}
