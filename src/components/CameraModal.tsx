import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  RefreshCw,
  SendHorizontal,
  Square,
  Video,
  X,
} from 'lucide-react';
import { formatDuration, getSupportedVideoMime } from '../lib/media';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptured: (blob: Blob, name: string) => void;
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onCaptured,
}) => {
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isRecording, setIsRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [error, setError] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);

  const stopStream = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setRecordMs(0);
  }, []);

  const clearPreview = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl('');
    setPreviewBlob(null);
  }, [previewUrl]);

  const startCamera = useCallback(async () => {
    stopStream();
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: mode === 'video',
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setError('Camera permission denied or camera not available.');
    }
  }, [facingMode, mode, stopStream]);

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      clearPreview();
      return;
    }
    if (!previewBlob) {
      void startCamera();
    }
    return () => {
      stopStream();
    };
  }, [isOpen, previewBlob, startCamera, stopStream, clearPreview]);

  if (!isOpen) return null;

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        const url = URL.createObjectURL(blob);
        setPreviewBlob(blob);
        setPreviewUrl(url);
      },
      'image/webp',
      0.85,
    );
  };

  const startVideoRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') return;

    const mime = getSupportedVideoMime();
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);

    chunksRef.current = [];
    recorderRef.current = recorder;
    recordStartRef.current = Date.now();
    setRecordMs(0);
    setIsRecording(true);

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) {
        chunksRef.current.push(ev.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || 'video/webm',
      });
      chunksRef.current = [];
      stopStream();
      const url = URL.createObjectURL(blob);
      setPreviewBlob(blob);
      setPreviewUrl(url);
    };

    timerRef.current = window.setInterval(() => {
      setRecordMs(Date.now() - recordStartRef.current);
    }, 250);

    recorder.start(250);
  };

  const stopVideoRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  const handleSend = () => {
    if (!previewBlob) return;
    const ext = previewBlob.type.startsWith('video/') ? 'webm' : 'webp';
    const name = `camera-${Date.now()}.${ext}`;
    onCaptured(previewBlob, name);
    clearPreview();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="In-app private camera"
    >
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-white">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-sm font-semibold">
              In-Site Camera
            </h2>
            <p className="text-[11px] text-slate-400">
              Stays inside the site only — never saved to your phone gallery.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopStream();
              clearPreview();
              onClose();
            }}
            aria-label="Close camera"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-black flex items-center justify-center overflow-hidden">
          {error ? (
            <p className="px-6 text-center text-sm text-red-400">{error}</p>
          ) : previewUrl ? (
            previewBlob?.type.startsWith('video/') ? (
              <video
                src={previewUrl}
                controls
                playsInline
                controlsList="nodownload"
                disablePictureInPicture
                onContextMenu={(e) => e.preventDefault()}
                className="w-full h-full object-contain"
              />
            ) : (
              <img
                src={previewUrl}
                alt="Captured preview"
                onContextMenu={(e) => e.preventDefault()}
                className="w-full h-full object-contain"
              />
            )
          ) : (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          )}

          {isRecording && (
            <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-md bg-black/70 text-xs font-mono tabular-nums text-red-400">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span>REC {formatDuration(recordMs)}</span>
            </div>
          )}
        </div>

        <div className="p-4 flex items-center justify-between gap-3 bg-slate-900">
          {previewBlob ? (
            <>
              <button
                type="button"
                onClick={() => clearPreview()}
                className="px-4 py-2 rounded-lg border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={handleSend}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-medium text-white"
              >
                <span>Send Now</span>
                <SendHorizontal className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-800">
                <button
                  type="button"
                  disabled={isRecording}
                  onClick={() => setMode('photo')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    mode === 'photo'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Photo</span>
                </button>
                <button
                  type="button"
                  disabled={isRecording}
                  onClick={() => setMode('video')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    mode === 'video'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Video className="w-3.5 h-3.5" />
                  <span>Video</span>
                </button>
              </div>

              {mode === 'photo' ? (
                <button
                  type="button"
                  disabled={Boolean(error)}
                  onClick={capturePhoto}
                  className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-xs font-medium text-white"
                >
                  Capture Photo
                </button>
              ) : isRecording ? (
                <button
                  type="button"
                  onClick={stopVideoRecording}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-medium text-white"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop Recording</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={Boolean(error)}
                  onClick={startVideoRecording}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-xs font-medium text-white"
                >
                  <Video className="w-3.5 h-3.5" />
                  <span>Record Video</span>
                </button>
              )}

              <button
                type="button"
                disabled={isRecording}
                onClick={() =>
                  setFacingMode((f) => (f === 'environment' ? 'user' : 'environment'))
                }
                aria-label="Switch front or back camera"
                className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
