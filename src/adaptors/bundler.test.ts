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

Deno.test('Bundler.4', async () => {
  const result: Array<Uint8Array> = [];
  const bundler = new Bundler(
    joinMerger,
    (update) => {
      result.push(update);
      return Promise.resolve();
    },
    {
      thresholdSize: 1000,
      delayMs: 300,
      maxDelayMs: 800,
    },
  );

  await bundler.produce(b`A`);
  await bundler.produce(b`B`);
  await sleep(0.4); // Trigger break
  await bundler.produce(b`C`);
  await bundler.produce(b`D`);
  await sleep(0.25); // No break
  await bundler.produce(b`E`);
  await bundler.produce(b`F`);
  await sleep(0.25); // No break
  await bundler.produce(b`G`);
  await bundler.produce(b`H`);
  await sleep(0.25); // No break
  await bundler.produce(b`I`);
  await bundler.produce(b`J`);
  await sleep(0.25); // With break
  await bundler.produce(b`K`);
  await bundler.produce(b`L`);
  await sleep(0.1); // No break
  await bundler.produce(b`M`);
  await bundler.produce(b`N`);
  await sleep(0.4); // With break
  assertEquals(result, [b`AB`, b`CDEFGHIJ`, b`KLMN`]);
});
