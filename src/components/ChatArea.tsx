import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Menu,
  Mic,
  Paperclip,
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
  prepareFileAttachment,
  readBlobAsDataUrl,
} from '../lib/media';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥'];

interface ChatAreaProps {
  localPeerId: string;
  localName: string;
  activeChannelId: string;
  channelTitle: string;
  targetPeer: PeerInfo | null;
  onlinePeers: PeerInfo[];
  messages: ChatMessage[];
  shareUrl: string;
  secondTabUrl: string;
  onOpenMobileSidebar: () => void;
  onSelectChannel: (channelId: string) => void;
  onSendMessage: (
    text: string,
    attachment?: ChatAttachment,
    replyTo?: ReplyRef,
  ) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
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

export const ChatArea: React.FC<ChatAreaProps> = ({
  localPeerId,
  localName,
  activeChannelId,
  channelTitle,
  targetPeer,
  onlinePeers,
  messages,
  shareUrl,
  secondTabUrl,
  onOpenMobileSidebar,
  onSelectChannel,
  onSendMessage,
  onToggleReaction,
  onTypingChange,
  onClearChannel,
}) => {
  const [draft, setDraft] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(
    null,
  );
  const [replyingTo, setReplyingTo] = useState<ReplyRef | null>(null);
  const [mediaError, setMediaError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    name: string;
  } | null>(null);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxImage(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxImage]);

  // Clean up voice recording on unmount
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
      if (targetPeer.dataChannelOpen) return 'WebRTC Direct · Saved locally';
      if (targetPeer.sameDevice) return 'Same-Device Channel · Saved locally';
      return 'Direct Live · Saved locally';
    }
    if (activeChannelId !== 'lounge') {
      return 'Offline right now · Saved locally';
    }
    const directCount = onlinePeers.filter((p) => p.dataChannelOpen).length;
    if (directCount > 0) {
      return `${onlinePeers.length + 1} online · ${directCount} WebRTC direct`;
    }
    if (onlinePeers.length > 0) {
      return `${onlinePeers.length + 1} online · Real-time sync`;
    }
    return 'Waiting for friends to open the site · Saved locally';
  }, [activeChannelId, onlinePeers, targetPeer]);

  const handleCopyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleSelectedFile = async (file: File | undefined) => {
    if (!file) return;
    setMediaError('');
    try {
      const prepared = await prepareFileAttachment(file);
      setPendingAttachment(prepared);
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
        const elapsed = Date.now() - recordStartRef.current;
        setRecordMs(elapsed);
        // Auto-stop at 60s to keep serverless P2P payloads lightweight
        if (elapsed >= 60000) {
          void finishVoiceRecording(true);
        }
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

    if (blob.size > 1.5 * 1024 * 1024) {
      setMediaError('Voice note exceeded 1.5 MB limit.');
      return;
    }

    const dataUrl = await readBlobAsDataUrl(blob);
    const voiceAttachment: ChatAttachment = {
      kind: 'voice',
      name: `voice-${Date.now()}.webm`,
      mimeType: blob.type,
      size: blob.size,
      dataUrl,
      durationMs,
    };

    onSendMessage('', voiceAttachment, replyingTo ?? undefined);
    setReplyingTo(null);
  };

  const submitMessage = () => {
    const text = draft.trim();
    if (!text && !pendingAttachment) return;

    onSendMessage(
      text,
      pendingAttachment ?? undefined,
      replyingTo ?? undefined,
    );
    setDraft('');
    setPendingAttachment(null);
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
      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-30 bg-blue-600/10 backdrop-blur-[2px] border-2 border-dashed border-blue-600 m-3 rounded-xl flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-6 py-4 text-center">
            <p className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Drop image or file to send
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Images are automatically optimized for instant P2P delivery
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
              aria-label="Clear messages in this chat"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleCopyShare()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Link Copied' : 'Share Site Link'}</span>
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
            placeholder="Search messages or filenames in this conversation..."
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
                      ? `Start chatting with ${targetPeer.name}`
                      : `Signed in as ${localName}`}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  {searchQuery.trim()
                    ? `No messages matched "${searchQuery}".`
                    : targetPeer
                      ? `Send text, photos, voice notes, or files directly to ${targetPeer.name}.`
                      : onlinePeers.length > 0
                        ? 'Pick someone online below for a 1-to-1 chat, or send a message here in Everyone Online.'
                        : 'Share this site link with friends on any phone or browser. As soon as they enter their name, they will appear here.'}
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
                    onClick={() => void handleCopyShare()}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Copied' : 'Copy Site Link'}</span>
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
                    className={`group flex flex-col ${
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
                        {/* Quoted Reply */}
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

                        {/* Image Attachment */}
                        {msg.attachment?.kind === 'image' && (
                          <button
                            type="button"
                            onClick={() =>
                              setLightboxImage({
                                src: msg.attachment!.dataUrl,
                                name: msg.attachment!.name,
                              })
                            }
                            className="block rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-white/60"
                          >
                            <img
                              src={msg.attachment.dataUrl}
                              alt={msg.attachment.name}
                              referrerPolicy="no-referrer"
                              className="max-h-72 w-auto max-w-full object-contain rounded-lg cursor-zoom-in"
                            />
                          </button>
                        )}

                        {/* Voice Attachment */}
                        {msg.attachment?.kind === 'voice' && (
                          <div className="min-w-[220px] space-y-1">
                            <audio
                              controls
                              src={msg.attachment.dataUrl}
                              className="w-full h-9"
                            />
                            {msg.attachment.durationMs !== undefined && (
                              <div
                                className={`text-[11px] font-mono tabular-nums ${
                                  isOwn
                                    ? 'text-blue-100'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                Voice note · {formatDuration(msg.attachment.durationMs)}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Generic File Attachment */}
                        {msg.attachment?.kind === 'file' && (
                          <a
                            href={msg.attachment.dataUrl}
                            download={msg.attachment.name}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                              isOwn
                                ? 'bg-blue-700/70 hover:bg-blue-700 text-white'
                                : 'bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100'
                            }`}
                          >
                            <FileText className="w-5 h-5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate">
                                {msg.attachment.name}
                              </div>
                              <div className="text-[11px] font-mono tabular-nums opacity-75">
                                {formatFileSize(msg.attachment.size)}
                              </div>
                            </div>
                            <Download className="w-4 h-4 shrink-0" />
                          </a>
                        )}

                        {/* Text */}
                        {msg.text && (
                          <div className="whitespace-pre-wrap">{msg.text}</div>
                        )}
                      </div>

                      {/* Quick Action Strip (Reply + Emojis) */}
                      <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-1 py-0.5 shrink-0">
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
                      </div>
                    </div>

                    {/* Reaction Counts */}
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

                    {/* Delivery & Transport Metadata */}
                    <div className="mt-1 px-1 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                      {isGrouped && <span>{formatTime(msg.timestamp)}</span>}
                      {!isOwn && <span>{transportText(msg.transport)}</span>}
                      {isOwn && (
                        <span className="inline-flex items-center gap-1">
                          {msg.status === 'delivered' ? (
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
          {/* Typing or Media Error Bar */}
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

          {/* Reply Preview */}
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

          {/* Pending Image/File Attachment Preview */}
          {pendingAttachment && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3 min-w-0">
                {pendingAttachment.kind === 'image' ? (
                  <img
                    src={pendingAttachment.dataUrl}
                    alt={pendingAttachment.name}
                    className="w-12 h-12 rounded-md object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                    {pendingAttachment.name}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {formatFileSize(pendingAttachment.size)} · Ready to send
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingAttachment(null)}
                aria-label="Remove attachment"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Hidden File Inputs */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
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

          {/* Main Input Row or Active Voice Recorder */}
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
            <div className="flex items-end gap-1.5 sm:gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/15 transition-shadow">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                aria-label="Send photo"
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                <ImageIcon className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach file"
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={`Message ${channelTitle}... (or paste/drop an image)`}
                className="flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none max-h-[140px]"
              />

              {!draft.trim() && !pendingAttachment ? (
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

      {/* Image Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-4"
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
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={lightboxImage.src}
                download={lightboxImage.name}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                aria-label="Close preview"
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <img
            src={lightboxImage.src}
            alt={lightboxImage.name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </section>
  );
};
