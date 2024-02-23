import { assert } from '../../dep.ts';
import { AsyncDisposableStack, name, Responder } from '../../utils/mod.ts';
import { Endpoint } from '@ndn/endpoint';
import { Data, digestSigning } from '@ndn/packet';
import { Decoder, Encoder } from '@ndn/tlv';
import { Bridge } from '@ndn/l3face';
import { BufferChunkSource, fetch } from '@ndn/segmented-object';
import { NtSchema, VerifyResult } from '../nt-schema.ts';
import { InMemoryStorage } from '../../storage/mod.ts';
import { LeafNode } from '../leaf-node.ts';
import * as Tree from '../schema-tree.ts';
import { SegmentedObject } from './segmented-object.ts';

export const b = ([value]: TemplateStringsArray) => new TextEncoder().encode(value);

Deno.test('SegmentedObject.1 Basic fetching', async () => {
  using bridge = Bridge.create({});
  const { fwA, fwB } = bridge;
  const epA = new Endpoint({ fw: fwA });
  const epB = new Endpoint({ fw: fwB });
  await using closers = new AsyncDisposableStack();
  const appPrefix = name`/prefix`;

  // NTSchema side
  const schema = new NtSchema();
  const leafNode = schema.set('/object/<50=segNum:number>', LeafNode, {});
  leafNode.resource!.onVerify.addListener(async ({ pkt }) => {
    try {
      await digestSigning.verify(pkt);
      return VerifyResult.Pass;
    } catch {
      return VerifyResult.Fail;
    }
  });
  const segObjNode = schema.set('/object', SegmentedObject, {
    leafNode,
    lifetimeAfterRto: 100,
  });
  await schema.attach(appPrefix, epA);
  closers.defer(async () => await schema.detach());

  // Responder side
  const storage = new InMemoryStorage();
  closers.use(storage);
  const responder = new Responder(appPrefix, epB, storage);
  closers.use(responder);
  const payloads = [b`SEG1 `, b`SEG2 `, b`SEG3;`];
  for (const [i, p] of payloads.entries()) {
    const data = new Data(
      name`${appPrefix}/object/50=${i}`,
      Data.FreshnessPeriod(1000),
      p,
    );
    data.finalBlockId = name`50=${payloads.length - 1}`.get(0);
    await digestSigning.sign(data);
    await storage.set(data.name.toString(), Encoder.encode(data));
  }

  // Fetching Object
  const results = [];
  const matched = Tree.apply(segObjNode, {});
  const needed = Tree.call(matched, 'need');
  for await (const r of needed) {
    results.push(r.content);
  }

  assert.assertEquals(results, payloads);
});

Deno.test('SegmentedObject.2 Basic provide', async () => {
  using bridge = Bridge.create({});
  const { fwA, fwB } = bridge;
  const epA = new Endpoint({ fw: fwA });
  await using closers = new AsyncDisposableStack();
  const appPrefix = name`/prefix`;

  // NTSchema side
  const schema = new NtSchema();
  const storageA = new InMemoryStorage();
  const leafNode = schema.set('/object/<50=segNum:number>', LeafNode, {
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
  const segObjNode = schema.set('/object', SegmentedObject, {
    leafNode,
    lifetimeAfterRto: 100,
  });
  await schema.attach(appPrefix, epA);
  closers.defer(async () => await schema.detach());

  // Provide object
  const matched = Tree.apply(segObjNode, {});
  await Tree.call(
    matched,
    'provide',
    new BufferChunkSource(
      b`SEG1 SEG2 SEG3;`,
      { chunkSize: 5 },
    ),
  );

  // Fetching Object
  const results = [];
  const result = fetch(name`${appPrefix}/object/`, {
    fw: fwB,
    verifier: digestSigning,
    modifyInterest: { mustBeFresh: true },
    lifetimeAfterRto: 2000,
    // default naming convention is 50=
  });
  for await (const segment of result) {
    // Reassemble
    results.push(segment.content);
  }

  assert.assertEquals(results, [b`SEG1 `, b`SEG2 `, b`SEG3;`]);
});
