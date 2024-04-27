import { Decoder, Encoder } from '@ndn/tlv';
import { Data, Interest, Name, Signer, Verifier } from '@ndn/packet';
import { Certificate, createSigner, createVerifier, ECDSA, ValidityPeriod } from '@ndn/keychain';
import * as endpoint from '@ndn/endpoint';
import type { Forwarder } from '@ndn/fw';
import { Storage } from '../storage/mod.ts';
import { base64ToBytes } from '@ucla-irl/ndnts-aux/utils';
import { SecurityAgent } from './types.ts';

/**
 * A Signer & Verifier that handles security authentication.
 * CertStorage itself is not a storage, actually. Depend on an external storage.
 */
export class InterTrust implements SecurityAgent {
  private _signer: Signer | undefined;
  readonly readyEvent: Promise<void>;
  private trustedNames: string[] = [];

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
              retx: 5,
              fw: this.fw,
            },
          );

          // Cache result certificates
          this.storage.set(result.name.toString(), Encoder.encode(result));

          return Certificate.fromData(result);
        } catch {
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

  //function that takes b64 encoded certificate bytes and returns cert
  decodeCert = (b64Value: string) => {
    const wire = base64ToBytes(b64Value);
    const data = Decoder.decode(wire, Data);
    const cert = Certificate.fromData(data);
    return cert;
  };

  /** Import an external certificate in base64 format into the storage */
  async importCertAsb64(certb64: string) {
    const cert = this.decodeCert(certb64); // convert b64 into type Certificate
    await this.storage.set(cert.name.toString(), Encoder.encode(cert.data)); // put certificate into cache
  }

  async generatePoR(
    strangerCert: string, // stranger's certficate in base64 format
  ): Promise<string> {
    //function that generates the name of cross signed certificate
    //this function follows the naming convention described in Intertrust poster
    const generatePoRName = (strangerKeyname: string, zone_A_certname: string = this.trustAnchor.name.toString()) => {
      // Construct <Z_a name encoded>
      const parts: string[] = zone_A_certname.split('/');
      let zone_A_name: string = '';
      for (let i = 0; i < parts.length; i++) { //put <Z_a name encoded> together with a loop
        if (parts[i].includes('KEY')) {
          break;
        }
        zone_A_name += parts[i] + '/';
      }

      return new Name(strangerKeyname + '/' + zone_A_name + '/v1');
    };

    const sCert = this.decodeCert(strangerCert); //stranger's cert

    //create validity parameters to be set with .build method later
    const now = Date.now();
    const oneHourInMilliseconds = 60 * 60 * 1000; // Number of milliseconds in an hour, change this if you want to adjust validity period
    const validityPeriodEnd = now + oneHourInMilliseconds;
    const validityPeriod = new ValidityPeriod();
    validityPeriod.notBefore = now;
    validityPeriod.notAfter = validityPeriodEnd;

    //this check is needed because Certificate.build function needs non-null signer
    if (!this._signer) {
      throw new Error('Signer is undefined');
    }
    // Create a cross-signed certificate, i.e. the PoR
    const proofOfZoneRecognition = await Certificate.build({
      name: generatePoRName(sCert.name.toString()),
      validity: validityPeriod,
      publicKeySpki: sCert.publicKeySpki, // Now accessing getPublicKey on the Certificate object
      signer: this._signer,
    });

    // Cache PoR certificate
    this.storage.set(proofOfZoneRecognition.name.toString(), Encoder.encode(proofOfZoneRecognition.data));

    // Encode the final certificate to base64 using Node.js Buffer
    const encodedPoR = Buffer.from(Encoder.encode(proofOfZoneRecognition.data)).toString('base64');

    return encodedPoR; // Return the encoded string
  }
}
