import { assert as assertMod, sleep } from '../dep.ts';
import { Bundler } from './bundler.ts';

const { assertEquals } = assertMod;

export const b = ([value]: TemplateStringsArray) => new TextEncoder().encode(value);

const joinMerger = (updates: Uint8Array[]) => {
  const totLength = updates.reduce((acc, cur) => acc + cur.length, 0);
  const ret = new Uint8Array(totLength);
  updates.reduce((offset, cur) => {
    ret.set(cur, offset);
    return offset + cur.length;
  }, 0);
  return ret;
};

Deno.test('Bundler.1', async () => {
  const result: Array<Uint8Array> = [];
  const bundler = new Bundler(
    joinMerger,
    (update) => {
      result.push(update);
      return Promise.resolve();
    },
    {
      thresholdSize: 100,
      delayMs: 100,
    },
  );

  await bundler.produce(b`Hello `);
  await bundler.produce(b`World.`);
  await sleep(0.1);
  assertEquals(result, [b`Hello World.`]);
});

Deno.test('Bundler.2', async () => {
  const result: Array<Uint8Array> = [];
  const bundler = new Bundler(
    joinMerger,
    (update) => {
      result.push(update);
      return Promise.resolve();
    },
    {
      thresholdSize: 3,
      delayMs: 100,
    },
  );

  await bundler.produce(b`Hello `);
  await bundler.produce(b`World.`);
  assertEquals(result, [b`Hello `, b`World.`]);
});

Deno.test('Bundler.3', async () => {
  const result: Array<Uint8Array> = [];
  const bundler = new Bundler(
    joinMerger,
    (update) => {
      result.push(update);
      return Promise.resolve();
    },
    {
      thresholdSize: 10,
      delayMs: 100,
    },
  );

  await bundler.produce(b`Hello `);
  await bundler.produce(b`World,`);
  await bundler.produce(b`Hello `);
  await bundler.produce(b`World.`);
  assertEquals(result, [b`Hello World,`, b`Hello World.`]);
});
