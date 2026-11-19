import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCheck,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Menu,
  Mic,
  Paperclip,
  Plus,
  QrCode,
  Reply,
  Search,
  SendHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  ChatAttachment,
  ChatMessage,
  PeerInfo,
  ReplyRef,
  TransportKind,
} from '../types/chat';
import { getDmChannelId } from '../lib/crypto';
import {
  formatDuration,
  formatFileSize,
  getSupportedAudioMime,
  prepareMediaAttachment,
} from '../lib/media';
import { getMediaObjectUrl } from '../lib/mediaVault';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥'];

interface ChatAreaProps {
  localPeerId: string;
  localName: string;
  activeChannelId: string;
  channelTitle: string;
  targetPeer: PeerInfo | null;
  onlinePeers: PeerInfo[];
  messages: ChatMessage[];
  secondTabUrl: string;
  onOpenMobileSidebar: () => void;
  onOpenQr: () => void;
  onOpenCamera: () => void;
  onSelectChannel: (channelId: string) => void;
  onSendMessage: (
    text: string,
    attachment?: ChatAttachment,
    mediaBlob?: Blob,
    replyTo?: ReplyRef,
  ) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onTypingChange: (isTyping: boolean) => void;
  onClearChannel: () => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function transportText(t: TransportKind): string {
  switch (t) {
    case 'webrtc':
      return 'WebRTC';
    case 'broadcast':
      return 'Local Tab';
    case 'relay':
      return 'Direct';
    default:
      return 'Saved';
  }
}

function useMediaSrc(attachment?: ChatAttachment, transferProgress?: number): string {
  const [src, setSrc] = useState<string>(attachment?.dataUrl ?? '');

  useEffect(() => {
    if (!attachment) {
      setSrc('');
      return;
    }
    if (attachment.dataUrl) {
      setSrc(attachment.dataUrl);
      return;
    }
    if (transferProgress !== undefined) {
      return;
    }
    let active = true;
    void getMediaObjectUrl(attachment.mediaId).then((url) => {
      if (active && url) {
        setSrc(url);
      }
    });
    return () => {
      active = false;
    };
  }, [attachment, transferProgress]);

  return src;
}

const PrivateAttachmentView: React.FC<{
  attachment: ChatAttachment;
  transferProgress?: number;
  isOwn: boolean;
  onOpenImage: (src: string, name: string) => void;
}> = ({ attachment, transferProgress, isOwn, onOpenImage }) => {
  const src = useMediaSrc(attachment, transferProgress);

  if (transferProgress !== undefined && !src) {
    return (
      <div className="min-w-[200px] space-y-1.5 py-1">
        <div className="flex items-center justify-between text-xs">
          <span className="truncate max-w-[160px]">{attachment.name}</span>
          <span className="font-mono tabular-nums">{transferProgress}%</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-black/15 dark:bg-white/15 overflow-hidden">
          <div
            className="h-full bg-current transition-all duration-150"
            style={{ width: `${transferProgress}%` }}
          />
        </div>
      </div>
    );
  }

  if (attachment.kind === 'image') {
    if (!src) {
      return (
        <div className="px-3 py-2 text-xs opacity-75">
          Media removed from site storage
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onOpenImage(src, attachment.name)}
        className="block rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-white/60"
      >
        <img
          src={src}
          alt={attachment.name}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          referrerPolicy="no-referrer"
          className="max-h-72 w-auto max-w-full object-contain rounded-lg cursor-zoom-in select-none"
        />
      </button>
    );
  }

  if (attachment.kind === 'video') {
    if (!src) {
      return (
        <div className="px-3 py-2 text-xs opacity-75">
          Video removed from site storage
        </div>
      );
    }
    return (
      <div className="max-w-[320px] space-y-1">
        <video
          src={src}
          controls
          playsInline
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          className="w-full max-h-72 rounded-lg bg-black"
        />
        <div className="text-[11px] font-mono tabular-nums opacity-75">
          {formatFileSize(attachment.size)} · In-site playback only
        </div>
      </div>
    );
  }

  if (attachment.kind === 'voice') {
    if (!src) {
      return (
        <div className="px-3 py-2 text-xs opacity-75">
          Voice note removed
        </div>
      );
    }
    return (
      <div className="min-w-[220px] space-y-1">
        <audio
          controls
          src={src}
          controlsList="nodownload"
          onContextMenu={(e) => e.preventDefault()}
          className="w-full h-9"
        />
        {attachment.durationMs !== undefined && (
          <div
            className={`text-[11px] font-mono tabular-nums ${
              isOwn ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            Voice note · {formatDuration(attachment.durationMs)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
        isOwn
          ? 'bg-blue-700/70 text-white'
          : 'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
      }`}
    >
      <FileText className="w-5 h-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{attachment.name}</div>
        <div className="text-[11px] font-mono tabular-nums opacity-75">
          {formatFileSize(attachment.size)} · In-site only
        </div>
      </div>
    </div>
  );
};

export const ChatArea: React.FC<ChatAreaProps> = ({
  localPeerId,
  localName,
  activeChannelId,
  channelTitle,
  targetPeer,
  onlinePeers,
  messages,
  secondTabUrl,
  onOpenMobileSidebar,
  onOpenQr,
  onOpenCamera,
  onSelectChannel,
  onSendMessage,
  onToggleReaction,
  onDeleteMessage,
  onTypingChange,
  onClearChannel,
}) => {
  const [draft, setDraft] = useState('');
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{
    attachment: ChatAttachment;
    blob: Blob;
    previewUrl: string;
  } | null>(null);
  const [replyingTo, setReplyingTo] = useState<ReplyRef | null>(null);
  const [mediaError, setMediaError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    name: string;
  } | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [isRecording, setIsRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  const channelMessages = useMemo(() => {
    const base = messages.filter((m) => m.channelId === activeChannelId);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q) ||
        (m.attachment?.name.toLowerCase().includes(q) ?? false),
    );
  }, [messages, activeChannelId, searchQuery]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [channelMessages.length, activeChannelId, searchQuery]);

  useEffect(() => {
    if (!lightboxImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxImage(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxImage]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        attachMenuRef.current &&
        !attachMenuRef.current.contains(e.target as Node)
      ) {
        setAttachMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAttachMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [attachMenuOpen]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current !== null) clearInterval(recordTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const typingPeers = useMemo(() => {
    const now = Date.now();
    if (targetPeer) {
      return targetPeer.typingUntil > now &&
        targetPeer.typingChannelId === activeChannelId
        ? [targetPeer]
        : [];
    }
    return onlinePeers.filter(
      (p) => p.typingUntil > now && p.typingChannelId === activeChannelId,
    );
  }, [activeChannelId, onlinePeers, targetPeer]);

  const connectionSummary = useMemo(() => {
    if (targetPeer) {
      if (targetPeer.dataChannelOpen) return 'WebRTC Direct · In-site only';
      if (targetPeer.sameDevice) return 'Same-Device Channel · In-site only';
      return 'Direct Live · In-site only';
    }
    if (activeChannelId !== 'lounge') {
      return 'Offline right now · In-site only';
    }
    const directCount = onlinePeers.filter((p) => p.dataChannelOpen).length;
    if (directCount > 0) {
      return `${onlinePeers.length + 1} online · ${directCount} WebRTC direct`;
    }
    if (onlinePeers.length > 0) {
      return `${onlinePeers.length + 1} online · Real-time sync`;
    }
    return 'Scan QR or open on another device · In-site only';
  }, [activeChannelId, onlinePeers, targetPeer]);

  const clearPending = () => {
    if (pendingMedia?.previewUrl) {
      URL.revokeObjectURL(pendingMedia.previewUrl);
    }
    setPendingMedia(null);
  };

  const handleSelectedFile = async (file: File | undefined) => {
    if (!file) return;
    setMediaError('');
    try {
      const prepared = await prepareMediaAttachment(file);
      clearPending();
      const previewUrl = URL.createObjectURL(file);
      setPendingMedia({
        attachment: prepared.attachment,
        blob: prepared.blob,
        previewUrl,
      });
      textareaRef.current?.focus();
    } catch (err) {
      setMediaError(
        err instanceof Error ? err.message : 'Unable to attach file.',
      );
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void handleSelectedFile(file);
          return;
        }
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      void handleSelectedFile(file);
    }
  };

  const startVoiceRecording = async () => {
    setMediaError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMediaError('Voice recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedAudioMime();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recordChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      recordStartRef.current = Date.now();
      setRecordMs(0);
      setIsRecording(true);

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          recordChunksRef.current.push(ev.data);
        }
      };

      recordTimerRef.current = window.setInterval(() => {
        setRecordMs(Date.now() - recordStartRef.current);
      }, 250);

      recorder.start(250);
    } catch {
      setMediaError('Microphone permission denied or unavailable.');
    }
  };

  const finishVoiceRecording = async (shouldSend: boolean) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    if (recordTimerRef.current !== null) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    const durationMs = Math.max(500, Date.now() - recordStartRef.current);
    setIsRecording(false);
    setRecordMs(0);

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        resolve();
      }
    });

    recorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;

    if (!shouldSend || recordChunksRef.current.length === 0) {
      recordChunksRef.current = [];
      return;
    }

    const blob = new Blob(recordChunksRef.current, {
      type: recorder.mimeType || 'audio/webm',
    });
    recordChunksRef.current = [];

    const prepared = await prepareMediaAttachment(
      blob,
      `voice-${Date.now()}.webm`,
      durationMs,
    );

    onSendMessage(
      '',
      prepared.attachment,
      prepared.blob,
      replyingTo ?? undefined,
    );
    setReplyingTo(null);
  };

  const submitMessage = () => {
    const text = draft.trim();
    if (!text && !pendingMedia) return;

    onSendMessage(
      text,
      pendingMedia?.attachment,
      pendingMedia?.blob,
      replyingTo ?? undefined,
    );
    setDraft('');
    clearPending();
    setReplyingTo(null);
    setMediaError('');
    onTypingChange(false);

    if (typingTimeoutRef.current !== null) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDraft(val);

    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;

    onTypingChange(val.trim().length > 0);
    if (typingTimeoutRef.current !== null) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      onTypingChange(false);
    }, 1800);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitMessage();
    }
  };

  const scrollToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <section
      className="relative flex-1 flex flex-col h-full min-w-0 bg-slate-50 dark:bg-slate-950"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-30 bg-blue-600/10 backdrop-blur-[2px] border-2 border-dashed border-blue-600 m-3 rounded-xl flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-6 py-4 text-center">
            <p className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Drop any photo, video, or file to send
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Stays private inside the site with zero MB limits
            </p>
          </div>
        </div>
      )}

      {/* Top Chat Header */}
      <header className="px-4 sm:px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            aria-label="Open people list"
            className="lg:hidden p-2 -ml-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <h1 className="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white truncate">
              {channelTitle}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {connectionSummary}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setSearchOpen((v) => !v);
              if (searchOpen) setSearchQuery('');
            }}
            aria-label="Search messages"
            className={`p-2 rounded-lg border text-xs transition-colors shrink-0 ${
              searchOpen
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-600/10'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          {channelMessages.length > 0 && (
            <button
              type="button"
              onClick={onClearChannel}
              aria-label="Delete messages in this chat"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenQr}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>QR Connect</span>
          </button>
        </div>
      </header>

      {/* Optional In-Chat Search Bar */}
      {searchOpen && (
        <div className="px-4 sm:px-6 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages or media names..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white px-2 py-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        {channelMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center space-y-4">
              <div className="space-y-1.5">
                <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                  {searchQuery.trim()
                    ? 'No matching messages'
                    : targetPeer
                      ? `Chat directly with ${targetPeer.name}`
                      : `Signed in as ${localName}`}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  {searchQuery.trim()
                    ? `No messages matched "${searchQuery}".`
                    : targetPeer
                      ? `Send text, photos, videos, or voice notes directly to ${targetPeer.name}. Nothing is saved to device gallery or exported.`
                      : onlinePeers.length > 0
                        ? 'Pick someone online below for a 1-to-1 chat, or send a message here in Everyone Online.'
                        : 'Show your QR code so friends can scan with Google Lens or phone camera and chat directly with you.'}
                </p>
              </div>

              {!searchQuery.trim() && !targetPeer && onlinePeers.length > 0 && (
                <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
                  {onlinePeers.slice(0, 6).map((peer) => (
                    <button
                      key={peer.peerId}
                      type="button"
                      onClick={() =>
                        onSelectChannel(getDmChannelId(localPeerId, peer.peerId))
                      }
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-600 dark:hover:border-blue-500 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      Message {peer.name}
                    </button>
                  ))}
                </div>
              )}

              {!searchQuery.trim() && !targetPeer && onlinePeers.length === 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={onOpenQr}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Show My QR Code</span>
                  </button>

                  <a
                    href={secondTabUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open 2nd Account Tab</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {channelMessages.map((msg, idx) => {
              const prev = idx > 0 ? channelMessages[idx - 1] : null;
              const isOwn = msg.senderId === localPeerId;
              const showDateDivider =
                !prev ||
                new Date(prev.timestamp).toDateString() !==
                  new Date(msg.timestamp).toDateString();
              const isGrouped =
                prev &&
                !showDateDivider &&
                prev.senderId === msg.senderId &&
                msg.timestamp - prev.timestamp < 120000;

              const reactionEntries = Object.entries(msg.reactions ?? {}).filter(
                ([, users]) => users.length > 0,
              );

              return (
                <React.Fragment key={msg.id}>
                  {showDateDivider && (
                    <div className="flex items-center justify-center py-2">
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                        {formatDateLabel(msg.timestamp)}
                      </span>
                    </div>
                  )}

                  <div
                    id={`msg-${msg.id}`}
                    tabIndex={0}
                    className={`group flex flex-col focus:outline-none ${
                      isOwn ? 'items-end' : 'items-start'
                    } ${isGrouped ? '-mt-2.5' : ''}`}
                  >
                    {!isGrouped && (
                      <div className="flex items-center gap-2 mb-1 px-1 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {isOwn ? 'You' : msg.senderName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                    )}

                    <div
                      className={`flex items-end gap-2 max-w-[90%] sm:max-w-[78%] ${
                        isOwn ? 'flex-row-reverse' : 'flex-row'
                      }`}
                    >
                      <div
                        className={`rounded-xl px-3.5 py-2.5 text-[15px] leading-relaxed break-words space-y-2 ${
                          isOwn
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {msg.replyTo && (
                          <button
                            type="button"
                            onClick={() => scrollToMessage(msg.replyTo!.messageId)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-90 ${
                              isOwn
                                ? 'bg-blue-700/70 text-blue-50'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            <div className="font-semibold truncate">
                              {msg.replyTo.senderName}
                            </div>
                            <div className="truncate opacity-85">
                              {msg.replyTo.preview}
                            </div>
                          </button>
                        )}

                        {msg.attachment && (
                          <PrivateAttachmentView
                            attachment={msg.attachment}
                            transferProgress={msg.transferProgress}
                            isOwn={isOwn}
                            onOpenImage={(src, name) =>
                              setLightboxImage({ src, name })
                            }
                          />
                        )}

                        {msg.text && (
                          <div className="whitespace-pre-wrap">{msg.text}</div>
                        )}
                      </div>

                      <div className="opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-1 py-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setReplyingTo({
                              messageId: msg.id,
                              senderName: isOwn ? localName : msg.senderName,
                              preview:
                                msg.text ||
                                (msg.attachment
                                  ? `[${msg.attachment.kind}] ${msg.attachment.name}`
                                  : ''),
                            })
                          }
                          aria-label="Reply to message"
                          className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Reply className="w-3.5 h-3.5" />
                        </button>
                        {QUICK_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => onToggleReaction(msg.id, emoji)}
                            className="px-1 py-0.5 text-xs rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {emoji}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => onDeleteMessage(msg.id)}
                          aria-label="Delete message for everyone"
                          className="p-1 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {reactionEntries.length > 0 && (
                      <div className="mt-1 px-1 flex flex-wrap items-center gap-1.5">
                        {reactionEntries.map(([emoji, peerList]) => {
                          const iReacted = peerList.includes(localPeerId);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => onToggleReaction(msg.id, emoji)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs transition-colors ${
                                iReacted
                                  ? 'border-blue-600 bg-blue-600/10 text-blue-700 dark:text-blue-300'
                                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              <span>{emoji}</span>
                              <span className="font-mono text-[11px] tabular-nums">
                                {peerList.length}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-1 px-1 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                      {isGrouped && <span>{formatTime(msg.timestamp)}</span>}
                      {!isOwn && <span>{transportText(msg.transport)}</span>}
                      {isOwn && (
                        <span className="inline-flex items-center gap-1">
                          {msg.transferProgress !== undefined ? (
                            <span>Sending {msg.transferProgress}%</span>
                          ) : msg.status === 'delivered' ? (
                            <>
                              <CheckCheck className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                              <span>Delivered</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3 h-3" />
                              <span>Sent</span>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer & Previews */}
      <footer className="px-4 sm:px-6 pb-4 pt-2 bg-slate-50 dark:bg-slate-950 shrink-0">
        <div className="max-w-3xl mx-auto space-y-2">
          <div className="min-h-[20px] px-1 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {typingPeers.length > 0 && (
                <>
                  {typingPeers.map((p) => p.name).join(', ')}{' '}
                  {typingPeers.length === 1 ? 'is' : 'are'} typing...
                </>
              )}
            </span>
            {mediaError && (
              <span className="text-red-600 dark:text-red-400" role="alert">
                {mediaError}
              </span>
            )}
          </div>

          {replyingTo && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
              <div className="min-w-0">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Replying to {replyingTo.senderName}:{' '}
                </span>
                <span className="text-slate-500 dark:text-slate-400 truncate">
                  {replyingTo.preview}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                aria-label="Cancel reply"
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {pendingMedia && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3 min-w-0">
                {pendingMedia.attachment.kind === 'image' ? (
                  <img
                    src={pendingMedia.previewUrl}
                    alt={pendingMedia.attachment.name}
                    className="w-12 h-12 rounded-md object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                    {pendingMedia.attachment.name}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {formatFileSize(pendingMedia.attachment.size)} · Stays in site only
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={clearPending}
                aria-label="Remove attachment"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Hidden File Inputs (No size limits) */}
          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void handleSelectedFile(file);
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void handleSelectedFile(file);
            }}
          />

          {isRecording ? (
            <div className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-red-500/60 rounded-xl px-4 py-2.5">
              <div className="flex items-center gap-2.5 text-sm font-medium text-red-600 dark:text-red-400">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                <span>Recording voice note</span>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {formatDuration(recordMs)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void finishVoiceRecording(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void finishVoiceRecording(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Send Voice</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="relative flex items-end gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/15 transition-shadow">
              <div ref={attachMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setAttachMenuOpen((v) => !v)}
                  aria-label="Open media and file options"
                  aria-expanded={attachMenuOpen}
                  className={`p-2 rounded-lg transition-colors ${
                    attachMenuOpen
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Plus
                    className={`w-5 h-5 transition-transform duration-150 ${
                      attachMenuOpen ? 'rotate-45' : ''
                    }`}
                  />
                </button>

                {attachMenuOpen && (
                  <div
                    role="menu"
                    className="absolute bottom-12 left-0 z-30 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1.5 shadow-lg space-y-0.5"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        onOpenCamera();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <Camera className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span>Camera (Photo / Video)</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        mediaInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <ImageIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>Photo & Video</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <Paperclip className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>Any File</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        void startVoiceRecording();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <Mic className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                      <span>Voice Note</span>
                    </button>
                  </div>
                )}
              </div>

              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={`Message ${channelTitle}...`}
                className="flex-1 min-w-0 resize-none bg-transparent px-2 py-2 text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none max-h-[140px]"
              />

              {!draft.trim() && !pendingMedia ? (
                <button
                  type="button"
                  onClick={() => void startVoiceRecording()}
                  aria-label="Record voice note"
                  className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors shrink-0"
                >
                  <Mic className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submitMessage}
                  aria-label="Send message"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
                >
                  <span className="hidden sm:inline">Send</span>
                  <SendHorizontal className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </footer>

      {/* View-Only Image Lightbox (No Download Button) */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xs flex flex-col items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="w-full max-w-4xl flex items-center justify-between gap-4 pb-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-medium truncate">
              {lightboxImage.name}
            </span>
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              aria-label="Close preview"
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <img
            src={lightboxImage.src}
            alt={lightboxImage.name}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-full rounded-lg object-contain select-none"
          />
        </div>
      )}
    </section>
  );
};
