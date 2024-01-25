import { assert as assertMod } from '../dep.ts';
import { Component, Name } from '@ndn/packet';
import { name } from './name-lit.ts';

const { assert } = assertMod;

Deno.test('Name tagged template literal test', () => {
  assert(name``.equals('/'));
  assert(name`/aa/bb`.equals('/8=aa/8=bb'));
  assert(name`/${'aa'}/8=${'bb'}`.equals('/8=aa/8=bb'));
  assert(name`/${new Name('/aa/bb')}/${new Name('/cc/dd')}/${new Component(10, 'ee')}`
    .equals('/8=aa/8=bb/8=cc/8=dd/10=ee'));
  assert(name`/a/seq=${1}`.equals('/8=a/58=%01'));
  assert(name`/v=${1000}`.equals('/54=%03%E8'));
  assert(name`/${new Uint8Array([1, 2, 3, 4])}`.equals('/8=%01%02%03%04'));
  assert(name`/test/node-${1}`.equals('/8=test/8=node-%01'));
});
