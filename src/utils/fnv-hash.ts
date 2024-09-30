/**
 * Calculate a 32 bit FNV-1a hash
 * Found here: https://gist.github.com/vaiorabbit/5657561
 * Ref.: http://isthe.com/chongo/tech/comp/fnv/
 *
 * @param str Input string to hash
 * @param seed The seed. By default `0x811c9dc5` is used.
 * @returns The FNV-1a hash in a 32bit number.
 */
export const hashFnv32a = (str: string, seed?: number): number => {
  /*jshint bitwise:false */
  let hval = seed ?? 0x811c9dc5;

  for (let i = 0, l = str.length; i < l; i++) {
    hval ^= str.charCodeAt(i);
    hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
  }
  return hval >>> 0;
};
