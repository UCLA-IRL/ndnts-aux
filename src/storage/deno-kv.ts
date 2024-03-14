import { Storage } from './types.ts';

/**
 * A storage based on DenoKV.
 */
export class DenoKvStorage implements Storage {
  constructor(
    public readonly kv: Deno.Kv,
  ) {
  }

  public static async create(path?: string) {
    return new DenoKvStorage(await Deno.openKv(path));
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const ret = await this.kv.get<Uint8Array>([key]);
    return ret.value ?? undefined;
  }

  async set(key: string, value: Uint8Array | undefined): Promise<void> {
    // TODO: There is a size limit
    await this.kv.set([key], value);
  }

  async has(key: string): Promise<boolean> {
    const ret = await this.kv.get<Uint8Array>([key]);
    return !!ret.value;
  }

  async delete(key: string): Promise<boolean> {
    const ret = await this.kv.get<Uint8Array>([key]);
    if (ret.value) {
      await this.kv.delete([key]);
      return true;
    } else {
      return false;
    }
  }

  async clear(): Promise<void> {
    const entries = this.kv.list({ prefix: [] });
    for await (const entry of entries) {
      await this.kv.delete(entry.key);
    }
  }

  close() {
    this.kv.close();
  }

  [Symbol.dispose]() {
    this.close();
  }
}
