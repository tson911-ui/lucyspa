import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const KEY_BYTES = 32;
const MAX_DATABASE_VERSION = 2_147_483_647;

/** Unambiguous length-prefixed UTF-8 tuple for keyed digests and authenticated context. */
export function lengthPrefixedTuple(fields: readonly string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const field of fields) {
    // Unpaired UTF-16 surrogates would alias U+FFFD in UTF-8 and break tuple injectivity.
    const value = Buffer.from(field, 'utf8');
    if (value.toString('utf8') !== field || value.length > 0xffff_ffff) {
      throw new Error('Invalid cryptographic tuple field');
    }
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(value.length);
    chunks.push(prefix, value);
  }
  return Buffer.concat(chunks);
}

export interface DeliveryBinding {
  deliveryId: string;
  challengeId: string;
  generation: number;
}

export interface SealedPayload {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

function deliveryKey(key: Uint8Array): Buffer {
  if (key.byteLength < KEY_BYTES) throw new Error('Invalid delivery key');
  return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'lucy-auth-delivery-v1', 32));
}

function deliveryContext(binding: DeliveryBinding): Buffer {
  if (
    !binding.deliveryId ||
    !binding.challengeId ||
    !Number.isSafeInteger(binding.generation) ||
    binding.generation <= 0 ||
    binding.generation > MAX_DATABASE_VERSION
  ) {
    throw new Error('Invalid delivery binding');
  }
  return lengthPrefixedTuple([
    'auth-delivery-v1',
    binding.deliveryId,
    binding.challengeId,
    binding.generation.toString(),
  ]);
}

/** AES-256-GCM with a unique random nonce; the delivery/challenge/generation is authenticated. */
export function sealDeliveryPayload(
  plaintext: string,
  binding: DeliveryBinding,
  key: Uint8Array,
): SealedPayload {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deliveryKey(key), nonce, { authTagLength: 16 });
  cipher.setAAD(deliveryContext(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

/** Returns null for any tampering, wrong binding or wrong key; never a partial plaintext. */
export function openDeliveryPayload(
  sealed: SealedPayload,
  binding: DeliveryBinding,
  key: Uint8Array,
): string | null {
  if (sealed.nonce.byteLength !== 12 || sealed.tag.byteLength !== 16) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deliveryKey(key), sealed.nonce, {
      authTagLength: 16,
    });
    decipher.setAAD(deliveryContext(binding));
    decipher.setAuthTag(sealed.tag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
