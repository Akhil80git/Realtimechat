import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'header',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = () => {
    if (isInstallable) {
      void install();
      return;
    }
    setShowGuide(true);
  };

  if (variant === 'header' && !isInstallable && !isIOS) {
    return null;
  }

  const isInsideIframe =
    typeof window !== 'undefined' && window.self !== window.top;

  return (
    <>
      {variant === 'header' ? (
        <button
          type="button"
          onClick={handleClick}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span className="hidden sm:inline">Install App</span>
          <span className="sm:hidden">Install</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{isInstallable ? 'Install Varta App' : 'Download / Install App'}</span>
        </button>
      )}

      {showGuide && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {isIOS ? 'Install Varta on iPhone / iPad' : 'Install Varta App'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install guide"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2 text-sm text-slate-600 dark:text-slate-300 list-decimal pl-4">
                <li>
                  Tap the{' '}
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-white">
                    Share <Share className="w-3.5 h-3.5 inline" />
                  </span>{' '}
                  button in Safari&apos;s toolbar.
                </li>
                <li>
                  Scroll down and tap{' '}
                  <strong className="text-slate-900 dark:text-white">
                    Add to Home Screen
                  </strong>
                  .
                </li>
                <li>
                  Tap <strong className="text-slate-900 dark:text-white">Add</strong>{' '}
                  to launch Varta like a native app.
                </li>
              </ol>
            ) : (
              <div className="space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
                {isInsideIframe && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Open Varta in a full browser tab first (via the link below or your
                    browser bar), then install it directly to your device:
                  </p>
                )}
                <ol className="space-y-1.5 list-decimal pl-4">
                  <li>
                    Tap your browser menu (<strong>⋮</strong> on Android Chrome or
                    the install icon in the address bar on desktop).
                  </li>
                  <li>
                    Choose{' '}
                    <strong className="text-slate-900 dark:text-white">
                      Install app
                    </strong>{' '}
                    or{' '}
                    <strong className="text-slate-900 dark:text-white">
                      Add to Home screen
                    </strong>
                    .
                  </li>
                </ol>
                {isInsideIframe && (
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Open Full App to Install</span>
                  </a>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
