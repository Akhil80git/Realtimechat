import { ChatAttachment } from '../types/chat';

export const MAX_RAW_FILE_BYTES = 1.5 * 1024 * 1024; // 1.5 MB for reliable P2P + localStorage

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function getSupportedAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

export async function compressImageFile(file: File): Promise<ChatAttachment> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = objectUrl;
    });

    const maxDim = 1080;
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas not supported');
    }
    ctx.drawImage(img, 0, 0, width, height);

    // Prefer WebP for high quality at tiny P2P byte sizes; fallback to JPEG
    let dataUrl = canvas.toDataURL('image/webp', 0.78);
    let mimeType = 'image/webp';
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      mimeType = 'image/jpeg';
    }

    const approxBytes = Math.round((dataUrl.length * 3) / 4);
    return {
      kind: 'image',
      name: file.name || `photo-${Date.now()}.webp`,
      mimeType,
      size: approxBytes,
      dataUrl,
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareFileAttachment(file: File): Promise<ChatAttachment> {
  if (file.type.startsWith('image/')) {
    return compressImageFile(file);
  }

  if (file.size > MAX_RAW_FILE_BYTES) {
    throw new Error('File must be under 1.5 MB for direct browser-to-browser transfer.');
  }

  const dataUrl = await readBlobAsDataUrl(file);
  return {
    kind: 'file',
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    dataUrl,
  };
}
