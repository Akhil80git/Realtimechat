import React, { useState } from 'react';
import {
  Check,
  Download,
  Hash,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { PeerInfo, RoomMeta, StorageStats, UserProfile } from '../types/chat';
import { StoredContact } from '../lib/storage';
import { getDmChannelId } from '../lib/crypto';

interface SidebarProps {
  profile: UserProfile;
  activeRoom: string;
  activeChannelId: string;
  rooms: RoomMeta[];
  onlinePeers: PeerInfo[];
  savedContacts: StoredContact[];
  storageStats: StorageStats;
  connectedRelays: number;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onUpdateName: (name: string) => void;
  onToggleTheme: () => void;
  onSelectChannel: (channelId: string) => void;
  onSwitchRoom: (roomCode: string) => void;
  onExportData: () => void;
  onClearAllData: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const Sidebar: React.FC<SidebarProps> = ({
  profile,
  activeRoom,
  activeChannelId,
  rooms,
  onlinePeers,
  savedContacts,
  storageStats,
  connectedRelays,
  isOpenMobile,
  onCloseMobile,
  onUpdateName,
  onToggleTheme,
  onSelectChannel,
  onSwitchRoom,
  onExportData,
  onClearAllData,
}) => {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);
  const [newRoomInput, setNewRoomInput] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

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

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newRoomInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
    if (!clean) return;
    setNewRoomInput('');
    onSwitchRoom(clean);
    onCloseMobile();
  };

  const onlineIds = new Set(onlinePeers.map((p) => p.peerId));
  const offlineSaved = savedContacts.filter(
    (c) => c.peerId !== profile.peerId && !onlineIds.has(c.peerId),
  );

  const sidebarContent = (
    <aside className="w-[280px] h-full flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 select-none">
      {/* Brand + Theme */}
      <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          Varta
        </span>
        <div className="flex items-center gap-1.5">
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

      {/* Your Profile */}
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
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                ID {profile.peerId.slice(0, 8)} · {connectedRelays > 0 ? `${connectedRelays} mesh relay` : 'Local mesh'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setDraftName(profile.name);
                setEditingName(true);
              }}
              aria-label="Edit your display name"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Scrollable Channels & People */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* Current Room Channel */}
        <div>
          <div className="px-2 mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            Active Room
          </div>
          <button
            type="button"
            onClick={() => {
              onSelectChannel('room');
              onCloseMobile();
            }}
            className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition-colors ${
              activeChannelId === 'room'
                ? 'bg-blue-600/10 text-blue-700 dark:text-blue-300 font-medium'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Hash className="w-4 h-4 shrink-0 opacity-70" />
              <span className="truncate">{activeRoom}</span>
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
              {onlinePeers.length + 1}
            </span>
          </button>
        </div>

        {/* Live People in Room */}
        <div>
          <div className="px-2 mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              People Live Now
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
              {onlinePeers.length}
            </span>
          </div>

          {onlinePeers.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
              Waiting for someone to join <span className="font-mono">{activeRoom}</span>. Share the invite link so they appear here instantly.
            </p>
          ) : (
            <div className="space-y-1">
              {onlinePeers.map((peer) => {
                const dmId = getDmChannelId(profile.peerId, peer.peerId);
                const isSelected = activeChannelId === dmId;
                const transportLabel = peer.dataChannelOpen
                  ? 'WebRTC direct'
                  : peer.sameDevice
                    ? 'Same device'
                    : 'Mesh relay';

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
                          {peer.typingUntil > Date.now() ? 'Typing...' : transportLabel}
                        </div>
                      </div>
                    </div>
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
              {offlineSaved.slice(0, 6).map((contact) => {
                const dmId = getDmChannelId(profile.peerId, contact.peerId);
                const isSelected = activeChannelId === dmId;
                return (
                  <button
                    key={contact.peerId}
                    type="button"
                    onClick={() => {
                      onSelectChannel(dmId);
                      onCloseMobile();
                    }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-sm transition-colors ${
                      isSelected
                        ? 'bg-blue-600/10 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <User className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{contact.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Saved Rooms Switcher */}
        <div>
          <div className="px-2 mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            Rooms on Device
          </div>
          <div className="space-y-1 mb-2">
            {rooms.map((room) => (
              <button
                key={room.roomCode}
                type="button"
                onClick={() => {
                  onSwitchRoom(room.roomCode);
                  onCloseMobile();
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors ${
                  room.roomCode === activeRoom
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className="font-mono truncate"># {room.roomCode}</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleJoinRoom} className="flex items-center gap-1.5 px-1">
            <input
              type="text"
              maxLength={32}
              value={newRoomInput}
              onChange={(e) => setNewRoomInput(e.target.value)}
              placeholder="Join another room..."
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              aria-label="Join room"
              disabled={!newRoomInput.trim()}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>

      {/* LocalStorage Vault Footer */}
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5 bg-slate-50/70 dark:bg-slate-900">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Device Storage</span>
          <span className="font-mono tabular-nums">
            {storageStats.messageCount} msgs · {formatBytes(storageStats.totalBytes)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExportData}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>

          {confirmClearAll ? (
            <button
              type="button"
              onClick={() => {
                setConfirmClearAll(false);
                onClearAllData();
              }}
              onMouseLeave={() => setConfirmClearAll(false)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-medium text-white transition-colors whitespace-nowrap"
            >
              <span>Confirm Wipe</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Reset All</span>
            </button>
          )}
        </div>
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
