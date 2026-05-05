import {
  type KeyboardEvent,
  memo,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Video, SlidersHorizontal, FileText, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type AiVideoNodeData,
  type UserVideoGenerationMode,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  canvasAiGateway,
  graphImageResolver,
} from '@/features/canvas/application/canvasServices';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import {
  detectAspectRatio,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import {
  insertReferenceToken,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/features/canvas/application/referenceTokenEditing';
import {
  PICKER_FALLBACK_ANCHOR,
  renderPromptWithHighlights,
  resolvePickerAnchor,
  type PickerAnchor,
} from '@/features/canvas/application/referenceTokenUi';
import {
  DEFAULT_VIDEO_MODEL_ID,
  getModelProvider,
  getVideoModel,
  listVideoModels,
  type ModelProviderDefinition,
} from '@/features/canvas/models';
import { generateVideo } from '@/commands/ai';
import { setCosConfig } from '@/commands/cos';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { UiButton, UiChipButton, UiPanel } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePromptTemplateStore } from '@/stores/promptTemplateStore';

type AiVideoNodeProps = NodeProps & {
  id: string;
  data: AiVideoNodeData;
  selected?: boolean;
};

interface AspectRatioChoice {
  value: string;
  label: string;
}

interface DurationChoice {
  value: number;
  label: string;
}

const AI_VIDEO_NODE_MIN_WIDTH = 600;
const AI_VIDEO_NODE_MIN_HEIGHT = 300;
const AI_VIDEO_NODE_MAX_WIDTH = 1400;
const AI_VIDEO_NODE_MAX_HEIGHT = 1000;
const AI_VIDEO_NODE_DEFAULT_WIDTH = 500;
const AI_VIDEO_NODE_DEFAULT_HEIGHT = 300;

// User-selectable generation mode
export type UserGenerationMode = UserVideoGenerationMode;

// Internal API operation mode
type ApiOperationMode = 'text-to-video' | 'image-to-video' | 'start-end-to-video' | 'reference-to-video';

function resolveApiOperationMode(
  userMode: UserGenerationMode,
  imageCount: number
): ApiOperationMode {
  if (imageCount === 0) return 'text-to-video';

  if (userMode === 'start-end') {
    if (imageCount === 1) return 'image-to-video';
    return 'start-end-to-video';
  }

  // reference mode
  return 'reference-to-video';
}

function getApiOperationLabel(mode: ApiOperationMode, t: (key: string) => string): string {
  switch (mode) {
    case 'text-to-video':
      return t('node.aiVideo.textToVideo');
    case 'image-to-video':
      return t('node.aiVideo.imageToVideo');
    case 'start-end-to-video':
      return t('node.aiVideo.startEndToVideo');
    case 'reference-to-video':
      return t('node.aiVideo.referenceToVideo');
    default:
      return mode;
  }
}

function getRatioPreviewStyle(ratio: string): { width: number; height: number } {
  const [rawW, rawH] = ratio.split(':').map((v) => Number(v));
  const w = Number.isFinite(rawW) && rawW > 0 ? rawW : 1;
  const h = Number.isFinite(rawH) && rawH > 0 ? rawH : 1;
  const box = 18;
  if (w >= h) {
    return { width: box, height: Math.max(6, Math.round((box * h) / w)) };
  }
  return { width: Math.max(6, Math.round((box * w) / h)), height: box };
}

export const AiVideoNode = memo(({ id, data, selected, width, height }: AiVideoNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const [error, setError] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const paramsTriggerRef = useRef<HTMLDivElement>(null);
  const paramsPanelRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLDivElement>(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);
  const [showParamsPanel, setShowParamsPanel] = useState(false);
  const [showModelPanel, setShowModelPanel] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [panelProviderId, setPanelProviderId] = useState(() => {
    const modelId = data.model ?? DEFAULT_VIDEO_MODEL_ID;
    return getVideoModel(modelId).providerId;
  });
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickerCursor, setPickerCursor] = useState<number | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);

  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const cosConfig = useSettingsStore((state) => state.cosConfig);

  const incomingImages = useMemo(
    () => graphImageResolver.collectInputImages(id, nodes, edges),
    [id, nodes, edges]
  );

  const videoModels = useMemo(() => listVideoModels(), []);
  const templates = usePromptTemplateStore((state) => state.templates);
  const videoTemplates = useMemo(() => templates.filter((t) => t.category === 'video'), [templates]);

  const selectedModel = useMemo(() => {
    const modelId = data.model ?? DEFAULT_VIDEO_MODEL_ID;
    return getVideoModel(modelId);
  }, [data.model]);

  const supportsReferenceMode = useMemo(
    () => selectedModel.operations.some((op) => op.value === 'reference-to-video'),
    [selectedModel.operations]
  );

  const maxReferenceImages = useMemo(
    () => supportsReferenceMode ? 9 : 2,
    [supportsReferenceMode]
  );

  const incomingImageItems = useMemo(
    () =>
      incomingImages.slice(0, maxReferenceImages).map((imageUrl, index) => ({
        imageUrl,
        displayUrl: resolveImageDisplayUrl(imageUrl),
        label: `图${index + 1}`,
      })),
    [incomingImages, maxReferenceImages]
  );

  const providerApiKey = apiKeys[selectedModel.providerId] ?? '';

  const providerOptions = useMemo<ModelProviderDefinition[]>(() => {
    const seen = new Set<string>();
    const result: ModelProviderDefinition[] = [];
    videoModels.forEach((model) => {
      if (seen.has(model.providerId)) return;
      seen.add(model.providerId);
      result.push(getModelProvider(model.providerId));
    });
    return result;
  }, [videoModels]);

  const panelModels = useMemo(
    () => videoModels.filter((model) => model.providerId === panelProviderId),
    [videoModels, panelProviderId]
  );

  const selectedModelName = useMemo(() => {
    const name = selectedModel.displayName.replace(/\s*\([^)]*\)\s*$/u, '').trim();
    return name || selectedModel.displayName;
  }, [selectedModel.displayName]);

  const selectedProviderName = useMemo(() => {
    const provider = getModelProvider(selectedModel.providerId);
    return provider.label || provider.name;
  }, [selectedModel.providerId]);

  const aspectRatioOptions = useMemo<AspectRatioChoice[]>(
    () => selectedModel.aspectRatios,
    [selectedModel.aspectRatios]
  );

  const selectedAspectRatio = useMemo(
    () =>
      aspectRatioOptions.find((item) => item.value === data.aspectRatio) ??
      aspectRatioOptions[0],
    [aspectRatioOptions, data.aspectRatio]
  );

  const outputAudio = (data.extraParams as Record<string, unknown> | undefined)?.generate_audio as boolean
    ?? (data.extraParams as Record<string, unknown> | undefined)?.output_audio as boolean
    ?? (selectedModel.defaultExtraParams as Record<string, unknown> | undefined)?.generate_audio as boolean
    ?? (selectedModel.defaultExtraParams as Record<string, unknown> | undefined)?.output_audio as boolean
    ?? false;

  // User-selectable generation mode
  const userGenerationMode: UserGenerationMode =
    !supportsReferenceMode && data.userGenerationMode === 'reference'
      ? 'start-end'
      : (data.userGenerationMode ?? 'start-end');

  const durationOptions = useMemo<DurationChoice[]>(() => {
    const durations = selectedModel.durations;
    if (selectedModel.id === 'lemondata/veo3.1-fast' && userGenerationMode === 'reference') {
      return durations.filter((d) => d.value === 8);
    }
    return durations;
  }, [selectedModel.durations, selectedModel.id, userGenerationMode]);

  const selectedDuration = useMemo(
    () =>
      durationOptions.find((item) => item.value === data.duration) ??
      durationOptions[0],
    [durationOptions, data.duration]
  );

  // Resolved API operation mode based on user selection and image count
  const apiOperationMode = useMemo(
    () => resolveApiOperationMode(userGenerationMode, incomingImages.length),
    [userGenerationMode, incomingImages.length]
  );

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.aiVideo, data),
    [data]
  );

  const resolvedWidth = Math.max(AI_VIDEO_NODE_MIN_WIDTH, Math.round(width ?? AI_VIDEO_NODE_DEFAULT_WIDTH));
  const resolvedHeight = Math.max(AI_VIDEO_NODE_MIN_HEIGHT, Math.round(height ?? AI_VIDEO_NODE_DEFAULT_HEIGHT));

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    const externalPrompt = data.prompt ?? '';
    if (externalPrompt !== promptDraftRef.current) {
      promptDraftRef.current = externalPrompt;
      setPromptDraft(externalPrompt);
    }
  }, [data.prompt]);

  useEffect(() => {
    if (incomingImages.length === 0) {
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      return;
    }
    setPickerActiveIndex((previous) => Math.min(previous, maxReferenceImages - 1));
  }, [maxReferenceImages]);

  useEffect(() => {
    if (data.model !== selectedModel.id) {
      updateNodeData(id, {
        model: selectedModel.id,
        resolution: selectedModel.resolutions[0]?.value ?? '720p',
        extraParams: selectedModel.defaultExtraParams ?? {},
      });
    }
  }, [data.model, id, selectedModel.id, selectedModel.resolutions, selectedModel.defaultExtraParams, updateNodeData]);

  const incomingImageViewerList = useMemo(
    () => incomingImageItems.map((item) => resolveImageDisplayUrl(item.imageUrl)),
    [incomingImageItems]
  );

  const syncPromptHighlightScroll = () => {
    if (!promptRef.current || !promptHighlightRef.current) return;
    promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
    promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
  };

  const commitPromptDraft = useCallback((nextPrompt: string) => {
    promptDraftRef.current = nextPrompt;
    updateNodeData(id, { prompt: nextPrompt });
  }, [id, updateNodeData]);

  const insertImageReference = useCallback((imageIndex: number) => {
    const marker = `@图${imageIndex + 1}`;
    const currentPrompt = promptDraftRef.current;
    const cursor = pickerCursor ?? currentPrompt.length;

    // 检查光标前是否已经有 @ 字符，如果有则移除它
    let adjustedPrompt = currentPrompt;
    let adjustedCursor = cursor;
    if (cursor > 0 && currentPrompt[cursor - 1] === '@') {
      adjustedPrompt = currentPrompt.slice(0, cursor - 1) + currentPrompt.slice(cursor);
      adjustedCursor = cursor - 1;
    }

    const { nextText: nextPrompt, nextCursor } = insertReferenceToken(adjustedPrompt, adjustedCursor, marker);

    setPromptDraft(nextPrompt);
    commitPromptDraft(nextPrompt);
    setShowImagePicker(false);
    setPickerCursor(null);
    setPickerActiveIndex(0);

    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextCursor, nextCursor);
      syncPromptHighlightScroll();
    });
  }, [commitPromptDraft, pickerCursor]);

  useEffect(() => {
    if (!showParamsPanel) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (paramsTriggerRef.current?.contains(target)) return;
      if (paramsPanelRef.current?.contains(target)) return;
      setShowParamsPanel(false);
    };
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [showParamsPanel]);

  useEffect(() => {
    if (!showModelPanel) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (modelTriggerRef.current?.contains(target)) return;
      if (modelPanelRef.current?.contains(target)) return;
      setShowModelPanel(false);
    };
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [showModelPanel]);

  const handleGenerate = useCallback(async () => {
    const prompt = promptDraft.trim();
    if (!prompt) {
      const errorMessage = t('node.aiVideo.promptRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    if (!providerApiKey) {
      const errorMessage = t('node.aiVideo.apiKeyRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    const generationDurationMs = selectedModel.expectedDurationMs ?? 180000;
    const generationStartedAt = Date.now();
    const resultNodeTitle = prompt.slice(0, 50) || t('node.aiVideo.resultTitle');

    setError(null);

    // Create result node immediately (waiting state)
    const newNodePosition = findNodePosition(
      id,
      EXPORT_RESULT_NODE_DEFAULT_WIDTH,
      EXPORT_RESULT_NODE_LAYOUT_HEIGHT
    );
    const newNodeId = addNode(
      CANVAS_NODE_TYPES.exportVideo,
      newNodePosition,
      {
        displayName: resultNodeTitle,
        mediaType: 'video',
        isGenerating: true,
        generationStartedAt,
        generationDurationMs,
        aspectRatio: selectedAspectRatio.value,
      }
    );
    addEdge(id, newNodeId);

    try {
      await canvasAiGateway.setApiKey(selectedModel.providerId, providerApiKey);
      await setCosConfig(cosConfig);

      let resolvedAspectRatio = selectedAspectRatio.value;
      if (resolvedAspectRatio === AUTO_REQUEST_ASPECT_RATIO && incomingImages.length > 0) {
        try {
          resolvedAspectRatio = await detectAspectRatio(incomingImages[0]);
        } catch {
          // fall back to default 16:9
          resolvedAspectRatio = '16:9';
        }
      }

      const result = await generateVideo({
        prompt,
        model: selectedModel.id,
        duration: selectedDuration.value,
        aspect_ratio: resolvedAspectRatio,
        resolution: data.resolution ?? selectedModel.resolutions[0]?.value ?? '720p',
        output_audio: outputAudio,
        user_generation_mode: userGenerationMode,
        reference_images: incomingImages,
        extra_params: data.extraParams,
      });

      // Update result node with video URL
      updateNodeData(newNodeId, {
        videoUrl: result.video_url,
        videoDuration: result.duration,
        isGenerating: false,
        generationStartedAt: null,
      });

    } catch (generationError) {
      const resolvedError = resolveErrorContent(generationError, t('ai.error'));
      const errorMessage = resolvedError.message;
      // 把技术报错翻译成大白话
      let userFriendlyMessage = errorMessage;
      if (errorMessage.includes('503') || errorMessage.includes('Service Unavailable')) {
        userFriendlyMessage = '视频模型通道繁忙或暂时不可用，建议等待片刻后重试，或切换到其他模型';
      } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        userFriendlyMessage = 'API Key 无效或未配置，请检查密钥设置';
      } else if (errorMessage.includes('timed out') || errorMessage.includes('Timeout')) {
        userFriendlyMessage = '视频生成超时，请重试';
      }
      setError(userFriendlyMessage);
      void showErrorDialog(
        userFriendlyMessage,
        t('common.error'),
        resolvedError.details
      );
      // 将错误信息写入结果节点，让其也能展示
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationError: userFriendlyMessage,
        generationErrorDetails: resolvedError.details ?? null,
      });
    }
  }, [
    promptDraft,
    providerApiKey,
    id,
    selectedModel,
    selectedDuration.value,
    selectedAspectRatio.value,
    data.resolution,
    outputAudio,
    userGenerationMode,
    incomingImages,
    data.extraParams,
    t,
    updateNodeData,
    addNode,
    addEdge,
    findNodePosition,
  ]);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const currentPrompt = promptDraftRef.current;
      const selectionStart = event.currentTarget.selectionStart ?? currentPrompt.length;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
      const deletionDirection = event.key === 'Backspace' ? 'backward' : 'forward';
      const deleteRange = resolveReferenceAwareDeleteRange(
        currentPrompt,
        selectionStart,
        selectionEnd,
        deletionDirection,
        maxReferenceImages
      );
      if (deleteRange) {
        event.preventDefault();
        const { nextText, nextCursor } = removeTextRange(currentPrompt, deleteRange);
        setPromptDraft(nextText);
        commitPromptDraft(nextText);
        requestAnimationFrame(() => {
          promptRef.current?.focus();
          promptRef.current?.setSelectionRange(nextCursor, nextCursor);
          syncPromptHighlightScroll();
        });
        return;
      }
    }

    if (showImagePicker && incomingImageItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPickerActiveIndex((previous) => (previous + 1) % incomingImageItems.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPickerActiveIndex((previous) =>
          previous === 0 ? incomingImageItems.length - 1 : previous - 1
        );
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        insertImageReference(pickerActiveIndex);
        return;
      }
    }

    if (event.key === '@' && incomingImages.length > 0) {
      event.preventDefault();
      const cursor = event.currentTarget.selectionStart ?? promptDraftRef.current.length;
      setPickerAnchor(resolvePickerAnchor(rootRef.current, event.currentTarget, cursor));
      setPickerCursor(cursor);
      setShowImagePicker(true);
      setPickerActiveIndex(0);
      return;
    }

    if (event.key === 'Escape' && showImagePicker) {
      event.preventDefault();
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleGenerate();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Video className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      {/* Prompt area */}
      <div className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2">
        <div className="relative h-full min-h-0">
          <div
            ref={promptHighlightRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="min-h-full whitespace-pre-wrap break-words px-1 py-0.5">
              {renderPromptWithHighlights(promptDraft, maxReferenceImages)}
            </div>
          </div>

          <textarea
            ref={promptRef}
            value={promptDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              setPromptDraft(nextValue);
              commitPromptDraft(nextValue);
            }}
            onKeyDown={handlePromptKeyDown}
            onScroll={syncPromptHighlightScroll}
            onMouseDown={(event) => event.stopPropagation()}
            placeholder={t('node.aiVideo.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words"
            style={{ scrollbarGutter: 'stable' }}
          />

          {showImagePicker && incomingImageItems.length > 0 && (
            <div
              className="nowheel absolute z-30 w-[120px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
              style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
              onMouseDown={(event) => event.stopPropagation()}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              <div
                className="ui-scrollbar nowheel max-h-[180px] overflow-y-auto"
                onWheelCapture={(event) => event.stopPropagation()}
              >
                {incomingImageItems.map((item, index) => (
                  <button
                    key={`${item.imageUrl}-${index}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      insertImageReference(index);
                    }}
                    onMouseEnter={() => setPickerActiveIndex(index)}
                    className={`flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)] ${
                      pickerActiveIndex === index
                        ? 'border-[rgba(255,255,255,0.24)] bg-bg-dark'
                        : ''
                    }`}
                  >
                    <CanvasNodeImage
                      src={item.displayUrl}
                      alt={item.label}
                      viewerSourceUrl={resolveImageDisplayUrl(item.imageUrl)}
                      viewerImageList={incomingImageViewerList}
                      className="h-8 w-8 rounded object-cover"
                      draggable={false}
                    />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Incoming images preview */}
      {incomingImageItems.length > 0 && (
        <div className="mt-2 flex shrink-0 gap-1">
          {incomingImageItems.slice(0, 4).map((item, index) => (
            <div
              key={`${item.imageUrl}-${index}`}
              className="relative h-12 w-12 overflow-hidden rounded border border-[rgba(255,255,255,0.1)]"
            >
              <CanvasNodeImage
                src={item.displayUrl}
                alt={item.label}
                className="h-full w-full object-cover"
                draggable={false}
              />
              <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[10px] text-white">
                {index + 1}
              </span>
            </div>
          ))}
          {incomingImageItems.length > 4 && (
            <div className="flex h-12 w-12 items-center justify-center rounded border border-[rgba(255,255,255,0.1)] bg-bg-dark text-xs text-text-muted">
              +{incomingImageItems.length - 4}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="mt-2 flex shrink-0 items-center gap-1">
        {/* Model Chip */}
        <div ref={modelTriggerRef} className="relative flex">
          <UiChipButton
            active={showModelPanel}
            className={`${NODE_CONTROL_CHIP_CLASS} ${NODE_CONTROL_MODEL_CHIP_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              setShowParamsPanel(false);
              if (showModelPanel) {
                setShowModelPanel(false);
                return;
              }
              setPanelProviderId(selectedModel.providerId);
              setShowModelPanel(true);
            }}
          >
            <Video className={`${NODE_CONTROL_ICON_CLASS} shrink-0`} />
            <span className="min-w-0 truncate text-[10px] font-medium leading-none">{selectedModelName}</span>
            <span className="shrink-0 text-[10px] leading-none text-text-muted/80">{selectedProviderName}</span>
          </UiChipButton>
        </div>

        {/* Params Chip */}
        <div ref={paramsTriggerRef} className="relative flex">
          <UiChipButton
            active={showParamsPanel}
            className={NODE_CONTROL_CHIP_CLASS}
            onClick={(event) => {
              event.stopPropagation();
              setShowModelPanel(false);
              setShowParamsPanel(!showParamsPanel);
            }}
          >
            <SlidersHorizontal className={`${NODE_CONTROL_ICON_CLASS} shrink-0`} />
            <span className="min-w-0 truncate text-[10px] leading-none">
              {getApiOperationLabel(apiOperationMode, t)} · {selectedAspectRatio.value} · {data.resolution ?? selectedModel.resolutions[0]?.value ?? '720p'} · {selectedDuration.value}s · {outputAudio ? '🔊' : '🔇'}
            </span>
          </UiChipButton>
        </div>

        {/* 默认提示词 */}
        {videoTemplates.length > 0 && (
          <div className="relative flex items-center gap-1">
            <span className="text-xs text-text-muted">{t('node.aiChat.defaultPrompt')}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setShowTemplatePicker(!showTemplatePicker);
                setShowModelPanel(false);
                setShowParamsPanel(false);
              }}
              className={`flex items-center gap-0.5 px-2 py-1 text-xs rounded transition-colors hover:bg-bg-dark ${NODE_CONTROL_CHIP_CLASS}`}
            >
              <FileText className="w-3 h-3" />
              <ChevronDown className="w-3 h-3" />
            </button>
            {showTemplatePicker && (
              <div
                className="absolute right-0 bottom-full z-30 mb-1 w-36 overflow-hidden rounded-lg border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-lg"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="max-h-[200px] overflow-y-auto">
                  {videoTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        const currentPrompt = promptDraftRef.current;
                        const separator = currentPrompt.trim() ? '\n\n' : '';
                        const nextPrompt = currentPrompt + separator + template.content;
                        setPromptDraft(nextPrompt);
                        commitPromptDraft(nextPrompt);
                        setShowTemplatePicker(false);
                      }}
                      className="w-full px-3 py-1.5 text-left text-xs text-text-dark hover:bg-bg-dark transition-colors truncate"
                    >
                      {template.title || t('promptTemplate.untitled')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="ml-auto" />

        {/* Generate button */}
        <UiButton
          onClick={(event) => {
            event.stopPropagation();
            void handleGenerate();
          }}
          variant="primary"
          className={`shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
          disabled={data.isGenerating}
        >
          <Video className={NODE_CONTROL_ICON_CLASS} strokeWidth={2.8} />
          {data.isGenerating ? t('node.aiVideo.generating') : t('canvas.generate')}
        </UiButton>
      </div>

      {/* Params Popover */}
      {typeof document !== 'undefined' && showParamsPanel && createPortal(
        <div
          ref={paramsPanelRef}
          className="fixed z-[80]"
          style={{
            left: paramsTriggerRef.current
              ? paramsTriggerRef.current.getBoundingClientRect().left
              : 0,
            top: paramsTriggerRef.current
              ? paramsTriggerRef.current.getBoundingClientRect().top - 8
              : 0,
            transform: 'translateY(-100%)',
          }}
        >
          <UiPanel className="w-[360px] p-3">
            {/* 生成方式 */}
            <div className="mb-3">
              <div className="mb-1.5 text-[11px] text-text-muted">{t('node.aiVideo.generationMode')}</div>
              <div className="flex gap-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/65 p-1">
                <button
                  type="button"
                  className={`flex-1 rounded-md py-1.5 text-xs transition-colors ${
                    userGenerationMode === 'start-end'
                      ? 'bg-surface-dark text-text-dark'
                      : 'text-text-muted hover:bg-bg-dark'
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    updateNodeData(id, { userGenerationMode: 'start-end' as UserGenerationMode });
                  }}
                >
                  {t('node.aiVideo.startEndToVideo')}
                </button>
                {supportsReferenceMode && (
                  <button
                    type="button"
                    className={`flex-1 rounded-md py-1.5 text-xs transition-colors ${
                      userGenerationMode === 'reference'
                        ? 'bg-surface-dark text-text-dark'
                        : 'text-text-muted hover:bg-bg-dark'
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateNodeData(id, { userGenerationMode: 'reference' as UserGenerationMode });
                    }}
                  >
                    {t('node.aiVideo.referenceToVideo')}
                  </button>
                )}
              </div>
            </div>

            {/* 比例 */}
            <div className="mb-3">
              <div className="mb-1.5 text-[11px] text-text-muted">{t('node.aiVideo.aspectRatio')}</div>
              <div className="grid grid-cols-5 gap-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/65 p-1">
                {aspectRatioOptions.map((option) => {
                  const active = option.value === selectedAspectRatio.value;
                  const previewStyle = getRatioPreviewStyle(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`rounded-md py-1 transition-colors ${active
                        ? 'bg-surface-dark text-text-dark'
                        : 'text-text-muted hover:bg-bg-dark'
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateNodeData(id, { aspectRatio: option.value });
                      }}
                    >
                      <div className="mb-0.5 flex h-5 items-center justify-center">
                        <span
                          className="inline-block rounded-[3px] border border-current/60"
                          style={previewStyle}
                        />
                      </div>
                      <div className="text-[10px]">{option.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 清晰度 */}
            <div className="mb-3">
              <div className="mb-1.5 text-[11px] text-text-muted">{t('node.aiVideo.resolution')}</div>
              <div className="flex gap-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/65 p-1">
                {selectedModel.resolutions.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={`flex-1 rounded-md py-1.5 text-xs transition-colors ${
                      (data.resolution ?? selectedModel.resolutions[0]?.value) === value
                        ? 'bg-surface-dark text-text-dark'
                        : 'text-text-muted hover:bg-bg-dark'
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateNodeData(id, { resolution: value });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 生成时长 */}
            <div className="mb-3">
              <div className="mb-1.5 text-[11px] text-text-muted">{t('node.aiVideo.duration')}</div>
              <div className="overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/65 p-1">
                <div className="flex gap-1 min-w-max">
                  {durationOptions.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`h-7 w-10 shrink-0 rounded-md text-xs transition-colors ${
                        selectedDuration.value === value
                          ? 'bg-surface-dark text-text-dark'
                          : 'text-text-muted hover:bg-bg-dark'
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateNodeData(id, { duration: value });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 额外参数 */}
            {selectedModel.extraParamsSchema && selectedModel.extraParamsSchema.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] text-text-muted">{t('modelParams.extraOptions')}</div>
                <div className="space-y-1.5 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/65 p-2">
                  {selectedModel.extraParamsSchema.map((def) => {
                    const currentValue = data.extraParams?.[def.key];
                    const resolvedValue =
                      typeof currentValue === 'boolean' || typeof currentValue === 'string' || typeof currentValue === 'number'
                        ? currentValue
                        : selectedModel.defaultExtraParams?.[def.key] ?? def.defaultValue;
                    const label = def.labelKey ? t(def.labelKey) : def.label;

                    if (def.type === 'boolean') {
                      return (
                        <label key={def.key} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs text-text-dark hover:bg-bg-dark/50">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded accent-accent"
                            checked={Boolean(resolvedValue)}
                            onChange={(event) => {
                              updateNodeData(id, {
                                extraParams: {
                                  ...(data.extraParams ?? {}),
                                  [def.key]: event.target.checked,
                                },
                              });
                            }}
                          />
                          <span>{label}</span>
                        </label>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            )}
          </UiPanel>
        </div>,
        document.body
      )}

      {/* Model Panel Popover */}
      {typeof document !== 'undefined' && showModelPanel && createPortal(
        <div
          ref={modelPanelRef}
          className="fixed z-[80]"
          style={{
            left: modelTriggerRef.current
              ? modelTriggerRef.current.getBoundingClientRect().left
              : 0,
            top: modelTriggerRef.current
              ? modelTriggerRef.current.getBoundingClientRect().top - 8
              : 0,
            transform: 'translateY(-100%)',
          }}
        >
          <UiPanel className="w-[320px] p-3">
            <div className="ui-scrollbar max-h-[340px] space-y-3 overflow-y-auto">
              {/* Provider tabs */}
              <section>
                  <div className="mb-2 text-xs font-medium text-text-muted">
                    {t('modelParams.provider')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {providerOptions.map((provider) => {
                      const active = provider.id === panelProviderId;
                      return (
                        <button
                          key={provider.id}
                          className={`h-8 min-w-[80px] rounded-lg border px-3 text-center text-xs transition-colors ${
                            active
                              ? 'border-accent/50 bg-accent/15 text-text-dark'
                              : 'border-[rgba(255,255,255,0.12)] bg-bg-dark/65 text-text-muted hover:border-[rgba(255,255,255,0.2)]'
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPanelProviderId(provider.id);
                          }}
                        >
                          {provider.label || provider.name}
                        </button>
                      );
                    })}
                  </div>
                </section>

              {/* Model list */}
              <section>
                <div className="mb-2 text-xs font-medium text-text-muted">
                  {t('modelParams.model')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {panelModels.map((model) => {
                    const active = model.id === selectedModel.id;
                    const name = model.displayName.replace(/\s*\([^)]*\)\s*$/u, '').trim() || model.displayName;
                    return (
                      <button
                        key={model.id}
                        className={`inline-flex max-w-full items-center rounded-lg border px-3 py-2 text-xs leading-4 transition-colors ${
                          active
                            ? 'border-accent/50 bg-accent/15 text-text-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                            : 'border-[rgba(255,255,255,0.12)] bg-bg-dark/65 text-text-muted hover:border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.05)]'
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateNodeData(id, {
                            model: model.id,
                            resolution: model.resolutions[0]?.value ?? '720p',
                            extraParams: model.defaultExtraParams ?? {},
                          });
                          setShowModelPanel(false);
                        }}
                      >
                        <span className="max-w-full break-words text-center">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          </UiPanel>
        </div>,
        document.body
      )}

      {error && <div className="mt-1 shrink-0 text-xs text-red-400">{error}</div>}

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
        minWidth={AI_VIDEO_NODE_MIN_WIDTH}
        minHeight={AI_VIDEO_NODE_MIN_HEIGHT}
        maxWidth={AI_VIDEO_NODE_MAX_WIDTH}
        maxHeight={AI_VIDEO_NODE_MAX_HEIGHT}
      />
    </div>
  );
});

AiVideoNode.displayName = 'AiVideoNode';
