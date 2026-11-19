import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraModal } from './components/CameraModal';
import { ChatArea } from './components/ChatArea';
import { QrModal } from './components/QrModal';
import { Sidebar } from './components/Sidebar';
import {
  generatePeerId,
  generateQrDerivedUsername,
  generateRandomUsername,
  getDmChannelId,
} from './lib/crypto';
import { prepareMediaAttachment } from './lib/media';
import { P2PChatEngine } from './lib/p2pEngine';
import {
  clearAllLocalData,
  clearChannelMessages,
  deleteSingleMessage,
  getStorageStatsAsync,
  loadAllMessages,
  loadContacts,
  loadProfile,
  saveAllMessages,
  saveProfile,
  upsertContact,
} from './lib/storage';
import {
  ChatAttachment,
  ChatMessage,
  PeerInfo,
  ReplyRef,
  StorageStats,
  StoredContact,
  UserProfile,
} from './types/chat';

interface UrlBootParams {
  isNewTab: boolean;
  connectPeerId: string | null;
  connectFromName: string | null;
}

function parseUrlBootParams(): UrlBootParams {
  const params = new URLSearchParams(window.location.search);
  const isNewTab = params.get('as') === 'new';
  const connectPeerId = params.get('connect')?.trim() || null;
  const connectFromName = params.get('from')?.trim() || null;
  return { isNewTab, connectPeerId, connectFromName };
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

function applyReactionUpdate(
  list: ChatMessage[],
  messageId: string,
  emoji: string,
  peerId: string,
  add: boolean,
): ChatMessage[] {
  let changed = false;
  const next = list.map((m) => {
    if (m.id !== messageId) return m;
    const current = { ...(m.reactions ?? {}) };
    const users = new Set(current[emoji] ?? []);
    if (add) {
      if (users.has(peerId)) return m;
      users.add(peerId);
    } else {
      if (!users.has(peerId)) return m;
      users.delete(peerId);
    }
    changed = true;
    if (users.size === 0) {
      delete current[emoji];
    } else {
      current[emoji] = Array.from(users);
    }
    return { ...m, reactions: current };
  });
  return changed ? next : list;
}

function resolveBootState(boot: UrlBootParams): {
  profile: UserProfile;
  initialChannelId: string;
} {
  const preferredTheme: 'light' | 'dark' = window.matchMedia?.(
    '(prefers-color-scheme: dark)',
  ).matches
    ? 'dark'
    : 'light';

  let profile = loadSessionProfileOverride();
  if (!profile && !boot.isNewTab) {
    profile = loadProfile();
  }

  // Instant auto-account creation on first visit (or via QR scan)
  if (!profile) {
    const autoName =
      boot.connectPeerId && boot.connectFromName
        ? generateQrDerivedUsername(boot.connectFromName)
        : generateRandomUsername();

    profile = {
      peerId: generatePeerId(),
      name: autoName,
      theme: preferredTheme,
      createdAt: Date.now(),
    };

    if (boot.isNewTab) {
      saveSessionProfileOverride(profile);
    } else {
      saveProfile(profile);
    }
  }

  let initialChannelId = 'lounge';
  if (boot.connectPeerId && boot.connectPeerId !== profile.peerId) {
    upsertContact(
      boot.connectPeerId,
      boot.connectFromName || 'Friend',
      Date.now(),
    );
    initialChannelId = getDmChannelId(profile.peerId, boot.connectPeerId);
  }

  return { profile, initialChannelId };
}

export default function App() {
  const bootParams = useMemo(() => parseUrlBootParams(), []);
  const bootState = useMemo(() => resolveBootState(bootParams), [bootParams]);

  const [profile, setProfile] = useState<UserProfile>(bootState.profile);
  const [theme, setTheme] = useState<'light' | 'dark'>(bootState.profile.theme);
  const [activeChannelId, setActiveChannelId] = useState<string>(
    bootState.initialChannelId,
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadAllMessages());
  const [onlinePeers, setOnlinePeers] = useState<PeerInfo[]>([]);
  const [savedContacts, setSavedContacts] = useState<StoredContact[]>(() =>
    loadContacts(),
  );
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const [storageStats, setStorageStats] = useState<StorageStats>({
    totalBytes: 0,
    messageCount: 0,
    contactCount: 0,
  });
  const [meshConnected, setMeshConnected] = useState<boolean>(false);
  const [meshLabel, setMeshLabel] = useState<string>('Connecting...');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [qrModalOpen, setQrModalOpen] = useState<boolean>(false);
  const [cameraModalOpen, setCameraModalOpen] = useState<boolean>(false);

  const engineRef = useRef<P2PChatEngine | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const activeChannelRef = useRef<string>(activeChannelId);
  activeChannelRef.current = activeChannelId;

  // Clean QR query params from URL bar after boot so reload stays tidy
  useEffect(() => {
    if (bootParams.connectPeerId || bootParams.connectFromName) {
      const url = new URL(window.location.href);
      url.searchParams.delete('connect');
      url.searchParams.delete('from');
      window.history.replaceState({}, '', url.toString());
    }
  }, [bootParams.connectPeerId, bootParams.connectFromName]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const updateViewportHeight = () => {
      const vv = window.visualViewport;
      const height = vv ? Math.round(vv.height) : window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
      if (vv && vv.offsetTop !== 0) {
        window.scrollTo(0, 0);
      }
    };

    updateViewportHeight();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', updateViewportHeight);
    vv?.addEventListener('scroll', updateViewportHeight);
    window.addEventListener('resize', updateViewportHeight);

    return () => {
      vv?.removeEventListener('resize', updateViewportHeight);
      vv?.removeEventListener('scroll', updateViewportHeight);
      window.removeEventListener('resize', updateViewportHeight);
    };
  }, []);

  const refreshStats = useCallback(() => {
    void getStorageStatsAsync().then((stats) => {
      setStorageStats(stats);
    });
  }, []);

  useEffect(() => {
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

        const preview =
          incoming.text.slice(0, 48) ||
          (incoming.attachment
            ? `[${incoming.attachment.kind}] ${incoming.attachment.name}`
            : '');

        setSavedContacts(
          upsertContact(
            incoming.senderId,
            incoming.senderName,
            incoming.timestamp,
            preview,
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
      onMediaTransferProgress: (messageId, progress) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, transferProgress: progress } : m,
          ),
        );
        if (progress === undefined) {
          refreshStats();
        }
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
      onReactionReceived: (_channelId, messageId, emoji, peerId, add) => {
        setMessages((prev) => {
          const next = applyReactionUpdate(prev, messageId, emoji, peerId, add);
          if (next !== prev) {
            saveAllMessages(next);
          }
          return next;
        });
      },
      onMessageDeleted: (_channelId, messageId) => {
        void deleteSingleMessage(messageId).then((remaining) => {
          setMessages(remaining);
          refreshStats();
        });
      },
      onChannelCleared: (channelId, clearedAt) => {
        void clearChannelMessages(channelId, clearedAt).then((remaining) => {
          setMessages(remaining);
          refreshStats();
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
  }, [profile.peerId, refreshStats]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateLocalName(profile.name);
    }
  }, [profile.name]);

  const persistProfile = useCallback(
    (updated: UserProfile) => {
      setProfile(updated);
      if (bootParams.isNewTab || loadSessionProfileOverride()) {
        saveSessionProfileOverride(updated);
      } else {
        saveProfile(updated);
      }
    },
    [bootParams.isNewTab],
  );

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    persistProfile({ ...profile, theme: nextTheme });
  };

  const handleUpdateName = (name: string) => {
    persistProfile({ ...profile, name });
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
    if (activeChannelId === 'lounge') return null;
    return (
      onlinePeers.find(
        (p) => getDmChannelId(profile.peerId, p.peerId) === activeChannelId,
      ) ?? null
    );
  }, [activeChannelId, onlinePeers, profile.peerId]);

  const targetSavedContact = useMemo(() => {
    if (activeChannelId === 'lounge') return null;
    return (
      savedContacts.find(
        (c) => getDmChannelId(profile.peerId, c.peerId) === activeChannelId,
      ) ?? null
    );
  }, [activeChannelId, profile.peerId, savedContacts]);

  const channelTitle = useMemo(() => {
    if (activeChannelId === 'lounge') return 'Everyone Online';
    if (targetPeer) return targetPeer.name;
    if (targetSavedContact) return targetSavedContact.name;
    return 'Direct Message';
  }, [activeChannelId, targetPeer, targetSavedContact]);

  const handleSendMessage = (
    text: string,
    attachment?: ChatAttachment,
    mediaBlob?: Blob,
    replyTo?: ReplyRef,
  ) => {
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
      attachment,
      replyTo,
      timestamp: now,
      status: 'sent',
      transport: targetPeer?.dataChannelOpen ? 'webrtc' : 'local',
      transferProgress: mediaBlob ? 0 : undefined,
    };

    const nextMessages = [...messagesRef.current, outbound];
    setMessages(nextMessages);
    saveAllMessages(nextMessages);

    if (recipientId) {
      const recipientName = targetPeer?.name ?? targetSavedContact?.name ?? 'User';
      const preview =
        text.slice(0, 48) ||
        (attachment ? `[${attachment.kind}] ${attachment.name}` : '');
      setSavedContacts(
        upsertContact(recipientId, recipientName, now, `You: ${preview}`, now),
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
        attachment: outbound.attachment,
        replyTo: outbound.replyTo,
        timestamp: outbound.timestamp,
      },
      mediaBlob,
      recipientId,
    );
  };

  const handleCameraCaptured = (blob: Blob, name: string) => {
    void prepareMediaAttachment(blob, name).then(({ attachment }) => {
      handleSendMessage('', attachment, blob);
    });
  };

  const handleToggleReaction = (messageId: string, emoji: string) => {
    const targetMsg = messagesRef.current.find((m) => m.id === messageId);
    if (!targetMsg) return;

    const alreadyReacted = (targetMsg.reactions?.[emoji] ?? []).includes(
      profile.peerId,
    );
    const add = !alreadyReacted;

    const next = applyReactionUpdate(
      messagesRef.current,
      messageId,
      emoji,
      profile.peerId,
      add,
    );
    setMessages(next);
    saveAllMessages(next);

    const recipientId = targetPeer?.peerId ?? targetSavedContact?.peerId;
    engineRef.current?.sendReaction(
      activeChannelId,
      messageId,
      emoji,
      add,
      recipientId,
    );
  };

  const handleTypingChange = (isTyping: boolean) => {
    const recipientId = targetPeer?.peerId ?? targetSavedContact?.peerId;
    engineRef.current?.sendTyping(activeChannelId, isTyping, recipientId);
  };

  const handleDeleteMessage = (messageId: string) => {
    void deleteSingleMessage(messageId).then((remaining) => {
      setMessages(remaining);
      refreshStats();
    });
    const recipientId = targetPeer?.peerId ?? targetSavedContact?.peerId;
    engineRef.current?.sendDeleteMessage(activeChannelId, messageId, recipientId);
  };

  const handleClearChannel = () => {
    void clearChannelMessages(activeChannelId).then((remaining) => {
      setMessages(remaining);
      refreshStats();
    });
    const recipientId = targetPeer?.peerId ?? targetSavedContact?.peerId;
    engineRef.current?.sendClearChat(activeChannelId, recipientId);
  };

  const handleClearAllData = () => {
    engineRef.current?.stop();
    const resetTask = bootParams.isNewTab
      ? Promise.resolve()
      : clearAllLocalData();

    void resetTask.then(() => {
      try {
        sessionStorage.removeItem('varta_session_account_v2');
      } catch {
        // Ignore
      }
      const freshProfile: UserProfile = {
        peerId: generatePeerId(),
        name: generateRandomUsername(),
        theme,
        createdAt: Date.now(),
      };
      if (bootParams.isNewTab) {
        saveSessionProfileOverride(freshProfile);
      } else {
        saveProfile(freshProfile);
      }
      setMessages(bootParams.isNewTab ? loadAllMessages() : []);
      setSavedContacts(bootParams.isNewTab ? loadContacts() : []);
      setOnlinePeers([]);
      setUnreadByChannel({});
      setActiveChannelId('lounge');
      setProfile(freshProfile);
      refreshStats();
    });
  };

  const secondTabUrl = useMemo(() => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('as', 'new');
    return url.toString();
  }, []);

  return (
    <div className="h-[var(--app-height,100dvh)] w-full overflow-hidden flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
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
        onOpenQr={() => setQrModalOpen(true)}
        onSelectChannel={handleSelectChannel}
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
        secondTabUrl={secondTabUrl}
        onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        onOpenQr={() => setQrModalOpen(true)}
        onOpenCamera={() => setCameraModalOpen(true)}
        onSelectChannel={handleSelectChannel}
        onSendMessage={handleSendMessage}
        onToggleReaction={handleToggleReaction}
        onDeleteMessage={handleDeleteMessage}
        onTypingChange={handleTypingChange}
        onClearChannel={handleClearChannel}
      />

      <QrModal
        isOpen={qrModalOpen}
        peerId={profile.peerId}
        userName={profile.name}
        onClose={() => setQrModalOpen(false)}
      />

      <CameraModal
        isOpen={cameraModalOpen}
        onClose={() => setCameraModalOpen(false)}
        onCaptured={handleCameraCaptured}
      />
    </div>
  );
}
