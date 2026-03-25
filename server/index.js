/**
 * 2인용 릴레이 서버 — 같은 Wi‑Fi의 PC에서 실행 후,
 * 휴대폰에서 ws://<PC IP>:37564 로 접속합니다.
 */
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 37564;
const rooms = new Map();

function forwardToPeer(ws, raw) {
  const room = rooms.get(ws.room);
  if (!room) return;
  const peer = ws === room.host ? room.guest : room.host;
  if (peer && peer.readyState === 1) peer.send(raw);
}

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

wss.on('connection', (ws) => {
  ws.room = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const rid = String(msg.room || 'room1').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'room1';
      if (!rooms.has(rid)) rooms.set(rid, { host: null, guest: null });
      const room = rooms.get(rid);

      if (!room.host) {
        room.host = ws;
        ws.room = rid;
        ws.role = 'host';
        ws.send(JSON.stringify({ type: 'joined', role: 'host', room: rid }));
      } else if (!room.guest) {
        room.guest = ws;
        ws.room = rid;
        ws.role = 'guest';
        ws.send(JSON.stringify({ type: 'joined', role: 'guest', room: rid }));
        if (room.host.readyState === 1) {
          room.host.send(JSON.stringify({ type: 'peer', connected: true }));
        }
        ws.send(JSON.stringify({ type: 'peer', connected: true }));
      } else {
        ws.send(JSON.stringify({ type: 'error', code: 'room_full' }));
        ws.close();
      }
      return;
    }

    if (!ws.room) return;
    forwardToPeer(ws, raw);
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    if (room.host === ws) {
      room.host = null;
      if (room.guest && room.guest.readyState === 1) {
        room.guest.send(JSON.stringify({ type: 'peer', connected: false }));
      }
    }
    if (room.guest === ws) {
      room.guest = null;
      if (room.host && room.host.readyState === 1) {
        room.host.send(JSON.stringify({ type: 'peer', connected: false }));
      }
    }
    if (!room.host && !room.guest) rooms.delete(ws.room);
  });
});

console.log(`멀티플레이 릴레이: ws://0.0.0.0:${PORT} (같은 Wi‑Fi의 휴대폰은 PC IP로 접속)`);
