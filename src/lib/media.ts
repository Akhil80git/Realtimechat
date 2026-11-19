import { ChatAttachment } from '../types/chat';
import { saveMediaBlob } from './mediaVault';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

export function getSupportedVideoMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'video/webm';
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

export function generateMediaId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `m_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  }
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function prepareMediaAttachment(
  fileOrBlob: File | Blob,
  overrideName?: string,
  durationMs?: number,
): Promise<{ attachment: ChatAttachment; blob: Blob }> {
  const mime = fileOrBlob.type || 'application/octet-stream';
  const name =
    overrideName ??
    (fileOrBlob instanceof File ? fileOrBlob.name : `media-${Date.now()}`);
  const mediaId = generateMediaId();

  // Read image dimensions cleanly without storing in phone gallery
  let width: number | undefined;
  let height: number | undefined;

  let kind: ChatAttachment['kind'] = 'file';
  if (mime.startsWith('image/')) {
    kind = 'image';
    const objUrl = URL.createObjectURL(fileOrBlob);
    try {
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 0, h: 0 });
        img.src = objUrl;
      });
      if (dims.w > 0) {
        width = dims.w;
        height = dims.h;
      }
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  } else if (mime.startsWith('video/')) {
    kind = 'video';
  } else if (mime.startsWith('audio/')) {
    kind = durationMs !== undefined ? 'voice' : 'file';
  }

  await saveMediaBlob(mediaId, fileOrBlob);

  return {
    attachment: {
      kind,
      name,
      mimeType: mime,
      size: fileOrBlob.size,
      mediaId,
      durationMs,
      width,
      height,
    },
    blob: fileOrBlob,
  };
}
