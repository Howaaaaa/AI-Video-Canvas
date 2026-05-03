import {
  memo,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useState,
} from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  useViewport,
  type NodeProps,
} from '@xyflow/react';
import { Video, Film, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  type ExportVideoNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  resolveMinEdgeFittedSize,
  resolveResizeMinConstraintsByAspect,
} from '@/features/canvas/application/imageNodeSizing';
import {
  resolveImageDisplayUrl,
  resolveImageSourceByZoom,
} from '@/features/canvas/application/imageData';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { CanvasNodeVideo, VideoProgressBar } from '@/features/canvas/ui/VideoPlayer';
import { prepareNodeImageBinary } from '@/commands/image';
import { downloadRemoteVideo } from '@/commands/video';
import { useCanvasStore } from '@/stores/canvasStore';

type ExportVideoNodeProps = NodeProps & {
  id: string;
  data: ExportVideoNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

const GeneratingIndicator = memo(({ startedAt, durationMs }: { startedAt: number | null; durationMs: number }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setProgress(0);
      return;
    }
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min((elapsed / durationMs) * 100, 95);
      setProgress(pct);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, durationMs]);

  const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-[var(--node-radius)] bg-bg-dark px-4">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      <div className="flex flex-col items-center gap-1 text-text-muted">
        <Film className="h-4 w-4" />
        <span className="text-xs">
          {minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`}
        </span>
      </div>
      <div className="h-1 w-3/4 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent transition-all duration-1000 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
});

GeneratingIndicator.displayName = 'ExportVideoGeneratingIndicator';

export const ExportVideoNode = memo(({ id, data, selected, width, height }: ExportVideoNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const connectNodes = useCanvasStore((state) => state.onConnect);
  const { zoom } = useViewport();
  const videoRef = useRef<HTMLVideoElement>(null);

  const isGenerating = data.isGenerating ?? false;
  const generationError = data.generationError?.trim() ?? '';
  const hasGenerationError = !isGenerating && !data.videoUrl && generationError.length > 0;
  const hasContent = Boolean(data.videoUrl) || Boolean(data.imageUrl);
  const mediaType = data.mediaType ?? 'video';
  const resolvedAspectRatio = data.aspectRatio || DEFAULT_ASPECT_RATIO;
  const compactSize = resolveMinEdgeFittedSize(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resolvedWidth = resolveNodeDimension(width, compactSize.width);
  const resolvedHeight = resolveNodeDimension(height, compactSize.height);
  const resizeConstraints = resolveResizeMinConstraintsByAspect(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeMinWidth = resizeConstraints.minWidth;
  const resizeMinHeight = resizeConstraints.minHeight;
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.exportVideo, data),
    [data]
  );

  const imageSource = useMemo(() => {
    return resolveImageSourceByZoom(
      zoom,
      data.imageUrl,
      data.previewImageUrl,
      data.tinyPreviewImageUrl,
    );
  }, [data.imageUrl, data.previewImageUrl, data.tinyPreviewImageUrl, zoom]);

  const originalImageUrl = useMemo(() => {
    if (!data.imageUrl) return null;
    return resolveImageDisplayUrl(data.imageUrl);
  }, [data.imageUrl]);

  const handleCaptureFrame = useCallback(async () => {
    try {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) return;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) {
        console.error('[ExportVideoNode] Capture failed: toBlob returned null (possibly cross-origin video)');
        return;
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      const prepared = await prepareNodeImageBinary(bytes, 'png');

      const currentNodes = useCanvasStore.getState().nodes;
      const sourceNode = currentNodes.find((n) => n.id === id);
      const offsetX = (sourceNode?.measured?.width ?? 300) + 40;
      const newNodeId = addNode(
        CANVAS_NODE_TYPES.exportImage,
        {
          x: (sourceNode?.position.x ?? 0) + offsetX,
          y: sourceNode?.position.y ?? 0,
        },
        {
          imageUrl: prepared.imagePath,
          previewImageUrl: prepared.previewImagePath,
          tinyPreviewImageUrl: prepared.tinyPreviewImagePath,
          aspectRatio: prepared.aspectRatio ?? '16:9',
          mediaType: 'image',
        }
      );
      connectNodes({
        source: id,
        target: newNodeId,
        sourceHandle: 'source',
        targetHandle: 'target',
      });
    } catch (err) {
      console.error('[ExportVideoNode] Capture error:', err);
    }
  }, [addNode, connectNodes, id]);

  useEffect(() => {
    const videoUrl = data.videoUrl;
    if (!videoUrl || !videoUrl.startsWith('http')) return;

    let cancelled = false;
    downloadRemoteVideo(videoUrl)
      .then((localPath) => {
        if (cancelled) return;
        updateNodeData(id, { videoUrl: localPath });
      })
      .catch((err) => {
        console.warn('[ExportVideoNode] Failed to migrate remote video:', err);
      });

    return () => { cancelled = true; };
  }, [data.videoUrl, id, updateNodeData]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-colors duration-150
        ${hasGenerationError
          ? (selected
            ? 'border-red-400 shadow-[0_0_0_1px_rgba(248,113,113,0.42)]'
            : 'border-red-500/70 bg-[rgba(127,29,29,0.12)] hover:border-red-400/80 dark:border-red-500/70 dark:hover:border-red-400/80')
          : selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Video className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      {isGenerating ? (
        <GeneratingIndicator
          startedAt={data.generationStartedAt ?? null}
          durationMs={data.generationDurationMs ?? 180000}
        />
      ) : hasGenerationError ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[var(--node-radius)] bg-[rgba(127,29,29,0.2)] px-4">
          <AlertTriangle className="h-7 w-7 text-red-500" />
          <span className="text-center text-[12px] font-medium leading-5 text-red-500">
            {t('node.imageNode.generationFailed')}
          </span>
          <span className="max-h-[88px] overflow-y-auto break-words text-center text-[11px] leading-5 text-red-400">
            {generationError}
          </span>
        </div>
      ) : hasContent ? (
        <div className="flex flex-col h-full w-full overflow-hidden rounded-[var(--node-radius)] bg-bg-dark">
          {mediaType === 'video' && data.videoUrl ? (
            <>
              <CanvasNodeVideo
                ref={videoRef}
                src={resolveImageDisplayUrl(data.videoUrl)}
                className="flex-1 w-full min-h-0"
                crossOrigin="anonymous"
              />
              <VideoProgressBar videoRef={videoRef} onCapture={handleCaptureFrame} />
            </>
          ) : data.imageUrl ? (
            <CanvasNodeImage
              src={imageSource ?? ''}
              alt={t('node.imageNode.resultAlt')}
              viewerSourceUrl={originalImageUrl}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-muted/85">
              <Video className="h-7 w-7 opacity-60" />
              <span className="px-4 text-center text-[12px] leading-6">
                {t('node.imageNode.waitingResult')}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-muted/85 bg-bg-dark rounded-[var(--node-radius)]">
          <Video className="h-7 w-7 opacity-60" />
          <span className="px-4 text-center text-[12px] leading-6">
            {t('node.imageNode.waitingResult')}
          </span>
        </div>
      )}

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle
        minWidth={resizeMinWidth}
        minHeight={resizeMinHeight}
        maxWidth={1600}
        maxHeight={1600}
      />
    </div>
  );
});

ExportVideoNode.displayName = 'ExportVideoNode';
