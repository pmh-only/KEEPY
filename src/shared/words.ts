import { wordlist } from '@scure/bip39/wordlists/english.js';
import { buffer } from './crypto';

const indexes = new Map(wordlist.map((word, index) => [word, index]));
const fromHex = (value: string) => {
  if (!/^[a-f0-9]{16}$/.test(value)) throw new Error('올바르지 않은 식별자입니다.');
  return Uint8Array.from(value.match(/../g)!, x => parseInt(x, 16));
};
const toHex = (value: Uint8Array) => Array.from(value, x => x.toString(16).padStart(2, '0')).join('');
const checksum = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', buffer(bytes))).slice(0, 4);

// This is a versioned byte encoding using the English BIP39 word list, NOT a wallet mnemonic.
export async function encodeWords(type: 'share' | 'author', capsule: string, person: string, payload: Uint8Array) {
  if (payload.length !== (type === 'share' ? 33 : 32)) throw new Error('올바르지 않은 열쇠 길이입니다.');
  const body = new Uint8Array([1, type === 'share' ? 0 : 1, ...fromHex(capsule), ...fromHex(person), payload.length, ...payload]);
  const data = new Uint8Array([...body, ...await checksum(body)]);
  const bits = Array.from(data, byte => byte.toString(2).padStart(8, '0')).join('');
  return bits.padEnd(Math.ceil(bits.length / 11) * 11, '0').match(/.{11}/g)!.map(chunk => wordlist[parseInt(chunk, 2)]).join(' ');
}

export async function decodeWords(input: string) {
  const words = input.trim().toLowerCase().split(/\s+/);
  if (words.length < 15 || words.length > 60) throw new Error('열쇠의 단어가 빠지거나 추가되지 않았는지 확인하세요.');
  const bits = words.map(word => {
    const index = indexes.get(word);
    if (index === undefined) throw new Error(`알 수 없는 단어: ${word}`);
    return index.toString(2).padStart(11, '0');
  }).join('');
  const data = Uint8Array.from(bits.match(/.{8}/g)!, byte => parseInt(byte, 2));
  if (data[0] !== 1 || data[1] > 1 || data[18] !== (data[1] === 0 ? 33 : 32)) throw new Error('이 열쇠를 읽을 수 없습니다. 원본을 다시 복사하세요.');
  const length = 19 + data[18];
  const bitLength = (length + 4) * 8;
  if (words.length !== Math.ceil(bitLength / 11) || /1/.test(bits.slice(bitLength))) throw new Error('열쇠 길이가 올바르지 않습니다.');
  const sum = await checksum(data.slice(0, length));
  if (sum.some((byte, i) => data[length + i] !== byte)) throw new Error('열쇠에 오타가 있습니다. 단어를 다시 확인하세요.');
  return { type: data[1] === 0 ? 'share' as const : 'author' as const, capsule: toHex(data.slice(2, 10)), person: toHex(data.slice(10, 18)), payload: data.slice(19, length) };
}
