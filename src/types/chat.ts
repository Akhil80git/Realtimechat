export type TransportKind = 'webrtc' | 'broadcast' | 'relay' | 'local';

export type DeliveryStatus = 'sending' | 'sent' | 'delivered';

export interface UserProfile {
  peerId: string;
  name: string;
  theme: 'light' | 'dark';
  createdAt: number;
}

export interface ChatAttachment {
  kind: 'image' | 'video' | 'voice' | 'file';
  name: string;
  mimeType: string;
  size: number;
  /** IndexedDB blob key for in-site private storage */
  mediaId: string;
  /** Optional inline preview/fallback dataUrl for tiny legacy items */
  dataUrl?: string;
  durationMs?: number;
  width?: number;
  height?: number;
}

export interface ReplyRef {
  messageId: string;
  senderName: string;
  preview: string;
}

export interface ChatMessage {
  id: string;
  /** 'lounge' for shared everyone chat, or 'dm:<sortedPeerA>_<sortedPeerB>' for 1-to-1 DM */
  channelId: string;
  senderId: string;
  senderName: string;
  recipientId?: string;
  text: string;
  attachment?: ChatAttachment;
  replyTo?: ReplyRef;
  reactions?: Record<string, string[]>;
  timestamp: number;
  status: DeliveryStatus;
  transport: TransportKind;
  /** 0-100 transfer progress while sending/receiving large media */
  transferProgress?: number;
}

export interface PeerInfo {
  peerId: string;
  name: string;
  lastSeen: number;
  webrtcState: RTCPeerConnectionState | 'idle';
  dataChannelOpen: boolean;
  sameDevice: boolean;
  typingChannelId: string | null;
  typingUntil: number;
}

export interface StoredContact {
  peerId: string;
  name: string;
  lastSeen: number;
  lastMessageAt: number;
  lastPreview: string;
}

export interface StorageStats {
  totalBytes: number;
  messageCount: number;
  contactCount: number;
}

export interface OutboxItem {
  opId: string;
  targetPeerId: string;
  kind: 'chat' | 'delete-msg' | 'clear-chat' | 'reaction';
  channelId: string;
  createdAt: number;
  message?: Omit<ChatMessage, 'status' | 'transport' | 'transferProgress'>;
  messageId?: string;
  emoji?: string;
  add?: boolean;
}

export type WirePacket =
  | {
      kind: 'chat';
      opId?: string;
      message: Omit<ChatMessage, 'status' | 'transport' | 'transferProgress'>;
    }
  | {
      kind: 'media-meta';
      opId?: string;
      transferId: string;
      totalChunks: number;
      message: Omit<ChatMessage, 'status' | 'transport' | 'transferProgress'>;
    }
  | {
      kind: 'media-chunk';
      transferId: string;
      index: number;
      totalChunks: number;
      data: string;
    }
  | {
      kind: 'reaction';
      opId?: string;
      channelId: string;
      messageId: string;
      emoji: string;
      peerId: string;
      add: boolean;
    }
  | {
      kind: 'delete-msg';
      opId?: string;
      channelId: string;
      messageId: string;
      fromPeerId: string;
    }
  | {
      kind: 'clear-chat';
      opId?: string;
      channelId: string;
      clearedAt: number;
      fromPeerId: string;
    }
  | {
      kind: 'ack';
      messageId: string;
      fromPeerId: string;
      channelId: string;
    }
  | {
      kind: 'op-ack';
      opId: string;
      fromPeerId: string;
    }
  | {
      kind: 'sync-hello';
      peerId: string;
      name: string;
      timestamp: number;
    }
  | {
      kind: 'typing';
      peerId: string;
      name: string;
      channelId: string;
      isTyping: boolean;
      timestamp: number;
    }
  | {
      kind: 'hello';
      peerId: string;
      name: string;
      timestamp: number;
    };

export interface SignalPayload {
  id: string;
  from: string;
  fromName: string;
  to: string;
  type: 'offer' | 'answer' | 'ice';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  ts: number;
}
