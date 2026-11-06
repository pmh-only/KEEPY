import type { Capsule } from './types';

function cleanName(value: string, fallback: string, length: number) {
  const cleaned = value.normalize('NFC').replace(/[<>:"\\|?*\u0000-\u001f\u007f]/g, '_').replaceAll('/', '_').trim();
  return Array.from(cleaned).slice(0, length).join('').replace(/[. ]+$/, '') || fallback;
}

export function capsuleFileName(capsule: Capsule, kind: 'capsule' | 'qr' = 'capsule') {
  const room = cleanName(capsule.settings.title, '타임캡슐', 36);
  const person = cleanName(capsule.people.find(person => person.id === capsule.self)?.name ?? '', '참여자', 24);
  return `${room}-${person}${kind === 'qr' ? '-열쇠.png' : '.html'}`;
}
