import { assert } from '../dep.ts';
import { encodeKey } from './encode-key.ts';

const { assertEquals } = assert;

Deno.test('encodeKey test', () => {
  assertEquals(encodeKey('ax<>:"\\/|?*\x00+='), 'ax%3C%3E%3A%22%5C%2F%7C%3F%2A%00%2B%3D');
});
