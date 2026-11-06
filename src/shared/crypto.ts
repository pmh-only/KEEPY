import { split, combine } from 'shamir-secret-sharing';
import type { Capsule, Cipher, Message } from './types';

const encoder = new TextEncoder();
export const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
export const hex = (bytes: Uint8Array) => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
export const randomId = () => hex(randomBytes(8));
export const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, x => String.fromCharCode(x)).join(''));
export const unb64 = (value: string) => Uint8Array.from(atob(value), x => x.charCodeAt(0));
export const buffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

export async function encrypt(key: CryptoKey, plaintext: string, context: string): Promise<Cipher> {
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(encoder.encode(context)) }, key, buffer(encoder.encode(plaintext)),
  );
  return { iv: b64(iv), data: b64(new Uint8Array(data)) };
}

export async function decrypt(key: CryptoKey, cipher: Cipher, context: string): Promise<string> {
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buffer(unb64(cipher.iv)), additionalData: buffer(encoder.encode(context)) }, key, buffer(unb64(cipher.data)),
  );
  return new TextDecoder().decode(result);
}

export async function deriveKey(secret: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', buffer(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buffer(salt), info: buffer(encoder.encode(info)) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function splitRoot(root: Uint8Array, count: number, threshold: number): Promise<Uint8Array[]> {
  if (!Number.isInteger(count) || count < 1 || count > 12 || !Number.isInteger(threshold) || threshold < 1 || threshold > count) {
    throw new Error('개봉 인원은 1명 이상, 전체 참여 인원 이하여야 합니다.');
  }
  // The library requires k >= 2; 1-of-n intentionally gives everyone the same secret.
  return threshold === 1
    ? Array.from({ length: count }, (_, i) => new Uint8Array([i + 1, ...root]))
    : split(root, count, threshold);
}

export async function restoreRoot(shares: Uint8Array[], threshold: number): Promise<Uint8Array> {
  if (shares.length < threshold) throw new Error(`서로 다른 ${threshold}명의 열쇠가 필요합니다.`);
  if (shares.some(s => s.length !== 33)) throw new Error('올바르지 않은 열쇠 길이입니다.');
  return threshold === 1 ? shares[0].slice(1) : combine(shares.slice(0, threshold));
}

export function messageContext(capsule: Pick<Capsule, 'id' | 'createdAt' | 'settings' | 'people'>, author: string) {
  return JSON.stringify(['keepy-v1', capsule.id, capsule.createdAt, capsule.settings, capsule.people, author]);
}

export async function encryptMessage(capsule: Pick<Capsule, 'id' | 'createdAt' | 'settings' | 'people'>, author: string, text: string, root: Uint8Array, authorSecret?: Uint8Array): Promise<Message> {
  const context = messageContext(capsule, author);
  const key = await deriveKey(root, authorSecret ?? new Uint8Array(32), context);
  return { author, cipher: await encrypt(key, text, context) };
}

export async function decryptMessage(capsule: Capsule, message: Message, root: Uint8Array, authorSecret?: Uint8Array) {
  if (capsule.settings.requireAuthor && !authorSecret) throw new Error('작성자의 추가 열쇠가 필요합니다.');
  const context = messageContext(capsule, message.author);
  const key = await deriveKey(root, authorSecret ?? new Uint8Array(32), context);
  return decrypt(key, message.cipher, context);
}
