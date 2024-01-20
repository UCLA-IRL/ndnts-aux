import { createEVDFromStruct, encodeStruct, NNIField, StringField, StructField } from '../utils/field-descriptors.ts';
import type { Decoder, Encoder } from 'npm:@ndn/tlv';

/** The TLV-value of NFD Management's FaceEventNotification. */
export class FaceEventNotification {
  static readonly Descriptor = [
    NNIField(0xc1, 'faceEventKind' as const),
    NNIField(0x69, 'faceId' as const),
    StringField(0x72, 'uri' as const),
    StringField(0x81, 'localUri' as const),
    NNIField(0x84, 'faceScope' as const),
    NNIField(0x85, 'facePersistency' as const),
    NNIField(0x86, 'linkType' as const),
    NNIField(0x6c, 'flags' as const),
  ];

  constructor(
    public faceEventKind = 0,
    public faceId = 0,
    public uri = '',
    public localUri = '',
    public faceScope = 0,
    public facePersistency = 0,
    public linkType = 0,
    public flags = 0,
  ) {}

  static readonly EVD = createEVDFromStruct<FaceEventNotification>(
    'FaceEventNotification',
    FaceEventNotification.Descriptor,
  );

  public static decodeFrom(decoder: Decoder): FaceEventNotification {
    return FaceEventNotification.EVD.decodeValue(new FaceEventNotification(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as FaceEventNotification, FaceEventNotification.Descriptor));
  }
}

/** The message content (full TLV block) of NFD Management's FaceEventNotification. */
export class FaceEventMsg {
  static readonly Descriptor = [
    StructField(0xc0, 'event' as const, FaceEventNotification.Descriptor, FaceEventNotification),
  ];

  constructor(public event = new FaceEventNotification()) {}

  static readonly EVD = createEVDFromStruct<FaceEventMsg>('FaceEventMsg', FaceEventMsg.Descriptor);

  public static decodeFrom(decoder: Decoder): FaceEventMsg {
    return FaceEventMsg.EVD.decodeValue(new FaceEventMsg(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as FaceEventMsg, FaceEventMsg.Descriptor));
  }
}
