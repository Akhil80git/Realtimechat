const APP_SALT = new TextEncoder().encode('varta-global-mesh-salt-v2');

const RANDOM_NAME_BASES = [
  'Aarav',
  'Aman',
  'Kiran',
  'Zoya',
  'Riya',
  'Kabir',
  'Neha',
  'Tara',
  'Dev',
  'Meera',
  'Sana',
  'Vihaan',
];

export function generatePeerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function generateRandomUsername(): string {
  const base =
    RANDOM_NAME_BASES[Math.floor(Math.random() * RANDOM_NAME_BASES.length)];
  const suffix = Math.floor(10 + Math.random() * 89).toString();
  return `${base}${suffix}`;
}

export function generateQrDerivedUsername(fromName: string): string {
  const cleaned = fromName
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 18);
  const base = cleaned || 'Friend';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let suffix = '';
  for (let i = 0; i < 2; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${base}${suffix}`;
}

export function getDmChannelId(peerA: string, peerB: string): string {
  return peerA < peerB ? `dm:${peerA}_${peerB}` : `dm:${peerB}_${peerA}`;
}

export async function deriveAesKey(secretSeed: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretSeed),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: APP_SALT,
      iterations: 15000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function encryptPacket(key: CryptoKey, payload: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  const cipherBytes = new Uint8Array(ciphertext);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv, 0);
  combined.set(cipherBytes, iv.length);
  return bytesToBase64(combined);
}

export async function decryptPacket<T>(key: CryptoKey, packed: string): Promise<T | null> {
  try {
    const combined = base64ToBytes(packed);
    if (combined.length < 13) return null;
    const iv = combined.slice(0, 12);
    const cipherBytes = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherBytes,
    );
    const json = new TextDecoder().decode(decrypted);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
