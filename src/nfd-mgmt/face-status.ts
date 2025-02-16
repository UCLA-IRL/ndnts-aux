import {
  ArrayField,
  createEVDFromStruct,
  DescriptorType,
  encodeStruct,
  NNIField,
  StringField,
  StructField,
} from '../utils/field-descriptors.ts';
import type { Decoder, Encoder, EvDecoder } from '@ndn/tlv';

/** NFD Management FaceStatus struct. */
export class FaceStatus {
  static readonly Descriptor: DescriptorType<FaceStatus> = [
    NNIField(0x69, 'faceId' as const),
    StringField(0x72, 'uri' as const),
    StringField(0x81, 'localUri' as const),
    NNIField(0x6d, 'expirationPeriod' as const),
    NNIField(0x84, 'faceScope' as const),
    NNIField(0x85, 'facePersistency' as const),
    NNIField(0x86, 'linkType' as const),
    NNIField(0x87, 'baseCongestionMarkingInterval' as const),
    NNIField(0x88, 'defaultCongestionPeriod' as const),
    NNIField(0x89, 'mtu' as const),
    NNIField(0x90, 'nInInterests' as const),
    NNIField(0x91, 'nInData' as const),
    NNIField(0x97, 'nInNacks' as const),
    NNIField(0x92, 'nOutInterests' as const),
    NNIField(0x93, 'nOutData' as const),
    NNIField(0x98, 'nOutNacks' as const),
    NNIField(0x94, 'nInBytes' as const),
    NNIField(0x95, 'nOutBytes' as const),
    NNIField(0x6c, 'flags' as const),
  ];

  constructor(
    public faceId = 0,
    public uri = '',
    public localUri = '',
    public expirationPeriod?: number,
    public faceScope = 0,
    public facePersistency = 0,
    public linkType = 0,
    public baseCongestionMarkingInterval?: number,
    public defaultCongestionPeriod?: number,
    public mtu?: number,
    public nInInterests = 0,
    public nInData = 0,
    public nInNacks = 0,
    public nOutInterests = 0,
    public nOutData = 0,
    public nOutNacks = 0,
    public nInBytes = 0,
    public nOutBytes = 0,
    public flags = 0,
  ) {}

  static readonly EVD: EvDecoder<FaceStatus> = createEVDFromStruct<FaceStatus>('FaceStatus', FaceStatus.Descriptor);

  public static decodeFrom(decoder: Decoder): FaceStatus {
    return FaceStatus.EVD.decodeValue(new FaceStatus(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as FaceStatus, FaceStatus.Descriptor));
  }
}

/** NFD Management FaceStatus messages, which is a list of FaceStatus. */
export class FaceStatusMsg {
  static readonly Descriptor: DescriptorType<FaceStatusMsg> = [
    ArrayField(StructField(0x80, 'faces' as const, FaceStatus.Descriptor, FaceStatus)),
  ];

  constructor(public faces: FaceStatus[] = []) {}

  static readonly EVD: EvDecoder<FaceStatusMsg> = createEVDFromStruct<FaceStatusMsg>(
    'FaceStatusMsg',
    FaceStatusMsg.Descriptor,
  );

  public static decodeFrom(decoder: Decoder): FaceStatusMsg {
    return FaceStatusMsg.EVD.decodeValue(new FaceStatusMsg(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as FaceStatusMsg, FaceStatusMsg.Descriptor));
  }
}
