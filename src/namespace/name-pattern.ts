import { Component, Name } from '@ndn/packet';
import { Encoder, NNI } from '@ndn/tlv';

export type PatternKind = 'bytes' | 'number' | 'string';
export type MatchValue = Uint8Array | number | string;

export type PatternComponent = {
  /** TLV-TYPE. */
  type: number;
  /** Pattern's matching variable name */
  tag: string;
  /** Pattern value type */
  kind: PatternKind;
};

export type Pattern = Array<PatternComponent | Component>;

export type Mapping = Record<string, MatchValue>;

export const patternComponentToString = (comp: PatternComponent) => `<${comp.type}=${comp.tag}:${comp.kind}>`;

export const componentToString = (comp: PatternComponent | Component) =>
  comp instanceof Component ? comp.toString() : patternComponentToString(comp);

/**
 * Convert a name pattern to string
 * @param pat The name pattern
 * @returns String representation
 */
export const toString = (pat: Pattern) => '/' + pat.map(componentToString).join('/');

export const matchStep = (
  pattern: PatternComponent | Component,
  subject: Component,
  mapping: Mapping,
) => {
  if (pattern.type !== subject.type) {
    return false;
  }
  if (pattern instanceof Component) {
    return pattern.equals(subject);
  } else if (pattern.kind === 'bytes') {
    mapping[pattern.tag] = subject.value;
    return true;
  } else if (pattern.kind === 'string') {
    mapping[pattern.tag] = subject.text;
    return true;
  } else {
    try {
      mapping[pattern.tag] = NNI.decode(subject.value);
      return true;
    } catch {
      return false;
    }
  }
};

/**
 * Match a given name with a given name pattern, and put matched variables into mapping.
 * Digest components are removen.
 *
 * @param pattern The name pattern to match with.
 * @param subject The name to be matched.
 * @param mapping The mapping holding matched variables.
 * @returns `true` if succeeded, `false` if failed.
 * @throws when the component type matches but its value cannot be decoded as specified value kind.
 */
export const match = (
  pattern: Pattern,
  subject: Name,
  mapping: Mapping,
) => {
  // Remove automatically added component
  // ImplicitSha256DigestComponent(0x01) and ParametersSha256DigestComponent(0x02)
  while (subject.length > 0 && subject.at(subject.length - 1).type <= 2) {
    subject = subject.getPrefix(subject.length - 1);
  }
  // Must be equal length
  if (subject.length !== pattern.length) {
    return false;
  }
  for (const [i, p] of pattern.entries()) {
    if (!matchStep(p, subject.at(i), mapping)) {
      return false;
    }
  }
  return true;
};

export const makeStep = (
  pattern: PatternComponent | Component,
  mapping: Mapping,
) => {
  if (pattern instanceof Component) {
    return pattern;
  } else {
    const value = mapping[pattern.tag];
    if (!value) {
      throw new Error(`The pattern variable ${pattern.tag} does not exist in the mapping.`);
    }
    const v = typeof value === 'number' ? Encoder.encode(NNI(value)) : value;
    return new Component(pattern.type, v);
  }
};

/**
 * Construct a Name from a given name pattern with variable mapping.
 *
 * @remarks The value kind of pattern components are not checked.
 * @param pattern The input name pattern
 * @param mapping The variable mapping
 * @returns The constructed name
 * @throws if a pattern with a given variable is missing
 */
export const make = (
  pattern: Pattern,
  mapping: Mapping,
) => new Name(pattern.map((p) => makeStep(p, mapping)));

export const componentFromString = (value: string): Component | PatternComponent => {
  if (value.length === 0) {
    return new Component();
  }
  if (value[0] !== '<') {
    return Component.from(value);
  } else {
    const matching = /^<(?<type>[0-9]+)=(?<tag>[a-zA-Z0-9$_-]+):(?<kind>bytes|number|string)>$/.exec(value);
    if (!matching || !matching.groups) {
      throw new Error(`Invalid pattern component: ${value}`);
    }
    return {
      type: parseInt(matching.groups.type),
      kind: matching.groups.kind as PatternKind, // Assume correct, no check
      tag: matching.groups.tag,
    };
  }
};

export const fromString = (value: string): Pattern => {
  if (value[0] === '/') {
    value = value.substring(1);
  }
  return value.split('/').map(componentFromString);
};

export const pattern = ([value]: TemplateStringsArray) => {
  return fromString(value);
};
