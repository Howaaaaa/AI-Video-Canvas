import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Play, Volume2, VolumeX, Camera } from 'lucide-react';

// ---------------------------------------------------------------------------
// Video player — just the <video> element + play overlay
// ---------------------------------------------------------------------------
const CanvasNodeVideo = memo(
  forwardRef<HTMLVideoElement, { src: string; className?: string; crossOrigin?: 'anonymous' }>(
    ({ src, className, crossOrigin }, ref) => {
      const [isPlaying, setIsPlaying] = useState(false);

      const handlePlay = useCallback(() => {
        const video = (ref as React.RefObject<HTMLVideoElement>).current;
        if (!video) return;
        if (isPlaying) {
          video.pause();
        } else {
          video.play();
        }
        setIsPlaying(!isPlaying);
      }, [isPlaying, ref]);

      const handleVideoEnd = useCallback(() => {
        setIsPlaying(false);
      }, []);

      return (
        <div className={`relative overflow-hidden ${className}`}>
          <video
            ref={ref}
            src={src}
            crossOrigin={crossOrigin}
            className="h-full w-full object-contain"
            onEnded={handleVideoEnd}
            onClick={handlePlay}
            playsInline
          />
          {!isPlaying && (
            <button
              type="button"
              onClick={handlePlay}
              className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors hover:bg-black/40"
            >
              <Play className="h-12 w-12 text-white/80" />
            </button>
          )}
        </div>
      );
    }
  )
);
CanvasNodeVideo.displayName = 'CanvasNodeVideo';

// ---------------------------------------------------------------------------
// Video progress bar — rendered outside the video container
// ---------------------------------------------------------------------------
const VideoProgressBar = memo(({ videoRef, onCapture }: { videoRef: React.RefObject<HTMLVideoElement>; onCapture?: () => void }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      const d = video.duration;
      if (d && Number.isFinite(d) && d > 0) {
        setDuration(d);
      }
    };
    const onLoadedMetadata = () => {
      const d = video.duration;
      if (d && Number.isFinite(d) && d > 0) {
        setDuration(d);
      }
    };
    const onVolumeChange = () => {
      setIsMuted(video.muted);
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('volumechange', onVolumeChange);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('volumechange', onVolumeChange);
    };
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, [videoRef]);

  const handleSeek = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const video = videoRef.current;
      if (!barRef.current || !video || !duration) return;
      const rect = barRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      video.currentTime = ratio * duration;
      setCurrentTime(ratio * duration);
    },
    [duration, videoRef]
  );

  if (!duration || duration <= 0) return null;

  const progress = (currentTime / duration) * 100;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <button
        type="button"
        onClick={toggleMute}
        className="flex-shrink-0 text-text-dark/50 hover:text-text-dark/80 transition-colors"
      >
        {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </button>
      <span className="text-[10px] text-text-dark/60 tabular-nums min-w-[32px]">
        {formatTime(currentTime)}
      </span>
      <div
        ref={barRef}
        className="relative flex-1 h-1 cursor-pointer rounded-full bg-black/15 dark:bg-white/25"
        onClick={handleSeek}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-75 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-[10px] text-text-dark/60 tabular-nums min-w-[32px] text-right">
        {formatTime(duration)}
      </span>
      {onCapture && (
        <button
          type="button"
          onClick={onCapture}
          className="flex-shrink-0 text-text-dark/50 hover:text-text-dark/80 transition-colors"
          title="Capture frame"
        >
          <Camera className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
VideoProgressBar.displayName = 'VideoProgressBar';

export { CanvasNodeVideo, VideoProgressBar };
