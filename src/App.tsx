import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatArea } from './components/ChatArea';
import { OnboardingView } from './components/OnboardingView';
import { Sidebar } from './components/Sidebar';
import { generatePeerId, getDmChannelId } from './lib/crypto';
import { P2PChatEngine } from './lib/p2pEngine';
import {
  clearAllLocalData,
  clearChannelMessages,
  exportAllLocalData,
  getStorageStats,
  loadAllMessages,
  loadContacts,
  loadProfile,
  saveAllMessages,
  saveProfile,
  upsertContact,
} from './lib/storage';
import {
  ChatMessage,
  PeerInfo,
  StorageStats,
  StoredContact,
  UserProfile,
} from './types/chat';

function isNewTabAccountMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('as') === 'new';
}

function loadSessionProfileOverride(): UserProfile | null {
  try {
    const raw = sessionStorage.getItem('varta_session_account_v2');
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

function saveSessionProfileOverride(profile: UserProfile): void {
  try {
    sessionStorage.setItem('varta_session_account_v2', JSON.stringify(profile));
  } catch {
    // Ignore
  }
}

export default function App() {
  const newTabMode = useMemo(() => isNewTabAccountMode(), []);

  const [profile, setProfile] = useState<UserProfile | null>(() => {
    const sessionOverride = loadSessionProfileOverride();
    if (sessionOverride) return sessionOverride;
    if (newTabMode) return null;
    return loadProfile();
  });

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const existing = loadSessionProfileOverride() ?? loadProfile();
    if (existing?.theme) return existing.theme;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  const [activeChannelId, setActiveChannelId] = useState<string>('lounge');
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadAllMessages());
  const [onlinePeers, setOnlinePeers] = useState<PeerInfo[]>([]);
  const [savedContacts, setSavedContacts] = useState<StoredContact[]>(() =>
    loadContacts(),
  );
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const [storageStats, setStorageStats] = useState<StorageStats>(() =>
    getStorageStats(),
  );
  const [meshConnected, setMeshConnected] = useState<boolean>(false);
  const [meshLabel, setMeshLabel] = useState<string>('Connecting...');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);

  const engineRef = useRef<P2PChatEngine | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const activeChannelRef = useRef<string>(activeChannelId);
  activeChannelRef.current = activeChannelId;

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

  useEffect(() => {
    if (!profile) return;

    const currentMsgs = loadAllMessages();
    setMessages(currentMsgs);
    refreshStats();

    const engine = new P2PChatEngine(profile.peerId, profile.name, {
      onPeersChange: (peers) => {
        setOnlinePeers(peers);
        for (const p of peers) {
          setSavedContacts(upsertContact(p.peerId, p.name, p.lastSeen));
        }
      },
      onMessageReceived: (incoming) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev;
          const next = [...prev, incoming].sort((a, b) => a.timestamp - b.timestamp);
          saveAllMessages(next);
          return next;
        });

        setSavedContacts(
          upsertContact(
            incoming.senderId,
            incoming.senderName,
            incoming.timestamp,
            incoming.text.slice(0, 48),
            incoming.timestamp,
          ),
        );

        if (activeChannelRef.current !== incoming.channelId) {
          setUnreadByChannel((prev) => ({
            ...prev,
            [incoming.channelId]: (prev[incoming.channelId] ?? 0) + 1,
          }));
        }

        refreshStats();
      },
      onMessageAcked: (messageId) => {
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
            saveAllMessages(next);
          }
          return changed ? next : prev;
        });
      },
      onConnectionStatusChange: (connected, label) => {
        setMeshConnected(connected);
        setMeshLabel(label);
      },
    });

    engineRef.current = engine;
    void engine.start(currentMsgs);

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [profile?.peerId, refreshStats]);

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
      if (newTabMode || loadSessionProfileOverride()) {
        saveSessionProfileOverride(updated);
      } else {
        saveProfile(updated);
      }
    }
  };

  const handleCompleteOnboarding = (name: string) => {
    const newProfile: UserProfile = {
      peerId: generatePeerId(),
      name,
      theme,
      createdAt: Date.now(),
    };

    if (newTabMode) {
      saveSessionProfileOverride(newProfile);
    } else {
      saveProfile(newProfile);
    }

    setActiveChannelId('lounge');
    setProfile(newProfile);
  };

  const handleUpdateName = (name: string) => {
    if (!profile) return;
    const updated: UserProfile = { ...profile, name };
    setProfile(updated);
    if (newTabMode || loadSessionProfileOverride()) {
      saveSessionProfileOverride(updated);
    } else {
      saveProfile(updated);
    }
  };

  const handleSelectChannel = (channelId: string) => {
    setActiveChannelId(channelId);
    setUnreadByChannel((prev) => {
      if (!prev[channelId]) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
  };

  const targetPeer = useMemo(() => {
    if (!profile || activeChannelId === 'lounge') return null;
    return (
      onlinePeers.find(
        (p) => getDmChannelId(profile.peerId, p.peerId) === activeChannelId,
      ) ?? null
    );
  }, [activeChannelId, onlinePeers, profile]);

  const targetSavedContact = useMemo(() => {
    if (!profile || activeChannelId === 'lounge') return null;
    return (
      savedContacts.find(
        (c) => getDmChannelId(profile.peerId, c.peerId) === activeChannelId,
      ) ?? null
    );
  }, [activeChannelId, profile, savedContacts]);

  const channelTitle = useMemo(() => {
    if (activeChannelId === 'lounge') return 'Everyone Online';
    if (targetPeer) return targetPeer.name;
    if (targetSavedContact) return targetSavedContact.name;
    return 'Direct Message';
  }, [activeChannelId, targetPeer, targetSavedContact]);

  const handleSendMessage = (text: string) => {
    if (!profile) return;
    const msgId = `${profile.peerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const recipientId = targetPeer?.peerId ?? targetSavedContact?.peerId;

    const outbound: ChatMessage = {
      id: msgId,
      channelId: activeChannelId,
      senderId: profile.peerId,
      senderName: profile.name,
      recipientId,
      text,
      timestamp: now,
      status: 'sent',
      transport: targetPeer?.dataChannelOpen ? 'webrtc' : 'local',
    };

    const nextMessages = [...messagesRef.current, outbound];
    setMessages(nextMessages);
    saveAllMessages(nextMessages);

    if (recipientId) {
      const recipientName = targetPeer?.name ?? targetSavedContact?.name ?? 'User';
      setSavedContacts(
        upsertContact(recipientId, recipientName, now, `You: ${text.slice(0, 48)}`, now),
      );
    }

    refreshStats();

    void engineRef.current?.sendMessage(
      {
        id: outbound.id,
        channelId: outbound.channelId,
        senderId: outbound.senderId,
        senderName: outbound.senderName,
        recipientId: outbound.recipientId,
        text: outbound.text,
        timestamp: outbound.timestamp,
      },
      recipientId,
    );
  };

  const handleTypingChange = (isTyping: boolean) => {
    const recipientId = targetPeer?.peerId ?? targetSavedContact?.peerId;
    engineRef.current?.sendTyping(activeChannelId, isTyping, recipientId);
  };

  const handleClearChannel = () => {
    const remaining = clearChannelMessages(activeChannelId);
    setMessages(remaining);
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
    engineRef.current?.stop();
    if (!newTabMode) {
      clearAllLocalData();
    }
    try {
      sessionStorage.removeItem('varta_session_account_v2');
    } catch {
      // Ignore
    }
    setMessages(newTabMode ? loadAllMessages() : []);
    setSavedContacts(newTabMode ? loadContacts() : []);
    setOnlinePeers([]);
    setUnreadByChannel({});
    setProfile(null);
    refreshStats();
  };

  const shareUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('as');
    url.searchParams.delete('room');
    return url.toString();
  }, []);

  const secondTabUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    url.searchParams.set('as', 'new');
    return url.toString();
  }, []);

  if (!profile) {
    return (
      <OnboardingView
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
        activeChannelId={activeChannelId}
        onlinePeers={onlinePeers}
        savedContacts={savedContacts}
        unreadByChannel={unreadByChannel}
        storageStats={storageStats}
        meshConnected={meshConnected}
        meshLabel={meshLabel}
        secondTabUrl={secondTabUrl}
        isOpenMobile={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onUpdateName={handleUpdateName}
        onToggleTheme={handleToggleTheme}
        onSelectChannel={handleSelectChannel}
        onExportData={handleExportData}
        onClearAllData={handleClearAllData}
      />

      <ChatArea
        localPeerId={profile.peerId}
        localName={profile.name}
        activeChannelId={activeChannelId}
        channelTitle={channelTitle}
        targetPeer={targetPeer}
        onlinePeers={onlinePeers}
        messages={messages}
        shareUrl={shareUrl}
        secondTabUrl={secondTabUrl}
        onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        onSelectChannel={handleSelectChannel}
        onSendMessage={handleSendMessage}
        onTypingChange={handleTypingChange}
        onClearChannel={handleClearChannel}
      />
    </div>
  );
}
