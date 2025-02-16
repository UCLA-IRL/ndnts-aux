import { Encoder } from '@ndn/tlv';
import { Forwarder } from '@ndn/fw';
import * as endpoint from '@ndn/endpoint';
import { Data, Interest, ValidityPeriod } from '@ndn/packet';
import { Certificate, CertNaming, createSigner, createVerifier, ECDSA, generateSigningKey } from '@ndn/keychain';
import { InMemoryStorage } from '../storage/mod.ts';
import { CertStorage } from './cert-storage.ts';
import { assertEquals, assertRejects } from 'assert';
import { AsyncDisposableStack, name, Responder } from '../utils/mod.ts';

Deno.test('Known certificates', async () => {
  await using closers = new AsyncDisposableStack();

  const appPrefix = name`/test-app`;
  // This is the high level API that generates a non-extractable P-256 key
  const [caPrvKey, caPubKey] = await generateSigningKey(/*identity*/ appPrefix, ECDSA);
  const anchor = await Certificate.selfSign({
    privateKey: caPrvKey,
    publicKey: caPubKey,
  });
  // These are controllable API functions to generate an extractable P-256 key
  const ownKeyPair = await ECDSA.cryptoGenerate({}, true);
  const keyName = CertNaming.makeKeyName(name`/${appPrefix}/8=node-0`);
  // const ownPrvKey = createSigner(keyName, ECDSA, ownKeyPair);
  const ownPubKey = createVerifier(keyName, ECDSA, ownKeyPair);
  const ownPrvKeyBits = await crypto.subtle.exportKey('pkcs8', ownKeyPair.privateKey);
  const ownCert = await Certificate.issue({
    issuerId: name`CA`.at(0),
    issuerPrivateKey: caPrvKey.withKeyLocator(anchor.name),
    publicKey: ownPubKey,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const otherKeyPair = await ECDSA.cryptoGenerate({}, true);
  const otherKeyName = CertNaming.makeKeyName(name`/${appPrefix}/8=node-1`);
  // const otherPrvKey = createSigner(otherKeyName, ECDSA, otherKeyPair);
  const otherPubKey = createVerifier(otherKeyName, ECDSA, otherKeyPair);
  // const otherPrvKeyBits = await crypto.subtle.exportKey('pkcs8', otherKeyPair.privateKey);
  const otherCert = await Certificate.issue({
    issuerId: name`CA`.at(0),
    issuerPrivateKey: caPrvKey.withKeyLocator(anchor.name),
    publicKey: otherPubKey,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const storage = new InMemoryStorage();
  closers.use(storage);
  const fwAB = Forwarder.create();
  closers.defer(() => fwAB.close());
  // const responder = new Responder(appPrefix, endpoint, storage);
  // closers.use(responder);

  storage.set(anchor.name.toString(), Encoder.encode(anchor.data));
  storage.set(ownCert.name.toString(), Encoder.encode(ownCert.data));
  storage.set(otherCert.name.toString(), Encoder.encode(otherCert.data));

  const cs = await CertStorage.create(anchor, ownCert, storage, fwAB, new Uint8Array(ownPrvKeyBits), 800);

  // await cs.verifier.verify(anchor.data);  // Unable to do so, since it is not signed with a Cert name.
  await cs.verifier.verify(ownCert.data);
  await cs.verifier.verify(otherCert.data);
});

Deno.test('Fetch missing certificate once', async () => {
  // This test shows the actual behavior, which is acceptable under current situation, but not ideal.
  await using closers = new AsyncDisposableStack();

  const appPrefix = name`/test-app`;
  // This is the high level API that generates a non-extractable P-256 key
  const [caPrvKey, caPubKey] = await generateSigningKey(/*identity*/ appPrefix, ECDSA);
  const anchor = await Certificate.selfSign({
    privateKey: caPrvKey,
    publicKey: caPubKey,
  });
  // These are controllable API functions to generate an extractable P-256 key
  const ownKeyPair = await ECDSA.cryptoGenerate({}, true);
  const keyName = CertNaming.makeKeyName(name`/${appPrefix}/8=node-0`);
  // const ownPrvKey = createSigner(keyName, ECDSA, ownKeyPair);
  const ownPubKey = createVerifier(keyName, ECDSA, ownKeyPair);
  const ownPrvKeyBits = await crypto.subtle.exportKey('pkcs8', ownKeyPair.privateKey);
  const ownCert = await Certificate.issue({
    issuerId: name`CA`.at(0),
    issuerPrivateKey: caPrvKey.withKeyLocator(anchor.name),
    publicKey: ownPubKey,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const otherKeyPair = await ECDSA.cryptoGenerate({}, true);
  const otherKeyName = CertNaming.makeKeyName(name`/${appPrefix}/8=node-1`);
  const otherPrvKey = createSigner(otherKeyName, ECDSA, otherKeyPair);
  const otherPubKey = createVerifier(otherKeyName, ECDSA, otherKeyPair);
  // const otherPrvKeyBits = await crypto.subtle.exportKey('pkcs8', otherKeyPair.privateKey);
  const otherCert = await Certificate.issue({
    issuerId: name`CA`.at(0),
    issuerPrivateKey: caPrvKey.withKeyLocator(anchor.name),
    publicKey: otherPubKey,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const dataToFetch = new Data(
    name`/${appPrefix}/8=node-1/data`,
    Data.FreshnessPeriod(10000),
    new TextEncoder().encode('Hello World'),
  );
  await otherPrvKey.withKeyLocator(otherCert.name).sign(dataToFetch);

  const storage = new InMemoryStorage();
  closers.use(storage);
  const storage2 = new InMemoryStorage();
  closers.use(storage2);
  const fwAB = Forwarder.create();
  closers.defer(() => fwAB.close());
  const responder = new Responder(appPrefix, fwAB, storage2);
  closers.use(responder);

  storage.set(anchor.name.toString(), Encoder.encode(anchor.data));
  storage.set(ownCert.name.toString(), Encoder.encode(ownCert.data));
  storage2.set(otherCert.name.toString(), Encoder.encode(otherCert.data));
  storage2.set(dataToFetch.name.toString(), Encoder.encode(dataToFetch));

  const cs = await CertStorage.create(anchor, ownCert, storage, fwAB, new Uint8Array(ownPrvKeyBits), 800);

  const fetchedData = await endpoint.consume(
    new Interest(
      name`/${appPrefix}/8=node-1/data`,
      Interest.Lifetime(1000),
    ),
    {
      verifier: cs.verifier,
      fw: fwAB,
    },
  );
  assertEquals(fetchedData.content, new TextEncoder().encode('Hello World'));
});

Deno.test('Properly sign packets', async () => {
  await using closers = new AsyncDisposableStack();

  const appPrefix = name`/test-app`;
  // This is the high level API that generates a non-extractable P-256 key
  const [caPrvKey, caPubKey] = await generateSigningKey(/*identity*/ appPrefix, ECDSA);
  const anchor = await Certificate.selfSign({
    privateKey: caPrvKey,
    publicKey: caPubKey,
  });
  // These are controllable API functions to generate an extractable P-256 key
  const ownKeyPair = await ECDSA.cryptoGenerate({}, true);
  const keyName = CertNaming.makeKeyName(name`/${appPrefix}/8=node-0`);
  // const ownPrvKey = createSigner(keyName, ECDSA, ownKeyPair);
  const ownPubKey = createVerifier(keyName, ECDSA, ownKeyPair);
  const ownPrvKeyBits = await crypto.subtle.exportKey('pkcs8', ownKeyPair.privateKey);
  const ownCert = await Certificate.issue({
    issuerId: name`CA`.at(0),
    issuerPrivateKey: caPrvKey.withKeyLocator(anchor.name),
    publicKey: ownPubKey,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const storage = new InMemoryStorage();
  closers.use(storage);
  const fwAB = Forwarder.create();
  closers.defer(() => fwAB.close());

  storage.set(anchor.name.toString(), Encoder.encode(anchor.data));
  storage.set(ownCert.name.toString(), Encoder.encode(ownCert.data));

  const cs = await CertStorage.create(anchor, ownCert, storage, fwAB, new Uint8Array(ownPrvKeyBits), 800);

  const dataToSign = new Data(
    name`/${appPrefix}/8=node-0/data`,
    Data.FreshnessPeriod(10000),
    new TextEncoder().encode('Hello World'),
  );
  await cs.signer.sign(dataToSign);
  await ownPubKey.verify(dataToSign);
});

Deno.test('Reject unavailable certificate', async () => {
  await using closers = new AsyncDisposableStack();

  const appPrefix = name`/test-app`;
  // This is the high level API that generates a non-extractable P-256 key
  const [caPrvKey, caPubKey] = await generateSigningKey(/*identity*/ appPrefix, ECDSA);
  const anchor = await Certificate.selfSign({
    privateKey: caPrvKey,
    publicKey: caPubKey,
  });
  // These are controllable API functions to generate an extractable P-256 key
  const ownKeyPair = await ECDSA.cryptoGenerate({}, true);
  const keyName = CertNaming.makeKeyName(name`/${appPrefix}/8=node-0`);
  // const ownPrvKey = createSigner(keyName, ECDSA, ownKeyPair);
  const ownPubKey = createVerifier(keyName, ECDSA, ownKeyPair);
  const ownPrvKeyBits = await crypto.subtle.exportKey('pkcs8', ownKeyPair.privateKey);
  const ownCert = await Certificate.issue({
    issuerId: name`CA`.at(0),
    issuerPrivateKey: caPrvKey.withKeyLocator(anchor.name),
    publicKey: ownPubKey,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const otherKeyPair = await ECDSA.cryptoGenerate({}, true);
  const otherKeyName = CertNaming.makeKeyName(name`/${appPrefix}/8=node-1`);
  const otherPrvKey = createSigner(otherKeyName, ECDSA, otherKeyPair);
  const otherPubKey = createVerifier(otherKeyName, ECDSA, otherKeyPair);
  // const otherPrvKeyBits = await crypto.subtle.exportKey('pkcs8', otherKeyPair.privateKey);
  const otherCert = await Certificate.issue({
    issuerId: name`CA`.at(0),
    issuerPrivateKey: caPrvKey.withKeyLocator(anchor.name),
    publicKey: otherPubKey,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const dataToFetch = new Data(
    name`/${appPrefix}/8=node-1/data`,
    Data.FreshnessPeriod(10000),
    new TextEncoder().encode('Hello World'),
  );
  await otherPrvKey.withKeyLocator(otherCert.name).sign(dataToFetch);

  const storage = new InMemoryStorage();
  closers.use(storage);
  const storage2 = new InMemoryStorage();
  closers.use(storage2);
  const fwAB = Forwarder.create();
  closers.defer(() => fwAB.close());
  const responder = new Responder(appPrefix, fwAB, storage2);
  closers.use(responder);

  storage.set(anchor.name.toString(), Encoder.encode(anchor.data));
  storage.set(ownCert.name.toString(), Encoder.encode(ownCert.data));
  // storage2.set(otherCert.name.toString(), Encoder.encode(otherCert.data));
  // Certificate is missing

  const cs = await CertStorage.create(anchor, ownCert, storage, fwAB, new Uint8Array(ownPrvKeyBits), 800);
  await assertRejects(async () => {
    await cs.verifier.verify(dataToFetch);
  }, 'Failed to reject not existing certificates');
});

Deno.test('Reject mutual loop', async () => {
  await using closers = new AsyncDisposableStack();

  const appPrefix = name`/test-app`;
  // This is the high level API that generates a non-extractable P-256 key
  const [caPrvKey, caPubKey] = await generateSigningKey(/*identity*/ appPrefix, ECDSA);
  const anchor = await Certificate.selfSign({
    privateKey: caPrvKey,
    publicKey: caPubKey,
  });
  // These are controllable API functions to generate an extractable P-256 key
  const ownKeyPair = await ECDSA.cryptoGenerate({}, true);
  const keyName = CertNaming.makeKeyName(name`/${appPrefix}/8=node-0`);
  // const ownPrvKey = createSigner(keyName, ECDSA, ownKeyPair);
  const ownPubKey = createVerifier(keyName, ECDSA, ownKeyPair);
  const ownPrvKeyBits = await crypto.subtle.exportKey('pkcs8', ownKeyPair.privateKey);
  const ownCert = await Certificate.issue({
    issuerId: name`CA`.at(0),
    issuerPrivateKey: caPrvKey.withKeyLocator(anchor.name),
    publicKey: ownPubKey,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const otherKeyPair1 = await ECDSA.cryptoGenerate({}, true);
  const otherKeyName1 = CertNaming.makeKeyName(name`/${appPrefix}/8=node-1`);
  const otherPrvKey1 = createSigner(otherKeyName1, ECDSA, otherKeyPair1);
  const otherPubKey1 = createVerifier(otherKeyName1, ECDSA, otherKeyPair1);
  const otherKeyPair2 = await ECDSA.cryptoGenerate({}, true);
  const otherKeyName2 = CertNaming.makeKeyName(name`/${appPrefix}/8=node-2`);
  const otherPrvKey2 = createSigner(otherKeyName2, ECDSA, otherKeyPair2);
  const otherPubKey2 = createVerifier(otherKeyName2, ECDSA, otherKeyPair2);
  const cert1Name = name`/${otherKeyName1}/node-2/v=${13}`;
  const cert2Name = name`/${otherKeyName2}/node-1/v=${13}`;
  const otherCert1 = await Certificate.build({
    name: cert1Name,
    signer: otherPrvKey2.withKeyLocator(cert2Name),
    publicKeySpki: otherPubKey1.spki!,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });
  const otherCert2 = await Certificate.build({
    name: cert2Name,
    signer: otherPrvKey1.withKeyLocator(cert1Name),
    publicKeySpki: otherPubKey2.spki!,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const dataToFetch = new Data(
    name`/${appPrefix}/8=node-1/data`,
    Data.FreshnessPeriod(10000),
    new TextEncoder().encode('Hello World'),
  );
  await otherPrvKey1.withKeyLocator(otherCert1.name).sign(dataToFetch);

  const storage = new InMemoryStorage();
  closers.use(storage);
  const storage2 = new InMemoryStorage();
  closers.use(storage2);
  const fwAB = Forwarder.create();
  closers.defer(() => fwAB.close());
  const responder = new Responder(appPrefix, fwAB, storage2);
  closers.use(responder);

  storage.set(anchor.name.toString(), Encoder.encode(anchor.data));
  storage.set(ownCert.name.toString(), Encoder.encode(ownCert.data));
  storage2.set(otherCert1.name.toString(), Encoder.encode(otherCert1.data));
  storage2.set(otherCert2.name.toString(), Encoder.encode(otherCert2.data));
  storage2.set(dataToFetch.name.toString(), Encoder.encode(dataToFetch));

  const cs = await CertStorage.create(anchor, ownCert, storage, fwAB, new Uint8Array(ownPrvKeyBits), 800);
  await assertRejects(async () => {
    await cs.verifier.verify(dataToFetch);
  }, 'Failed to reject mutually signed certificates');
});

Deno.test('Reject self-signed certificate', async () => {
  await using closers = new AsyncDisposableStack();

  const appPrefix = name`/test-app`;
  // This is the high level API that generates a non-extractable P-256 key
  const [caPrvKey, caPubKey] = await generateSigningKey(/*identity*/ appPrefix, ECDSA);
  const anchor = await Certificate.selfSign({
    privateKey: caPrvKey,
    publicKey: caPubKey,
  });
  // These are controllable API functions to generate an extractable P-256 key
  const ownKeyPair = await ECDSA.cryptoGenerate({}, true);
  const keyName = CertNaming.makeKeyName(name`/${appPrefix}/8=node-0`);
  // const ownPrvKey = createSigner(keyName, ECDSA, ownKeyPair);
  const ownPubKey = createVerifier(keyName, ECDSA, ownKeyPair);
  const ownPrvKeyBits = await crypto.subtle.exportKey('pkcs8', ownKeyPair.privateKey);
  const ownCert = await Certificate.issue({
    issuerId: name`CA`.at(0),
    issuerPrivateKey: caPrvKey.withKeyLocator(anchor.name),
    publicKey: ownPubKey,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const otherKeyPair = await ECDSA.cryptoGenerate({}, true);
  const otherKeyName = CertNaming.makeKeyName(name`/${appPrefix}/8=node-1`);
  const otherPrvKey = createSigner(otherKeyName, ECDSA, otherKeyPair);
  const otherPubKey = createVerifier(otherKeyName, ECDSA, otherKeyPair);
  // const otherPrvKeyBits = await crypto.subtle.exportKey('pkcs8', otherKeyPair.privateKey);
  const otherCert = await Certificate.selfSign({
    privateKey: otherPrvKey,
    publicKey: otherPubKey,
    validity: new ValidityPeriod(Date.now(), Date.now() + 3600000),
  });

  const dataToFetch = new Data(
    name`/${appPrefix}/8=node-1/data`,
    Data.FreshnessPeriod(10000),
    new TextEncoder().encode('Hello World'),
  );
  await otherPrvKey.withKeyLocator(otherCert.name).sign(dataToFetch);

  const storage = new InMemoryStorage();
  closers.use(storage);
  const storage2 = new InMemoryStorage();
  closers.use(storage2);
  const fwAB = Forwarder.create();
  closers.defer(() => fwAB.close());
  const responder = new Responder(appPrefix, fwAB, storage2);
  closers.use(responder);

  storage.set(anchor.name.toString(), Encoder.encode(anchor.data));
  storage.set(ownCert.name.toString(), Encoder.encode(ownCert.data));
  storage2.set(otherCert.name.toString(), Encoder.encode(otherCert.data));

  const cs = await CertStorage.create(anchor, ownCert, storage, fwAB, new Uint8Array(ownPrvKeyBits), 800);
  await assertRejects(async () => {
    await cs.verifier.verify(dataToFetch);
  }, 'Failed to reject self-signed certificates');
});
