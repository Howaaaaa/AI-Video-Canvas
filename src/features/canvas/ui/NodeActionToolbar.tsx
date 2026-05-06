import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeToolbar as ReactFlowNodeToolbar } from '@xyflow/react';
import { Copy, Crop, Download, FolderOpen, PenLine, RefreshCw, Scissors, Trash2, Unlink2 } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';

import {
  NODE_TOOL_TYPES,
  isExportImageNode,
  isExportVideoNode,
  isGroupNode,
  isImageEditNode,
  isStoryboardGenNode,
  isStoryboardSplitNode,
  isTextAnnotationNode,
  isUploadNode,
  type CanvasNode,
  type NodeToolType,
  type TextAnnotationNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { getNodeToolPlugins } from '@/features/canvas/tools';
import type { ToolIconKey } from '@/features/canvas/tools';
import { UiChipButton, UiPanel } from '@/components/ui';
import {
  copyImageSourceToClipboard,
  saveImageSourceToDirectory,
  saveImageSourceToPath,
} from '@/commands/image';
import {
  copyVideoToClipboard,
  saveVideoSourceToPath,
  saveVideoSourceToDirectory,
} from '@/commands/video';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';
import { sanitizeStoryboardText } from '@/features/canvas/application/storyboardText';
import { buildGenerationErrorReport } from '@/features/canvas/application/generationErrorReport';
import {
  NODE_TOOLBAR_ALIGN,
  NODE_TOOLBAR_CLASS,
  NODE_TOOLBAR_OFFSET,
  NODE_TOOLBAR_POSITION,
} from './nodeToolbarConfig';

interface NodeActionToolbarProps {
  node: CanvasNode;
}

const toolIconMap: Record<ToolIconKey, typeof Crop> = {
  crop: Crop,
  annotate: PenLine,
  split: Scissors,
};

const TOOLBAR_BUTTON_RADIUS_CLASS = 'rounded-full';
const TOOLBAR_NEUTRAL_BUTTON_CLASS =
  'border-[rgba(255,255,255,0.18)] bg-bg-dark/70 text-text-dark hover:border-[rgba(255,255,255,0.32)] hover:bg-bg-dark';

const TEXT_COLOR_SWATCHES: { key: string; colorClass: string }[] = [
  { key: '', colorClass: 'bg-surface-dark' },
  { key: 'red', colorClass: 'bg-rose-200 dark:bg-rose-950' },
  { key: 'yellow', colorClass: 'bg-amber-200 dark:bg-amber-950' },
  { key: 'blue', colorClass: 'bg-sky-200 dark:bg-sky-950' },
  { key: 'green', colorClass: 'bg-emerald-200 dark:bg-emerald-950' },
  { key: 'purple', colorClass: 'bg-violet-200 dark:bg-violet-950' },
];

export const NodeActionToolbar = memo(({ node }: NodeActionToolbarProps) => {
  const { t, i18n } = useTranslation();
  const isImageEdit = isImageEditNode(node);
  const isStoryboardGen = isStoryboardGenNode(node);
  const isStoryboardSplit = isStoryboardSplitNode(node);
  const isTextAnnotation = isTextAnnotationNode(node);
  const textAnnotationData = isTextAnnotation ? (node.data as TextAnnotationNodeData) : null;
  const canCopyStoryboardText = isStoryboardGen || isStoryboardSplit;
  const tools = useMemo(() => getNodeToolPlugins(node), [node]);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const ungroupNode = useCanvasStore((state) => state.ungroupNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const canReupload = isUploadNode(node) && (Boolean(node.data.imageUrl) || Boolean((node.data as { videoUrl?: string | null }).videoUrl));
  const downloadPresetPaths = useSettingsStore((state) => state.downloadPresetPaths);
  const ignoreAtTagWhenCopyingAndGenerating = useSettingsStore(
    (state) => state.ignoreAtTagWhenCopyingAndGenerating
  );
  const [downloadMenu, setDownloadMenu] = useState<{ open: boolean } | null>(null);
  const [isDownloadMenuVisible, setIsDownloadMenuVisible] = useState(false);
  const [isCopySuccess, setIsCopySuccess] = useState(false);
  const [isCopyTextSuccess, setIsCopyTextSuccess] = useState(false);
  const [isCopyErrorSuccess, setIsCopyErrorSuccess] = useState(false);
  const [isCopyAnnotationSuccess, setIsCopyAnnotationSuccess] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTextFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyErrorFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyAnnotationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageSource = useMemo(() => {
    if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node) || isExportVideoNode(node)) {
      return node.data.imageUrl || node.data.previewImageUrl || node.data.tinyPreviewImageUrl || null;
    }
    return null;
  }, [node]);
  const videoSource = useMemo(() => {
    if (isUploadNode(node) || isExportVideoNode(node)) {
      return (node.data as { videoUrl?: string | null }).videoUrl || null;
    }
    return null;
  }, [node]);
  const canHandleImage = Boolean(imageSource);
  const canHandleVideo = Boolean(videoSource);
  const generationError =
    isExportImageNode(node)
    && typeof (node.data as { generationError?: unknown }).generationError === 'string'
      ? ((node.data as { generationError?: string }).generationError ?? '').trim()
      : '';
  const generationErrorDetails =
    isExportImageNode(node)
    && typeof (node.data as { generationErrorDetails?: unknown }).generationErrorDetails === 'string'
      ? ((node.data as { generationErrorDetails?: string }).generationErrorDetails ?? '').trim()
      : '';
  const canCopyGenerationError = isExportImageNode(node) && generationError.length > 0;
  const generationErrorReport = useMemo(
    () =>
      buildGenerationErrorReport({
        errorMessage: generationError || t('ai.error'),
        errorDetails: generationErrorDetails || undefined,
        context: (node.data as { generationDebugContext?: unknown }).generationDebugContext,
      }),
    [generationError, generationErrorDetails, node.data, t]
  );

  const closeDownloadMenu = useCallback(() => {
    setIsDownloadMenuVisible(false);
    if (downloadMenuCloseTimerRef.current) {
      clearTimeout(downloadMenuCloseTimerRef.current);
    }
    downloadMenuCloseTimerRef.current = setTimeout(() => {
      setDownloadMenu(null);
      downloadMenuCloseTimerRef.current = null;
    }, UI_POPOVER_TRANSITION_MS);
  }, []);

  const resolveToolLabel = useCallback((toolType: NodeToolType) => {
    if (toolType === NODE_TOOL_TYPES.crop) {
      return t('tool.crop');
    }
    if (toolType === NODE_TOOL_TYPES.annotate) {
      return t('tool.annotate');
    }
    if (toolType === NODE_TOOL_TYPES.splitStoryboard) {
      return t('tool.split');
    }
    return '';
  }, [t]);

  useEffect(() => {
    if (!downloadMenu) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const menuElement = downloadMenuRef.current;
      if (!menuElement) {
        closeDownloadMenu();
        return;
      }
      if (menuElement.contains(event.target as Node)) {
        return;
      }
      closeDownloadMenu();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [closeDownloadMenu, downloadMenu]);

  useEffect(() => {
    if (!downloadMenu) {
      return;
    }
    const frameId = requestAnimationFrame(() => {
      setIsDownloadMenuVisible(true);
    });
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [downloadMenu]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
      if (copyTextFeedbackTimerRef.current) {
        clearTimeout(copyTextFeedbackTimerRef.current);
      }
      if (copyErrorFeedbackTimerRef.current) {
        clearTimeout(copyErrorFeedbackTimerRef.current);
      }
      if (copyAnnotationTimerRef.current) {
        clearTimeout(copyAnnotationTimerRef.current);
      }
      if (downloadMenuCloseTimerRef.current) {
        clearTimeout(downloadMenuCloseTimerRef.current);
      }
    };
  }, []);

  const handleCopyImage = useCallback(async () => {
    if (!imageSource) {
      return;
    }

    setIsCopySuccess(true);
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
    copyFeedbackTimerRef.current = setTimeout(() => {
      setIsCopySuccess(false);
      copyFeedbackTimerRef.current = null;
    }, 1100);

    try {
      await copyImageSourceToClipboard(imageSource);
    } catch (error) {
      console.error('Failed to copy image to clipboard', error);
    }
  }, [imageSource]);

  const handleCopyVideo = useCallback(async () => {
    if (!videoSource) {
      return;
    }

    setIsCopySuccess(true);
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
    copyFeedbackTimerRef.current = setTimeout(() => {
      setIsCopySuccess(false);
      copyFeedbackTimerRef.current = null;
    }, 1100);

    try {
      await copyVideoToClipboard(videoSource);
    } catch (error) {
      console.error('Failed to copy video to clipboard', error);
    }
  }, [videoSource]);

  const storyboardText = useMemo(() => {
    if (isStoryboardGen) {
      return node.data.frames
        .map((frame, index) => t('nodeToolbar.storyboardLine', {
          index: String(index + 1).padStart(2, '0'),
          content: sanitizeStoryboardText(
            frame.description ?? '',
            ignoreAtTagWhenCopyingAndGenerating
          ),
        }))
        .join('\n');
    }
    if (isStoryboardSplit) {
      const orderedFrames = [...node.data.frames].sort((a, b) => a.order - b.order);
      return orderedFrames
        .map((frame, index) => t('nodeToolbar.storyboardLine', {
          index: String(index + 1).padStart(2, '0'),
          content: sanitizeStoryboardText(frame.note ?? '', ignoreAtTagWhenCopyingAndGenerating),
        }))
        .join('\n');
    }
    return '';
  }, [ignoreAtTagWhenCopyingAndGenerating, isStoryboardGen, isStoryboardSplit, node, t, i18n.language]);

  const handleCopyStoryboardText = useCallback(async () => {
    if (!storyboardText) {
      return;
    }

    setIsCopyTextSuccess(true);
    if (copyTextFeedbackTimerRef.current) {
      clearTimeout(copyTextFeedbackTimerRef.current);
    }
    copyTextFeedbackTimerRef.current = setTimeout(() => {
      setIsCopyTextSuccess(false);
      copyTextFeedbackTimerRef.current = null;
    }, 1100);

    try {
      await navigator.clipboard.writeText(storyboardText);
    } catch (error) {
      console.error('Failed to copy storyboard text', error);
    }
  }, [storyboardText]);

  const handleCopyGenerationError = useCallback(async () => {
    if (!canCopyGenerationError) {
      return;
    }

    setIsCopyErrorSuccess(true);
    if (copyErrorFeedbackTimerRef.current) {
      clearTimeout(copyErrorFeedbackTimerRef.current);
    }
    copyErrorFeedbackTimerRef.current = setTimeout(() => {
      setIsCopyErrorSuccess(false);
      copyErrorFeedbackTimerRef.current = null;
    }, 1100);

    try {
      await navigator.clipboard.writeText(generationErrorReport);
    } catch (error) {
      console.error('Failed to copy generation error report', error);
    }
  }, [canCopyGenerationError, generationErrorReport]);

  const handleDownloadSaveAs = useCallback(async () => {
    try {
      if (videoSource) {
        const selectedPath = await save({
          defaultPath: `video-${node.id}.mp4`,
          filters: [{ name: 'Video', extensions: ['mp4'] }],
        });
        if (!selectedPath || Array.isArray(selectedPath)) {
          return;
        }
        await saveVideoSourceToPath(videoSource, selectedPath);
        closeDownloadMenu();
        return;
      }
      if (!imageSource) {
        return;
      }
      const selectedPath = await save({
        defaultPath: `node-${node.id}.png`,
      });
      if (!selectedPath || Array.isArray(selectedPath)) {
        return;
      }
      await saveImageSourceToPath(imageSource, selectedPath);
      closeDownloadMenu();
    } catch (error) {
      console.error('Failed to save with save-as', error);
    }
  }, [closeDownloadMenu, imageSource, videoSource, node.id]);

  const handleDownloadToPreset = useCallback(
    async (targetDir: string) => {
      try {
        if (videoSource) {
          await saveVideoSourceToDirectory(videoSource, targetDir, `video-${node.id}`);
          closeDownloadMenu();
          return;
        }
        if (!imageSource) {
          return;
        }
        await saveImageSourceToDirectory(imageSource, targetDir, `node-${node.id}`);
        closeDownloadMenu();
      } catch (error) {
        console.error('Failed to save to preset dir', error);
      }
    },
    [closeDownloadMenu, imageSource, videoSource, node.id]
  );

  return (
    <ReactFlowNodeToolbar
      nodeId={node.id}
      isVisible
      position={NODE_TOOLBAR_POSITION}
      align={NODE_TOOLBAR_ALIGN}
      offset={NODE_TOOLBAR_OFFSET}
      className={NODE_TOOLBAR_CLASS}
    >
      <UiPanel className="flex items-center gap-1 rounded-full p-1">
        {!isImageEdit && tools.map((tool) => {
          const Icon = toolIconMap[tool.icon] ?? Crop;

          return (
            <UiChipButton
              key={tool.type}
              className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
              onClick={() =>
                canvasEventBus.publish('tool-dialog/open', {
                  nodeId: node.id,
                  toolType: tool.type,
                })
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {resolveToolLabel(tool.type)}
            </UiChipButton>
          );
        })}
        {!isImageEdit && canReupload && (
          <UiChipButton
            key="upload-reupload"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
            onClick={() =>
              canvasEventBus.publish('upload-node/reupload', {
                nodeId: node.id,
              })
            }
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('nodeToolbar.reupload')}
          </UiChipButton>
        )}
        {!isImageEdit && (canHandleImage || canHandleVideo) && (
          <UiChipButton
            key={canHandleVideo ? 'video-copy' : 'image-copy'}
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} ${
              isCopySuccess
                ? '!border-emerald-400/70 !bg-emerald-500/20 !text-emerald-200 hover:!bg-emerald-500/30'
                : ''
            }`}
            onClick={() => {
              if (canHandleVideo) {
                void handleCopyVideo();
              } else {
                void handleCopyImage();
              }
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {t('nodeToolbar.copy')}
          </UiChipButton>
        )}
        {!isImageEdit && canCopyStoryboardText && (
          <UiChipButton
            key="storyboard-text-copy"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} ${
              isCopyTextSuccess
                ? '!border-emerald-400/70 !bg-emerald-500/20 !text-emerald-200 hover:!bg-emerald-500/30'
                : ''
            }`}
            onClick={() => {
              void handleCopyStoryboardText();
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {t('nodeToolbar.copyText')}
          </UiChipButton>
        )}
        {!isImageEdit && canCopyGenerationError && (
          <UiChipButton
            key="generation-error-copy"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} ${
              isCopyErrorSuccess
                ? '!border-emerald-400/70 !bg-emerald-500/20 !text-emerald-200 hover:!bg-emerald-500/30'
                : '!border-red-500/45 !bg-red-500/15 !text-red-200 hover:!bg-red-500/25'
            }`}
            onClick={() => {
              void handleCopyGenerationError();
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {isCopyErrorSuccess ? t('nodeToolbar.copied') : t('nodeToolbar.copyErrorReport')}
          </UiChipButton>
        )}
        {!isImageEdit && (canHandleImage || canHandleVideo) && (
          <UiChipButton
            key={canHandleVideo ? 'video-download' : 'image-download'}
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              setDownloadMenu({ open: true });
              setIsDownloadMenuVisible(false);
            }}
          >
            <Download className="h-3.5 w-3.5" />
            {t('nodeToolbar.download')}
          </UiChipButton>
        )}
        {!isImageEdit && isGroupNode(node) && (
          <UiChipButton
            key="group-ungroup"
            className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} hover:!border-amber-400/60 hover:!bg-amber-500/20 hover:!text-amber-200`}
            onClick={(event) => {
              event.stopPropagation();
              closeDownloadMenu();
              ungroupNode(node.id);
            }}
          >
            <Unlink2 className="h-3.5 w-3.5" />
            {t('nodeToolbar.ungroup')}
          </UiChipButton>
        )}
        {isTextAnnotation && textAnnotationData && (
          <>
            <UiChipButton
              key="text-annotation-copy"
              className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${TOOLBAR_NEUTRAL_BUTTON_CLASS} ${
                isCopyAnnotationSuccess
                  ? '!border-emerald-400/70 !bg-emerald-500/20 !text-emerald-200 hover:!bg-emerald-500/30'
                  : ''
              }`}
              onClick={() => {
                const content = textAnnotationData.content || '';
                if (!content) return;
                navigator.clipboard.writeText(content).catch(() => {});
                setIsCopyAnnotationSuccess(true);
                if (copyAnnotationTimerRef.current) {
                  clearTimeout(copyAnnotationTimerRef.current);
                }
                copyAnnotationTimerRef.current = setTimeout(() => {
                  setIsCopyAnnotationSuccess(false);
                }, 1100);
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              {isCopyAnnotationSuccess ? t('nodeToolbar.copied') : t('node.textAnnotation.copy')}
            </UiChipButton>

            <div className="mx-1 flex items-center gap-1">
              {TEXT_COLOR_SWATCHES.map(({ key, colorClass }) => {
                const isActive = (textAnnotationData.bgColor ?? '') === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateNodeData(node.id, { bgColor: key || '' })}
                    className={`h-4 w-4 rounded-full border transition-transform ${colorClass} ${
                      isActive
                        ? 'scale-125 border-white shadow-[0_0_6px_rgba(255,255,255,0.5)]'
                        : 'border-white/40 hover:scale-110'
                    }`}
                    title={t(`node.textAnnotation.bgColor.${key || 'default'}`)}
                  />
                );
              })}
            </div>
          </>
        )}
        <UiChipButton
          key="node-delete"
          className={`h-8 ${TOOLBAR_BUTTON_RADIUS_CLASS} border-red-500/45 bg-red-500/15 px-2.5 text-xs text-red-300 hover:bg-red-500/25`}
          onClick={(event) => {
            event.stopPropagation();
            closeDownloadMenu();
            deleteNode(node.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('common.delete')}
        </UiChipButton>
      </UiPanel>

      {!isImageEdit && downloadMenu && (
        <div
          ref={downloadMenuRef}
          className={`fixed right-4 top-12 z-[120] min-w-[200px] max-w-[320px] rounded-xl border border-[rgba(255,255,255,0.18)] bg-surface-dark/95 p-2 shadow-2xl backdrop-blur-sm transition-opacity duration-150 ${isDownloadMenuVisible ? 'opacity-100' : 'opacity-0'}`}
        >
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-text-dark transition-colors hover:bg-bg-dark"
            onClick={() => {
              void handleDownloadSaveAs();
            }}
          >
            <Download className="h-4 w-4" />
            {t('nodeToolbar.saveAs')}
          </button>

          {downloadPresetPaths.length > 0 ? (
            <div className="mt-1 space-y-1 border-t border-[rgba(255,255,255,0.1)] pt-2">
              {downloadPresetPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-text-dark transition-colors hover:bg-bg-dark"
                  onClick={() => {
                    void handleDownloadToPreset(path);
                  }}
                  title={path}
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="truncate">{path}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-1 border-t border-[rgba(255,255,255,0.1)] px-2.5 pt-2 text-xs text-text-muted">
              {t('nodeToolbar.noDownloadPresetPathsHint')}
            </div>
          )}
        </div>
      )}
    </ReactFlowNodeToolbar>
  );
});

NodeActionToolbar.displayName = 'NodeActionToolbar';
