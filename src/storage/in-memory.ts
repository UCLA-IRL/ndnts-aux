// deno-lint-ignore-file require-await
import { Storage } from './types.ts';

export class InMemoryStorage implements Storage {
  private cache: { [name: string]: Uint8Array } = {};

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.cache[key];
  }

  async set(key: string, value: Uint8Array | undefined) {
    if (typeof value === 'undefined') {
      delete this.cache[key];
    } else {
      this.cache[key] = value;
    }
  }

  async has(key: string): Promise<boolean> {
    return Object.hasOwn(this.cache, key);
  }

  async delete(key: string): Promise<boolean> {
    if (Object.hasOwn(this.cache, key)) {
      delete this.cache[key];
      return true;
    } else {
      return false;
    }
  }

  async clear() {
    this.cache = {};
  }

  close() {}

  [Symbol.dispose]() {
    this.close();
  }
}
