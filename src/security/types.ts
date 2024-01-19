import type { Signer, Verifier } from '@ndn/packet';

export interface SecurityAgent {
  signer: Signer;
  verifier: Verifier;
}
