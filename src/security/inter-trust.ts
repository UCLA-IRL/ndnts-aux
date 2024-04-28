import { Decoder, Encoder } from '@ndn/tlv';
import { Component, Data, Interest, Name, Signer, ValidityPeriod, Verifier } from '@ndn/packet';
import { Certificate, createSigner, createVerifier, ECDSA } from '@ndn/keychain';
import * as endpoint from '@ndn/endpoint';
import type { Forwarder } from '@ndn/fw';
import { Version } from '@ndn/naming-convention2';
import { Storage } from '../storage/mod.ts';
import { SecurityAgent } from './types.ts';

/**
 * A Signer & Verifier handling cross-zone trust relation.
 */
// TODO: (Urgent) Add test to this class
export class InterTrust implements SecurityAgent {
  private _signer: Signer | undefined;
  readonly readyEvent: Promise<void>;
  // private trustedNames: string[] = [];  // TODO: Not used for now.

  constructor(
    readonly trustAnchor: Certificate,
    readonly ownCertificate: Certificate,
    readonly storage: Storage,
    readonly fw: Forwarder,
    prvKeyBits: Uint8Array,
  ) {
    this.readyEvent = (async () => {
      await this.importCert(trustAnchor);
      await this.importCert(ownCertificate);
      const keyPair = await ECDSA.cryptoGenerate({
        importPkcs8: [prvKeyBits, ownCertificate.publicKeySpki],
      }, true);
      this._signer = createSigner(
        ownCertificate.name.getPrefix(ownCertificate.name.length - 2),
        ECDSA,
        keyPair,
      ).withKeyLocator(ownCertificate.name);
    })();
  }

  /** Obtain the signer */
  get signer() {
    return this._signer!;
  }

  /** Obtain this node's own certificate */
  get certificate() {
    return this.ownCertificate;
  }

  /** Import an external certificate into the storage */
  async importCert(cert: Certificate) {
    await this.storage.set(cert.name.toString(), Encoder.encode(cert.data));
  }

  /**
   * Fetch a certificate based on its name from local storage and then remote.
   * @param keyName The certificate's name.
   * @param localOnly If `true`, only look up the local storage without sending an Interest.
   * @returns The fetched certificate. `undefined` if not found.
   */
  async getCertificate(keyName: Name, localOnly: boolean): Promise<Certificate | undefined> {
    const certBytes = await this.storage.get(keyName.toString());
    if (certBytes === undefined) {
      if (localOnly) {
        return undefined;
      } else {
        try {
          // TODO: (Urgent) PoR is never fetched.
          // In the first design of Web-of-trust (I'm not sure if this is the latest)
          // all application data are supposed to be signed by self-signed certificats.
          // One is supposed to enumerate PoR issuer and fetch it.
          // Enroll the new certificate upon the receiption of PoR.
          // This is not done here.
          // Also, with respect to the implementation designed above, chained invitation is not allowed.
          // That is, if A invites B into the workspace, then everyone else must know A.
          // The one who does not know A cannot successfully enumerate PoR of B, which further triggers a hard failure.
          // (Supposed to be fixed with the Sync, but not done yet)
          // This needs to be parallel due to limited certifcate fetching deadline.
          const result = await endpoint.consume(
            new Interest(
              keyName,
              Interest.MustBeFresh,
              Interest.Lifetime(5000),
            ),
            {
              // Fetched key must be signed by a known key
              // TODO: Find a better way to handle security
              verifier: this.localVerifier,
              retx: 20,
              fw: this.fw,
            },
          );

          // Cache result certificates. NOTE: no await needed
          this.storage.set(result.name.toString(), Encoder.encode(result));

          return Certificate.fromData(result);
        } catch {
          // TODO: This is suggested for Varun for debug.
          // However, it adds output to our unit test and may hurt console applications by unnecessary output.
          // Prevent this output when users do not want. Or simply remove this line when the debug is not needed.
          console.error(`Failed to fetch certificate: ${keyName.toString()}`);
          return undefined;
        }
      }
    } else {
      return Certificate.fromData(Decoder.decode(certBytes, Data));
    }
  }

  /**
   * Verify a packet. Throw an error if failed.
   * @param pkt The packet to verify.
   * @param localOnly If `true`, only look up the local storage for the certificate.
   */
  async verify(pkt: Verifier.Verifiable, localOnly: boolean) {
    const keyName = pkt.sigInfo?.keyLocator?.name;
    if (!keyName) {
      throw new Error(`Data not signed: ${pkt.name.toString()}`);
    }
    const cert = await this.getCertificate(keyName, localOnly);
    if (cert === undefined) {
      throw new Error(`No certificate: ${pkt.name.toString()} signed by ${keyName.toString()}`);
    }
    const verifier = await createVerifier(cert, { algoList: [ECDSA] });
    try {
      await verifier.verify(pkt);
    } catch (error) {
      throw new Error(`Unable to verify ${pkt.name.toString()} signed by ${keyName.toString()} due to: ${error}`);
    }
  }

  /** Obtain an verifier that fetches certificate */
  get verifier(): Verifier {
    return {
      verify: (pkt) => this.verify(pkt, false),
    };
  }

  /** Obtain an verifier that does not fetch certificate remotely */
  get localVerifier(): Verifier {
    return {
      verify: (pkt) => this.verify(pkt, true),
    };
  }

  public static async create(
    trustAnchor: Certificate,
    ownCertificate: Certificate,
    storage: Storage,
    fw: Forwarder,
    prvKeyBits: Uint8Array,
  ) {
    const result = new InterTrust(
      trustAnchor,
      ownCertificate,
      storage,
      fw,
      prvKeyBits,
    );
    await result.readyEvent;
    return result;
  }

  /**
   * Generate the cross-signed certificate (PoR, Proof-of-zone-Recognition)
   * @param strangerCert Stranger's certficate in base64 format
   * @returns PoR
   */
  public async generatePoR(strangerCert: Certificate): Promise<Certificate> {
    // The name of cross signed certificate, following the naming convention described in Intertrust poster
    const zoneACertName = this.trustAnchor.name;
    // Key name is cert name except the last two components
    const strangerKeyName = strangerCert.name.getPrefix(strangerCert.name.length - 2);
    const porName = strangerKeyName.append(
      new Component(8, Encoder.encode(zoneACertName)), // Encoded Za name as issuer
      Version.create(1), // Version number fixed to 1 for easy fetching, as decided in Roadmap stage 1
    );

    // Validity period is 1 hour later
    const now = Date.now();
    const validityPeriod = new ValidityPeriod(now, now + 60 * 60 * 1000);

    // Create a cross-signed certificate, i.e. the PoR
    const proofOfZoneRecognition = await Certificate.build({
      name: porName,
      validity: validityPeriod,
      publicKeySpki: strangerCert.publicKeySpki, // The publicKey of the Certificate
      signer: this._signer!, // Signer is initialized when ready
    });

    await this.importCert(proofOfZoneRecognition);
    return proofOfZoneRecognition;
  }
}
