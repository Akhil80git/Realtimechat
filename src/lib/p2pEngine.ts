import Gun from 'gun';
import {
  decryptPacket,
  deriveRoomAesKey,
  deriveRoomHash,
  encryptPacket,
} from './crypto';
import {
  ChatMessage,
  PeerInfo,
  SignalPayload,
  TransportKind,
  WirePacket,
} from '../types/chat';

const GUN_RELAY_PEERS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://peer.wallie.io/gun',
  'https://relay.peer.ooo/gun',
];

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const PEER_TTL_MS = 16000;
const HEARTBEAT_INTERVAL_MS = 4000;
const TYPING_TTL_MS = 2600;

export interface EngineCallbacks {
  onPeersChange: (peers: PeerInfo[]) => void;
  onMessageReceived: (message: ChatMessage) => void;
  onMessageAcked: (messageId: string) => void;
  onRelayStatusChange: (connectedRelays: number) => void;
}

interface PeerConnectionEntry {
  peerId: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingIce: RTCIceCandidateInit[];
  remoteDescSet: boolean;
}

interface GunChain {
  get: (key: string) => GunChain;
  put: (data: Record<string, string | number | boolean>) => GunChain;
  map: () => GunChain;
  on: (cb: (data: unknown, key: string) => void) => void;
  off: () => void;
}

interface GunInstance extends GunChain {
  _?: {
    opt?: {
      peers?: Record<string, { wire?: WebSocket }>;
    };
  };
}

export class P2PChatEngine {
  private localPeerId: string;
  private localName: string;
  private roomCode = '';
  private roomHash = '';
  private aesKey: CryptoKey | null = null;
  private callbacks: EngineCallbacks;

  private gun: GunInstance | null = null;
  private roomNode: GunChain | null = null;
  private broadcast: BroadcastChannel | null = null;

  private peers = new Map<string, PeerInfo>();
  private rtcEntries = new Map<string, PeerConnectionEntry>();
  private manualEntries = new Map<string, PeerConnectionEntry>();

  private seenMessageIds = new Set<string>();
  private seenSignalIds = new Set<string>();
  private heartbeatTimer: number | null = null;
  private cleanupTimer: number | null = null;
  private relayCheckTimer: number | null = null;
  private destroyed = false;
  private sessionStartTs = Date.now();

  constructor(
    localPeerId: string,
    localName: string,
    callbacks: EngineCallbacks,
  ) {
    this.localPeerId = localPeerId;
    this.localName = localName;
    this.callbacks = callbacks;
  }

  public updateLocalName(name: string): void {
    this.localName = name;
    this.broadcastPresence();
  }

  public seedSeenMessages(messages: ChatMessage[]): void {
    for (const m of messages) {
      this.seenMessageIds.add(m.id);
    }
  }

  public async joinRoom(roomCode: string, existingMessages: ChatMessage[]): Promise<void> {
    this.leaveRoom();
    this.destroyed = false;
    this.roomCode = roomCode.trim().toLowerCase();
    this.sessionStartTs = Date.now();
    this.seenMessageIds.clear();
    this.seenSignalIds.clear();
    this.seedSeenMessages(existingMessages);

    const [roomHash, aesKey] = await Promise.all([
      deriveRoomHash(this.roomCode),
      deriveRoomAesKey(this.roomCode),
    ]);

    if (this.destroyed) return;
    this.roomHash = roomHash;
    this.aesKey = aesKey;

    // 1. Instant same-device BroadcastChannel
    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcast = new BroadcastChannel(`varta_mesh_${this.roomHash}`);
      this.broadcast.onmessage = (event) => {
        void this.handleBroadcastRaw(event.data);
      };
    }

    // 2. Decentralized Gun.js relay mesh (ephemeral in-memory; app data is saved in our structured localStorage)
    try {
      this.gun = Gun({
        peers: GUN_RELAY_PEERS,
        localStorage: false,
        radisk: false,
      }) as unknown as GunInstance;

      this.roomNode = this.gun.get(`varta_v1_${this.roomHash}`);

      // Listen for peer presence heartbeats
      this.roomNode.get('presence').map().on((data: unknown, peerKey: string) => {
        if (this.destroyed || !peerKey || peerKey === this.localPeerId) return;
        if (!data || typeof data !== 'object') return;
        const rec = data as { d?: string; ts?: number };
        if (typeof rec.d !== 'string') return;
        void this.handleEncryptedPresence(peerKey, rec.d);
      });

      // Listen for WebRTC signaling directed at this peer
      this.roomNode.get('signals').get(this.localPeerId).map().on((data: unknown) => {
        if (this.destroyed || !data || typeof data !== 'object') return;
        const rec = data as { d?: string };
        if (typeof rec.d !== 'string') return;
        void this.handleEncryptedSignal(rec.d);
      });

      // Listen for encrypted Gun relay fallback packets
      this.roomNode.get('packets').map().on((data: unknown) => {
        if (this.destroyed || !data || typeof data !== 'object') return;
        const rec = data as { d?: string; ts?: number };
        if (typeof rec.d !== 'string') return;
        void this.handleEncryptedWirePacket(rec.d, 'gun');
      });

      this.monitorRelayConnections();
    } catch {
      this.callbacks.onRelayStatusChange(0);
    }

    // 3. Start presence heartbeats and stale-peer reaper
    this.broadcastPresence();
    this.heartbeatTimer = window.setInterval(() => {
      this.broadcastPresence();
    }, HEARTBEAT_INTERVAL_MS);

    this.cleanupTimer = window.setInterval(() => {
      this.pruneStalePeers();
    }, 3000);
  }

  public leaveRoom(): void {
    this.destroyed = true;

    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.relayCheckTimer !== null) {
      clearInterval(this.relayCheckTimer);
      this.relayCheckTimer = null;
    }

    if (this.broadcast) {
      this.broadcast.close();
      this.broadcast = null;
    }

    for (const entry of this.rtcEntries.values()) {
      this.closeRtcEntry(entry);
    }
    this.rtcEntries.clear();

    for (const entry of this.manualEntries.values()) {
      this.closeRtcEntry(entry);
    }
    this.manualEntries.clear();

    if (this.roomNode) {
      try {
        this.roomNode.off();
      } catch {
        // Ignore cleanup errors
      }
      this.roomNode = null;
    }
    this.gun = null;
    this.peers.clear();
    this.callbacks.onPeersChange([]);
    this.callbacks.onRelayStatusChange(0);
  }

  public async sendMessage(message: Omit<ChatMessage, 'status' | 'transport'>, targetPeerId?: string): Promise<void> {
    this.seenMessageIds.add(message.id);
    const packet: WirePacket = {
      kind: 'chat',
      message,
    };
    await this.dispatchWirePacket(packet, targetPeerId, true);
  }

  public sendTyping(channelId: string, isTyping: boolean, targetPeerId?: string): void {
    const packet: WirePacket = {
      kind: 'typing',
      peerId: this.localPeerId,
      name: this.localName,
      channelId,
      isTyping,
      timestamp: Date.now(),
    };
    void this.dispatchWirePacket(packet, targetPeerId, false);
  }

  // --- Manual Offline / Firewalled WebRTC Pairing ---

  public async createManualOffer(aliasLabel = 'Manual Peer'): Promise<string> {
    const tempId = `manual_${Date.now().toString(36)}`;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry: PeerConnectionEntry = {
      peerId: tempId,
      pc,
      dc: null,
      makingOffer: false,
      ignoreOffer: false,
      pendingIce: [],
      remoteDescSet: false,
    };

    const dc = pc.createDataChannel('varta-fast-dc', { ordered: true });
    entry.dc = dc;
    this.wireManualDataChannel(entry, dc, aliasLabel);
    this.manualEntries.set(tempId, entry);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.waitForIceGathering(pc, 2200);

    const payload = {
      t: 'offer',
      p: this.localPeerId,
      n: this.localName,
      s: pc.localDescription,
      k: tempId,
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }

  public async acceptManualOfferAndCreateAnswer(offerCode: string): Promise<string> {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(offerCode.trim())))) as {
      t: string;
      p: string;
      n: string;
      s: RTCSessionDescriptionInit;
      k: string;
    };

    if (parsed.t !== 'offer' || !parsed.s) {
      throw new Error('Invalid invite offer code');
    }

    const remotePeerId = parsed.p;
    const remoteName = parsed.n || 'Direct Peer';
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry: PeerConnectionEntry = {
      peerId: remotePeerId,
      pc,
      dc: null,
      makingOffer: false,
      ignoreOffer: false,
      pendingIce: [],
      remoteDescSet: true,
    };

    pc.ondatachannel = (ev) => {
      entry.dc = ev.channel;
      this.wireManualDataChannel(entry, ev.channel, remoteName);
    };

    this.rtcEntries.set(remotePeerId, entry);
    this.upsertPeer(remotePeerId, remoteName, false, 'connecting', false);

    await pc.setRemoteDescription(parsed.s);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.waitForIceGathering(pc, 2200);

    const reply = {
      t: 'answer',
      p: this.localPeerId,
      n: this.localName,
      s: pc.localDescription,
      k: parsed.k,
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(reply))));
  }

  public async acceptManualAnswer(answerCode: string): Promise<void> {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(answerCode.trim())))) as {
      t: string;
      p: string;
      n: string;
      s: RTCSessionDescriptionInit;
      k: string;
    };

    if (parsed.t !== 'answer' || !parsed.s) {
      throw new Error('Invalid response answer code');
    }

    const entry = this.manualEntries.get(parsed.k);
    if (!entry) {
      throw new Error('Pending offer session not found. Generate a fresh offer first.');
    }

    this.manualEntries.delete(parsed.k);
    entry.peerId = parsed.p;
    entry.remoteDescSet = true;
    this.rtcEntries.set(parsed.p, entry);
    this.upsertPeer(parsed.p, parsed.n || 'Direct Peer', false, 'connecting', false);

    await entry.pc.setRemoteDescription(parsed.s);
  }

  private wireManualDataChannel(
    entry: PeerConnectionEntry,
    dc: RTCDataChannel,
    fallbackName: string,
  ): void {
    entry.pc.onconnectionstatechange = () => {
      const p = this.peers.get(entry.peerId);
      if (p) {
        p.webrtcState = entry.pc.connectionState;
        p.lastSeen = Date.now();
        this.emitPeers();
      }
    };

    dc.onopen = () => {
      const existing = this.peers.get(entry.peerId);
      this.upsertPeer(
        entry.peerId,
        existing?.name ?? fallbackName,
        false,
        entry.pc.connectionState,
        true,
      );
      const hello: WirePacket = {
        kind: 'hello',
        peerId: this.localPeerId,
        name: this.localName,
        timestamp: Date.now(),
      };
      dc.send(JSON.stringify(hello));
    };

    dc.onclose = () => {
      const p = this.peers.get(entry.peerId);
      if (p) {
        p.dataChannelOpen = false;
        p.webrtcState = 'disconnected';
        this.emitPeers();
      }
    };

    dc.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const pkt = JSON.parse(ev.data) as WirePacket;
          this.handleWirePacket(pkt, 'webrtc');
        } catch {
          // Ignore malformed packet
        }
      }
    };
  }

  private waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', onState);
        resolve();
      }, timeoutMs);

      const onState = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          pc.removeEventListener('icegatheringstatechange', onState);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', onState);
    });
  }

  // --- Core Multi-Transport Dispatch ---

  private async dispatchWirePacket(
    packet: WirePacket,
    targetPeerId: string | undefined,
    includeGunFallback: boolean,
  ): Promise<void> {
    const serialized = JSON.stringify(packet);

    // 1. Direct WebRTC DataChannels (fastest cross-device P2P path)
    let sentViaDirectRtc = false;
    if (targetPeerId) {
      const entry = this.rtcEntries.get(targetPeerId);
      if (entry?.dc && entry.dc.readyState === 'open') {
        try {
          entry.dc.send(serialized);
          sentViaDirectRtc = true;
        } catch {
          // Fall back below
        }
      }
    } else {
      for (const entry of this.rtcEntries.values()) {
        if (entry.dc && entry.dc.readyState === 'open') {
          try {
            entry.dc.send(serialized);
            sentViaDirectRtc = true;
          } catch {
            // Continue other peers
          }
        }
      }
    }

    // 2. Same-device BroadcastChannel (<1ms)
    if (this.broadcast) {
      try {
        this.broadcast.postMessage({
          kind: 'wire',
          from: this.localPeerId,
          packet,
        });
      } catch {
        // Ignore
      }
    }

    // 3. Encrypted Gun.js Mesh Relay (always for chat if not all peers have direct RTC, or as reliable mesh sync)
    if (this.roomNode && this.aesKey && (includeGunFallback || !sentViaDirectRtc)) {
      try {
        const cipher = await encryptPacket(this.aesKey, packet);
        const nodeKey =
          packet.kind === 'chat'
            ? `m_${packet.message.id}`
            : `e_${this.localPeerId}_${packet.kind}`;
        this.roomNode.get('packets').get(nodeKey).put({
          d: cipher,
          ts: Date.now(),
        });
      } catch {
        // Ignore relay failure
      }
    }
  }

  // --- Presence & Automatic WebRTC Negotiation ---

  private broadcastPresence(): void {
    if (this.destroyed) return;
    const now = Date.now();

    if (this.broadcast) {
      try {
        this.broadcast.postMessage({
          kind: 'presence',
          peerId: this.localPeerId,
          name: this.localName,
          ts: now,
        });
      } catch {
        // Ignore
      }
    }

    if (this.roomNode && this.aesKey) {
      void encryptPacket(this.aesKey, {
        peerId: this.localPeerId,
        name: this.localName,
        ts: now,
      }).then((cipher) => {
        if (this.destroyed || !this.roomNode) return;
        this.roomNode.get('presence').get(this.localPeerId).put({
          d: cipher,
          ts: now,
        });
      });
    }
  }

  private async handleEncryptedPresence(peerKey: string, cipher: string): Promise<void> {
    if (!this.aesKey) return;
    const data = await decryptPacket<{ peerId: string; name: string; ts: number }>(
      this.aesKey,
      cipher,
    );
    if (!data || data.peerId !== peerKey) return;
    if (Date.now() - data.ts > PEER_TTL_MS * 2) return;

    const existing = this.peers.get(data.peerId);
    this.upsertPeer(
      data.peerId,
      data.name,
      existing?.sameDevice ?? false,
      existing?.webrtcState ?? 'idle',
      existing?.dataChannelOpen ?? false,
    );

    this.maybeInitiateWebRTC(data.peerId);
  }

  private async handleBroadcastRaw(raw: unknown): Promise<void> {
    if (this.destroyed || !raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;

    if (msg.kind === 'presence') {
      const peerId = String(msg.peerId ?? '');
      const name = String(msg.name ?? 'Peer');
      if (!peerId || peerId === this.localPeerId) return;
      const existing = this.peers.get(peerId);
      this.upsertPeer(
        peerId,
        name,
        true,
        existing?.webrtcState ?? 'idle',
        existing?.dataChannelOpen ?? false,
      );
      this.maybeInitiateWebRTC(peerId);
      return;
    }

    if (msg.kind === 'signal') {
      const sig = msg.signal as SignalPayload;
      if (sig && sig.to === this.localPeerId) {
        await this.handleSignalPayload(sig);
      }
      return;
    }

    if (msg.kind === 'wire') {
      if (msg.from === this.localPeerId) return;
      const pkt = msg.packet as WirePacket;
      if (pkt) {
        this.handleWirePacket(pkt, 'broadcast');
      }
    }
  }

  private async handleEncryptedSignal(cipher: string): Promise<void> {
    if (!this.aesKey) return;
    const sig = await decryptPacket<SignalPayload>(this.aesKey, cipher);
    if (!sig || sig.to !== this.localPeerId) return;
    if (Date.now() - sig.ts > 30000) return;
    await this.handleSignalPayload(sig);
  }

  private async handleEncryptedWirePacket(cipher: string, transport: TransportKind): Promise<void> {
    if (!this.aesKey) return;
    const pkt = await decryptPacket<WirePacket>(this.aesKey, cipher);
    if (!pkt) return;
    this.handleWirePacket(pkt, transport);
  }

  private handleWirePacket(pkt: WirePacket, transport: TransportKind): void {
    if (pkt.kind === 'hello') {
      if (pkt.peerId === this.localPeerId) return;
      const existing = this.peers.get(pkt.peerId);
      this.upsertPeer(
        pkt.peerId,
        pkt.name,
        existing?.sameDevice ?? false,
        existing?.webrtcState ?? 'connected',
        true,
      );
      return;
    }

    if (pkt.kind === 'typing') {
      if (pkt.peerId === this.localPeerId) return;
      const p = this.peers.get(pkt.peerId);
      if (p) {
        p.name = pkt.name;
        p.lastSeen = Date.now();
        p.typingUntil = pkt.isTyping ? Date.now() + TYPING_TTL_MS : 0;
        this.emitPeers();
      }
      return;
    }

    if (pkt.kind === 'ack') {
      if (pkt.fromPeerId === this.localPeerId) return;
      this.callbacks.onMessageAcked(pkt.messageId);
      return;
    }

    if (pkt.kind === 'chat') {
      const m = pkt.message;
      if (m.senderId === this.localPeerId) return;
      if (this.seenMessageIds.has(m.id)) return;
      // Skip stale ephemeral typing/replay older than room join unless loaded in localStorage
      if (m.timestamp < this.sessionStartTs - 1000 * 60 * 60 * 12) return;

      this.seenMessageIds.add(m.id);

      const existing = this.peers.get(m.senderId);
      this.upsertPeer(
        m.senderId,
        m.senderName,
        transport === 'broadcast' ? true : (existing?.sameDevice ?? false),
        existing?.webrtcState ?? 'idle',
        existing?.dataChannelOpen ?? false,
      );

      // Clear typing state on message receipt
      const peer = this.peers.get(m.senderId);
      if (peer) {
        peer.typingUntil = 0;
        this.emitPeers();
      }

      this.callbacks.onMessageReceived({
        ...m,
        status: 'delivered',
        transport,
      });

      // Send real delivery ACK back to sender
      const ack: WirePacket = {
        kind: 'ack',
        messageId: m.id,
        fromPeerId: this.localPeerId,
        channelId: m.channelId,
      };
      void this.dispatchWirePacket(ack, m.senderId, true);
    }
  }

  // --- WebRTC Polite/Impolite Negotiation ---

  private maybeInitiateWebRTC(remotePeerId: string): void {
    if (this.destroyed || remotePeerId === this.localPeerId) return;
    const existing = this.rtcEntries.get(remotePeerId);
    if (
      existing &&
      existing.pc.connectionState !== 'failed' &&
      existing.pc.connectionState !== 'closed'
    ) {
      return;
    }

    const entry = this.createPeerConnectionEntry(remotePeerId);
    // Deterministic initiator: smaller peerId creates offer & DataChannel
    const isInitiator = this.localPeerId < remotePeerId;

    if (isInitiator) {
      const dc = entry.pc.createDataChannel('varta-fast-dc', { ordered: true });
      this.attachDataChannel(entry, dc);
      void this.negotiateOffer(entry);
    }
  }

  private createPeerConnectionEntry(remotePeerId: string): PeerConnectionEntry {
    const old = this.rtcEntries.get(remotePeerId);
    if (old) this.closeRtcEntry(old);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry: PeerConnectionEntry = {
      peerId: remotePeerId,
      pc,
      dc: null,
      makingOffer: false,
      ignoreOffer: false,
      pendingIce: [],
      remoteDescSet: false,
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && !this.destroyed) {
        void this.sendSignal({
          id: `${this.localPeerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          from: this.localPeerId,
          fromName: this.localName,
          to: remotePeerId,
          type: 'ice',
          candidate: ev.candidate.toJSON(),
          ts: Date.now(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const peer = this.peers.get(remotePeerId);
      if (peer) {
        peer.webrtcState = pc.connectionState;
        peer.lastSeen = Date.now();
        this.emitPeers();
      }
      if (pc.connectionState === 'failed') {
        this.closeRtcEntry(entry);
        this.rtcEntries.delete(remotePeerId);
      }
    };

    pc.ondatachannel = (ev) => {
      this.attachDataChannel(entry, ev.channel);
    };

    this.rtcEntries.set(remotePeerId, entry);
    return entry;
  }

  private attachDataChannel(entry: PeerConnectionEntry, dc: RTCDataChannel): void {
    entry.dc = dc;
    dc.onopen = () => {
      const peer = this.peers.get(entry.peerId);
      if (peer) {
        peer.dataChannelOpen = true;
        peer.webrtcState = 'connected';
        peer.lastSeen = Date.now();
        this.emitPeers();
      }
      const hello: WirePacket = {
        kind: 'hello',
        peerId: this.localPeerId,
        name: this.localName,
        timestamp: Date.now(),
      };
      dc.send(JSON.stringify(hello));
    };

    dc.onclose = () => {
      const peer = this.peers.get(entry.peerId);
      if (peer) {
        peer.dataChannelOpen = false;
        this.emitPeers();
      }
    };

    dc.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const pkt = JSON.parse(ev.data) as WirePacket;
          this.handleWirePacket(pkt, 'webrtc');
        } catch {
          // Ignore malformed packet
        }
      }
    };
  }

  private async negotiateOffer(entry: PeerConnectionEntry): Promise<void> {
    try {
      entry.makingOffer = true;
      const offer = await entry.pc.createOffer();
      if (entry.pc.signalingState !== 'stable') return;
      await entry.pc.setLocalDescription(offer);
      await this.sendSignal({
        id: `${this.localPeerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        from: this.localPeerId,
        fromName: this.localName,
        to: entry.peerId,
        type: 'offer',
        sdp: entry.pc.localDescription ?? undefined,
        ts: Date.now(),
      });
    } catch {
      // Ignore transient signaling error
    } finally {
      entry.makingOffer = false;
    }
  }

  private async handleSignalPayload(sig: SignalPayload): Promise<void> {
    if (this.seenSignalIds.has(sig.id)) return;
    this.seenSignalIds.add(sig.id);

    const existing = this.peers.get(sig.from);
    if (!existing) {
      this.upsertPeer(sig.from, sig.fromName || 'Peer', false, 'connecting', false);
    }

    let entry = this.rtcEntries.get(sig.from);
    if (!entry) {
      entry = this.createPeerConnectionEntry(sig.from);
    }

    // Polite peer is the one with larger peerId
    const polite = this.localPeerId > sig.from;

    try {
      if (sig.type === 'offer' && sig.sdp) {
        const offerCollision =
          entry.makingOffer || entry.pc.signalingState !== 'stable';
        entry.ignoreOffer = !polite && offerCollision;
        if (entry.ignoreOffer) return;

        await entry.pc.setRemoteDescription(sig.sdp);
        entry.remoteDescSet = true;
        await this.flushPendingIce(entry);

        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        await this.sendSignal({
          id: `${this.localPeerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          from: this.localPeerId,
          fromName: this.localName,
          to: sig.from,
          type: 'answer',
          sdp: entry.pc.localDescription ?? undefined,
          ts: Date.now(),
        });
      } else if (sig.type === 'answer' && sig.sdp) {
        if (entry.pc.signalingState === 'have-local-offer') {
          await entry.pc.setRemoteDescription(sig.sdp);
          entry.remoteDescSet = true;
          await this.flushPendingIce(entry);
        }
      } else if (sig.type === 'ice' && sig.candidate) {
        if (entry.remoteDescSet) {
          await entry.pc.addIceCandidate(sig.candidate).catch(() => {});
        } else {
          entry.pendingIce.push(sig.candidate);
        }
      }
    } catch {
      // Ignore signaling race
    }
  }

  private async flushPendingIce(entry: PeerConnectionEntry): Promise<void> {
    while (entry.pendingIce.length > 0) {
      const cand = entry.pendingIce.shift();
      if (cand) {
        await entry.pc.addIceCandidate(cand).catch(() => {});
      }
    }
  }

  private async sendSignal(sig: SignalPayload): Promise<void> {
    if (this.broadcast) {
      try {
        this.broadcast.postMessage({ kind: 'signal', signal: sig });
      } catch {
        // Ignore
      }
    }

    if (this.roomNode && this.aesKey) {
      try {
        const cipher = await encryptPacket(this.aesKey, sig);
        this.roomNode
          .get('signals')
          .get(sig.to)
          .get(sig.id)
          .put({ d: cipher, ts: sig.ts });
      } catch {
        // Ignore
      }
    }
  }

  private upsertPeer(
    peerId: string,
    name: string,
    sameDevice: boolean,
    webrtcState: RTCPeerConnectionState | 'idle',
    dataChannelOpen: boolean,
  ): void {
    const prev = this.peers.get(peerId);
    this.peers.set(peerId, {
      peerId,
      name: name || prev?.name || 'Peer',
      lastSeen: Date.now(),
      webrtcState: dataChannelOpen ? 'connected' : webrtcState,
      dataChannelOpen,
      sameDevice: sameDevice || prev?.sameDevice || false,
      typingUntil: prev?.typingUntil ?? 0,
    });
    this.emitPeers();
  }

  private pruneStalePeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers.entries()) {
      // Keep directly connected WebRTC peers alive even if Gun heartbeat pauses
      if (peer.dataChannelOpen) continue;
      if (now - peer.lastSeen > PEER_TTL_MS) {
        this.peers.delete(id);
        changed = true;
      } else if (peer.typingUntil > 0 && now > peer.typingUntil) {
        peer.typingUntil = 0;
        changed = true;
      }
    }
    if (changed) {
      this.emitPeers();
    }
  }

  private emitPeers(): void {
    const list = Array.from(this.peers.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    this.callbacks.onPeersChange(list);
  }

  private closeRtcEntry(entry: PeerConnectionEntry): void {
    try {
      entry.dc?.close();
    } catch {
      // Ignore
    }
    try {
      entry.pc.close();
    } catch {
      // Ignore
    }
  }

  private monitorRelayConnections(): void {
    const check = () => {
      if (!this.gun || this.destroyed) return;
      try {
        const opt = (this.gun as unknown as { _: { opt?: { peers?: Record<string, { wire?: WebSocket }> } } })._?.opt?.peers;
        if (!opt) {
          this.callbacks.onRelayStatusChange(0);
          return;
        }
        let connected = 0;
        for (const p of Object.values(opt)) {
          if (p?.wire && p.wire.readyState === 1) {
            connected++;
          }
        }
        this.callbacks.onRelayStatusChange(connected);
      } catch {
        this.callbacks.onRelayStatusChange(0);
      }
    };
    check();
    this.relayCheckTimer = window.setInterval(check, 3000);
  }
}
