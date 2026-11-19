const APP_SALT = new TextEncoder().encode('varta-global-mesh-salt-v2');

export function generatePeerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
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
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
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
