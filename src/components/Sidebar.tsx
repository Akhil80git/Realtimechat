import React, { useState } from 'react';
import {
  Check,
  ExternalLink,
  Hash,
  Moon,
  Pencil,
  QrCode,
  Search,
  Sun,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { PeerInfo, StorageStats, StoredContact, UserProfile } from '../types/chat';
import { getDmChannelId } from '../lib/crypto';
import { formatFileSize } from '../lib/media';

interface SidebarProps {
  profile: UserProfile;
  activeChannelId: string;
  onlinePeers: PeerInfo[];
  savedContacts: StoredContact[];
  unreadByChannel: Record<string, number>;
  storageStats: StorageStats;
  meshConnected: boolean;
  meshLabel: string;
  secondTabUrl: string;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onUpdateName: (name: string) => void;
  onToggleTheme: () => void;
  onOpenQr: () => void;
  onSelectChannel: (channelId: string) => void;
  onClearAllData: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  profile,
  activeChannelId,
  onlinePeers,
  savedContacts,
  unreadByChannel,
  storageStats,
  meshConnected,
  meshLabel,
  secondTabUrl,
  isOpenMobile,
  onCloseMobile,
  onUpdateName,
  onToggleTheme,
  onOpenQr,
  onSelectChannel,
  onClearAllData,
}) => {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = draftName.trim();
    if (clean) {
      onUpdateName(clean);
    } else {
      setDraftName(profile.name);
    }
    setEditingName(false);
  };

  const normalizedQuery = userSearch.trim().toLowerCase();

  const filteredOnlinePeers = normalizedQuery
    ? onlinePeers.filter((p) => p.name.toLowerCase().includes(normalizedQuery))
    : onlinePeers;

  const onlineIds = new Set(onlinePeers.map((p) => p.peerId));
  const offlineSaved = savedContacts.filter((c) => {
    if (c.peerId === profile.peerId || onlineIds.has(c.peerId)) return false;
    return normalizedQuery
      ? c.name.toLowerCase().includes(normalizedQuery)
      : true;
  });

  const loungeUnread = unreadByChannel.lounge ?? 0;

  const sidebarContent = (
    <aside className="w-[290px] h-full flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 select-none">
      {/* Brand + Theme */}
      <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          Varta
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenQr}
            aria-label="Show your QR code"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>QR</span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={profile.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {profile.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close sidebar"
            className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Your Account */}
      <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800">
        {editingName ? (
          <form onSubmit={handleSaveName} className="flex items-center gap-1.5">
            <input
              type="text"
              autoFocus
              maxLength={32}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-md border border-blue-600 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Save name"
              className="p-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 shrink-0"
            >
              <Check className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                {profile.name}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {meshConnected ? `Online · ${meshLabel}` : meshLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setDraftName(profile.name);
                setEditingName(true);
              }}
              aria-label="Edit your username"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* People & Public Lounge */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {/* Username Search */}
        <div className="px-1">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus-within:border-blue-600">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search username..."
              aria-label="Search username"
              className="flex-1 min-w-0 bg-transparent text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
            />
            {userSearch && (
              <button
                type="button"
                onClick={() => setUserSearch('')}
                aria-label="Clear username search"
                className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Public Group Lounge */}
        <div>
          <div className="px-2 mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            Group Lounge
          </div>
          <button
            type="button"
            onClick={() => {
              onSelectChannel('lounge');
              onCloseMobile();
            }}
            className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition-colors ${
              activeChannelId === 'lounge'
                ? 'bg-blue-600/10 text-blue-700 dark:text-blue-300 font-medium'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Hash className="w-4 h-4 shrink-0 opacity-70" />
              <span className="truncate">Everyone Online</span>
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
              {loungeUnread > 0 ? `${loungeUnread} new` : onlinePeers.length + 1}
            </span>
          </button>
        </div>

        {/* Live People Directory */}
        <div>
          <div className="px-2 mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              People Online
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
              {filteredOnlinePeers.length}
            </span>
          </div>

          {filteredOnlinePeers.length === 0 ? (
            <div className="px-2.5 py-2 space-y-2">
              <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
                {normalizedQuery
                  ? `No online user matched "${userSearch}".`
                  : 'Share your QR code or site link. Anyone who opens it appears here automatically.'}
              </p>
              {!normalizedQuery && (
                <a
                  href={secondTabUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open 2nd account tab</span>
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredOnlinePeers.map((peer) => {
                const dmId = getDmChannelId(profile.peerId, peer.peerId);
                const isSelected = activeChannelId === dmId;
                const unread = unreadByChannel[dmId] ?? 0;
                const isTyping =
                  peer.typingUntil > Date.now() && peer.typingChannelId === dmId;
                const transportLabel = peer.dataChannelOpen
                  ? 'WebRTC direct'
                  : peer.sameDevice
                    ? 'Same device'
                    : 'Direct live';

                return (
                  <button
                    key={peer.peerId}
                    type="button"
                    onClick={() => {
                      onSelectChannel(dmId);
                      onCloseMobile();
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                      isSelected
                        ? 'bg-blue-600/10 text-blue-700 dark:text-blue-300'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0">
                        {peer.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {peer.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {isTyping ? 'Typing...' : transportLabel}
                        </div>
                      </div>
                    </div>

                    {unread > 0 && (
                      <span className="text-xs font-mono font-semibold tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Saved Offline Contacts */}
        {offlineSaved.length > 0 && (
          <div>
            <div className="px-2 mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              Recent Contacts
            </div>
            <div className="space-y-1">
              {offlineSaved.slice(0, 12).map((contact) => {
                const dmId = getDmChannelId(profile.peerId, contact.peerId);
                const isSelected = activeChannelId === dmId;
                const unread = unreadByChannel[dmId] ?? 0;

                return (
                  <button
                    key={contact.peerId}
                    type="button"
                    onClick={() => {
                      onSelectChannel(dmId);
                      onCloseMobile();
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition-colors ${
                      isSelected
                        ? 'bg-blue-600/10 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <User className="w-3.5 h-3.5 shrink-0 opacity-70" />
                      <span className="truncate">{contact.name}</span>
                    </span>
                    {unread > 0 && (
                      <span className="text-xs font-mono font-semibold tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Private Site Storage Footer (Delete-Only, No Export) */}
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5 bg-slate-50/70 dark:bg-slate-900">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>In-Site Storage</span>
          <span className="font-mono tabular-nums">
            {storageStats.messageCount} msgs · {formatFileSize(storageStats.totalBytes)}
          </span>
        </div>

        {confirmClearAll ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmClearAll(false)}
              className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmClearAll(false);
                onClearAllData();
              }}
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-medium text-white transition-colors whitespace-nowrap"
            >
              Confirm Delete
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClearAll(true)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete All Site Data</span>
          </button>
        )}
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block h-full shrink-0">{sidebarContent}</div>

      {isOpenMobile && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};
