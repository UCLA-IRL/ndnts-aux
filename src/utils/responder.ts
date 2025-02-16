import { produce, Producer } from '@ndn/endpoint';
import type { Forwarder } from '@ndn/fw';
import { Data, Interest, Name } from '@ndn/packet';
import { Decoder } from '@ndn/tlv';
import { Storage } from '../storage/mod.ts';

/** Simple responder used for test */
export class Responder implements Disposable {
  public readonly producer: Producer;

  constructor(
    public readonly prefix: Name,
    public readonly fw: Forwarder,
    public readonly store: Storage,
  ) {
    this.producer = produce(prefix, (interest) => {
      return this.serve(interest);
    }, {
      describe: `Responder[${prefix.toString()}]`,
      routeCapture: false,
      announcement: prefix,
      fw: fw,
    });
  }

  async serve(interest: Interest): Promise<Data | undefined> {
    const intName = interest.name;
    if (intName.length <= this.prefix.length) {
      // The name should be longer than the prefix
      return undefined;
    }
    const key = intName.toString();
    const wire = await this.store.get(key);
    if (wire === undefined || wire.length === 0) {
      return undefined;
    }
    try {
      const data = Decoder.decode(wire, Data);
      return data;
    } catch (e) {
      console.error(`Data in storage is not decodable: ${intName.toString()}`, e);
      return undefined;
    }
  }

  [Symbol.dispose]() {
    this.producer.close();
  }
}
