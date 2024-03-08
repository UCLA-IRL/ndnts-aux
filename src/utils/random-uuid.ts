import { v4 as uuidv4 } from 'uuid';

export const randomUUID = (): string => {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  } else {
    return uuidv4();
  }
};
