import { b64, buffer, decrypt, deriveKey, encrypt, randomBytes, randomId, unb64 } from './shared/crypto';
import type { Cipher, Person } from './shared/types';

export type Route = 'connecting' | 'direct' | 'relay';
type WireMember = Person & { publicKey: string };
type Peer = { member: WireMember; key: CryptoKey; pc?: RTCPeerConnection; channel?: RTCDataChannel; pendingIce: RTCIceCandidateInit[]; route: Route; outbound: Promise<void>; sent: number; received: number; inbox: Map<number, unknown> };
export type TransportEvents = {
  roster: (members: Person[], host: string) => void;
  route: (id: string, route: Route) => void;
  message: (from: string, message: any) => Promise<void>;
  error: (message: string) => void;
};

export function createRoomCode() {
  return `${randomId()}.${b64(randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export function parseRoomCode(input: string) {
  const code = input.trim().includes('#') ? input.trim().split('#').pop()! : input.trim();
  if (!/^[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('초대 링크 또는 전체 방 코드를 입력해 주세요.');
  const [room, secret] = code.split('.');
  return { code, room, secret: unb64(secret.replace(/-/g, '+').replace(/_/g, '/') + '=') };
}

export class Transport {
  readonly id = randomId();
  readonly room: string;
  private secret: Uint8Array;
  private socket?: WebSocket;
  private identity?: CryptoKeyPair;
  private peers = new Map<string, Peer>();
  private closed = false;
  private chain = Promise.resolve();
  private lockOperation?: Promise<void>;
  private pendingLock?: { resolve: () => void; reject: (error: Error) => void };
  private forceRelay = new URLSearchParams(location.search).has('relay');

  constructor(readonly code: string, private name: string, private create: boolean, private events: TransportEvents) {
    const parsed = parseRoomCode(code);
    this.room = parsed.room;
    this.secret = parsed.secret;
  }

  async start() {
    this.identity = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKey = b64(new Uint8Array(await crypto.subtle.exportKey('raw', this.identity.publicKey)));
    if (this.closed) return;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.socket = socket;
    socket.onopen = () => this.wire({ kind: 'join', room: this.room, id: this.id, name: this.name, publicKey, create: this.create });
    socket.onmessage = event => {
      this.chain = this.chain.then(() => this.handle(JSON.parse(event.data))).catch(() => this.events.error('참여자와 연결하지 못했습니다. 같은 초대 링크로 입장했는지 확인하세요.'));
    };
    socket.onerror = () => this.events.error('연결할 수 없습니다. 잠시 후 다시 시도하세요.');
    socket.onclose = () => {
      this.pendingLock?.reject(new Error('연결이 끊겨 초대를 마감하지 못했습니다.'));
      this.pendingLock = undefined;
      if (!this.closed) this.events.error('방 연결이 끊겼습니다. 다운로드한 파일은 계속 사용할 수 있습니다.');
    };
  }

  private wire(message: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('방 연결이 끊겼습니다.');
    this.socket.send(JSON.stringify(message));
  }

  private context(id: string) { return `keepy-transport-v1:${this.room}:${[id, this.id].sort().join(':')}`; }

  private async makePeer(member: WireMember): Promise<Peer> {
    const publicKey = await crypto.subtle.importKey('raw', buffer(unb64(member.publicKey)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, this.identity!.privateKey, 256));
    // The invitation fragment never reaches the server. Mixing it into the key also
    // prevents a signaling server from substituting public keys to decrypt traffic.
    const key = await deriveKey(shared, this.secret, this.context(member.id));
    shared.fill(0);
    const peer: Peer = { member, key, pendingIce: [], route: 'relay', outbound: Promise.resolve(), sent: 0, received: 0, inbox: new Map() };
    this.peers.set(member.id, peer);
    this.events.route(member.id, 'relay');
    if (!this.forceRelay && typeof RTCPeerConnection !== 'undefined') {
      try {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        peer.pc = pc;
        pc.onicecandidate = event => {
          if (event.candidate) void this.signal(peer, { candidate: event.candidate.toJSON() }).catch(() => {});
        };
        pc.ondatachannel = event => this.attachChannel(peer, event.channel);
        pc.onconnectionstatechange = () => {
          if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.setRoute(peer, 'relay');
        };
        if (this.id < member.id) this.attachChannel(peer, pc.createDataChannel('keepy', { ordered: true }));
      } catch { /* WebSocket relay remains available when WebRTC is unsupported. */ }
    }
    return peer;
  }

  private attachChannel(peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel;
    channel.onopen = () => this.setRoute(peer, 'direct');
    channel.onclose = () => this.setRoute(peer, 'relay');
    channel.onerror = () => this.setRoute(peer, 'relay');
    channel.onmessage = event => {
      this.chain = this.chain.then(async () => {
        const plaintext = await decrypt(peer.key, JSON.parse(event.data), this.context(peer.member.id));
        await this.deliver(peer, JSON.parse(plaintext));
      }).catch(() => this.events.error('참여자에게 받은 데이터를 검증하지 못했습니다.'));
    };
  }

  private setRoute(peer: Peer, route: Route) {
    if (this.closed || !this.peers.has(peer.member.id)) return;
    peer.route = route;
    this.events.route(peer.member.id, route);
  }

  private async deliver(peer: Peer, envelope: any) {
    if (envelope.type !== '$app' || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < peer.received) return;
    if (envelope.sequence > peer.received + 1000) throw new Error('Invalid message sequence');
    peer.inbox.set(envelope.sequence, envelope.payload);
    // WebRTC and WebSocket may cross while a direct connection is established.
    // Restore logical order before handing protocol messages to the room.
    while (peer.inbox.has(peer.received)) {
      const payload = peer.inbox.get(peer.received);
      peer.inbox.delete(peer.received++);
      await this.events.message(peer.member.id, payload);
    }
  }

  private async signal(peer: Peer, signal: unknown) {
    const cipher = await encrypt(peer.key, JSON.stringify({ type: '$signal', signal }), this.context(peer.member.id));
    this.wire({ kind: 'packet', to: peer.member.id, cipher });
  }

  private async handle(message: any) {
    if (this.closed) return;
    if (message.kind === 'locked') {
      this.pendingLock?.resolve();
      this.pendingLock = undefined;
      return;
    }
    if (message.kind === 'error') { this.events.error(message.message); return; }
    if (message.kind === 'roster') {
      const members = message.members as WireMember[];
      for (const [id, peer] of this.peers) {
        if (!members.some(member => member.id === id)) {
          this.peers.delete(id);
          peer.pc?.close();
        }
      }
      const fresh: Peer[] = [];
      for (const member of members) {
        if (member.id !== this.id && !this.peers.has(member.id)) fresh.push(await this.makePeer(member));
      }
      this.events.roster(members.map(({ id, name }) => ({ id, name })), message.host);
      for (const peer of fresh) {
        if (peer.pc && this.id < peer.member.id) {
          try {
            const offer = await peer.pc.createOffer();
            await peer.pc.setLocalDescription(offer);
            await this.signal(peer, { description: peer.pc.localDescription });
          } catch { /* Use relay. */ }
        }
      }
      return;
    }
    if (message.kind !== 'packet') return;
    const peer = this.peers.get(message.from);
    if (!peer) return;
    const payload = JSON.parse(await decrypt(peer.key, message.cipher as Cipher, this.context(message.from)));
    if (payload.type !== '$signal') { await this.deliver(peer, payload); return; }
    if (!peer.pc) return;
    try {
      const { description, candidate } = payload.signal;
      if (description) {
        await peer.pc.setRemoteDescription(description);
        for (const pending of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(pending);
        if (description.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          await this.signal(peer, { description: peer.pc.localDescription });
        }
      } else if (candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate);
        else peer.pendingIce.push(candidate);
      }
    } catch { this.setRoute(peer, 'relay'); }
  }

  async send(to: string, message: unknown) {
    const peer = this.peers.get(to);
    if (!peer) throw new Error('참여자 연결이 끊겼습니다.');
    const operation = peer.outbound.then(async () => {
      const cipher = await encrypt(peer.key, JSON.stringify({ type: '$app', sequence: peer.sent++, payload: message }), this.context(to));
      const serialized = JSON.stringify(cipher);
      // Large bundles use the relay to avoid browser-specific SCTP message limits.
      if (peer.channel?.readyState === 'open' && serialized.length < 48_000 && peer.channel.bufferedAmount < 128_000) {
        try { peer.channel.send(serialized); return; } catch { this.setRoute(peer, 'relay'); }
      }
      this.wire({ kind: 'packet', to, cipher });
    });
    peer.outbound = operation.catch(() => {});
    return operation;
  }

  lock(): Promise<void> {
    if (this.lockOperation) return this.lockOperation;
    this.lockOperation = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingLock = undefined;
        reject(new Error('초대 마감을 확인하지 못했습니다. 다시 시도하세요.'));
      }, 10_000);
      this.pendingLock = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: error => { clearTimeout(timer); reject(error); },
      };
      try { this.wire({ kind: 'lock' }); }
      catch {
        this.pendingLock.reject(new Error('연결할 수 없어 초대를 마감하지 못했습니다.'));
        this.pendingLock = undefined;
      }
    });
    return this.lockOperation;
  }

  close() {
    this.closed = true;
    this.pendingLock?.reject(new Error('방 연결이 종료되었습니다.'));
    this.pendingLock = undefined;
    for (const peer of this.peers.values()) peer.pc?.close();
    this.peers.clear();
    this.socket?.close();
    this.secret.fill(0);
  }
}
