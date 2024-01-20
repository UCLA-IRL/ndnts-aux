import { Name, TT } from 'npm:@ndn/packet';
import {
  ArrayField,
  createEVDFromStruct,
  encodeStruct,
  NameField,
  NNIField,
  StructField,
} from '../utils/field-descriptors.ts';
import type { Decoder, Encoder } from 'npm:@ndn/tlv';

/** NFD Management Route struct. */
export class Route {
  static readonly Descriptor = [
    NNIField(0x69, 'faceId' as const),
    NNIField(0x6f, 'origin' as const),
    NNIField(0x6a, 'cost' as const),
    NNIField(0x6c, 'flags' as const),
    NNIField(0x6d, 'expirationPeriod' as const),
  ];

  constructor(
    public faceId = 0,
    public origin = 0,
    public cost = 0,
    public flags = 0,
    public expirationPeriod = 0,
  ) {}

  static readonly EVD = createEVDFromStruct<Route>('Route', Route.Descriptor);

  public static decodeFrom(decoder: Decoder): Route {
    return Route.EVD.decodeValue(new Route(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as Route, Route.Descriptor));
  }
}

/** NFD Management RibEntry struct. */
export class RibEntry {
  static readonly Descriptor = [
    NameField(TT.Name, 'name' as const),
    ArrayField(StructField(0x81, 'routes' as const, Route.Descriptor, Route)),
  ];

  constructor(
    public name = new Name(),
    public routes: Route[] = [],
  ) {}

  static readonly EVD = createEVDFromStruct<RibEntry>('RibEntry', RibEntry.Descriptor);

  public static decodeFrom(decoder: Decoder): RibEntry {
    return RibEntry.EVD.decodeValue(new RibEntry(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as RibEntry, RibEntry.Descriptor));
  }
}

/** NFD Management RibStatus struct, which is a list of RibEntry. */
export class RibStatus {
  static readonly Descriptor = [ArrayField(StructField(0x80, 'entries' as const, RibEntry.Descriptor, RibEntry))];

  constructor(public entries: RibEntry[] = []) {}

  static readonly EVD = createEVDFromStruct<RibStatus>('RibStatus', RibStatus.Descriptor);

  public static decodeFrom(decoder: Decoder): RibStatus {
    return RibStatus.EVD.decodeValue(new RibStatus(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as RibStatus, RibStatus.Descriptor));
  }
}
