import { assertEquals } from 'assert';
import { encodeKey } from './encode-key.ts';

Deno.test('encodeKey test', () => {
  assertEquals(encodeKey('ax<>:"\\/|?*\x00+='), 'ax%3C%3E%3A%22%5C%2F%7C%3F%2A%00%2B%3D');
});
