import React, { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

interface ManualPairModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateOffer: () => Promise<string>;
  onAcceptOfferCreateAnswer: (offer: string) => Promise<string>;
  onAcceptAnswer: (answer: string) => Promise<void>;
}

export const ManualPairModal: React.FC<ManualPairModalProps> = ({
  isOpen,
  onClose,
  onCreateOffer,
  onAcceptOfferCreateAnswer,
  onAcceptAnswer,
}) => {
  const [tab, setTab] = useState<'host' | 'join'>('host');
  const [offerCode, setOfferCode] = useState('');
  const [answerInput, setAnswerInput] = useState('');
  const [remoteOfferInput, setRemoteOfferInput] = useState('');
  const [generatedAnswer, setGeneratedAnswer] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedField, setCopiedField] = useState<'offer' | 'answer' | null>(null);

  if (!isOpen) return null;

  const copyText = async (text: string, field: 'offer' | 'answer') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      setErrorMsg('Clipboard access failed. Please select and copy manually.');
    }
  };

  const handleGenerateOffer = async () => {
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const code = await onCreateOffer();
      setOfferCode(code);
      setStatusMsg('Offer ready. Send this code to the other person, then paste their reply below.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create WebRTC offer');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteHost = async () => {
    if (!answerInput.trim()) return;
    setBusy(true);
    setErrorMsg('');
    try {
      await onAcceptAnswer(answerInput);
      setStatusMsg('Direct WebRTC connection established.');
      setTimeout(() => onClose(), 800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid answer code');
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptOffer = async () => {
    if (!remoteOfferInput.trim()) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const ans = await onAcceptOfferCreateAnswer(remoteOfferInput);
      setGeneratedAnswer(ans);
      setStatusMsg('Answer created. Send this code back to complete the direct link.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid offer code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-pair-title"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="manual-pair-title" className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Direct WebRTC Pairing
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Optional offline handshake if public Gun.js relays are blocked on your network.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pairing dialog"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setTab('host');
              setErrorMsg('');
              setStatusMsg('');
            }}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'host'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            1. Start Direct Link
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('join');
              setErrorMsg('');
              setStatusMsg('');
            }}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'join'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            2. Accept Invite Code
          </button>
        </div>

        {tab === 'host' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Step A: Create your offer code
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleGenerateOffer()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors whitespace-nowrap shrink-0"
                >
                  {busy ? 'Creating...' : offerCode ? 'Regenerate' : 'Create Offer'}
                </button>
              </div>

              {offerCode && (
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={offerCode}
                    className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300"
                  />
                  <button
                    type="button"
                    onClick={() => void copyText(offerCode, 'offer')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    {copiedField === 'offer' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedField === 'offer' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Step B: Paste their answer code
              </label>
              <textarea
                rows={3}
                value={answerInput}
                onChange={(e) => setAnswerInput(e.target.value)}
                placeholder="Paste the answer code sent back by the other person..."
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30"
              />
              <button
                type="button"
                disabled={busy || !answerInput.trim()}
                onClick={() => void handleCompleteHost()}
                className="w-full py-2 px-4 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                Connect Peer
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Step A: Paste offer code from the first person
              </label>
              <textarea
                rows={3}
                value={remoteOfferInput}
                onChange={(e) => setRemoteOfferInput(e.target.value)}
                placeholder="Paste offer code..."
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30"
              />
              <button
                type="button"
                disabled={busy || !remoteOfferInput.trim()}
                onClick={() => void handleAcceptOffer()}
                className="w-full py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium transition-colors"
              >
                {busy ? 'Generating...' : 'Generate Answer Code'}
              </button>
            </div>

            {generatedAnswer && (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <span className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Step B: Copy this answer back to them
                </span>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={generatedAnswer}
                    className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300"
                  />
                  <button
                    type="button"
                    onClick={() => void copyText(generatedAnswer, 'answer')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    {copiedField === 'answer' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedField === 'answer' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {statusMsg && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">{statusMsg}</p>
        )}
        {errorMsg && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">{errorMsg}</p>
        )}
      </div>
    </div>
  );
};
