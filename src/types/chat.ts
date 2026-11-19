export type TransportKind = 'webrtc' | 'broadcast' | 'relay' | 'local';

export type DeliveryStatus = 'sending' | 'sent' | 'delivered';

export interface UserProfile {
  peerId: string;
  name: string;
  theme: 'light' | 'dark';
  createdAt: number;
}

export interface ChatAttachment {
  kind: 'image' | 'voice' | 'file';
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
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
  /** Map of emoji -> array of peerIds who reacted */
  reactions?: Record<string, string[]>;
  timestamp: number;
  status: DeliveryStatus;
  transport: TransportKind;
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

export type WirePacket =
  | {
      kind: 'chat';
      message: Omit<ChatMessage, 'status' | 'transport'>;
    }
  | {
      kind: 'chunk';
      transferId: string;
      index: number;
      total: number;
      data: string;
    }
  | {
      kind: 'reaction';
      channelId: string;
      messageId: string;
      emoji: string;
      peerId: string;
      add: boolean;
    }
  | {
      kind: 'ack';
      messageId: string;
      fromPeerId: string;
      channelId: string;
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
