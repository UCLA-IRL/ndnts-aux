import { Name, TT } from '@ndn/packet';
import { ArrayField, createEVDFromStruct, encodeStruct, NameField, StructField } from '../utils/field-descriptors.ts';
import type { Decoder, Encoder } from '@ndn/tlv';

/** NFD Management Strategy struct. */
export class Strategy {
  static readonly Descriptor = [NameField(TT.Name, 'name' as const)];

  constructor(public name = new Name()) {}

  static readonly EVD = createEVDFromStruct<Strategy>('Strategy', Strategy.Descriptor);

  public static decodeFrom(decoder: Decoder): Strategy {
    return Strategy.EVD.decodeValue(new Strategy(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as Strategy, Strategy.Descriptor));
  }
}

/** NFD Management Strategy struct. */
export class StrategyChoice {
  static readonly Descriptor = [
    NameField(TT.Name, 'name' as const),
    StructField(0x6b, 'strategy' as const, Strategy.Descriptor, Strategy),
  ];

  constructor(
    public name = new Name(),
    public strategy = new Strategy(),
  ) {}

  static readonly EVD = createEVDFromStruct<StrategyChoice>('StrategyChoice', StrategyChoice.Descriptor);

  public static decodeFrom(decoder: Decoder): StrategyChoice {
    return StrategyChoice.EVD.decodeValue(new StrategyChoice(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as StrategyChoice, StrategyChoice.Descriptor));
  }
}

/** NFD Management StrategyChoiceMsg struct, which is a list of StrategyChoice. */
export class StrategyChoiceMsg {
  static readonly Descriptor = [
    ArrayField(StructField(0x80, 'strategyChoices' as const, StrategyChoice.Descriptor, StrategyChoice)),
  ];

  constructor(public strategyChoices: StrategyChoice[] = []) {}

  static readonly EVD = createEVDFromStruct<StrategyChoiceMsg>('StrategyChoiceMsg', StrategyChoiceMsg.Descriptor);

  public static decodeFrom(decoder: Decoder): StrategyChoiceMsg {
    return StrategyChoiceMsg.EVD.decodeValue(new StrategyChoiceMsg(), decoder);
  }

  public encodeTo(encoder: Encoder) {
    encoder.prependValue(...encodeStruct(this as StrategyChoiceMsg, StrategyChoiceMsg.Descriptor));
  }
}
