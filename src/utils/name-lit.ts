import { Component, Name } from '@ndn/packet';
import { Encoder, NNI } from '@ndn/tlv';

/**
 * NDN Name generator for test. Allows to use tag literals to generate NDN name from boilerplate.
 * Designed for unit tests only. Do not use in production, as it is slow and not guaranteed to reflect the latest spec.
 *
 * @remarks
 *
 * 1. Alternative URI only works for templates, e.g. `` name`/aa/seg=${1}` ``.
 * 2. Do not try to fool this function on purpuse. It is designed for test use only and
 *    does not handle corner cases at all.
 *    For example, `` name`/8=seg=${0}` ``.
 *
 * @param templates Name boilerplate
 * @param values Values
 */
export const name = (
  templates: TemplateStringsArray,
  ...values: Array<string | Uint8Array | number | Component | Name>
) => {
  const stringValues: string[] = values.map((v) => {
    if (typeof v === 'number') {
      v = Encoder.encode(NNI(v));
    }
    if (v instanceof Name) {
      // Remove the beginning '/' to allow name`/aa/${name}/bb`
      return v.toString().substring(1);
    } else if (v instanceof Component) {
      return v.toString();
    } else if (v instanceof Uint8Array) {
      return new Component(8, v).toString().substring(2);
    } else if (typeof v === 'string') {
      return encodeURIComponent(v); // Component is able to handle !'()*
    } else {
      throw new Error(`Invalid value for name template: ${v}`);
    }
  });

  let ret = '';
  for (const [i, prefix] of templates.entries()) {
    // Remove alturi, since we have already made everything into percent-encoded string
    if (prefix.endsWith('sha256digest=')) {
      ret += prefix.substring(0, prefix.length - 13) + '1=';
    } else if (prefix.endsWith('params-sha256=')) {
      ret += prefix.substring(0, prefix.length - 14) + '2=';
    } else if (prefix.endsWith('seg=')) {
      ret += prefix.substring(0, prefix.length - 4) + '50=';
    } else if (prefix.endsWith('off=')) {
      ret += prefix.substring(0, prefix.length - 4) + '52=';
    } else if (prefix.endsWith('v=')) {
      ret += prefix.substring(0, prefix.length - 2) + '54=';
    } else if (prefix.endsWith('t=')) {
      ret += prefix.substring(0, prefix.length - 2) + '56=';
    } else if (prefix.endsWith('seq=')) {
      ret += prefix.substring(0, prefix.length - 4) + '58=';
    } else {
      ret += prefix;
    }
    if (i < stringValues.length) {
      ret += stringValues[i];
    }
  }

  return Name.from(ret);
};
