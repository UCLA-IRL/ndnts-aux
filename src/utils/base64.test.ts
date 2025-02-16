import { assertEquals } from 'assert';
import { base64ToBytes, bytesToBase64 } from './base64.ts';

Deno.test('bytesToBase64 test', () => {
  assertEquals(bytesToBase64(new Uint8Array([0x00, 0x0a, 0x0b, 0x10, 0xfa, 0x01])), 'AAoLEPoB');
});

Deno.test('base64ToBytes test', () => {
  assertEquals(base64ToBytes('AAoLEPoB'), new Uint8Array([0x00, 0x0a, 0x0b, 0x10, 0xfa, 0x01]));
});
