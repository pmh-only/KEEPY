import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

type Client = { id: string; name: string; publicKey: string; socket: WebSocket };
type Room = { id: string; host: string; locked: boolean; clients: Map<string, Client> };
const rooms = new Map<string, Room>();
const root = resolve('dist');
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
  res.setHeader('Vary', 'Access-Control-Request-Headers');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  let file = resolve(root, '.' + pathname);
  if (!file.startsWith(root + '/') && file !== root) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || !statSync(file).isFile()) file = resolve(root, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end('Run npm run build first, or use npm run dev.'); return; }
  res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', extname(file) === '.html' ? 'no-store' : 'public, max-age=3600');
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws' || wss.clients.size >= 2400) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

const send = (socket: WebSocket, value: unknown) => {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 2 * 1024 * 1024) { socket.close(1013, 'Slow connection'); return; }
  socket.send(JSON.stringify(value));
};
const roster = (room: Room) => {
  const message = { kind: 'roster', host: room.host, members: [...room.clients.values()].map(({ id, name, publicKey }) => ({ id, name, publicKey })) };
  for (const client of room.clients.values()) send(client.socket, message);
};

wss.on('connection', socket => {
  let room: Room | undefined;
  let self: Client | undefined;
  let alive = true;
  let count = 0;
  let windowStart = Date.now();
  const joinTimer = setTimeout(() => { if (!self) socket.close(1008, 'Join timeout'); }, 10_000);
  const heartbeat = setInterval(() => {
    if (!alive) { socket.terminate(); return; }
    alive = false;
    socket.ping();
  }, 30_000);
  socket.on('pong', () => { alive = true; });
  socket.on('error', () => { /* Never log message bodies or cryptographic material. */ });
  const fail = (message: string) => { send(socket, { kind: 'error', message }); socket.close(1008); };

  socket.on('message', data => {
    if (Date.now() - windowStart > 10_000) { count = 0; windowStart = Date.now(); }
    if (++count > 400) { fail('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'); return; }
    try {
      const message = JSON.parse(data.toString());
      if (!self) {
        if (message.kind !== 'join' || !/^[a-f0-9]{16}$/.test(message.room) || !/^[a-f0-9]{16}$/.test(message.id)
          || typeof message.name !== 'string' || !message.name.trim() || message.name.length > 24
          || typeof message.publicKey !== 'string' || !/^[A-Za-z0-9+/]{87}=$/.test(message.publicKey)) {
          fail('입장 정보를 확인해 주세요.'); return;
        }
        room = rooms.get(message.room);
        if (message.create) {
          if (room || rooms.size >= 200) { fail('방을 만들 수 없습니다. 다시 시도해 주세요.'); return; }
          room = { id: message.room, host: message.id, locked: false, clients: new Map() };
          rooms.set(room.id, room);
        }
        if (!room) { fail('방이 없거나 이미 닫혔습니다. 초대 링크를 확인해 주세요.'); return; }
        if (room.locked) { fail('초대가 마감된 방입니다.'); return; }
        if (room.clients.size >= 12 || room.clients.has(message.id)) { fail('방이 가득 찼습니다. 최대 12명까지 참여할 수 있습니다.'); return; }
        self = { id: message.id, name: message.name.trim(), publicKey: message.publicKey, socket };
        room.clients.set(self.id, self);
        clearTimeout(joinTimer);
        roster(room);
        return;
      }
      if (!room) return;
      if (message.kind === 'lock' && self.id === room.host) {
        room.locked = true;
        send(socket, { kind: 'locked' });
        return;
      }
      // Opaque, end-to-end encrypted frames are forwarded immediately, never persisted.
      if (message.kind === 'packet' && typeof message.to === 'string' && message.cipher
        && typeof message.cipher.iv === 'string' && message.cipher.iv.length === 16
        && typeof message.cipher.data === 'string' && message.cipher.data.length <= 500_000) {
        const target = room.clients.get(message.to);
        if (target) send(target.socket, { kind: 'packet', from: self.id, cipher: message.cipher });
      }
    } catch { fail('잘못된 요청입니다.'); }
  });

  socket.on('close', () => {
    clearTimeout(joinTimer);
    clearInterval(heartbeat);
    if (!room || !self) return;
    room.clients.delete(self.id);
    if (room.host === self.id) {
      rooms.delete(room.id);
      for (const client of room.clients.values()) {
        send(client.socket, { kind: 'error', message: '방장이 나가서 방이 닫혔습니다. 다운로드한 파일은 계속 사용할 수 있습니다.' });
        client.socket.close(1000);
      }
    } else if (room.clients.size) roster(room);
    else rooms.delete(room.id);
  });
});

const port = Number(process.env.PORT ?? 3001);
server.listen(port, '0.0.0.0', () => console.log(`KEEPY listening on http://localhost:${port}`));
