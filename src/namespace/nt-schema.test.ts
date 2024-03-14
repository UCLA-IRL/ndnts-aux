import { assert } from '../dep.ts';
import { AsyncDisposableStack, name, Responder } from '../utils/mod.ts';
import { consume } from '@ndn/endpoint';
import { Data, digestSigning, SigType } from '@ndn/packet';
import { Decoder, Encoder } from '@ndn/tlv';
import { Bridge } from '@ndn/l3face';
import { Ed25519, generateSigningKey } from '@ndn/keychain';
import { NtSchema, VerifyResult } from './nt-schema.ts';
import { InMemoryStorage } from '../storage/mod.ts';
import { LeafNode } from './leaf-node.ts';
import * as Tree from './schema-tree.ts';

export const b = ([value]: TemplateStringsArray) => new TextEncoder().encode(value);

Deno.test('NtSchema.1 Basic Interest and Data', async () => {
  using bridge = Bridge.create({});
  const { fwA, fwB } = bridge;
  await using closers = new AsyncDisposableStack();
  const appPrefix = name`/prefix`;

  // NTSchema side
  const schema = new NtSchema();
  const leafNode = schema.set('/records/<8=recordId:string>', LeafNode, {
    lifetimeMs: 100,
    freshnessMs: 60000,
    signer: digestSigning,
  });
  leafNode.resource!.onVerify.addListener(async ({ pkt }) => {
    try {
      await digestSigning.verify(pkt);
      return VerifyResult.Pass;
    } catch {
      return VerifyResult.Fail;
    }
  });
  leafNode.resource!.onInterest.addListener(async () => {
    const data3 = new Data(
      name`${appPrefix}/records/8=rec3`,
      Data.FreshnessPeriod(60000),
      b`Hello, World.`,
    );
    await digestSigning.sign(data3);
    return data3;
  });
  await schema.attach(appPrefix, fwA);
  closers.defer(async () => await schema.detach());

  // Responder side
  const storage = new InMemoryStorage();
  closers.use(storage);
  const responder = new Responder(appPrefix, fwB, storage);
  closers.use(responder);
  const data1 = new Data(
    name`${appPrefix}/records/8=rec1`,
    Data.FreshnessPeriod(1000),
    b`Hello,`,
  );
  await digestSigning.sign(data1);
  await storage.set(data1.name.toString(), Encoder.encode(data1));
  const data2 = new Data(
    name`${appPrefix}/records/8=rec2`,
    Data.FreshnessPeriod(1000),
    b`World.`,
  );
  await digestSigning.sign(data2);
  await storage.set(data2.name.toString(), Encoder.encode(data2));

  // Express Interest
  const recved1 = await Tree.call(
    Tree.apply(leafNode, { 'recordId': 'rec1' }),
    'need',
  );
  assert.assertExists(recved1);
  assert.assert(recved1.name.equals(name`${appPrefix}/records/8=rec1`));
  assert.assertEquals(recved1.content, b`Hello,`);

  const recved2 = await Tree.call(
    Tree.cast(schema.match(name`${appPrefix}/records/8=rec2`), LeafNode)!,
    'need',
  );
  assert.assertExists(recved2);
  assert.assert(recved2.name.equals(name`${appPrefix}/records/8=rec2`));
  assert.assertEquals(recved2.content, b`World.`);

  // Test NTSchema's producing data (on request, without storage)
  const recved3 = await consume(name`${appPrefix}/records/8=rec3`, {
    verifier: digestSigning,
    fw: fwB,
  });
  assert.assertExists(recved3);
  assert.assert(recved3.name.equals(name`${appPrefix}/records/8=rec3`));
  assert.assertEquals(recved3.freshnessPeriod, 60000);
  assert.assertEquals(recved3.content, b`Hello, World.`);
});

Deno.test('NtSchema.2 Data Storage', async () => {
  using bridge = Bridge.create({});
  const { fwA, fwB } = bridge;
  await using closers = new AsyncDisposableStack();
  const appPrefix = name`/prefix`;

  // NTSchema side
  const schema = new NtSchema();
  const storageA = new InMemoryStorage();
  const leafNode = schema.set('/records/<8=recordId:string>', LeafNode, {
    lifetimeMs: 100,
    freshnessMs: 60000,
    signer: digestSigning,
  });
  leafNode.resource!.onVerify.addListener(async ({ pkt }) => {
    try {
      await digestSigning.verify(pkt);
      return VerifyResult.Pass;
    } catch {
      return VerifyResult.Fail;
    }
  });
  leafNode.resource!.onSaveStorage.addListener(({ data, wire }) => storageA.set(data.name.toString(), wire));
  leafNode.resource!.onSearchStorage.addListener(async ({ interest }) => {
    const wire = await storageA.get(interest.name.toString());
    if (wire) {
      return Decoder.decode(wire, Data);
    } else {
      return undefined;
    }
  });
  await schema.attach(appPrefix, fwA);
  closers.defer(async () => await schema.detach());

  // Responder side
  const storageB = new InMemoryStorage();
  closers.use(storageB);
  const responder = new Responder(appPrefix, fwB, storageB);
  closers.use(responder);
  const data1 = new Data(
    name`${appPrefix}/records/8=rec1`,
    Data.FreshnessPeriod(1000),
    b`Hello,`,
  );
  await digestSigning.sign(data1);
  await storageB.set(data1.name.toString(), Encoder.encode(data1));

  // Test NTSchema's producing data (with storage)
  await Tree.call(
    Tree.cast(schema.match(name`${appPrefix}/records/8=rec2`), LeafNode)!,
    'provide',
    b`World.`,
  );
  const received = await consume(name`${appPrefix}/records/8=rec2`, {
    verifier: digestSigning,
    fw: fwB,
  });
  assert.assertExists(received);
  assert.assert(received.name.equals(name`${appPrefix}/records/8=rec2`));
  assert.assertEquals(received.freshnessPeriod, 60000);
  assert.assertEquals(received.contentType, 0);
  assert.assertEquals(received.content, b`World.`);

  // Test NTSchema can cache received Data
  const recved1 = await Tree.call(
    Tree.apply(leafNode, { 'recordId': 'rec1' }),
    'need',
  );
  assert.assertExists(recved1);
  // Remove the responder and test again
  await storageB.delete(data1.name.toString());
  const recved2 = await Tree.call(
    Tree.apply(leafNode, { 'recordId': 'rec1' }),
    'need',
  );
  assert.assertExists(recved2);
  assert.assert(recved2.name.equals(name`${appPrefix}/records/8=rec1`));
  assert.assertEquals(recved2.content, b`Hello,`);
});

Deno.test('NtSchema.3 Verification', async () => {
  using bridge = Bridge.create({});
  const { fwA, fwB } = bridge;
  await using closers = new AsyncDisposableStack();
  const appPrefix = name`/prefix`;
  const [prvKey, pubKey] = await generateSigningKey(/*identity*/ appPrefix, Ed25519);
  const [wrongKey, _wrongPubKey] = await generateSigningKey(/*identity*/ appPrefix, Ed25519);

  // NTSchema side
  const schema = new NtSchema();
  const leafNode = schema.set('/records/<8=recordId:string>', LeafNode, {
    lifetimeMs: 100,
    freshnessMs: 60000,
    signer: digestSigning,
  });
  leafNode.resource!.onVerify.addListener(async ({ pkt, prevResult }) => {
    if (pkt.sigInfo?.type === SigType.Sha256) {
      try {
        await digestSigning.verify(pkt);
        return VerifyResult.Pass;
      } catch {
        return VerifyResult.Fail;
      }
    } else {
      return prevResult;
    }
  });
  leafNode.resource!.onVerify.addListener(async ({ pkt, prevResult }) => {
    if (pkt.sigInfo?.type === SigType.Ed25519) {
      try {
        await pubKey.verify(pkt);
        return VerifyResult.Pass;
      } catch {
        return VerifyResult.Fail;
      }
    } else {
      return prevResult;
    }
  });
  await schema.attach(appPrefix, fwA);
  closers.defer(async () => await schema.detach());

  // Responder side
  const storage = new InMemoryStorage();
  closers.use(storage);
  const responder = new Responder(appPrefix, fwB, storage);
  closers.use(responder);
  const data1 = new Data(
    name`${appPrefix}/records/8=rec1`,
    Data.FreshnessPeriod(1000),
    b`Hello,`,
  );
  await digestSigning.sign(data1);
  await storage.set(data1.name.toString(), Encoder.encode(data1));
  const data2 = new Data(
    name`${appPrefix}/records/8=rec2`,
    Data.FreshnessPeriod(1000),
    b`World.`,
  );
  await prvKey.sign(data2);
  await storage.set(data2.name.toString(), Encoder.encode(data2));
  const data3 = new Data(
    name`${appPrefix}/records/8=rec3`,
    Data.FreshnessPeriod(1000),
    b`World.`,
  );
  // data3 is unsigned
  await storage.set(data3.name.toString(), Encoder.encode(data3));
  const data4 = new Data(
    name`${appPrefix}/records/8=rec4`,
    Data.FreshnessPeriod(1000),
    b`World.`,
  );
  await wrongKey.sign(data4);
  await storage.set(data4.name.toString(), Encoder.encode(data4));

  // Express Interest
  const recved1 = await Tree.call(
    Tree.apply(leafNode, { 'recordId': 'rec1' }),
    'need',
  );
  assert.assertExists(recved1);
  const recved2 = await Tree.call(
    Tree.apply(leafNode, { 'recordId': 'rec2' }),
    'need',
  );
  assert.assertExists(recved2);
  assert.assertRejects(() =>
    Tree.call(
      Tree.apply(leafNode, { 'recordId': 'rec3' }),
      'need',
    )
  );
  assert.assertRejects(() =>
    Tree.call(
      Tree.apply(leafNode, { 'recordId': 'rec4' }),
      'need',
    )
  );
});

Deno.test('NtSchema.4 Signed Interest', async () => {
  // TODO:
});
