import mqtt, { MqttClient } from 'mqtt';
import {
  decryptPacket,
  deriveAesKey,
  encryptPacket,
} from './crypto';
import { getMediaBlob, saveMediaBlob } from './mediaVault';
import {
  enqueueOutboxItem,
  getOutboxForPeer,
  loadContacts,
  loadDeletedMessageIds,
  removeOutboxByOpId,
  removeOutboxChatByMessageId,
} from './storage';
import {
  ChatMessage,
  OutboxItem,
  PeerInfo,
  SignalPayload,
  TransportKind,
  WirePacket,
} from '../types/chat';

const BROKER_URLS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const TOPIC_PREFIX = 'varta/net/v2';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const HEARTBEAT_MS = 12000;
const PEER_TTL_MS = 45000;
const TYPING_TTL_MS = 2600;
const MEDIA_CHUNK_BYTES = 28 * 1024;
const TRANSFER_TTL_MS = 1000 * 60 * 10;
const FLUSH_COOLDOWN_MS = 2500;

export interface EngineCallbacks {
  onPeersChange: (peers: PeerInfo[]) => void;
  onMessageReceived: (message: ChatMessage) => void;
  onMediaTransferProgress: (messageId: string, progress: number | undefined) => void;
  onMessageAcked: (messageId: string) => void;
  onReactionReceived: (
    channelId: string,
    messageId: string,
    emoji: string,
    peerId: string,
    add: boolean,
  ) => void;
  onMessageDeleted: (channelId: string, messageId: string) => void;
  onChannelCleared: (channelId: string, clearedAt?: number) => void;
  onConnectionStatusChange: (connected: boolean, brokerLabel: string) => void;
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

interface IncomingMediaTransfer {
  opId?: string;
  message: Omit<ChatMessage, 'status' | 'transport' | 'transferProgress'>;
  totalChunks: number;
  chunks: (Uint8Array | undefined)[];
  receivedCount: number;
  lastProgressPct: number;
  createdAt: number;
  transport: TransportKind;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class P2PChatEngine {
  private localPeerId: string;
  private localName: string;
  private callbacks: EngineCallbacks;

  private client: MqttClient | null = null;
  private broadcast: BroadcastChannel | null = null;
  private aesKey: CryptoKey | null = null;

  private peers = new Map<string, PeerInfo>();
  private rtcEntries = new Map<string, PeerConnectionEntry>();
  private seenMessageIds = new Set<string>();
  private seenSignalIds = new Set<string>();
  private seenOpIds = new Set<string>();
  private incomingTransfers = new Map<string, IncomingMediaTransfer>();

  private flushingPeers = new Set<string>();
  private lastFlushAt = new Map<string, number>();

  private heartbeatTimer: number | null = null;
  private cleanupTimer: number | null = null;
  private failoverTimer: number | null = null;
  private brokerIndex = 0;
  private destroyed = false;

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
    this.publishPresence();
  }

  public async start(existingMessages: ChatMessage[]): Promise<void> {
    this.stop();
    this.destroyed = false;
    this.seenMessageIds.clear();
    this.seenSignalIds.clear();
    this.seenOpIds.clear();
    this.incomingTransfers.clear();
    this.flushingPeers.clear();
    this.lastFlushAt.clear();

    for (const m of existingMessages) {
      this.seenMessageIds.add(m.id);
    }

    this.aesKey = await deriveAesKey('varta-global-network-key-v2');
    if (this.destroyed) return;

    // 1. Instant same-device BroadcastChannel (<1ms)
    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcast = new BroadcastChannel('varta_global_mesh_v2');
      this.broadcast.onmessage = (ev) => {
        void this.handleBroadcastRaw(ev.data);
      };
    }

    // 2. Global WebSocket Relay + WebRTC Signaling
    this.connectBroker(0);

    // 3. Periodic presence heartbeat & stale reaper
    this.publishPresence();
    this.sendSyncHello();

    this.heartbeatTimer = window.setInterval(() => {
      this.publishPresence();
    }, HEARTBEAT_MS);

    this.cleanupTimer = window.setInterval(() => {
      this.pruneStalePeers();
    }, 4000);

    window.addEventListener('pagehide', this.handlePageUnload);
    window.addEventListener('beforeunload', this.handlePageUnload);
    window.addEventListener('online', this.handleNetworkOnline);
  }

  public stop(): void {
    this.destroyed = true;

    window.removeEventListener('pagehide', this.handlePageUnload);
    window.removeEventListener('beforeunload', this.handlePageUnload);
    window.removeEventListener('online', this.handleNetworkOnline);

    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.failoverTimer !== null) {
      clearTimeout(this.failoverTimer);
      this.failoverTimer = null;
    }

    this.clearMyPresence();

    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        // Ignore
      }
      this.client = null;
    }

    if (this.broadcast) {
      this.broadcast.close();
      this.broadcast = null;
    }

    for (const entry of this.rtcEntries.values()) {
      this.closeRtcEntry(entry);
    }
    this.rtcEntries.clear();
    this.incomingTransfers.clear();
    this.peers.clear();
    this.callbacks.onPeersChange([]);
    this.callbacks.onConnectionStatusChange(false, 'Disconnected');
  }

  private getTargetPeerIds(explicitTargetId?: string): string[] {
    if (explicitTargetId) return [explicitTargetId];
    const ids = new Set<string>();
    for (const p of this.peers.keys()) {
      if (p !== this.localPeerId) ids.add(p);
    }
    for (const c of loadContacts()) {
      if (c.peerId !== this.localPeerId) ids.add(c.peerId);
    }
    return Array.from(ids);
  }

  public async sendMessage(
    message: Omit<ChatMessage, 'status' | 'transport' | 'transferProgress'>,
    mediaBlob?: Blob,
    targetPeerId?: string,
  ): Promise<void> {
    this.seenMessageIds.add(message.id);
    const now = Date.now();

    // Persist in sender's localStorage outbox for every target so offline peers sync on reconnect
    const targets = this.getTargetPeerIds(targetPeerId);
    for (const tid of targets) {
      enqueueOutboxItem({
        opId: `op_${message.id}_${tid}`,
        targetPeerId: tid,
        kind: 'chat',
        channelId: message.channelId,
        createdAt: now,
        message: {
          ...message,
          attachment: message.attachment
            ? { ...message.attachment, dataUrl: undefined }
            : undefined,
        },
      });
    }

    // If a specific DM recipient is currently offline, keep safely in outbox until they reconnect
    if (targetPeerId && !this.peers.has(targetPeerId) && mediaBlob) {
      this.callbacks.onMediaTransferProgress(message.id, undefined);
      return;
    }

    const opId = targetPeerId ? `op_${message.id}_${targetPeerId}` : undefined;
    await this.transmitChatMessage(message, mediaBlob, targetPeerId, opId, true);
  }

  private async transmitChatMessage(
    message: Omit<ChatMessage, 'status' | 'transport' | 'transferProgress'>,
    mediaBlob: Blob | undefined,
    targetPeerId: string | undefined,
    opId: string | undefined,
    reportProgress: boolean,
  ): Promise<void> {
    if (!mediaBlob) {
      const packet: WirePacket = {
        kind: 'chat',
        opId,
        message,
      };
      await this.dispatchWirePacket(packet, targetPeerId, true);
      return;
    }

    const totalChunks = Math.max(1, Math.ceil(mediaBlob.size / MEDIA_CHUNK_BYTES));
    const transferId = `tr_${message.id}_${targetPeerId ?? 'all'}`;

    const cleanMetaMessage = {
      ...message,
      attachment: message.attachment
        ? { ...message.attachment, dataUrl: undefined }
        : undefined,
    };

    const metaPacket: WirePacket = {
      kind: 'media-meta',
      opId,
      transferId,
      totalChunks,
      message: cleanMetaMessage,
    };

    await this.dispatchWirePacket(metaPacket, targetPeerId, true);

    let lastPct = -1;
    for (let i = 0; i < totalChunks; i++) {
      if (this.destroyed) return;
      const start = i * MEDIA_CHUNK_BYTES;
      const end = Math.min(mediaBlob.size, start + MEDIA_CHUNK_BYTES);
      const buffer = await mediaBlob.slice(start, end).arrayBuffer();
      const b64 = uint8ToBase64(new Uint8Array(buffer));

      const chunkPacket: WirePacket = {
        kind: 'media-chunk',
        transferId,
        index: i,
        totalChunks,
        data: b64,
      };

      if (targetPeerId) {
        const entry = this.rtcEntries.get(targetPeerId);
        if (entry?.dc && entry.dc.readyState === 'open' && entry.dc.bufferedAmount > 512 * 1024) {
          await this.waitForDcDrain(entry.dc);
        }
      }

      await this.dispatchWirePacket(chunkPacket, targetPeerId, true);

      if (reportProgress) {
        const pct = Math.round(((i + 1) / totalChunks) * 100);
        if (pct !== lastPct && (pct % 5 === 0 || i === totalChunks - 1)) {
          lastPct = pct;
          this.callbacks.onMediaTransferProgress(
            message.id,
            i === totalChunks - 1 ? undefined : pct,
          );
        }
      }

      if (i % 4 === 3) {
        await new Promise<void>((r) => setTimeout(r, 4));
      }
    }
  }

  public sendReaction(
    channelId: string,
    messageId: string,
    emoji: string,
    add: boolean,
    targetPeerId?: string,
  ): void {
    const now = Date.now();
    const targets = this.getTargetPeerIds(targetPeerId);
    for (const tid of targets) {
      const opId = `op_react_${messageId}_${emoji}_${tid}_${now}`;
      enqueueOutboxItem({
        opId,
        targetPeerId: tid,
        kind: 'reaction',
        channelId,
        createdAt: now,
        messageId,
        emoji,
        add,
      });
    }

    const packet: WirePacket = {
      kind: 'reaction',
      opId: targetPeerId ? `op_react_${messageId}_${emoji}_${targetPeerId}_${now}` : undefined,
      channelId,
      messageId,
      emoji,
      peerId: this.localPeerId,
      add,
    };
    void this.dispatchWirePacket(packet, targetPeerId, true);
  }

  public sendDeleteMessage(
    channelId: string,
    messageId: string,
    targetPeerId?: string,
  ): void {
    const now = Date.now();
    const targets = this.getTargetPeerIds(targetPeerId);
    for (const tid of targets) {
      const opId = `op_del_${messageId}_${tid}`;
      enqueueOutboxItem({
        opId,
        targetPeerId: tid,
        kind: 'delete-msg',
        channelId,
        createdAt: now,
        messageId,
      });
    }

    const packet: WirePacket = {
      kind: 'delete-msg',
      opId: targetPeerId ? `op_del_${messageId}_${targetPeerId}` : undefined,
      channelId,
      messageId,
      fromPeerId: this.localPeerId,
    };
    void this.dispatchWirePacket(packet, targetPeerId, true);
  }

  public sendClearChat(channelId: string, targetPeerId?: string): void {
    const now = Date.now();
    const targets = this.getTargetPeerIds(targetPeerId);
    for (const tid of targets) {
      const opId = `op_clr_${channelId}_${tid}_${now}`;
      enqueueOutboxItem({
        opId,
        targetPeerId: tid,
        kind: 'clear-chat',
        channelId,
        createdAt: now,
      });
    }

    const packet: WirePacket = {
      kind: 'clear-chat',
      opId: targetPeerId ? `op_clr_${channelId}_${targetPeerId}_${now}` : undefined,
      channelId,
      clearedAt: now,
      fromPeerId: this.localPeerId,
    };
    void this.dispatchWirePacket(packet, targetPeerId, true);
  }

  public sendTyping(
    channelId: string,
    isTyping: boolean,
    targetPeerId?: string,
  ): void {
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

  private async flushOutboxForPeer(remotePeerId: string, force = false): Promise<void> {
    if (this.destroyed || remotePeerId === this.localPeerId) return;
    if (this.flushingPeers.has(remotePeerId)) return;

    const lastAt = this.lastFlushAt.get(remotePeerId) ?? 0;
    if (!force && Date.now() - lastAt < FLUSH_COOLDOWN_MS) return;

    const pending = getOutboxForPeer(remotePeerId);
    if (pending.length === 0) return;

    this.flushingPeers.add(remotePeerId);
    this.lastFlushAt.set(remotePeerId, Date.now());

    try {
      for (const item of pending) {
        if (this.destroyed) return;
        await this.replayOutboxItem(item);
      }
    } finally {
      this.flushingPeers.delete(remotePeerId);
    }
  }

  private async replayOutboxItem(item: OutboxItem): Promise<void> {
    if (item.kind === 'chat' && item.message) {
      let blob: Blob | undefined;
      if (item.message.attachment?.mediaId) {
        const found = await getMediaBlob(item.message.attachment.mediaId);
        if (!found) {
          // If media blob no longer exists, send text notice or drop dead media
          if (!item.message.text) {
            removeOutboxByOpId(item.opId);
            return;
          }
        } else {
          blob = found;
        }
      }
      await this.transmitChatMessage(
        item.message,
        blob,
        item.targetPeerId,
        item.opId,
        false,
      );
      return;
    }

    if (item.kind === 'delete-msg' && item.messageId) {
      await this.dispatchWirePacket(
        {
          kind: 'delete-msg',
          opId: item.opId,
          channelId: item.channelId,
          messageId: item.messageId,
          fromPeerId: this.localPeerId,
        },
        item.targetPeerId,
        true,
      );
      return;
    }

    if (item.kind === 'clear-chat') {
      await this.dispatchWirePacket(
        {
          kind: 'clear-chat',
          opId: item.opId,
          channelId: item.channelId,
          clearedAt: item.createdAt,
          fromPeerId: this.localPeerId,
        },
        item.targetPeerId,
        true,
      );
      return;
    }

    if (item.kind === 'reaction' && item.messageId && item.emoji !== undefined) {
      await this.dispatchWirePacket(
        {
          kind: 'reaction',
          opId: item.opId,
          channelId: item.channelId,
          messageId: item.messageId,
          emoji: item.emoji,
          peerId: this.localPeerId,
          add: Boolean(item.add),
        },
        item.targetPeerId,
        true,
      );
    }
  }

  private sendSyncHello(): void {
    if (this.destroyed) return;
    const pkt: WirePacket = {
      kind: 'sync-hello',
      peerId: this.localPeerId,
      name: this.localName,
      timestamp: Date.now(),
    };
    void this.dispatchWirePacket(pkt, undefined, false);
  }

  private handleNetworkOnline = (): void => {
    this.publishPresence();
    this.sendSyncHello();
  };

  private waitForDcDrain(dc: RTCDataChannel): Promise<void> {
    if (dc.bufferedAmount <= 256 * 1024 || dc.readyState !== 'open') {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 120);
      dc.bufferedAmountLowThreshold = 128 * 1024;
      const onLow = () => {
        clearTimeout(timer);
        dc.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };
      dc.addEventListener('bufferedamountlow', onLow);
    });
  }

  private handlePageUnload = (): void => {
    this.clearMyPresence();
  };

  private clearMyPresence(): void {
    if (this.client?.connected) {
      try {
        this.client.publish(`${TOPIC_PREFIX}/users/${this.localPeerId}`, '', {
          retain: true,
          qos: 0,
        });
      } catch {
        // Ignore
      }
    }
    if (this.broadcast) {
      try {
        this.broadcast.postMessage({
          kind: 'leave',
          peerId: this.localPeerId,
        });
      } catch {
        // Ignore
      }
    }
  }

  private connectBroker(index: number): void {
    if (this.destroyed) return;
    this.brokerIndex = index % BROKER_URLS.length;
    const url = BROKER_URLS[this.brokerIndex];
    const brokerLabel = url.includes('emqx') ? 'EMQX Mesh' : 'HiveMQ Mesh';

    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        // Ignore
      }
      this.client = null;
    }

    if (this.failoverTimer !== null) {
      clearTimeout(this.failoverTimer);
      this.failoverTimer = null;
    }

    const client = mqtt.connect(url, {
      clientId: `varta_${this.localPeerId}_${Math.random().toString(36).slice(2, 6)}`,
      clean: true,
      keepalive: 25,
      reconnectPeriod: 4000,
      connectTimeout: 6000,
      will: {
        topic: `${TOPIC_PREFIX}/users/${this.localPeerId}`,
        payload: '',
        qos: 0,
        retain: true,
      },
    });

    this.client = client;

    this.failoverTimer = window.setTimeout(() => {
      if (!this.destroyed && !client.connected) {
        this.connectBroker(this.brokerIndex + 1);
      }
    }, 6500);

    client.on('connect', () => {
      if (this.destroyed) return;
      if (this.failoverTimer !== null) {
        clearTimeout(this.failoverTimer);
        this.failoverTimer = null;
      }
      this.callbacks.onConnectionStatusChange(true, brokerLabel);

      client.subscribe(
        [
          `${TOPIC_PREFIX}/users/+`,
          `${TOPIC_PREFIX}/inbox/${this.localPeerId}`,
          `${TOPIC_PREFIX}/signal/${this.localPeerId}`,
          `${TOPIC_PREFIX}/lounge`,
        ],
        { qos: 0 },
      );

      this.publishPresence();
      this.sendSyncHello();
    });

    client.on('offline', () => {
      if (!this.destroyed) {
        this.callbacks.onConnectionStatusChange(false, 'Reconnecting');
      }
    });

    client.on('close', () => {
      if (!this.destroyed) {
        this.callbacks.onConnectionStatusChange(false, 'Reconnecting');
      }
    });

    client.on('message', (topic, payloadBuf) => {
      if (this.destroyed) return;
      const raw = payloadBuf.toString();

      if (topic.startsWith(`${TOPIC_PREFIX}/users/`)) {
        const peerKey = topic.slice(`${TOPIC_PREFIX}/users/`.length);
        if (!peerKey || peerKey === this.localPeerId) return;

        if (!raw) {
          this.peers.delete(peerKey);
          this.emitPeers();
          return;
        }

        try {
          const data = JSON.parse(raw) as {
            peerId?: string;
            name?: string;
            ts?: number;
          };
          if (!data.peerId || !data.name || typeof data.ts !== 'number') return;
          if (Date.now() - data.ts > PEER_TTL_MS) return;

          const wasOffline = !this.peers.has(data.peerId);
          const existing = this.peers.get(data.peerId);
          this.upsertPeer(
            data.peerId,
            data.name,
            existing?.sameDevice ?? false,
            existing?.webrtcState ?? 'idle',
            existing?.dataChannelOpen ?? false,
            data.ts,
          );
          this.maybeInitiateWebRTC(data.peerId);
          if (wasOffline) {
            void this.flushOutboxForPeer(data.peerId, true);
          }
        } catch {
          // Ignore invalid presence
        }
        return;
      }

      if (topic === `${TOPIC_PREFIX}/signal/${this.localPeerId}`) {
        void this.handleEncryptedSignal(raw);
        return;
      }

      if (
        topic === `${TOPIC_PREFIX}/inbox/${this.localPeerId}` ||
        topic === `${TOPIC_PREFIX}/lounge`
      ) {
        void this.handleEncryptedWirePacket(raw, 'relay');
      }
    });
  }

  private publishPresence(): void {
    if (this.destroyed) return;
    const now = Date.now();
    const payload = JSON.stringify({
      peerId: this.localPeerId,
      name: this.localName,
      ts: now,
    });

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

    if (this.client?.connected) {
      try {
        this.client.publish(`${TOPIC_PREFIX}/users/${this.localPeerId}`, payload, {
          retain: true,
          qos: 0,
        });
      } catch {
        // Ignore
      }
    }
  }

  private async dispatchWirePacket(
    packet: WirePacket,
    targetPeerId: string | undefined,
    isImportant: boolean,
  ): Promise<void> {
    const serialized = JSON.stringify(packet);

    // 1. Direct WebRTC DataChannel (<10ms browser-to-browser)
    let deliveredDirect = false;
    if (targetPeerId) {
      const entry = this.rtcEntries.get(targetPeerId);
      if (entry?.dc && entry.dc.readyState === 'open') {
        try {
          entry.dc.send(serialized);
          deliveredDirect = true;
        } catch {
          // Fallback to relay
        }
      }
    } else {
      for (const entry of this.rtcEntries.values()) {
        if (entry.dc && entry.dc.readyState === 'open') {
          try {
            entry.dc.send(serialized);
            deliveredDirect = true;
          } catch {
            // Continue
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
          to: targetPeerId ?? null,
          packet,
        });
      } catch {
        // Ignore
      }
    }

    // 3. Encrypted Ephemeral Relay (when direct WebRTC isn't already open for target)
    if (this.client?.connected && this.aesKey) {
      if (deliveredDirect && targetPeerId) return;
      if (!isImportant && deliveredDirect) return;

      try {
        const cipher = await encryptPacket(this.aesKey, packet);
        const topic = targetPeerId
          ? `${TOPIC_PREFIX}/inbox/${targetPeerId}`
          : `${TOPIC_PREFIX}/lounge`;
        this.client.publish(topic, cipher, {
          retain: false,
          qos: isImportant ? 1 : 0,
        });
      } catch {
        // Ignore
      }
    }
  }

  private async handleBroadcastRaw(raw: unknown): Promise<void> {
    if (this.destroyed || !raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;

    if (msg.kind === 'leave') {
      const peerId = String(msg.peerId ?? '');
      if (peerId && this.peers.delete(peerId)) {
        this.emitPeers();
      }
      return;
    }

    if (msg.kind === 'presence') {
      const peerId = String(msg.peerId ?? '');
      const name = String(msg.name ?? 'User');
      if (!peerId || peerId === this.localPeerId) return;
      const wasOffline = !this.peers.has(peerId);
      const existing = this.peers.get(peerId);
      this.upsertPeer(
        peerId,
        name,
        true,
        existing?.webrtcState ?? 'idle',
        existing?.dataChannelOpen ?? false,
        Date.now(),
      );
      this.maybeInitiateWebRTC(peerId);
      if (wasOffline) {
        void this.flushOutboxForPeer(peerId, true);
      }
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
      if (msg.to && msg.to !== this.localPeerId) return;
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

  private async handleEncryptedWirePacket(
    cipher: string,
    transport: TransportKind,
  ): Promise<void> {
    if (!this.aesKey) return;
    const pkt = await decryptPacket<WirePacket>(this.aesKey, cipher);
    if (!pkt) return;
    this.handleWirePacket(pkt, transport);
  }

  private sendOpAck(opId: string | undefined, targetPeerId: string): void {
    if (!opId) return;
    const pkt: WirePacket = {
      kind: 'op-ack',
      opId,
      fromPeerId: this.localPeerId,
    };
    void this.dispatchWirePacket(pkt, targetPeerId, false);
  }

  private handleWirePacket(pkt: WirePacket, transport: TransportKind): void {
    if (pkt.kind === 'sync-hello') {
      if (pkt.peerId === this.localPeerId) return;
      const existing = this.peers.get(pkt.peerId);
      this.upsertPeer(
        pkt.peerId,
        pkt.name,
        transport === 'broadcast' ? true : (existing?.sameDevice ?? false),
        existing?.webrtcState ?? 'idle',
        existing?.dataChannelOpen ?? false,
        Date.now(),
      );
      this.maybeInitiateWebRTC(pkt.peerId);
      void this.flushOutboxForPeer(pkt.peerId, true);
      return;
    }

    if (pkt.kind === 'op-ack') {
      if (pkt.fromPeerId === this.localPeerId) return;
      removeOutboxByOpId(pkt.opId);
      return;
    }

    if (pkt.kind === 'media-meta') {
      const m = pkt.message;
      if (m.senderId === this.localPeerId) return;

      const deletedIds = loadDeletedMessageIds();
      if (deletedIds.has(m.id) || this.seenMessageIds.has(m.id)) {
        this.sendOpAck(pkt.opId, m.senderId);
        return;
      }
      this.seenMessageIds.add(m.id);

      const existing = this.peers.get(m.senderId);
      this.upsertPeer(
        m.senderId,
        m.senderName,
        transport === 'broadcast' ? true : (existing?.sameDevice ?? false),
        existing?.webrtcState ?? 'idle',
        existing?.dataChannelOpen ?? false,
        Date.now(),
      );

      this.incomingTransfers.set(pkt.transferId, {
        opId: pkt.opId,
        message: m,
        totalChunks: pkt.totalChunks,
        chunks: new Array<Uint8Array | undefined>(pkt.totalChunks),
        receivedCount: 0,
        lastProgressPct: 0,
        createdAt: Date.now(),
        transport,
      });

      this.callbacks.onMessageReceived({
        ...m,
        status: 'delivered',
        transport,
        transferProgress: 0,
      });
      return;
    }

    if (pkt.kind === 'media-chunk') {
      void this.handleMediaChunk(pkt);
      return;
    }

    if (pkt.kind === 'hello') {
      if (pkt.peerId === this.localPeerId) return;
      const existing = this.peers.get(pkt.peerId);
      this.upsertPeer(
        pkt.peerId,
        pkt.name,
        existing?.sameDevice ?? false,
        'connected',
        true,
        Date.now(),
      );
      void this.flushOutboxForPeer(pkt.peerId, true);
      return;
    }

    if (pkt.kind === 'typing') {
      if (pkt.peerId === this.localPeerId) return;
      const p = this.peers.get(pkt.peerId);
      if (p) {
        p.name = pkt.name;
        p.lastSeen = Date.now();
        p.typingChannelId = pkt.isTyping ? pkt.channelId : null;
        p.typingUntil = pkt.isTyping ? Date.now() + TYPING_TTL_MS : 0;
        this.emitPeers();
      }
      return;
    }

    if (pkt.kind === 'reaction') {
      if (pkt.peerId === this.localPeerId) return;
      if (pkt.opId) {
        if (this.seenOpIds.has(pkt.opId)) {
          this.sendOpAck(pkt.opId, pkt.peerId);
          return;
        }
        this.seenOpIds.add(pkt.opId);
      }
      this.callbacks.onReactionReceived(
        pkt.channelId,
        pkt.messageId,
        pkt.emoji,
        pkt.peerId,
        pkt.add,
      );
      this.sendOpAck(pkt.opId, pkt.peerId);
      return;
    }

    if (pkt.kind === 'delete-msg') {
      if (pkt.fromPeerId === this.localPeerId) return;
      if (pkt.opId) {
        if (this.seenOpIds.has(pkt.opId)) {
          this.sendOpAck(pkt.opId, pkt.fromPeerId);
          return;
        }
        this.seenOpIds.add(pkt.opId);
      }
      this.callbacks.onMessageDeleted(pkt.channelId, pkt.messageId);
      this.sendOpAck(pkt.opId, pkt.fromPeerId);
      return;
    }

    if (pkt.kind === 'clear-chat') {
      if (pkt.fromPeerId === this.localPeerId) return;
      if (pkt.opId) {
        if (this.seenOpIds.has(pkt.opId)) {
          this.sendOpAck(pkt.opId, pkt.fromPeerId);
          return;
        }
        this.seenOpIds.add(pkt.opId);
      }
      this.callbacks.onChannelCleared(pkt.channelId, pkt.clearedAt);
      this.sendOpAck(pkt.opId, pkt.fromPeerId);
      return;
    }

    if (pkt.kind === 'ack') {
      if (pkt.fromPeerId === this.localPeerId) return;
      removeOutboxChatByMessageId(pkt.messageId, pkt.fromPeerId);
      this.callbacks.onMessageAcked(pkt.messageId);
      return;
    }

    if (pkt.kind === 'chat') {
      const m = pkt.message;
      if (m.senderId === this.localPeerId) return;

      const deletedIds = loadDeletedMessageIds();
      if (deletedIds.has(m.id) || this.seenMessageIds.has(m.id)) {
        this.sendOpAck(pkt.opId, m.senderId);
        return;
      }
      this.seenMessageIds.add(m.id);

      const existing = this.peers.get(m.senderId);
      this.upsertPeer(
        m.senderId,
        m.senderName,
        transport === 'broadcast' ? true : (existing?.sameDevice ?? false),
        existing?.webrtcState ?? 'idle',
        existing?.dataChannelOpen ?? false,
        Date.now(),
      );

      const peer = this.peers.get(m.senderId);
      if (peer) {
        peer.typingUntil = 0;
        peer.typingChannelId = null;
        this.emitPeers();
      }

      this.callbacks.onMessageReceived({
        ...m,
        status: 'delivered',
        transport,
      });

      this.sendOpAck(pkt.opId, m.senderId);

      const ack: WirePacket = {
        kind: 'ack',
        messageId: m.id,
        fromPeerId: this.localPeerId,
        channelId: m.channelId,
      };
      void this.dispatchWirePacket(ack, m.senderId, false);
    }
  }

  private async handleMediaChunk(
    pkt: Extract<WirePacket, { kind: 'media-chunk' }>,
  ): Promise<void> {
    const tr = this.incomingTransfers.get(pkt.transferId);
    if (!tr || pkt.index < 0 || pkt.index >= tr.totalChunks) return;

    if (tr.chunks[pkt.index] === undefined) {
      tr.chunks[pkt.index] = base64ToUint8(pkt.data);
      tr.receivedCount++;
    }

    const pct = Math.round((tr.receivedCount / tr.totalChunks) * 100);
    if (pct !== tr.lastProgressPct && (pct % 5 === 0 || tr.receivedCount === tr.totalChunks)) {
      tr.lastProgressPct = pct;
      if (tr.receivedCount < tr.totalChunks) {
        this.callbacks.onMediaTransferProgress(tr.message.id, pct);
      }
    }

    if (tr.receivedCount === tr.totalChunks) {
      this.incomingTransfers.delete(pkt.transferId);
      const mime = tr.message.attachment?.mimeType ?? 'application/octet-stream';
      const orderedParts = tr.chunks.filter(
        (c): c is Uint8Array => c !== undefined,
      );
      const blobParts = orderedParts.map((u8) => u8.buffer as ArrayBuffer);
      const fullBlob = new Blob(blobParts, { type: mime });
      const mediaId = tr.message.attachment?.mediaId;
      if (mediaId) {
        await saveMediaBlob(mediaId, fullBlob);
      }
      this.callbacks.onMediaTransferProgress(tr.message.id, undefined);
      this.sendOpAck(tr.opId, tr.message.senderId);

      const ack: WirePacket = {
        kind: 'ack',
        messageId: tr.message.id,
        fromPeerId: this.localPeerId,
        channelId: tr.message.channelId,
      };
      void this.dispatchWirePacket(ack, tr.message.senderId, false);
    }
  }

  // --- Automatic WebRTC P2P Negotiation ---

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
    const isInitiator = this.localPeerId < remotePeerId;
    if (isInitiator) {
      const dc = entry.pc.createDataChannel('varta-dm', { ordered: true });
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
      void this.flushOutboxForPeer(entry.peerId, true);
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
          // Ignore
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
      // Ignore
    } finally {
      entry.makingOffer = false;
    }
  }

  private async handleSignalPayload(sig: SignalPayload): Promise<void> {
    if (this.seenSignalIds.has(sig.id)) return;
    this.seenSignalIds.add(sig.id);

    const existing = this.peers.get(sig.from);
    if (!existing) {
      this.upsertPeer(
        sig.from,
        sig.fromName || 'User',
        false,
        'connecting',
        false,
        Date.now(),
      );
    }

    let entry = this.rtcEntries.get(sig.from);
    if (!entry) {
      entry = this.createPeerConnectionEntry(sig.from);
    }

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

    if (this.client?.connected && this.aesKey) {
      try {
        const cipher = await encryptPacket(this.aesKey, sig);
        this.client.publish(`${TOPIC_PREFIX}/signal/${sig.to}`, cipher, {
          retain: false,
          qos: 0,
        });
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
    ts: number,
  ): void {
    const prev = this.peers.get(peerId);
    this.peers.set(peerId, {
      peerId,
      name: name || prev?.name || 'User',
      lastSeen: Math.max(ts, prev?.lastSeen ?? 0),
      webrtcState: dataChannelOpen ? 'connected' : webrtcState,
      dataChannelOpen,
      sameDevice: sameDevice || prev?.sameDevice || false,
      typingChannelId: prev?.typingChannelId ?? null,
      typingUntil: prev?.typingUntil ?? 0,
    });
    this.emitPeers();
  }

  private pruneStalePeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers.entries()) {
      if (!peer.dataChannelOpen && now - peer.lastSeen > PEER_TTL_MS) {
        this.peers.delete(id);
        changed = true;
      } else if (peer.typingUntil > 0 && now > peer.typingUntil) {
        peer.typingUntil = 0;
        peer.typingChannelId = null;
        changed = true;
      }
    }
    for (const [tid, buf] of this.incomingTransfers.entries()) {
      if (now - buf.createdAt > TRANSFER_TTL_MS) {
        this.incomingTransfers.delete(tid);
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
}
