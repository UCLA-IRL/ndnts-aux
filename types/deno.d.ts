// declare namespace Deno {
// }
declare namespace Deno {
  export function openKv(path?: string): Promise<Deno.Kv>;

  export class Kv implements Disposable {
    get<T = unknown>(
      key: any,
      options?: { consistency?: KvConsistencyLevel },
    ): Promise<T>;

    set(
      key: any,
      value: unknown,
      options?: { expireIn?: number },
    ): Promise<any>;

    delete(key: any): Promise<any>;

    list(
      selector: any,
      options?: any,
    ): any;

    close(): void;

    [Symbol.dispose](): void;
  }
}
