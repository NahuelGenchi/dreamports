// Passkeys (WebAuthn), checked with the runtime's own Web Crypto. The site asks for no attestation, so a
// new passkey's public key is the one the browser hands over (getPublicKey()), and each sign-in proves
// that the player's device holds the matching private key, for this site and this challenge.

export class PasskeyError extends Error {}

export const b64url = {
  encode(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let text = '';
    for (const byte of view) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text: unknown, max = 4096): Uint8Array {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length > (max * 4) / 3 + 4) {
      throw new PasskeyError('not base64url');
    }
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  },
};

// The COSE algorithms the site accepts, most preferred first, and their Web Crypto names
const ALGORITHMS: Record<number, { key: SubtleCryptoImportKeyAlgorithm; verify: SubtleCryptoSignAlgorithm }> = {
  [-8]: { key: { name: 'Ed25519' }, verify: { name: 'Ed25519' } },
  [-7]: { key: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } },
  [-257]: { key: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } },
};
export const ALGORITHM_IDS = [-8, -7, -257];

// Where the ceremony happens: the page's origin, the site's name for passkeys (its host) and the
// challenge the site handed out for it
export interface Ceremony {
  origin: string;
  rpId: string;
  challenge: string;
}

// What the browser sends back for a new passkey, every part base64url
export interface NewPasskey {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  publicKeyAlgorithm: number;
  transports?: string[];
}

// What the browser sends back to sign in, every part base64url
export interface PasskeyProof {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string | null;
}

// A passkey as the site keeps it
export interface StoredPasskey {
  id: string;
  key: string;
  alg: number;
  counter: number;
}

// The challenge a response answers, unchecked: the site looks it up before checking the rest
export function challengeOf(clientDataJSON: unknown): string | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(b64url.decode(clientDataJSON)));
    return typeof data.challenge === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(data.challenge) ? data.challenge : null;
  } catch {
    return null;
  }
}

function checkClientData(bytes: Uint8Array, type: string, ceremony: Ceremony) {
  let data: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PasskeyError('client data is not JSON');
  }
  if (data.type !== type) throw new PasskeyError(`client data is not ${type}`);
  if (data.challenge !== ceremony.challenge) throw new PasskeyError('wrong challenge');
  if (data.origin !== ceremony.origin) throw new PasskeyError('wrong origin');
  if (data.crossOrigin === true) throw new PasskeyError('made in a frame from another site');
}

const sha256 = async (bytes: Uint8Array | string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes));

function same(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// The authenticator data: made for this site, with the player present. Returns its flags and counter.
async function checkAuthData(data: Uint8Array, ceremony: Ceremony) {
  if (data.length < 37) throw new PasskeyError('authenticator data too short');
  if (!same(data.subarray(0, 32), await sha256(ceremony.rpId))) throw new PasskeyError('made for another site');
  const flags = data[32];
  if (!(flags & 0x01)) throw new PasskeyError('the player was not present');
  const counter = new DataView(data.buffer, data.byteOffset + 33, 4).getUint32(0);
  return { flags, counter };
}

// A new passkey: checks it was made for this site and challenge, and that its public key is one the
// site can use. Returns what to keep.
export async function verifyRegistration(input: NewPasskey, ceremony: Ceremony) {
  const id = b64url.decode(input.id, 1023);
  if (!id.length) throw new PasskeyError('no credential id');
  checkClientData(b64url.decode(input.clientDataJSON), 'webauthn.create', ceremony);
  const authData = b64url.decode(input.authenticatorData, 8192);
  const { flags, counter } = await checkAuthData(authData, ceremony);
  // the attested credential, after the 37 bytes: its 16-byte AAGUID, its id's length and its id
  if (!(flags & 0x40) || authData.length < 55) throw new PasskeyError('no attested credential');
  const idLength = (authData[53] << 8) | authData[54];
  if (!same(authData.subarray(55, 55 + idLength), id)) throw new PasskeyError('credential id does not match');
  const algorithm = ALGORITHMS[input.publicKeyAlgorithm];
  if (!algorithm) throw new PasskeyError('unsupported algorithm');
  const key = b64url.decode(input.publicKey, 2048);
  try {
    await crypto.subtle.importKey('spki', key, algorithm.key, false, ['verify']);
  } catch {
    throw new PasskeyError('unreadable public key');
  }
  const transports = Array.isArray(input.transports)
    ? input.transports.filter((t): t is string => typeof t === 'string' && /^[a-z-]{1,16}$/.test(t)).slice(0, 8)
    : [];
  return { id: b64url.encode(id), key: b64url.encode(key), alg: input.publicKeyAlgorithm, counter, transports };
}

// ECDSA signatures come DER-encoded; Web Crypto wants r and s side by side
function rawSignature(der: Uint8Array, size = 32) {
  if (der[0] !== 0x30) throw new PasskeyError('bad signature');
  let at = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
  const raw = new Uint8Array(size * 2);
  for (let part = 0; part < 2; part++) {
    if (der[at] !== 0x02) throw new PasskeyError('bad signature');
    const length = der[at + 1];
    let int = der.subarray(at + 2, at + 2 + length);
    at += 2 + length;
    while (int.length > size && int[0] === 0) int = int.subarray(1);
    if (int.length > size) throw new PasskeyError('bad signature');
    raw.set(int, part * size + size - int.length);
  }
  return raw;
}

// A sign-in: checks it was made for this site and challenge, signed by the stored passkey's private
// key. Returns the passkey's new counter.
export async function verifyAssertion(input: PasskeyProof, stored: StoredPasskey, ceremony: Ceremony) {
  const clientData = b64url.decode(input.clientDataJSON);
  checkClientData(clientData, 'webauthn.get', ceremony);
  const authData = b64url.decode(input.authenticatorData, 8192);
  const { counter } = await checkAuthData(authData, ceremony);
  const algorithm = ALGORITHMS[stored.alg];
  if (!algorithm) throw new PasskeyError('unsupported algorithm');
  const key = await crypto.subtle.importKey('spki', b64url.decode(stored.key, 2048), algorithm.key, false, ['verify']);
  let signature = b64url.decode(input.signature, 1024);
  if (stored.alg === -7) signature = rawSignature(signature);
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData);
  signed.set(await sha256(clientData), authData.length);
  if (!(await crypto.subtle.verify(algorithm.verify, key, signature, signed))) throw new PasskeyError('wrong signature');
  // a passkey that counts its uses must count up; one that came back lower may have been copied
  if ((counter || stored.counter) && counter <= stored.counter) throw new PasskeyError('counter went back');
  return counter;
}
