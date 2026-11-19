import React, { useState } from 'react';
import { ArrowRight, RefreshCw, Sun, Moon } from 'lucide-react';
import { generateRoomCode } from '../lib/crypto';

interface OnboardingViewProps {
  initialName?: string;
  initialRoom: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onComplete: (name: string, roomCode: string) => void;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  initialName = '',
  initialRoom,
  theme,
  onToggleTheme,
  onComplete,
}) => {
  const [name, setName] = useState(initialName);
  const [roomCode, setRoomCode] = useState(initialRoom);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    const cleanRoom = roomCode.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');

    if (!cleanName) {
      setError('Please enter your display name.');
      return;
    }
    if (!cleanRoom) {
      setError('Please enter a room code.');
      return;
    }
    setError('');
    onComplete(cleanName, cleanRoom);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <span className="font-display text-xl font-bold tracking-tight whitespace-nowrap shrink-0">
            Varta
          </span>
          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-6 space-y-5">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              WebRTC Direct · Gun.js Mesh · LocalStorage Only
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight [text-wrap:balance]">
              Direct peer-to-peer chat with zero backend.
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-md">
              Pick a name and enter a shared room code. Your browser connects directly to the other person over WebRTC and saves your conversation solely in your own device storage.
            </p>

            <div className="pt-2 space-y-3 border-t border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-slate-400 dark:text-slate-500 tabular-nums">01</span>
                <span>Each person enters any display name on their own device.</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-slate-400 dark:text-slate-500 tabular-nums">02</span>
                <span>Share the room link or code to connect in real time.</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-slate-400 dark:text-slate-500 tabular-nums">03</span>
                <span>All chat history stays strictly inside browser localStorage.</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <form
              onSubmit={handleSubmit}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-8 space-y-5"
            >
              <div>
                <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                  Join a conversation
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  No sign-up or account required.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="display-name"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Your Name
                  </label>
                  <input
                    id="display-name"
                    type="text"
                    maxLength={32}
                    autoFocus
                    placeholder="e.g. Aarav, Priya"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 text-sm"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="room-code"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                    >
                      Room Code
                    </label>
                    <button
                      type="button"
                      onClick={() => setRoomCode(generateRoomCode())}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Generate New
                    </button>
                  </div>
                  <input
                    id="room-code"
                    type="text"
                    maxLength={40}
                    placeholder="e.g. lobby or x7k-92p"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 text-sm font-mono"
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0"
              >
                <span>Enter Chat</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};
