// import { assert } from '../../dep.ts';
// import { AsyncDisposableStack, name, Responder } from '../../utils/mod.ts';
// import { Data, digestSigning } from '@ndn/packet';
// import { Encoder } from '@ndn/tlv';
// import { Bridge } from '@ndn/l3face';
// import { NtSchema, VerifyResult } from '../nt-schema.ts';
// import { InMemoryStorage } from '../../storage/mod.ts';
// import { LeafNode } from '../leaf-node.ts';
// import { Fetcher } from './fetcher.ts';

// export const b = ([value]: TemplateStringsArray) => new TextEncoder().encode(value);

// Deno.test('Fetcher.1 Basic fetching', async () => {
//   using bridge = Bridge.create({});
//   const { fwA, fwB } = bridge;
//   await using closers = new AsyncDisposableStack();
//   const appPrefix = name`/prefix`;

//   // NTSchema side
//   const schema = new NtSchema();
//   const leafNode = schema.set('/object/<50=segNum:number>', LeafNode, {});
//   leafNode.resource!.onVerify.addListener(async ({ pkt }) => {
//     try {
//       await digestSigning.verify(pkt);
//       return VerifyResult.Pass;
//     } catch {
//       return VerifyResult.Fail;
//     }
//   });
//   await schema.attach(appPrefix, fwA);
//   closers.defer(async () => await schema.detach());

//   // Responder side
//   const storage = new InMemoryStorage();
//   closers.use(storage);
//   const responder = new Responder(appPrefix, fwB, storage);
//   closers.use(responder);
//   const payloads = [b`SEG1 `, b`SEG2 `, b`SEG3;`];
//   for (const [i, p] of payloads.entries()) {
//     const data = new Data(
//       name`${appPrefix}/object/50=${i}`,
//       Data.FreshnessPeriod(1000),
//       p,
//     );
//     data.finalBlockId = name`50=${payloads.length - 1}`.get(0);
//     await digestSigning.sign(data);
//     await storage.set(data.name.toString(), Encoder.encode(data));
//   }

//   // Fetching Object
//   const results = payloads.map(() => 'MISSING');
//   const fetcher = new Fetcher(leafNode, {}, {});
//   fetcher.onSegment.addListener((segNum, data) => {
//     // results[segNum] = data.content === payloads[segNum] ? 'CORRECT' : 'WRONG';
//     assert.assertEquals(data.content, payloads[segNum]);
//     results[segNum] = 'CORRECT';
//     return Promise.resolve();
//   });
//   const { promise: finishPromise, resolve: resolveFinish } = Promise.withResolvers<void>();
//   fetcher.onEnd.addListener(() => {
//     resolveFinish();
//     return Promise.resolve();
//   });
//   fetcher.onError.addListener((err) => {
//     throw new Error(`Fetching failed: ${err}`);
//   });
//   fetcher.run(); // Concurrently without await
//   await finishPromise;

//   assert.assertEquals(results, ['CORRECT', 'CORRECT', 'CORRECT']);
// });
