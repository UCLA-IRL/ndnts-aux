import { Endpoint } from '@ndn/endpoint';
import { Forwarder } from '@ndn/fw';
import { Data, digestSigning, Name } from '@ndn/packet';
import { GenericNumber } from '@ndn/naming-convention2';
import { Encoder } from '@ndn/tlv';
import { assert } from '../dep.ts';
import { AtLeastOnceDelivery, SyncDelivery } from './deliveries.ts';
import { AsyncDisposableStack, name, Responder } from '../utils/mod.ts';
import { InMemoryStorage } from '../storage/mod.ts';

type SyncUpdateEvent = {
  content: Uint8Array;
  origin: number;
  receiver: number;
};

class DeliveryTester implements AsyncDisposable {
  readonly #closers = new AsyncDisposableStack();
  readonly endpoint: Endpoint;
  readonly syncPrefix = name`/test/32=alo`;
  readonly stores;
  readonly alos = [] as AtLeastOnceDelivery[];
  readonly events = [] as SyncUpdateEvent[];

  constructor(
    readonly svsCount: number,
    readonly updateEvent?: (evt: SyncUpdateEvent, inst: DeliveryTester) => Promise<void>,
  ) {
    const fwAB = Forwarder.create();
    this.endpoint = new Endpoint({ fw: fwAB });
    this.#closers.defer(() => {
      fwAB.close();
    });

    this.stores = Array.from({ length: svsCount }, (_, i) => {
      const store = new InMemoryStorage();
      this.#closers.use(store);
      const responder = new Responder(name`/test/32=node/${i}`, this.endpoint, store);
      this.#closers.use(responder);
      return store;
    });
  }

  async start(timeoutMs: number) {
    for (let i = 0; this.svsCount > i; i++) {
      const alo = await AtLeastOnceDelivery.create(
        name`/test/32=node/${i}`,
        this.endpoint,
        this.syncPrefix,
        digestSigning,
        digestSigning,
        this.stores[i],
        Promise.resolve(this.onUpdate.bind(this)),
      );
      this.#closers.use(alo);
      this.alos.push(alo);
    }
    for (const alo of this.alos) {
      alo.start();
    }
    const finishTimer = setTimeout(() => {
      throw new Error('Test timed out.');
    }, timeoutMs);
    this.#closers.defer(() => clearTimeout(finishTimer));
  }

  async onUpdate(content: Uint8Array, name: Name, instance: SyncDelivery) {
    const receiver = this.alos.findIndex((v) => v === instance);
    const origin = name.at(name.length - 1).as(GenericNumber);
    const evt = { content, origin, receiver };
    this.events.push(evt);
    await this.updateEvent?.(evt, this);
  }

  async stop() {
    if (!this.#closers.disposed) {
      return await this.#closers[Symbol.asyncDispose]();
    }
  }

  async [Symbol.asyncDispose]() {
    if (!this.#closers.disposed) {
      return await this.#closers[Symbol.asyncDispose]();
    }
  }

  async dispositData(id: number, seq: number, content: Uint8Array) {
    const data = new Data(
      name`/test/32=node/${id}/test/32=alo/seq=${seq}`,
      Data.FreshnessPeriod(60000),
      content,
    );
    await digestSigning.sign(data);
    await this.stores[id].set(
      data.name.toString(),
      Encoder.encode(data),
    );
  }
}

Deno.test('basic test', async () => {
  let eventSet;
  {
    const { promise: stopSignal, resolve: stop } = Promise.withResolvers<void>();
    await using tester = new DeliveryTester(2, () => {
      if (tester.events.length === 2) {
        stop();
      }
      return Promise.resolve();
    });
    await tester.start(2000);

    await tester.alos[1].produce(new TextEncoder().encode('Hello'));
    await tester.alos[1].produce(new TextEncoder().encode('World'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    await stopSignal;
    eventSet = tester.events;
  }

  assert.assertEquals(eventSet.length, 2);
  assert.assertEquals(eventSet[0], {
    content: new TextEncoder().encode('Hello'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[1], {
    content: new TextEncoder().encode('World'),
    origin: 1,
    receiver: 0,
  });
});

// TODO: Known failure
// Deno.test('no missing due to parallel', async () => {
//   let eventSet;
//   {
//     const { promise: stopSignal, resolve: stop } = Promise.withResolvers<void>();
//     await using tester = new DeliveryTester(2, () => {
//       if (tester.events.length === 2) {
//         stop();
//       }
//       return Promise.resolve();
//     });
//     await tester.start(3000);

//     // Make a hanging trigger without actual data
//     tester.alos[1].syncNode!.seqNum = 2;
//     await new Promise((resolve) => setTimeout(resolve, 100));
//     // Then generate two normal updates. They are fetched first.
//     await tester.alos[1].produce(new TextEncoder().encode('C'));
//     await tester.alos[1].produce(new TextEncoder().encode('D'));
//     await new Promise((resolve) => setTimeout(resolve, 100));
//     // Finally make up those missing data.
//     await tester.dispositData(1, 1, new TextEncoder().encode('A'));
//     await tester.dispositData(1, 2, new TextEncoder().encode('B'));
//     // Wait for retransmission Interest.
//     await new Promise((resolve) => setTimeout(resolve, 1500));

//     await stopSignal;
//     eventSet = tester.events;
//   }

//   assert.assertEquals(eventSet.length, 4);
//   assert.assertEquals(eventSet[0], {
//     content: new TextEncoder().encode('A'),
//     origin: 1,
//     receiver: 0,
//   });
//   assert.assertEquals(eventSet[1], {
//     content: new TextEncoder().encode('B'),
//     origin: 1,
//     receiver: 0,
//   });
//   assert.assertEquals(eventSet[2], {
//     content: new TextEncoder().encode('C'),
//     origin: 1,
//     receiver: 0,
//   });
//   assert.assertEquals(eventSet[3], {
//     content: new TextEncoder().encode('D'),
//     origin: 1,
//     receiver: 0,
//   });
// });
