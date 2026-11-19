import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="px-4 sm:px-6 py-2 bg-amber-500/15 dark:bg-amber-500/15 border-b border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs font-medium flex items-center gap-2 shrink-0"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>
        Offline Mode — Cached chats &amp; media are available. New sends will sync
        automatically when back online.
      </span>
    </div>
  );
};
