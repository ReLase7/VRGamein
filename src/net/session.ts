import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { ClientMsg, HostMsg, Role } from './protocol';

/**
 * Сеть на WebRTC (PeerJS). Сервер нужен только чтобы найти друг друга по коду комнаты,
 * дальше шлемы и компьютеры общаются напрямую.
 *
 * ?peer=local — использовать локальный сервер PeerJS (для проверки без интернета).
 */
const PREFIX = 'atu-kitchen-vr-';

function peerOptions(): PeerOptions {
  const q = new URLSearchParams(location.search);
  if (q.get('peer') === 'local') {
    return { host: location.hostname, port: Number(q.get('peerport') ?? 9000), path: '/', secure: false, debug: 1 };
  }
  return { debug: 1 };
}

function randomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function netError(e: unknown): string {
  const type = (e as { type?: string })?.type ?? '';
  if (type === 'peer-unavailable') return 'Бөлме табылмады. Кодты тексеріңіз';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') return 'Желіге қосылу мүмкін болмады';
  if (type === 'browser-incompatible') return 'Бұл браузер желілік ойынды қолдамайды';
  return 'Байланыс қатесі';
}

export interface RemoteConn {
  id: string;
  role: Role;
  conn: DataConnection;
}

/** Хост: создаёт комнату и принимает игрока и зрителей. */
export class HostSession {
  readonly conns = new Map<string, RemoteConn>();
  onJoin: (c: RemoteConn) => void = () => {};
  onLeave: (c: RemoteConn) => void = () => {};
  onMessage: (c: RemoteConn, msg: ClientMsg) => void = () => {};

  private constructor(
    private readonly peer: Peer,
    readonly code: string,
  ) {
    peer.on('connection', (conn) => {
      conn.on('data', (raw) => {
        const msg = raw as ClientMsg;
        let rc = this.conns.get(conn.peer);
        if (msg.t === 'hello' && !rc) {
          let role = msg.role;
          // второй игрок может быть только один — остальные смотрят
          if (role === 'player' && [...this.conns.values()].some((c) => c.role === 'player')) {
            conn.send({ t: 'full' } satisfies HostMsg);
            role = 'spectator';
          }
          rc = { id: conn.peer, role, conn };
          this.conns.set(conn.peer, rc);
          conn.send({ t: 'welcome', role } satisfies HostMsg);
          this.onJoin(rc);
          return;
        }
        if (rc) this.onMessage(rc, msg);
      });
      const drop = (): void => {
        const rc = this.conns.get(conn.peer);
        if (!rc) return;
        this.conns.delete(conn.peer);
        this.onLeave(rc);
      };
      conn.on('close', drop);
      conn.on('error', drop);
    });
  }

  static open(): Promise<HostSession> {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = (): void => {
        const code = randomCode();
        const peer = new Peer(PREFIX + code, peerOptions());
        peer.on('open', () => resolve(new HostSession(peer, code)));
        peer.on('error', (e) => {
          if ((e as { type?: string }).type === 'unavailable-id' && tries++ < 5) {
            peer.destroy();
            attempt();
          } else if (!peer.open) {
            peer.destroy();
            reject(e);
          }
        });
      };
      attempt();
    });
  }

  get player(): RemoteConn | undefined {
    return [...this.conns.values()].find((c) => c.role === 'player');
  }

  get spectators(): number {
    return [...this.conns.values()].filter((c) => c.role === 'spectator').length;
  }

  broadcast(msg: HostMsg): void {
    for (const c of this.conns.values()) if (c.conn.open) c.conn.send(msg);
  }

  close(): void {
    for (const c of this.conns.values()) c.conn.close();
    this.conns.clear();
    this.peer.destroy();
  }
}

/** Игрок или зритель: подключается к комнате по коду. */
export class ClientSession {
  onMessage: (msg: HostMsg) => void = () => {};
  onClose: () => void = () => {};
  private closed = false;

  private constructor(
    private readonly peer: Peer,
    private readonly conn: DataConnection,
    readonly code: string,
    public role: Role,
  ) {
    conn.on('data', (raw) => this.onMessage(raw as HostMsg));
    const end = (): void => {
      if (this.closed) return;
      this.closed = true;
      this.onClose();
    };
    conn.on('close', end);
    conn.on('error', end);
    peer.on('disconnected', () => {
      /* сервер поиска отвалился — прямое соединение продолжает работать */
    });
  }

  static join(code: string, role: Role): Promise<ClientSession> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions());
      let done = false;
      const fail = (e: unknown): void => {
        if (done) return;
        done = true;
        peer.destroy();
        reject(e);
      };
      peer.on('error', fail);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        const timer = setTimeout(() => fail({ type: 'peer-unavailable' }), 12000);
        conn.on('open', () => {
          clearTimeout(timer);
          if (done) return;
          done = true;
          const s = new ClientSession(peer, conn, code, role);
          conn.send({ t: 'hello', role } satisfies ClientMsg);
          resolve(s);
        });
        conn.on('error', fail);
      });
    });
  }

  send(msg: ClientMsg): void {
    if (this.conn.open) this.conn.send(msg);
  }

  close(): void {
    this.closed = true;
    this.conn.close();
    this.peer.destroy();
  }
}
