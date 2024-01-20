import type { Signer, Verifier } from 'npm:@ndn/packet';

export interface SecurityAgent {
  signer: Signer;
  verifier: Verifier;
}
