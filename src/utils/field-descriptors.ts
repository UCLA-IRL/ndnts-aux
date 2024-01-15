import { Name } from '@ndn/packet';
import { type Decodable, Decoder, type Encodable, Encoder, EvDecoder, NNI } from '@ndn/tlv';
import { toUtf8 } from '@ndn/util';

export const decodeNNI = ({ nni }: Decoder.Tlv) => nni;
export const decodeString = ({ text }: Decoder.Tlv) => text;

export type FieldDescriptor<T, K> = {
  tt: number;
  key: K;
  encodeValue: (v: NonNullable<T>) => Encodable;
  decode: (tlv: Decoder.Tlv, original?: T) => T;
  repeat?: boolean;
};

type ValidFieldDescriptorOfRecord<T extends object> = {
  [Key in keyof T]: FieldDescriptor<T[Key], Key>;
};

export type ValidFieldDescriptorOf<T extends object> = ValidFieldDescriptorOfRecord<
  T
>[keyof ValidFieldDescriptorOfRecord<T>];

export const StringField = <K>(tt: number, key: K): FieldDescriptor<string, K> => ({
  tt: tt,
  key: key,
  encodeValue: toUtf8,
  decode: decodeString,
});

export const NameField = <K>(tt: number, key: K): FieldDescriptor<Name, K> => ({
  tt: tt,
  key: key,
  encodeValue: (name) => name.value,
  decode: ({ decoder }) => decoder.decode(Name),
});

export const NNIField = <K>(tt: number, key: K): FieldDescriptor<number, K> => ({
  tt: tt,
  key: key,
  encodeValue: NNI,
  decode: decodeNNI,
});

export const BoolField = <K>(tt: number, key: K): FieldDescriptor<boolean, K> => ({
  tt: tt,
  key: key,
  encodeValue: (v: boolean) => (v ? [tt] : [tt, Encoder.OmitEmpty]),
  decode: () => true,
});

export const encodeStruct = <T extends object>(value: T, descriptor: ValidFieldDescriptorOf<T>[]): Encodable[] =>
  descriptor.map((fieldDesc) => {
    const fieldValue = value[fieldDesc.key];
    if (fieldValue !== null && fieldValue !== undefined) {
      return [fieldDesc.tt, fieldDesc.encodeValue(fieldValue)];
    } else {
      return false;
    }
  });

export const createEVDFromStruct = <T extends object>(
  typeName: string,
  descriptor: ValidFieldDescriptorOf<T>[],
): EvDecoder<T> => {
  const ret = new EvDecoder<T>(typeName).setIsCritical(() => false);
  for (const fieldDesc of descriptor) {
    ret.add(
      fieldDesc.tt,
      (t, tlv) => {
        t[fieldDesc.key] = fieldDesc.decode(tlv, t[fieldDesc.key]);
      },
      { repeat: fieldDesc.repeat },
    );
  }
  return ret;
};

export const StructField = <T extends object, K>(
  tt: number,
  key: K,
  descriptor: ValidFieldDescriptorOf<T>[],
  decodable: Decodable<T>,
): FieldDescriptor<T, K> => ({
  tt: tt,
  key: key,
  encodeValue: (v: T) => [tt, ...encodeStruct(v, descriptor)],
  // T should define its own Decodable. `createEVDFromStruct` can be used.
  decode: ({ value }) => Decoder.decode(value, decodable),
  repeat: false,
});

export const ArrayField = <T, K>(descriptor: FieldDescriptor<T, K>): FieldDescriptor<T[], K> => ({
  tt: descriptor.tt,
  key: descriptor.key,
  encodeValue: (v) => ({
    encodeTo(encoder) {
      const encodableList = v.map((value) =>
        value !== null && value !== undefined ? descriptor.encodeValue(value) : false
      );
      encoder.prependValue(...encodableList);
    },
  }),
  decode: (tlv, original) => {
    const newValue = descriptor.decode(tlv, undefined);
    return [newValue, ...(original ?? [])];
  },
  repeat: true,
});
