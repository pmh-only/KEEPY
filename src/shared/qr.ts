import { unb64 } from './crypto';
import { encodeWords } from './words';
import type { Capsule } from './types';

export function encodeKeyQR(capsule: Capsule) {
  return JSON.stringify({
    format: 'keepy-keys', version: 1, capsule: capsule.id, person: capsule.self,
    share: capsule.share,
    ...(capsule.authorSecret ? { authorSecret: capsule.authorSecret } : {}),
  });
}

export async function decodeKeyQR(input: string, capsule: Capsule) {
  if (input.length > 2048) throw new Error('KEEPY 열쇠 QR이 아닙니다.');
  let value;
  try { value = JSON.parse(input); }
  catch { throw new Error('KEEPY 열쇠 QR이 아닙니다.'); }
  if (value?.format !== 'keepy-keys' || value.version !== 1) throw new Error('KEEPY 열쇠 QR이 아닙니다.');
  if (value.capsule !== capsule.id) throw new Error('다른 타임캡슐의 QR입니다.');
  if (!capsule.people.some(person => person.id === value.person)) throw new Error('이 방의 참여자가 아닌 사람의 QR입니다.');
  const decode = (data: unknown, length: number) => {
    if (typeof data !== 'string' || data.length > 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('QR의 열쇠를 읽을 수 없습니다. 원본을 다시 받으세요.');
    const bytes = unb64(data);
    if (bytes.length !== length) throw new Error('QR의 열쇠를 읽을 수 없습니다. 원본을 다시 받으세요.');
    return bytes;
  };
  const words = [await encodeWords('share', capsule.id, value.person, decode(value.share, 33))];
  if (value.authorSecret !== undefined) words.push(await encodeWords('author', capsule.id, value.person, decode(value.authorSecret, 32)));
  return words.join('\n');
}
