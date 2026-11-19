import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, QrCode, X } from 'lucide-react';

interface QrModalProps {
  isOpen: boolean;
  peerId: string;
  userName: string;
  onClose: () => void;
}

export const QrModal: React.FC<QrModalProps> = ({
  isOpen,
  peerId,
  userName,
  onClose,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const qrUrl = React.useMemo(() => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('connect', peerId);
    url.searchParams.set('from', userName);
    return url.toString();
  }, [peerId, userName]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void QRCode.toDataURL(qrUrl, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl);
    });
    return () => {
      active = false;
    };
  }, [isOpen, qrUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(qrUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 text-left">
          <div>
            <h2
              id="qr-modal-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"
            >
              <QrCode className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Your Direct QR</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Friends scan with Google Lens or phone camera to chat directly with{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {userName}
              </span>
              .
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-center py-2">
          <div className="p-3 bg-white rounded-xl border border-slate-200">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR code to chat directly with ${userName}`}
                className="w-56 h-56 block"
              />
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-xs text-slate-400">
                Generating QR...
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Anyone scanning this gets an instant account like{' '}
          <span className="font-mono text-slate-700 dark:text-slate-300">
            {userName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'Friend'}Xz
          </span>{' '}
          and opens your direct chat immediately.
        </p>

        <button
          type="button"
          onClick={() => void handleCopy()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 transition-colors"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          <span>{copied ? 'Direct Link Copied' : 'Copy Direct Link'}</span>
        </button>
      </div>
    </div>
  );
};
