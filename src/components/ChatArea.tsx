import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Copy,
  ExternalLink,
  Link2,
  Menu,
  SendHorizontal,
  Trash2,
} from 'lucide-react';
import { ChatMessage, PeerInfo, TransportKind } from '../types/chat';

interface ChatAreaProps {
  localPeerId: string;
  localName: string;
  activeRoom: string;
  activeChannelId: string;
  channelTitle: string;
  targetPeer: PeerInfo | null;
  onlinePeers: PeerInfo[];
  messages: ChatMessage[];
  inviteUrl: string;
  onOpenMobileSidebar: () => void;
  onOpenManualPair: () => void;
  onSendMessage: (text: string) => void;
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
    case 'gun':
      return 'Mesh';
    default:
      return 'Saved';
  }
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  localPeerId,
  localName,
  activeRoom,
  activeChannelId,
  channelTitle,
  targetPeer,
  onlinePeers,
  messages,
  inviteUrl,
  onOpenMobileSidebar,
  onOpenManualPair,
  onSendMessage,
  onTypingChange,
  onClearChannel,
}) => {
  const [draft, setDraft] = useState('');
  const [copiedInvite, setCopiedInvite] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  const channelMessages = useMemo(
    () => messages.filter((m) => m.channelId === activeChannelId),
    [messages, activeChannelId],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages.length, activeChannelId]);

  const typingPeers = useMemo(() => {
    const now = Date.now();
    if (targetPeer) {
      return targetPeer.typingUntil > now ? [targetPeer] : [];
    }
    return onlinePeers.filter((p) => p.typingUntil > now);
  }, [onlinePeers, targetPeer]);

  const connectionSummary = useMemo(() => {
    if (targetPeer) {
      if (targetPeer.dataChannelOpen) return 'WebRTC Direct · Saved locally';
      if (targetPeer.sameDevice) return 'Same-Device Channel · Saved locally';
      return 'Mesh Relay · Saved locally';
    }
    const directCount = onlinePeers.filter((p) => p.dataChannelOpen).length;
    if (directCount > 0) {
      return `${onlinePeers.length + 1} in room · ${directCount} WebRTC direct`;
    }
    if (onlinePeers.length > 0) {
      return `${onlinePeers.length + 1} in room · Real-time sync`;
    }
    return `Waiting for peers in ${activeRoom} · Saved locally`;
  }, [activeRoom, onlinePeers, targetPeer]);

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const submitMessage = () => {
    const text = draft.trim();
    if (!text) return;
    onSendMessage(text);
    setDraft('');
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

  return (
    <section className="flex-1 flex flex-col h-full min-w-0 bg-slate-50 dark:bg-slate-950">
      {/* Top Chat Header */}
      <header className="px-4 sm:px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            aria-label="Open conversations menu"
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
            onClick={onOpenManualPair}
            aria-label="Pair manually via WebRTC code"
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pair Manually</span>
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
            onClick={() => void handleCopyInvite()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            {copiedInvite ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedInvite ? 'Link Copied' : 'Share Invite'}</span>
          </button>
        </div>
      </header>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        {channelMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center space-y-4">
              <div className="space-y-1.5">
                <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                  Ready to chat as {localName}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  Send this invite link to another device or open it in a second browser tab. Once they enter their name, messages flow directly in real time.
                </p>
              </div>

              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-600 dark:text-slate-300 truncate">
                {inviteUrl}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => void handleCopyInvite()}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
                >
                  {copiedInvite ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedInvite ? 'Copied' : 'Copy Invite Link'}</span>
                </button>

                <a
                  href={inviteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Second Tab</span>
                </a>
              </div>
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
                    className={`flex flex-col ${
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
                      className={`group max-w-[82%] sm:max-w-[70%] px-3.5 py-2.5 rounded-xl text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
                        isOwn
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {msg.text}
                    </div>

                    <div className="mt-1 px-1 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                      {isGrouped && <span>{formatTime(msg.timestamp)}</span>}
                      {!isOwn && (
                        <span>{transportText(msg.transport)}</span>
                      )}
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

      {/* Typing + Message Composer */}
      <footer className="px-4 sm:px-6 pb-4 pt-2 bg-slate-50 dark:bg-slate-950 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="h-5 px-1 mb-1 flex items-center text-xs text-slate-500 dark:text-slate-400">
            {typingPeers.length > 0 && (
              <span>
                {typingPeers.map((p) => p.name).join(', ')}{' '}
                {typingPeers.length === 1 ? 'is' : 'are'} typing...
              </span>
            )}
          </div>

          <div className="flex items-end gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/15 transition-shadow">
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={handleDraftChange}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${channelTitle}...`}
              className="flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none max-h-[140px]"
            />

            <button
              type="button"
              disabled={!draft.trim()}
              onClick={submitMessage}
              aria-label="Send message"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
            >
              <span>Send</span>
              <SendHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
};
