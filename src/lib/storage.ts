import { ChatMessage, PeerInfo, RoomMeta, StorageStats, UserProfile } from '../types/chat';

const PROFILE_KEY = 'varta_profile_v1';
const ROOMS_KEY = 'varta_rooms_v1';
const CONTACTS_KEY = 'varta_contacts_v1';
const MSG_PREFIX = 'varta_msgs_v1_';
const MAX_MESSAGES_PER_ROOM = 800;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Handle quota exceeded by trimming oldest messages across rooms
    try {
      const msgKeys = Object.keys(localStorage).filter((k) => k.startsWith(MSG_PREFIX));
      for (const mk of msgKeys) {
        const list = safeParse<ChatMessage[]>(localStorage.getItem(mk), []);
        if (list.length > 100) {
          localStorage.setItem(mk, JSON.stringify(list.slice(-100)));
        }
      }
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore if still unable to write
    }
  }
}

export function loadProfile(): UserProfile | null {
  return safeParse<UserProfile | null>(localStorage.getItem(PROFILE_KEY), null);
}

export function saveProfile(profile: UserProfile): void {
  safeSet(PROFILE_KEY, profile);
}

export function loadRooms(): RoomMeta[] {
  const rooms = safeParse<RoomMeta[]>(localStorage.getItem(ROOMS_KEY), []);
  return rooms.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function saveRoom(roomCode: string, lastPreview?: string, lastMessageAt?: number): RoomMeta[] {
  const normalized = roomCode.trim().toLowerCase();
  const rooms = loadRooms();
  const existing = rooms.find((r) => r.roomCode === normalized);
  const now = Date.now();

  if (existing) {
    existing.lastMessageAt = lastMessageAt ?? existing.lastMessageAt;
    if (lastPreview !== undefined) {
      existing.lastPreview = lastPreview;
    }
  } else {
    rooms.unshift({
      roomCode: normalized,
      joinedAt: now,
      lastMessageAt: lastMessageAt ?? now,
      lastPreview: lastPreview ?? 'No messages yet',
    });
  }

  const sorted = rooms.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  safeSet(ROOMS_KEY, sorted);
  return sorted;
}

export function removeRoomFromStorage(roomCode: string): RoomMeta[] {
  const normalized = roomCode.trim().toLowerCase();
  localStorage.removeItem(MSG_PREFIX + normalized);
  const next = loadRooms().filter((r) => r.roomCode !== normalized);
  safeSet(ROOMS_KEY, next);
  return next;
}

export function loadMessages(roomCode: string): ChatMessage[] {
  const normalized = roomCode.trim().toLowerCase();
  const msgs = safeParse<ChatMessage[]>(localStorage.getItem(MSG_PREFIX + normalized), []);
  return msgs.sort((a, b) => a.timestamp - b.timestamp);
}

export function saveMessages(roomCode: string, messages: ChatMessage[]): void {
  const normalized = roomCode.trim().toLowerCase();
  const trimmed = messages.slice(-MAX_MESSAGES_PER_ROOM);
  safeSet(MSG_PREFIX + normalized, trimmed);
}

export function clearRoomMessages(roomCode: string): void {
  const normalized = roomCode.trim().toLowerCase();
  localStorage.removeItem(MSG_PREFIX + normalized);
  saveRoom(normalized, 'Conversation cleared', Date.now());
}

export interface StoredContact {
  peerId: string;
  name: string;
  lastRoom: string;
  lastSeen: number;
}

export function loadContacts(): StoredContact[] {
  return safeParse<StoredContact[]>(localStorage.getItem(CONTACTS_KEY), []);
}

export function upsertContact(peer: Pick<PeerInfo, 'peerId' | 'name' | 'lastSeen'>, roomCode: string): StoredContact[] {
  const contacts = loadContacts();
  const idx = contacts.findIndex((c) => c.peerId === peer.peerId);
  const nextItem: StoredContact = {
    peerId: peer.peerId,
    name: peer.name,
    lastRoom: roomCode,
    lastSeen: peer.lastSeen,
  };
  if (idx >= 0) {
    contacts[idx] = nextItem;
  } else {
    contacts.unshift(nextItem);
  }
  const bounded = contacts.slice(0, 100);
  safeSet(CONTACTS_KEY, bounded);
  return bounded;
}

export function getStorageStats(): StorageStats {
  let totalBytes = 0;
  let messageCount = 0;
  let roomCount = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('varta_')) continue;
    const val = localStorage.getItem(key) ?? '';
    totalBytes += new Blob([key, val]).size;

    if (key.startsWith(MSG_PREFIX)) {
      const list = safeParse<ChatMessage[]>(val, []);
      messageCount += list.length;
    }
  }

  roomCount = loadRooms().length;
  const contactCount = loadContacts().length;

  return {
    totalBytes,
    messageCount,
    roomCount,
    contactCount,
  };
}

export function exportAllLocalData(): string {
  const dump: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    profile: loadProfile(),
    rooms: loadRooms(),
    contacts: loadContacts(),
    conversations: {} as Record<string, ChatMessage[]>,
  };

  const convs = dump.conversations as Record<string, ChatMessage[]>;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(MSG_PREFIX)) {
      const room = key.slice(MSG_PREFIX.length);
      convs[room] = safeParse<ChatMessage[]>(localStorage.getItem(key), []);
    }
  }

  return JSON.stringify(dump, null, 2);
}

export function clearAllLocalData(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('varta_')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}
