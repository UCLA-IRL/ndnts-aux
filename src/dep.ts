/**
 * deps.ts
 *
 * This module re-exports the required dependecies, as BYONM does not work with the import map.
 */
export * as assert from 'https://deno.land/std@0.212.0/assert/mod.ts';
export * as hex from 'https://deno.land/std@0.212.0/encoding/hex.ts';
export { sleep } from 'https://deno.land/x/sleep@v1.3.0/mod.ts';
