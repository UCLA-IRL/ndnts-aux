export const faceScopeToString = (v: number) =>
  ({
    0: 'non-local',
    1: 'local',
  })[v];

export const facePersistencyToString = (v: number) =>
  ({
    1: 'on-demand',
    0: 'persistent',
    2: 'permanent',
  })[v];

export const linkTypeToString = (v: number) =>
  ({
    0: 'point-to-point',
    1: 'multi-access',
    2: 'ad-hoc',
  })[v];

export const faceEventKindToString = (v: number) =>
  ({
    1: 'CREATED',
    2: 'DESTROYED',
    3: 'UP',
    4: 'DOWN',
  })[v];

export const contentTypeRepr = (v: number) =>
  ({
    0: 'BLOB',
    1: 'LINK',
    2: 'KEY',
    3: 'NACK',
  })[v] ?? v;

export const signatureTypeRepr = (v: number) =>
  ({
    0: 'DigestSha256',
    1: 'SignatureSha256WithRsa',
    3: 'SignatureSha256WithEcdsa',
    4: 'SignatureHmacWithSha256',
    5: 'SignatureEd25519',
  })[v] ?? v;

export const nackReasonRepr = (v: number): string =>
  ({
    0: '0 None',
    50: '50 Congestion',
    100: '100 Duplicate',
    150: '150 NoRoute',
  })[v] ?? `${v} Unknown`;

export const routeOriginRepr = (v: number): string =>
  ({
    0: 'app',
    255: 'static',
    128: 'nlsr',
    129: 'prefixann',
    65: 'client',
    64: 'autoreg',
    66: 'autoconf',
  })[v] ?? `${v}-unknown`;
