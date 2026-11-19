import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatArea } from './components/ChatArea';
import { ManualPairModal } from './components/ManualPairModal';
import { OnboardingView } from './components/OnboardingView';
import { Sidebar } from './components/Sidebar';
import { generatePeerId, getDmChannelId } from './lib/crypto';
import { P2PChatEngine } from './lib/p2pEngine';
import {
  clearAllLocalData,
  clearRoomMessages,
  exportAllLocalData,
  getStorageStats,
  loadContacts,
  loadMessages,
  loadProfile,
  loadRooms,
  saveMessages,
  saveProfile,
  saveRoom,
  StoredContact,
  upsertContact,
} from './lib/storage';
import {
  ChatMessage,
  PeerInfo,
  RoomMeta,
  StorageStats,
  UserProfile,
} from './types/chat';

function getInitialUrlParams(): { room: string; isNewTabIdentity: boolean } {
  const params = new URLSearchParams(window.location.search);
  const rawRoom = params.get('room') ?? 'lobby';
  const cleanRoom = rawRoom.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '') || 'lobby';
  const isNewTabIdentity = params.get('as') === 'new';
  return { room: cleanRoom, isNewTabIdentity };
}

function loadSessionProfileOverride(): UserProfile | null {
  try {
    const raw = sessionStorage.getItem('varta_session_profile');
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

function saveSessionProfileOverride(profile: UserProfile): void {
  try {
    sessionStorage.setItem('varta_session_profile', JSON.stringify(profile));
  } catch {
    // Ignore
  }
}

export default function App() {
  const initialParams = useMemo(() => getInitialUrlParams(), []);

  const [profile, setProfile] = useState<UserProfile | null>(() => {
    const sessionOverride = loadSessionProfileOverride();
    if (sessionOverride) return sessionOverride;
    if (initialParams.isNewTabIdentity) return null;
    return loadProfile();
  });

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const existing = loadSessionProfileOverride() ?? loadProfile();
    if (existing?.theme) return existing.theme;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  const [activeRoom, setActiveRoom] = useState<string>(initialParams.room);
  const [activeChannelId, setActiveChannelId] = useState<string>('room');
  const [rooms, setRooms] = useState<RoomMeta[]>(() => loadRooms());
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadMessages(initialParams.room),
  );
  const [onlinePeers, setOnlinePeers] = useState<PeerInfo[]>([]);
  const [savedContacts, setSavedContacts] = useState<StoredContact[]>(() =>
    loadContacts(),
  );
  const [storageStats, setStorageStats] = useState<StorageStats>(() =>
    getStorageStats(),
  );
  const [connectedRelays, setConnectedRelays] = useState<number>(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [manualPairOpen, setManualPairOpen] = useState<boolean>(false);

  const engineRef = useRef<P2PChatEngine | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const activeRoomRef = useRef<string>(activeRoom);
  activeRoomRef.current = activeRoom;

  // Sync Tailwind dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const refreshStats = useCallback(() => {
    setStorageStats(getStorageStats());
  }, []);

  const syncRoomQueryParam = useCallback((roomCode: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomCode);
    url.searchParams.delete('as');
    window.history.replaceState({}, '', url.toString());
  }, []);

  // Initialize and manage P2P Engine when profile & activeRoom are ready
  useEffect(() => {
    if (!profile) return;

    const currentMsgs = loadMessages(activeRoom);
    setMessages(currentMsgs);
    setRooms(saveRoom(activeRoom));
    refreshStats();
    syncRoomQueryParam(activeRoom);

    const engine = new P2PChatEngine(profile.peerId, profile.name, {
      onPeersChange: (peers) => {
        setOnlinePeers(peers);
        for (const p of peers) {
          setSavedContacts(upsertContact(p, activeRoomRef.current));
        }
      },
      onMessageReceived: (incoming) => {
        const room = activeRoomRef.current;
        if (incoming.roomCode !== room) return;

        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev;
          const next = [...prev, incoming].sort((a, b) => a.timestamp - b.timestamp);
          saveMessages(room, next);
          return next;
        });

        setRooms(
          saveRoom(
            room,
            `${incoming.senderName}: ${incoming.text.slice(0, 48)}`,
            incoming.timestamp,
          ),
        );
        setSavedContacts(
          upsertContact(
            {
              peerId: incoming.senderId,
              name: incoming.senderName,
              lastSeen: incoming.timestamp,
            },
            room,
          ),
        );
        refreshStats();
      },
      onMessageAcked: (messageId) => {
        const room = activeRoomRef.current;
        setMessages((prev) => {
          let changed = false;
          const next = prev.map((m) => {
            if (m.id === messageId && m.status !== 'delivered') {
              changed = true;
              return { ...m, status: 'delivered' as const };
            }
            return m;
          });
          if (changed) {
            saveMessages(room, next);
          }
          return changed ? next : prev;
        });
      },
      onRelayStatusChange: (count) => {
        setConnectedRelays(count);
      },
    });

    engineRef.current = engine;
    void engine.joinRoom(activeRoom, currentMsgs);

    return () => {
      engine.leaveRoom();
      engineRef.current = null;
    };
  }, [profile?.peerId, activeRoom, refreshStats, syncRoomQueryParam]);

  // Keep engine name synced without tearing down connections
  useEffect(() => {
    if (profile && engineRef.current) {
      engineRef.current.updateLocalName(profile.name);
    }
  }, [profile?.name]);

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    if (profile) {
      const updated: UserProfile = { ...profile, theme: nextTheme };
      setProfile(updated);
      if (initialParams.isNewTabIdentity || loadSessionProfileOverride()) {
        saveSessionProfileOverride(updated);
      } else {
        saveProfile(updated);
      }
    }
  };

  const handleCompleteOnboarding = (name: string, roomCode: string) => {
    const newProfile: UserProfile = {
      peerId: generatePeerId(),
      name,
      theme,
      createdAt: Date.now(),
    };

    if (initialParams.isNewTabIdentity) {
      saveSessionProfileOverride(newProfile);
    } else {
      saveProfile(newProfile);
    }

    setActiveRoom(roomCode);
    setActiveChannelId('room');
    setProfile(newProfile);
  };

  const handleUpdateName = (name: string) => {
    if (!profile) return;
    const updated: UserProfile = { ...profile, name };
    setProfile(updated);
    if (initialParams.isNewTabIdentity || loadSessionProfileOverride()) {
      saveSessionProfileOverride(updated);
    } else {
      saveProfile(updated);
    }
  };

  const handleSwitchRoom = (roomCode: string) => {
    const clean = roomCode.trim().toLowerCase();
    if (!clean || clean === activeRoom) return;
    setActiveRoom(clean);
    setActiveChannelId('room');
  };

  const targetPeer = useMemo(() => {
    if (!profile || activeChannelId === 'room') return null;
    return (
      onlinePeers.find(
        (p) => getDmChannelId(profile.peerId, p.peerId) === activeChannelId,
      ) ?? null
    );
  }, [activeChannelId, onlinePeers, profile]);

  const channelTitle = useMemo(() => {
    if (activeChannelId === 'room') return `# ${activeRoom}`;
    if (targetPeer) return `@ ${targetPeer.name}`;
    if (profile) {
      const offline = savedContacts.find(
        (c) => getDmChannelId(profile.peerId, c.peerId) === activeChannelId,
      );
      if (offline) return `@ ${offline.name}`;
    }
    return 'Direct Message';
  }, [activeChannelId, activeRoom, profile, savedContacts, targetPeer]);

  const handleSendMessage = (text: string) => {
    if (!profile) return;
    const msgId = `${profile.peerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const outbound: ChatMessage = {
      id: msgId,
      roomCode: activeRoom,
      channelId: activeChannelId,
      senderId: profile.peerId,
      senderName: profile.name,
      text,
      timestamp: now,
      status: 'sent',
      transport: targetPeer?.dataChannelOpen ? 'webrtc' : 'local',
    };

    const nextMessages = [...messagesRef.current, outbound];
    setMessages(nextMessages);
    saveMessages(activeRoom, nextMessages);
    setRooms(saveRoom(activeRoom, `You: ${text.slice(0, 48)}`, now));
    refreshStats();

    void engineRef.current?.sendMessage(
      {
        id: outbound.id,
        roomCode: outbound.roomCode,
        channelId: outbound.channelId,
        senderId: outbound.senderId,
        senderName: outbound.senderName,
        text: outbound.text,
        timestamp: outbound.timestamp,
      },
      targetPeer?.peerId,
    );
  };

  const handleTypingChange = (isTyping: boolean) => {
    engineRef.current?.sendTyping(
      activeChannelId,
      isTyping,
      targetPeer?.peerId,
    );
  };

  const handleClearChannel = () => {
    if (activeChannelId === 'room') {
      const remaining = messagesRef.current.filter((m) => m.channelId !== 'room');
      if (remaining.length === 0) {
        clearRoomMessages(activeRoom);
      } else {
        saveMessages(activeRoom, remaining);
      }
      setMessages(remaining);
    } else {
      const remaining = messagesRef.current.filter(
        (m) => m.channelId !== activeChannelId,
      );
      saveMessages(activeRoom, remaining);
      setMessages(remaining);
    }
    refreshStats();
  };

  const handleExportData = () => {
    const json = exportAllLocalData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `varta-local-chats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearAllData = () => {
    engineRef.current?.leaveRoom();
    clearAllLocalData();
    try {
      sessionStorage.removeItem('varta_session_profile');
    } catch {
      // Ignore
    }
    setMessages([]);
    setRooms([]);
    setSavedContacts([]);
    setOnlinePeers([]);
    setProfile(null);
    refreshStats();
  };

  const inviteUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', activeRoom);
    url.searchParams.set('as', 'new');
    return url.toString();
  }, [activeRoom]);

  if (!profile) {
    return (
      <OnboardingView
        initialRoom={activeRoom}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onComplete={handleCompleteOnboarding}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Sidebar
        profile={profile}
        activeRoom={activeRoom}
        activeChannelId={activeChannelId}
        rooms={rooms}
        onlinePeers={onlinePeers}
        savedContacts={savedContacts}
        storageStats={storageStats}
        connectedRelays={connectedRelays}
        isOpenMobile={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onUpdateName={handleUpdateName}
        onToggleTheme={handleToggleTheme}
        onSelectChannel={setActiveChannelId}
        onSwitchRoom={handleSwitchRoom}
        onExportData={handleExportData}
        onClearAllData={handleClearAllData}
      />

      <ChatArea
        localPeerId={profile.peerId}
        localName={profile.name}
        activeRoom={activeRoom}
        activeChannelId={activeChannelId}
        channelTitle={channelTitle}
        targetPeer={targetPeer}
        onlinePeers={onlinePeers}
        messages={messages}
        inviteUrl={inviteUrl}
        onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        onOpenManualPair={() => setManualPairOpen(true)}
        onSendMessage={handleSendMessage}
        onTypingChange={handleTypingChange}
        onClearChannel={handleClearChannel}
      />

      <ManualPairModal
        isOpen={manualPairOpen}
        onClose={() => setManualPairOpen(false)}
        onCreateOffer={() => {
          if (!engineRef.current) {
            return Promise.reject(new Error('Chat engine not ready'));
          }
          return engineRef.current.createManualOffer();
        }}
        onAcceptOfferCreateAnswer={(offer) => {
          if (!engineRef.current) {
            return Promise.reject(new Error('Chat engine not ready'));
          }
          return engineRef.current.acceptManualOfferAndCreateAnswer(offer);
        }}
        onAcceptAnswer={(answer) => {
          if (!engineRef.current) {
            return Promise.reject(new Error('Chat engine not ready'));
          }
          return engineRef.current.acceptManualAnswer(answer);
        }}
      />
    </div>
  );
}
