import { Component, Name } from '@ndn/packet';
import * as namePattern from './name-pattern.ts';

export type Node<R> = {
  fixedChildren: Array<{
    edge: Component;
    dest: Node<R>;
  }>;
  children: Map<number, Node<R>>;
  parent?: WeakRef<Node<R>>;
  upEdge?: namePattern.PatternComponent | Component;
  resource?: R;
};

export type MatchedObject<R> = {
  mapping: namePattern.Mapping;
  name: Name;
  resource?: R;
};

export type StrictMatch<R> = Required<MatchedObject<R>>;

export const apply = <R>(
  node: Node<R>,
  mapping: namePattern.Mapping,
): MatchedObject<R> => {
  const path: Array<Component> = [];
  let cur: Node<R> | undefined = node;
  while (cur?.upEdge) {
    path.push(namePattern.makeStep(cur.upEdge, mapping));
    cur = cur.parent?.deref();
  }
  return {
    mapping,
    resource: node.resource,
    name: new Name(path.reverse()),
  };
};

export const match = <R>(
  node: Node<R>,
  name: Name,
): MatchedObject<R> | undefined => {
  // Remove automatically added component
  // ImplicitSha256DigestComponent(0x01) and ParametersSha256DigestComponent(0x02)
  while (name.length > 0 && name.at(name.length - 1).type <= 2) {
    name = name.getPrefix(name.length - 1);
  }
  let cur: Node<R> = node;
  const mapping: namePattern.Mapping = {};
  for (const comp of name.comps) {
    let nextFixedNode: Node<R> | undefined = undefined;
    // Check fixed children first
    for (const { edge, dest } of cur.fixedChildren) {
      if (edge.equals(comp)) {
        nextFixedNode = dest;
        break;
      }
    }
    if (nextFixedNode) {
      cur = nextFixedNode;
      continue;
    }
    // Then pattern children
    const nextNode = cur.children.get(comp.type);
    const edge = nextNode?.upEdge;
    if (!edge || !namePattern.matchStep(edge, comp, mapping)) {
      return undefined;
    }
    cur = nextNode;
  }
  return {
    mapping,
    resource: cur.resource,
    name: name,
  };
};

export const get = <R>(
  root: Node<R>,
  path: namePattern.Pattern,
): Node<R> | undefined => {
  let cur = root;
  for (const pat of path) {
    if (pat instanceof Component) {
      // Fixed children
      let nextFixedNode: Node<R> | undefined = undefined;
      for (const { edge, dest } of cur.fixedChildren) {
        if (edge.equals(pat)) {
          nextFixedNode = dest;
          break;
        }
      }
      if (nextFixedNode) {
        cur = nextFixedNode;
      } else {
        return undefined;
      }
    } else {
      // Pattern children
      const nextNode = cur.children.get(pat.type);
      const edge = nextNode?.upEdge;
      if (!edge || edge instanceof Component || edge.tag !== pat.tag || edge.kind !== pat.kind) {
        return undefined;
      }
      cur = nextNode;
    }
  }
  return cur;
};

export const touch = <R>(
  root: Node<R>,
  path: namePattern.Pattern,
  resource?: R,
): Node<R> => {
  let cur: Node<R> = root;
  for (const pat of path) {
    if (pat instanceof Component) {
      // Fixed children
      let nextFixedNode: Node<R> | undefined = undefined;
      for (const { edge, dest } of cur.fixedChildren) {
        if (edge.equals(pat)) {
          nextFixedNode = dest;
          break;
        }
      }
      if (!nextFixedNode) {
        // Create new
        nextFixedNode = {
          fixedChildren: [],
          children: new Map(),
          parent: new WeakRef(cur),
          upEdge: pat,
          resource: undefined,
        };
        cur.fixedChildren.push({
          edge: pat,
          dest: nextFixedNode,
        });
      }
      cur = nextFixedNode;
    } else {
      // Pattern children
      let nextNode = cur.children.get(pat.type);
      const edge = nextNode?.upEdge;
      if (!edge || edge instanceof Component || edge.tag !== pat.tag || edge.kind !== pat.kind) {
        if (nextNode) {
          throw new Error(`PatternTree's existing edge ${edge} conflicts with desired edge ${pat}`);
        }
        // Create new
        nextNode = {
          fixedChildren: [],
          children: new Map(),
          parent: new WeakRef(cur),
          upEdge: pat,
          resource: undefined,
        };
        cur.children.set(pat.type, nextNode);
      }
      cur = nextNode!;
    }
  }
  if (resource) {
    cur.resource = resource;
  }
  return cur;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _callOld = <
  Args extends Array<unknown>,
  Key extends string,
  Return,
  R extends { [key in Key]: (matchedObj: MatchedObject<R>, ...args: Args) => Return },
>(object: MatchedObject<R>, key: Key, ...args: Args): Return | undefined => {
  return object.resource?.[key](object, ...args);
};

export const call = <
  R,
  Key extends {
    // deno-lint-ignore no-explicit-any
    [K in keyof R]: R[K] extends ((matchedObj: MatchedObject<R>, ...args: any[]) => unknown) ? K : never;
  }[keyof R],
>(
  object: MatchedObject<R>,
  key: Key,
  ...args: R[Key] extends ((matchedObj: MatchedObject<R>, ...args: infer Args) => unknown) ? Args : never
) => {
  if (object.resource) {
    const func = object.resource[key] as ((
      matchedObj: MatchedObject<R>,
      ...params: typeof args
    ) => R[Key] extends (matchedObj: MatchedObject<R>, ...params: typeof args) => infer Return ? Return : never);
    return func(object, ...args);
  } else {
    throw new Error(`Invalid schema tree node call on ${object.name.toString()}`);
  }
};

export const create = <R>(): Node<R> => ({
  fixedChildren: [],
  children: new Map(),
  parent: undefined,
  upEdge: undefined,
  resource: undefined,
});
