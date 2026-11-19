import React, { useState } from 'react';
import { ArrowRight, Moon, Sun } from 'lucide-react';

interface OnboardingViewProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onComplete: (name: string) => void;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  theme,
  onToggleTheme,
  onComplete,
}) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError('Please enter your name to continue.');
      return;
    }
    setError('');
    onComplete(cleanName);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <span className="font-display text-xl font-bold tracking-tight whitespace-nowrap shrink-0">
            Varta
          </span>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-6 space-y-5">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              WebRTC Direct · Live Discovery · LocalStorage Only
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight [text-wrap:balance]">
              Enter your name and chat directly with anyone online.
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-md">
              Open this site on any phone or browser. Type your name once to create your local account, see everyone who is online right now, and message anyone directly.
            </p>

            <div className="pt-2 space-y-3 border-t border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-slate-400 dark:text-slate-500 tabular-nums">01</span>
                <span>Enter your name — no email, password, or room code needed.</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-slate-400 dark:text-slate-500 tabular-nums">02</span>
                <span>Everyone online on any device appears live in your people list.</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-slate-400 dark:text-slate-500 tabular-nums">03</span>
                <span>All conversations are saved strictly inside your own browser storage.</span>
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
                  Create your local account
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Saved on this device only.
                </p>
              </div>

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
                  placeholder="e.g. Rahul, Priya, Aman"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 text-sm"
                />
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
                <span>Join Chat</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};
