import { Transport, type Route } from './transport';
import { b64, encryptMessage, randomBytes, splitRoot, unb64 } from './shared/crypto';
import { defaults, type Capsule, type DownloadStatus, type Message, type Person, type RoomState, type Settings } from './shared/types';

type View = {
  state: RoomState;
  self: string;
  host: string;
  connected: boolean;
  routes: Record<string, Route>;
  error: string;
  capsule?: Capsule;
};

export class Session {
  readonly transport: Transport;
  view: View;
  private text = '';
  private revision = 0;
  private latestRevision = -1;
  private receipts = new Map<string, Message | null>();
  private pendingCapsule?: Capsule;
  private sealTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(code: string, name: string, create: boolean, private change: (view: View) => void) {
    this.transport = new Transport(code, name, create, {
      roster: (members, host) => this.roster(members, host),
      route: (id, route) => { this.view.routes = { ...this.view.routes, [id]: route }; this.emit(); },
      message: (from, message) => this.receive(from, message),
      error: message => this.error(message),
    });
    this.view = {
      self: this.transport.id, host: '', connected: false, routes: {}, error: '',
      state: { settings: { ...defaults }, invitationsClosed: false, settingsConfirmed: false, members: [], stage: 'writing', progress: '' },
    };
  }

  start() { void this.transport.start().catch(() => this.error('캡슐을 시작하지 못했습니다. 접속 주소를 확인하고 다시 시도하세요.')); }
  get isHost() { return this.view.self === this.view.host; }
  private emit() { if (!this.destroyed) this.change({ ...this.view, state: { ...this.view.state } }); }
  private error(message: string) { if (!this.view.error) this.view.error = message; this.emit(); }
  clearError() { this.view.error = ''; this.emit(); }

  private roster(people: Person[], host: string) {
    this.view.host = host;
    this.view.connected = true;
    if (!this.isHost) { this.emit(); return; }
    const state = this.view.state;
    const departed = state.members.some(member => !people.some(person => person.id === member.id));
    if (departed && state.stage === 'sealing') {
      this.fail('봉인 중 참여자의 연결이 끊겼습니다. 새 방에서 다시 시작해 주세요.');
      return;
    }
    if (state.stage === 'writing') {
      const previousThreshold = state.settings.threshold;
      state.members = people.map(person => state.members.find(member => member.id === person.id) ?? { ...person, ready: false, download: 'waiting' });
      if (state.settings.template === 'couple') state.settings = { ...state.settings, threshold: people.length };
      else if (state.settings.template === 'friends' || state.settings.template === 'future') state.settings = { ...state.settings, threshold: Math.min(2, people.length) };
      else state.settings = { ...state.settings, threshold: Math.min(state.settings.threshold, people.length) };
      if (state.settings.threshold !== previousThreshold) {
        state.settingsConfirmed = false;
        state.members = state.members.map(member => ({ ...member, ready: false }));
      }
    }
    this.publish();
  }

  private publish() {
    this.emit();
    const payload = { type: 'state', revision: ++this.revision, state: structuredClone(this.view.state) };
    for (const member of this.view.state.members) {
      if (member.id !== this.view.self) void this.transport.send(member.id, payload).catch(() => this.error('일부 참여자와 연결이 끊겼습니다.'));
    }
  }

  updateSettings(settings: Settings) {
    if (!this.isHost || this.view.state.stage !== 'writing') return;
    if (!settings.title.trim() || settings.title.length > 60) return;
    this.view.state.settings = settings;
    this.view.state.settingsConfirmed = false;
    // Any change of the sealing policy needs fresh consent from every participant.
    this.view.state.members = this.view.state.members.map(member => ({ ...member, ready: false }));
    this.publish();
  }

  async closeInvitations() {
    if (!this.isHost || this.view.state.stage !== 'writing' || this.view.state.invitationsClosed) return;
    await this.transport.lock();
    this.view.state.invitationsClosed = true;
    this.publish();
  }

  confirmSettings() {
    if (!this.isHost || this.view.state.stage !== 'writing') return;
    if (!this.view.state.invitationsClosed) throw new Error('먼저 초대를 마감하세요.');
    const { settings, members } = this.view.state;
    if (!settings.title.trim()) throw new Error('캡슐 이름을 입력해 주세요.');
    if (!Number.isInteger(settings.threshold) || settings.threshold < 1 || settings.threshold > members.length) throw new Error('개봉 인원을 확인해 주세요.');
    if (settings.opensAt && !Number.isFinite(Date.parse(settings.opensAt))) throw new Error('개봉일을 확인해 주세요.');
    this.view.state.settingsConfirmed = true;
    this.publish();
  }

  async setReady(text: string, ready: boolean) {
    if (this.view.state.stage !== 'writing') return;
    if (!this.view.state.settingsConfirmed) throw new Error('방장이 설정을 마칠 때까지 기다려 주세요.');
    if (ready && (!text.trim() || text.length > 4000)) throw new Error('메시지는 1~4,000자로 작성해 주세요.');
    this.text = text;
    if (this.isHost) {
      const me = this.view.state.members.find(member => member.id === this.view.self);
      if (me) me.ready = ready;
      this.publish();
    } else await this.transport.send(this.view.host, { type: 'ready', ready });
  }

  private fail(message: string) {
    clearTimeout(this.sealTimer);
    this.pendingCapsule = undefined;
    this.view.state.stage = 'failed';
    this.view.state.progress = message;
    this.publish();
  }

  async seal() {
    if (!this.isHost || this.view.state.stage !== 'writing') return;
    const state = this.view.state;
    if (!state.settingsConfirmed) throw new Error('먼저 캡슐 설정을 완료해 주세요.');
    const count = state.members.length;
    if (!count || !state.members.every(member => member.ready)) throw new Error('모두가 작성 완료를 눌러야 봉인할 수 있습니다.');
    if (state.settings.threshold < 1 || state.settings.threshold > count) throw new Error('개봉 인원을 확인해 주세요.');
    if (state.settings.opensAt && !Number.isFinite(Date.parse(state.settings.opensAt))) throw new Error('개봉일을 확인해 주세요.');
    state.stage = 'sealing';
    state.progress = '참여자별 열쇠를 준비하고 있습니다.';
    this.publish();
    this.sealTimer = setTimeout(() => this.fail('봉인 시간이 초과됐습니다. 연결을 확인하고 새 방에서 다시 시작해 주세요.'), 60_000);
    const root = randomBytes(32);
    try {
      const shares = await splitRoot(root, count, state.settings.threshold);
      const manifest = {
        id: this.transport.room, createdAt: new Date().toISOString(), settings: structuredClone(state.settings),
        people: state.members.map(({ id, name }) => ({ id, name })),
      };
      state.progress = '열쇠를 나누고 메시지를 안전하게 보관하고 있습니다.';
      this.publish();
      for (let i = 0; i < count; i++) {
        const member = state.members[i];
        const payload = { type: 'seal', manifest, root: b64(root), share: b64(shares[i]) };
        if (member.id === this.view.self) await this.receive(this.view.self, payload);
        else await this.transport.send(member.id, payload);
        shares[i].fill(0);
      }
    } catch {
      this.fail('봉인하지 못했습니다. 새 방에서 다시 시도해 주세요.');
    } finally {
      root.fill(0);
    }
  }

  async downloadStatus(download: DownloadStatus) {
    if (!this.view.capsule) return;
    const member = this.view.state.members.find(member => member.id === this.view.self);
    if (member && member.download !== 'started') member.download = download;
    if (this.isHost) {
      this.publish();
    } else {
      this.emit();
      await this.transport.send(this.view.host, { type: 'download', download });
    }
  }

  private async complete() {
    if (this.view.state.stage !== 'sealing' || this.receipts.size !== this.view.state.members.length) return;
    const messages = this.view.state.settings.visibility === 'everyone' ? [...this.receipts.values()].filter((value): value is Message => !!value) : [];
    for (const member of this.view.state.members) {
      const payload = { type: 'finalize', messages };
      if (member.id === this.view.self) await this.receive(this.view.self, payload);
      else await this.transport.send(member.id, payload);
    }
    clearTimeout(this.sealTimer);
    this.receipts.clear();
    this.view.state.stage = 'complete';
    this.view.state.progress = '캡슐이 완성되었습니다. 각자의 파일을 받으세요.';
    this.publish();
  }

  private async receive(from: string, message: any) {
    const member = this.view.state.members.find(person => person.id === from);
    if (message.type === 'state' && !this.isHost && from === this.view.host && message.revision > this.latestRevision) {
      this.latestRevision = message.revision;
      this.view.state = message.state;
      this.emit();
    } else if (message.type === 'ready' && this.isHost && member && this.view.state.stage === 'writing' && this.view.state.settingsConfirmed) {
      member.ready = message.ready === true;
      this.publish();
    } else if (message.type === 'seal' && from === this.view.host && !this.pendingCapsule && !this.view.capsule && this.view.state.stage === 'sealing') {
      const root = unb64(message.root);
      const authorSecret = message.manifest.settings.requireAuthor ? randomBytes(32) : undefined;
      try {
        const encrypted = await encryptMessage(message.manifest, this.view.self, this.text, root, authorSecret);
        this.pendingCapsule = {
          format: 'keepy', version: 1,
          algorithms: { cipher: 'AES-256-GCM', kdf: 'HKDF-SHA-256', sharing: 'shamir-gf256-or-1ofn', words: 'keepy-words-v1' },
          ...message.manifest, self: this.view.self, share: message.share,
          ...(authorSecret ? { authorSecret: b64(authorSecret) } : {}), messages: [encrypted],
        };
        this.text = '';
        const receipt = { type: 'sealed', message: message.manifest.settings.visibility === 'everyone' ? encrypted : null };
        if (this.isHost) this.receipts.set(this.view.self, receipt.message);
        else await this.transport.send(this.view.host, receipt);
      } finally {
        root.fill(0);
        authorSecret?.fill(0);
      }
      if (this.isHost) await this.complete();
    } else if (message.type === 'sealed' && this.isHost && member && this.view.state.stage === 'sealing') {
      if (this.view.state.settings.visibility === 'everyone' && message.message?.author !== from) throw new Error('작성자 정보가 다릅니다.');
      this.receipts.set(from, message.message);
      this.view.state.progress = `${this.receipts.size}/${this.view.state.members.length}명의 메시지를 보관했습니다. 캡슐을 완성하고 있습니다.`;
      this.publish();
      await this.complete();
    } else if (message.type === 'finalize' && from === this.view.host && this.pendingCapsule) {
      if (this.pendingCapsule.settings.visibility === 'everyone') this.pendingCapsule.messages = message.messages;
      this.view.capsule = this.pendingCapsule;
      this.pendingCapsule = undefined;
      this.emit();
      await this.downloadStatus('ready');
    } else if (message.type === 'download' && this.isHost && member && ['ready', 'started'].includes(message.download)) {
      if (member.download !== 'started') member.download = message.download;
      this.publish();
    }
  }

  close() {
    this.destroyed = true;
    clearTimeout(this.sealTimer);
    this.text = '';
    this.pendingCapsule = undefined;
    this.transport.close();
  }
}
