export type Settings = {
  template: 'friends' | 'couple' | 'future' | 'custom';
  title: string;
  threshold: number;
  visibility: 'everyone' | 'self';
  requireAuthor: boolean;
  opensAt: string;
};

export type Person = { id: string; name: string };
export type DownloadStatus = 'waiting' | 'ready' | 'started';
export type Member = Person & { ready: boolean; download: DownloadStatus };
export type RoomState = {
  settings: Settings;
  invitationsClosed: boolean;
  settingsConfirmed: boolean;
  members: Member[];
  stage: 'writing' | 'sealing' | 'complete' | 'failed';
  progress: string;
};

export type Cipher = { iv: string; data: string };
export type Message = { author: string; cipher: Cipher };
export type Capsule = {
  format: 'keepy';
  version: 1;
  algorithms: { cipher: 'AES-256-GCM'; kdf: 'HKDF-SHA-256'; sharing: 'shamir-gf256-or-1ofn'; words: 'keepy-words-v1' };
  id: string;
  createdAt: string;
  settings: Settings;
  people: Person[];
  self: string;
  share: string;
  authorSecret?: string;
  messages: Message[];
};

export const defaults: Settings = {
  template: 'friends',
  title: '타임캡슐',
  threshold: 2,
  visibility: 'everyone',
  requireAuthor: false,
  opensAt: '',
};
