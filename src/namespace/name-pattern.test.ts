import { Component } from '@ndn/packet';
import { assert as assertMod } from '../dep.ts';
import { name } from '../utils/mod.ts';
import * as namePattern from './name-pattern.ts';
import { pattern } from './name-pattern.ts';

const assert = assertMod.assert as ((expr: unknown, msg?: string) => void);
const { assertEquals } = assertMod;

Deno.test('Name Pattern construction', () => {
  const pat = pattern`/8=base/<8=peerId:string>/<58=sequence:number>`;
  assertEquals(pat.length, 3);
  assert((pat[0] as Component).equals(new Component(8, 'base')));
  assertEquals(pat[1] as namePattern.PatternComponent, {
    type: 8,
    kind: 'string',
    tag: 'peerId',
  });
  assertEquals(pat[2] as namePattern.PatternComponent, {
    type: 58,
    kind: 'number',
    tag: 'sequence',
  });

  const mapping = {};
  assert(namePattern.match(pat, name`/base/peer-01/seq=${13}`, mapping));
  assertEquals(mapping, {
    peerId: 'peer-01',
    sequence: 13,
  });
});

Deno.test('Make name from patterns', () => {
  const pat = pattern`/8=base/<8=peerId:string>/<58=sequence:number>`;
  assert(
    namePattern.make(pat, {
      peerId: 'peer-01',
      sequence: 13,
    }).equals(name`/base/peer-01/seq=${13}`),
  );
});
