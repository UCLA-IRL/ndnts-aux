// import { Component, Name } from '@ndn/packet';
import { assert as assertMod } from '../dep.ts';
import { name } from '../utils/mod.ts';
import * as namePattern from './name-pattern.ts';
import * as schemaTree from './schema-tree.ts';
import { pattern } from './name-pattern.ts';

// const assert = assertMod.assert as ((expr: unknown, msg?: string) => void);
const assertExists = assertMod.assertExists as (<T>(actual: T, msg?: string) => void);
const { assertEquals } = assertMod;

type TestRec = {
  nodeId: string;
  reqId: string;
  mapping: namePattern.Mapping;
  nameStr: string;
};

type TestCollector = Record<string, TestRec>;

class Reflector {
  constructor(
    public readonly nodeId: string,
  ) {}

  public reflect(matched: schemaTree.StrictMatch<Reflector>, mapping: TestCollector, reqId: string) {
    mapping[reqId] = {
      nodeId: this.nodeId,
      reqId,
      mapping: matched.mapping,
      nameStr: matched.name.toString(),
    };
    return this.nodeId;
  }
}

Deno.test('schemaTree.call', () => {
  const collector: TestCollector = {};
  const reflector = new Reflector('node');
  const matched: schemaTree.MatchedObject<Reflector> = {
    mapping: { sequence: 0 },
    name: name`/prefix/seq=${0}`,
    resource: reflector,
  };
  const nodeId = schemaTree.call(matched, 'reflect', collector, 'request');
  assertEquals(collector, {
    request: {
      nodeId: 'node',
      reqId: 'request',
      mapping: { sequence: 0 },
      nameStr: '/8=prefix/58=%00',
    },
  });
  assertEquals(nodeId, 'node');
});

Deno.test('schemaTree basic', () => {
  const root = schemaTree.create<Reflector>();
  const node = schemaTree.touch(root, pattern`/prefix/<58=sequence:number>`, new Reflector('node'));
  const collector: TestCollector = {};

  // Match
  const matched = schemaTree.match(root, name`/prefix/seq=${13}`)!;
  assertExists(matched);
  schemaTree.call(matched, 'reflect', collector, 'req1');
  assertEquals(collector['req1'], {
    nodeId: 'node',
    reqId: 'req1',
    mapping: { sequence: 13 },
    nameStr: '/8=prefix/58=%0D',
  });

  // Apply
  const applied = schemaTree.apply(node, { sequence: 14 });
  schemaTree.call(applied, 'reflect', collector, 'req2');
  assertEquals(collector['req2'], {
    nodeId: 'node',
    reqId: 'req2',
    mapping: { sequence: 14 },
    nameStr: '/8=prefix/58=%0E',
  });
});

Deno.test('schemaTree matching', () => {
  const root = schemaTree.create<Reflector>();
  schemaTree.touch(root, pattern`/prefix/<32=key:string>/<58=sequence:number>`, new Reflector('node-key'));
  schemaTree.touch(root, pattern`/prefix/8=fixed/<58=sequence:number>`, new Reflector('node-fixed'));
  schemaTree.touch(root, pattern`/prefix/<8=nodeId:string>/<58=sequence:number>`, new Reflector('node-id'));

  const collector: TestCollector = {};
  schemaTree.call(schemaTree.match(root, name`/prefix/fixed/seq=${13}`)!, 'reflect', collector, 'req1');
  schemaTree.call(schemaTree.match(root, name`/prefix/32=KEY/seq=${14}`)!, 'reflect', collector, 'req2');
  schemaTree.call(schemaTree.match(root, name`/prefix/name/seq=${15}`)!, 'reflect', collector, 'req3');

  assertEquals(collector, {
    req1: {
      nodeId: 'node-fixed',
      reqId: 'req1',
      mapping: { sequence: 13 },
      nameStr: '/8=prefix/8=fixed/58=%0D',
    },
    req2: {
      nodeId: 'node-key',
      reqId: 'req2',
      mapping: { sequence: 14, key: 'KEY' },
      nameStr: '/8=prefix/32=KEY/58=%0E',
    },
    req3: {
      nodeId: 'node-id',
      reqId: 'req3',
      mapping: { sequence: 15, nodeId: 'name' },
      nameStr: '/8=prefix/8=name/58=%0F',
    },
  });
});
