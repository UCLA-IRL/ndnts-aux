import { v4 as uuidv4 } from 'uuid';

export const randomUUID = (): string => {
  try {
    if (globalThis.crypto && globalThis.crypto.randomUUID !== undefined) {
      return crypto.randomUUID();
    } else {
      return uuidv4();
    }
  } catch {
    return uuidv4();
  }
};
