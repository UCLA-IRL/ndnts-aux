import { assert } from '../dep.ts';
import { callCC } from './callcc.ts';

const { assertEquals } = assert;

const multiplyArray = (nums: number[]): number => {
  const multiplyArrayRecur = (i: number, prod: number, exit: (result: number) => void): number => {
    if (i === nums.length) {
      return prod;
    }
    const cur = nums[i];
    if (cur === 0) {
      exit(0);
      // Never execute.
    }
    return multiplyArrayRecur(i + 1, prod * cur, exit);
  };
  return callCC((exit) => multiplyArrayRecur(0, 1, exit));
};

Deno.test('callCC test 1', () => {
  assertEquals(multiplyArray([]), 1);
});

Deno.test('callCC test 2', () => {
  assertEquals(multiplyArray([2, 0, NaN]), 0);
});

Deno.test('callCC test 3', () => {
  assertEquals(multiplyArray([1, 2, 3]), 6);
});

Deno.test('callCC test 4', () => {
  assertEquals(multiplyArray([NaN, 0, NaN]), 0);
});
