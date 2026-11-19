import { ChatMessage, StorageStats, StoredContact, UserProfile } from '../types/chat';
import {
  clearAllMediaBlobs,
  deleteMediaBlobs,
  getMediaVaultBytes,
} from './mediaVault';

const PROFILE_KEY = 'varta_account_v2';
const CONTACTS_KEY = 'varta_contacts_v2';
const MSG_KEY = 'varta_messages_v2';
const MAX_MESSAGES = 2000;

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
    try {
      const msgs = safeParse<ChatMessage[]>(localStorage.getItem(MSG_KEY), []);
      if (msgs.length > 300) {
        localStorage.setItem(MSG_KEY, JSON.stringify(msgs.slice(-300)));
      }
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore if browser storage is full
    }
  }
}

export function loadProfile(): UserProfile | null {
  return safeParse<UserProfile | null>(localStorage.getItem(PROFILE_KEY), null);
}

export function saveProfile(profile: UserProfile): void {
  safeSet(PROFILE_KEY, profile);
}

export function loadAllMessages(): ChatMessage[] {
  const msgs = safeParse<ChatMessage[]>(localStorage.getItem(MSG_KEY), []);
  return msgs.sort((a, b) => a.timestamp - b.timestamp);
}

export function saveAllMessages(messages: ChatMessage[]): void {
  const trimmed = messages.slice(-MAX_MESSAGES);
  safeSet(MSG_KEY, trimmed);
}

export async function deleteSingleMessage(messageId: string): Promise<ChatMessage[]> {
  const all = loadAllMessages();
  const target = all.find((m) => m.id === messageId);
  const remaining = all.filter((m) => m.id !== messageId);
  saveAllMessages(remaining);
  if (target?.attachment?.mediaId) {
    await deleteMediaBlobs([target.attachment.mediaId]);
  }
  return remaining;
}

export async function clearChannelMessages(channelId: string): Promise<ChatMessage[]> {
  const all = loadAllMessages();
  const removedMediaIds = all
    .filter((m) => m.channelId === channelId && m.attachment?.mediaId)
    .map((m) => m.attachment!.mediaId);

  const remaining = all.filter((m) => m.channelId !== channelId);
  saveAllMessages(remaining);
  await deleteMediaBlobs(removedMediaIds);
  return remaining;
}

export function loadContacts(): StoredContact[] {
  const contacts = safeParse<StoredContact[]>(localStorage.getItem(CONTACTS_KEY), []);
  return contacts.sort((a, b) => b.lastMessageAt - a.lastMessageAt || b.lastSeen - a.lastSeen);
}

export function upsertContact(
  peerId: string,
  name: string,
  lastSeen: number,
  preview?: string,
  messageTs?: number,
): StoredContact[] {
  const contacts = loadContacts();
  const idx = contacts.findIndex((c) => c.peerId === peerId);
  const existing = idx >= 0 ? contacts[idx] : null;

  const updated: StoredContact = {
    peerId,
    name: name || existing?.name || 'User',
    lastSeen: Math.max(lastSeen, existing?.lastSeen ?? 0),
    lastMessageAt: messageTs ?? existing?.lastMessageAt ?? 0,
    lastPreview: preview ?? existing?.lastPreview ?? '',
  };

  if (idx >= 0) {
    contacts[idx] = updated;
  } else {
    contacts.unshift(updated);
  }

  const sorted = contacts
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt || b.lastSeen - a.lastSeen)
    .slice(0, 150);

  safeSet(CONTACTS_KEY, sorted);
  return sorted;
}

export async function getStorageStatsAsync(): Promise<StorageStats> {
  let localBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('varta_')) continue;
    const val = localStorage.getItem(key) ?? '';
    localBytes += new Blob([key, val]).size;
  }

  const mediaBytes = await getMediaVaultBytes();

  return {
    totalBytes: localBytes + mediaBytes,
    messageCount: loadAllMessages().length,
    contactCount: loadContacts().length,
  };
}

export async function clearAllLocalData(): Promise<void> {
  const toDelete: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('varta_')) {
      toDelete.push(key);
    }
  }
  toDelete.forEach((k) => localStorage.removeItem(k));
  await clearAllMediaBlobs();
}
