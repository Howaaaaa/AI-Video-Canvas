import { memo, useCallback, useRef, useState, useEffect, type ImgHTMLAttributes, type MouseEvent } from 'react';

import { useCanvasStore } from '@/stores/canvasStore';

export interface CanvasNodeImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  viewerSourceUrl?: string | null;
  viewerImageList?: Array<string | null | undefined>;
  disableViewer?: boolean;
}

function normalizeViewerList(
  imageList: Array<string | null | undefined> | undefined,
  currentImageUrl: string
): string[] {
  const deduped: string[] = [];
  for (const rawItem of imageList ?? []) {
    const item = typeof rawItem === 'string' ? rawItem.trim() : '';
    if (!item || deduped.includes(item)) {
      continue;
    }
    deduped.push(item);
  }

  if (!deduped.includes(currentImageUrl)) {
    deduped.unshift(currentImageUrl);
  }

  return deduped.length > 0 ? deduped : [currentImageUrl];
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [400, 1200];

export const CanvasNodeImage = memo(({
  viewerSourceUrl,
  viewerImageList,
  disableViewer = false,
  onDoubleClick,
  src,
  ...props
}: CanvasNodeImageProps) => {
  const openImageViewer = useCanvasStore((state) => state.openImageViewer);
  const [, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLoadError(false);
    setRetryKey(0);
  }, [src]);

  useEffect(() => () => {
    clearTimeout(retryTimerRef.current);
  }, []);

  const handleError = useCallback(() => {
    console.warn('[CanvasNodeImage] Image load failed, src:', src);
    setLoadError(true);
    if (retryKey < MAX_RETRY_ATTEMPTS) {
      const delay = RETRY_DELAYS[retryKey] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1] ?? 1000;
      retryTimerRef.current = setTimeout(() => {
        setRetryKey((prev) => prev + 1);
      }, delay);
    }
  }, [src, retryKey]);

  const handleLoad = useCallback(() => {
    setLoadError(false);
    clearTimeout(retryTimerRef.current);
  }, []);

  const effectiveSrc = retryKey > 0 ? `${src}?retry=${retryKey}` : src;

  const handleDoubleClick = useCallback((event: MouseEvent<HTMLImageElement>) => {
    onDoubleClick?.(event);

    if (event.defaultPrevented || disableViewer) {
      return;
    }

    const fallbackSrc = event.currentTarget.currentSrc || (typeof src === 'string' ? src : '');
    const resolvedSource =
      typeof viewerSourceUrl === 'string' && viewerSourceUrl.trim().length > 0
        ? viewerSourceUrl.trim()
        : fallbackSrc.trim();
    if (!resolvedSource) {
      return;
    }

    event.stopPropagation();
    openImageViewer(resolvedSource, normalizeViewerList(viewerImageList, resolvedSource));
  }, [disableViewer, onDoubleClick, openImageViewer, src, viewerImageList, viewerSourceUrl]);

  return (
    <img
      {...props}
      key={retryKey}
      src={effectiveSrc}
      decoding="async"
      data-viewer-src={
        typeof viewerSourceUrl === 'string' && viewerSourceUrl.trim().length > 0
          ? viewerSourceUrl.trim()
          : undefined
      }
      onError={handleError}
      onLoad={handleLoad}
      onDoubleClick={handleDoubleClick}
    />
  );
});

CanvasNodeImage.displayName = 'CanvasNodeImage';
