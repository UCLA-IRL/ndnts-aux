import { Forwarder } from '@ndn/fw';
import { Data, digestSigning, Name, type Signer, type Verifier } from '@ndn/packet';
import { GenericNumber } from '@ndn/naming-convention2';
import { Encoder } from '@ndn/tlv';
import { SyncUpdate } from '@ndn/sync-api';
import { assert, hex } from '../dep.ts';
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
  readonly fwAB: Forwarder;
  readonly syncPrefix = name`/test/32=alo`;
  readonly stores;
  readonly alos = [] as AtLeastOnceDelivery[];
  readonly events = [] as SyncUpdateEvent[];

  constructor(
    readonly svsCount: number,
    readonly updateEvent?: (evt: SyncUpdateEvent, inst: DeliveryTester) => Promise<void>,
  ) {
    this.fwAB = Forwarder.create();
    this.#closers.defer(() => {
      this.fwAB.close();
    });

    this.stores = Array.from({ length: svsCount }, (_, i) => {
      const store = new InMemoryStorage();
      this.#closers.use(store);
      const responder = new Responder(name`/test/32=node/${i}`, this.fwAB, store);
      this.#closers.use(responder);
      return store;
    });
  }

  async start(timeoutMs: number, signer: Signer = digestSigning, verifier: Verifier = digestSigning) {
    for (let i = 0; this.svsCount > i; i++) {
      const alo = await AtLeastOnceDelivery.create(
        name`/test/32=node/${i}`,
        this.fwAB,
        this.syncPrefix,
        signer,
        verifier,
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
      name`/test/32=node/${id}/seq=${seq}`,
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

const eventToKey = (a: SyncUpdateEvent) => `${a.receiver}-${a.origin}-${hex.encodeHex(a.content)}`;

const compareEvent = (a: SyncUpdateEvent, b: SyncUpdateEvent) => {
  const keyA = eventToKey(a);
  const keyB = eventToKey(b);
  if (keyA < keyB) {
    return -1;
  } else if (keyA > keyB) {
    return 1;
  } else {
    return 0;
  }
};

Deno.test('Alo.1 Basic test', async () => {
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

    await tester.alos[1].produce(new TextEncoder().encode('0-Hello'));
    await tester.alos[1].produce(new TextEncoder().encode('1-World'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    await stopSignal;
    eventSet = tester.events;
  }

  // Since it is unordered, we have to sort
  eventSet.sort(compareEvent);
  assert.assertEquals(eventSet.length, 2);
  assert.assertEquals(eventSet[0], {
    content: new TextEncoder().encode('0-Hello'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[1], {
    content: new TextEncoder().encode('1-World'),
    origin: 1,
    receiver: 0,
  });
});

Deno.test('Alo.2 No missing due to out-of-order', async () => {
  let eventSet;
  {
    const { promise: stopSignal1, resolve: stop1 } = Promise.withResolvers<void>();
    const { promise: stopSignal2, resolve: stop2 } = Promise.withResolvers<void>();
    await using tester = new DeliveryTester(2, () => {
      if (tester.events.length === 2) {
        stop1();
      } else if (tester.events.length === 4) {
        stop2();
      }
      return Promise.resolve();
    });
    await tester.start(3000);

    // Make a hanging trigger without actual data
    tester.alos[1].syncNode!.seqNum = 2;
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Then generate two normal updates. They are fetched first.
    await tester.alos[1].produce(new TextEncoder().encode('C'));
    await tester.alos[1].produce(new TextEncoder().encode('D'));

    await stopSignal1;
    // For now, the state must not be set
    assert.assertEquals(tester.alos[0].syncState.get(name`/test/32=node/${1}`), 0);
    // But the data should be delivered
    assert.assertEquals(tester.events.length, 2);

    // Finally make up those missing data.
    await tester.dispositData(1, 1, new TextEncoder().encode('A'));
    await tester.dispositData(1, 2, new TextEncoder().encode('B'));
    // Wait for retransmission Interest.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await stopSignal2;
    eventSet = tester.events;

    // At last, the state should be updated
    assert.assertEquals(tester.alos[0].syncState.get(name`/test/32=node/${1}`), 4);
  }

  // Since it is unordered, we have to sort
  eventSet.sort(compareEvent);
  assert.assertEquals(eventSet.length, 4);
  assert.assertEquals(eventSet[0], {
    content: new TextEncoder().encode('A'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[1], {
    content: new TextEncoder().encode('B'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[2], {
    content: new TextEncoder().encode('C'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[3], {
    content: new TextEncoder().encode('D'),
    origin: 1,
    receiver: 0,
  });
});

Deno.test('Alo.2.1 Concurrent onUpdates causing gap in the middle', async () => {
  let eventSet;
  {
    const { promise: stopSignal1, resolve: stop1 } = Promise.withResolvers<void>();
    const { promise: stopSignal2, resolve: stop2 } = Promise.withResolvers<void>();
    const { promise: stopSignal3, resolve: stop3 } = Promise.withResolvers<void>();
    await using tester = new DeliveryTester(2, () => {
      if (tester.events.length === 4) {
        stop1();
      } else if (tester.events.length === 6) {
        stop2();
      } else if (tester.events.length === 8) {
        stop3();
      }
      return Promise.resolve();
    });
    await tester.start(3000);

    // Do not use alo1 for this time
    await tester.alos[1].destroy();

    // Then generate two normal updates. They are fetched first. (No 7, 8)
    await tester.dispositData(1, 7, new TextEncoder().encode('G'));
    await tester.dispositData(1, 8, new TextEncoder().encode('H'));
    // Make some initial data (No 1, 2)
    await tester.dispositData(1, 1, new TextEncoder().encode('A'));
    await tester.dispositData(1, 2, new TextEncoder().encode('B'));

    // Call onUpdate for 7-8 and 1-2
    await tester.alos[0].handleSyncUpdate(
      new SyncUpdate<Name>(tester.alos[0].syncInst!.get(name`/test/32=node/${1}`), 7, 8),
    );
    await tester.alos[0].handleSyncUpdate(
      new SyncUpdate<Name>(tester.alos[0].syncInst!.get(name`/test/32=node/${1}`), 1, 2),
    );

    await stopSignal1;
    // For now, the state must be in the middle
    assert.assertEquals(tester.alos[0].syncState.get(name`/test/32=node/${1}`), 2);
    // But the data should be delivered
    assert.assertEquals(tester.events.length, 4);

    // Make up some missing data. (No 3, 5)
    await tester.dispositData(1, 3, new TextEncoder().encode('C'));
    await tester.dispositData(1, 5, new TextEncoder().encode('E'));
    // Call onUpdate on each of them
    await tester.alos[0].handleSyncUpdate(
      new SyncUpdate<Name>(tester.alos[0].syncInst!.get(name`/test/32=node/${1}`), 3, 3),
    );
    await tester.alos[0].handleSyncUpdate(
      new SyncUpdate<Name>(tester.alos[0].syncInst!.get(name`/test/32=node/${1}`), 5, 5),
    );

    await stopSignal2;
    // For now, the state must move by 1
    assert.assertEquals(tester.alos[0].syncState.get(name`/test/32=node/${1}`), 3);

    // Finally make up all missing data.
    await tester.dispositData(1, 4, new TextEncoder().encode('D'));
    await tester.dispositData(1, 6, new TextEncoder().encode('F'));
    // Call onUpdate on each of them
    await tester.alos[0].handleSyncUpdate(
      new SyncUpdate<Name>(tester.alos[0].syncInst!.get(name`/test/32=node/${1}`), 4, 4),
    );
    await tester.alos[0].handleSyncUpdate(
      new SyncUpdate<Name>(tester.alos[0].syncInst!.get(name`/test/32=node/${1}`), 6, 6),
    );

    await stopSignal3;
    eventSet = tester.events;

    // At last, the state should be updated
    assert.assertEquals(tester.alos[0].syncState.get(name`/test/32=node/${1}`), 8);
  }

  // Since it is unordered, we have to sort
  eventSet.sort(compareEvent);
  assert.assertEquals(eventSet.length, 8);
  assert.assertEquals(eventSet[0], {
    content: new TextEncoder().encode('A'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[1], {
    content: new TextEncoder().encode('B'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[2], {
    content: new TextEncoder().encode('C'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[3], {
    content: new TextEncoder().encode('D'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[4], {
    content: new TextEncoder().encode('E'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[5], {
    content: new TextEncoder().encode('F'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[6], {
    content: new TextEncoder().encode('G'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[7], {
    content: new TextEncoder().encode('H'),
    origin: 1,
    receiver: 0,
  });
});

Deno.test('Alo.3 Recover after shutdown', async () => {
  let eventSet;
  {
    const { promise: stopSignal0, resolve: stop0 } = Promise.withResolvers<void>();
    const { promise: stopSignal1, resolve: stop1 } = Promise.withResolvers<void>();
    const { promise: stopSignal2, resolve: stop2 } = Promise.withResolvers<void>();
    await using tester = new DeliveryTester(2, () => {
      if (tester.events.length === 1) {
        stop0();
      } else if (tester.events.length === 2) {
        stop1();
      } else if (tester.events.length === 4) {
        stop2();
      }
      return Promise.resolve();
    });
    await tester.start(2000);

    // Provide A and C. (no B)
    await tester.alos[1].produce(new TextEncoder().encode('A'));
    await stopSignal0; // Wait the database to be set
    tester.alos[1].syncNode!.seqNum = 2;
    await tester.alos[1].produce(new TextEncoder().encode('C'));
    await stopSignal1;

    // Stop alo 0
    await tester.alos[0].destroy();

    // Assert we have 'A' and 'C'
    eventSet = tester.events.toSorted(compareEvent);
    assert.assertEquals(eventSet.length, 2);
    assert.assertEquals(eventSet[0], {
      content: new TextEncoder().encode('A'),
      origin: 1,
      receiver: 0,
    });
    assert.assertEquals(eventSet[1], {
      content: new TextEncoder().encode('C'),
      origin: 1,
      receiver: 0,
    });

    // Provide 'B'
    await tester.dispositData(1, 2, new TextEncoder().encode('B'));

    // Restart alo 0. It is supposed to deliver 'C' again.
    tester.alos[0] = await AtLeastOnceDelivery.create(
      name`/test/32=node/${0}`,
      tester.fwAB,
      tester.syncPrefix,
      digestSigning,
      digestSigning,
      tester.stores[0],
      Promise.resolve(tester.onUpdate.bind(tester)),
    );
    tester.alos[0].start();

    // Wait for 'B' and 'C' again
    await stopSignal2;

    // Manually destroy alo0 since it is created outside
    tester.alos[0].destroy();
    eventSet = tester.events;
  }

  // Since it is unordered, we have to sort
  eventSet.sort(compareEvent);
  assert.assertEquals(eventSet.length, 4);
  assert.assertEquals(eventSet[0], {
    content: new TextEncoder().encode('A'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[1], {
    content: new TextEncoder().encode('B'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[2], {
    content: new TextEncoder().encode('C'),
    origin: 1,
    receiver: 0,
  });
  assert.assertEquals(eventSet[3], {
    content: new TextEncoder().encode('C'),
    origin: 1,
    receiver: 0,
  });
});

// Alo.4 Crash during onUpdate
// Unable to test for now

// Alo.5 Data unverified
// Unable to test for now
// This kind of error may only come from two sources:
// 1. authenticated users(producers)'s doing this on purpose,
// 2. cache polution.
// Case 1 is not very bad, since today's cloud application may still suffer from it.
// If the user is allowed to modify data, it is kind of feature.
// Case 2 needs network operator's help to eliminate.

Deno.test('Alo.Ex Unverified SVS Sync interest', async () => {
  // Note: this is handled by NDNts, not this library.

  let eventSet;
  {
    await using tester = new DeliveryTester(2, () => {
      throw new Error('Not suppsoed to handle any data');
    });
    await tester.start(2000, digestSigning, {
      verify: () => Promise.reject('Always fail verifier'),
    });

    await tester.alos[1].produce(new TextEncoder().encode('0-Hello'));
    await tester.alos[1].produce(new TextEncoder().encode('1-World'));
    await new Promise((resolve) => setTimeout(resolve, 500));

    eventSet = tester.events;
  }

  // Should receive no data
  assert.assertEquals(eventSet.length, 0);
});
