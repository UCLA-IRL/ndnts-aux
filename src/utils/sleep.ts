import { delay } from 'async';

export async function sleep(seconds: number) {
  await delay(seconds * 1000);
}
