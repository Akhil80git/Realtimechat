export type TransportKind = 'webrtc' | 'broadcast' | 'gun' | 'local';

export type DeliveryStatus = 'sending' | 'sent' | 'delivered';

export interface UserProfile {
  peerId: string;
  name: string;
  theme: 'light' | 'dark';
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  roomCode: string;
  /** 'room' for shared room conversation, or 'dm:<sortedPeerA>_<sortedPeerB>' for 1-to-1 DM */
  channelId: string;
  senderId: string;
  senderName: string;
  text: string;
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
  typingUntil: number;
}

export interface RoomMeta {
  roomCode: string;
  joinedAt: number;
  lastMessageAt: number;
  lastPreview: string;
}

export interface StorageStats {
  totalBytes: number;
  messageCount: number;
  roomCount: number;
  contactCount: number;
}

export type WirePacket =
  | {
      kind: 'chat';
      message: Omit<ChatMessage, 'status' | 'transport'>;
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
