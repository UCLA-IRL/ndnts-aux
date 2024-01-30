import { Name } from '@ndn/packet';
import * as namePattern from './name-pattern.ts';

export type Node<R> = {
  children: Map<number, {
    edge: namePattern.PatternComponent;
    dest: Node<R>;
  }>;
  parent: WeakRef<Node<R>> | undefined;
  resource: R;
};

export type MatchedObject<R> = {
  mapping: Record<string, namePattern.MatchValue>;
  name: Name;
  resource: R;
};
