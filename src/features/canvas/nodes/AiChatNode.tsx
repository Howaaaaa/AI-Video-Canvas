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
import { MessageSquare, Loader2, ChevronDown, X, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  type AiChatNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  graphImageResolver,
} from '@/features/canvas/application/canvasServices';
import {
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
import { chat, setApiKey, type ChatMessage } from '@/commands/ai';

const TEXT_RESULT_NODE_DEFAULT_WIDTH = 300;
const TEXT_RESULT_NODE_DEFAULT_HEIGHT = 180;

interface ChatProvider {
  id: string;
  label: string;
}

interface ChatModelOption {
  id: string;
  label: string;
  providerId: string;
}

const CHAT_PROVIDERS: ChatProvider[] = [
  { id: 'grsai', label: 'GRSAI' },
  { id: 'doubao', label: '豆包' },
];

const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  // GRSAI models
  { id: 'grsai/gemini-3.1-pro', label: 'Gemini 3.1 Pro', providerId: 'grsai' },
  { id: 'grsai/gemini-3-pro', label: 'Gemini 3 Pro', providerId: 'grsai' },
  { id: 'grsai/gemini-2.5-pro', label: 'Gemini 2.5 Pro', providerId: 'grsai' },
  // Doubao models
  { id: 'doubao/doubao-seed-2-0-mini-260215', label: 'Seed 2.0 Mini', providerId: 'doubao' },
  { id: 'doubao/doubao-seed-2-0-lite-260215', label: 'Seed 2.0 Lite', providerId: 'doubao' },
];

type AiChatNodeProps = NodeProps & {
  id: string;
  data: AiChatNodeData;
  selected?: boolean;
};

const AI_CHAT_NODE_MIN_WIDTH = 600;
const AI_CHAT_NODE_MIN_HEIGHT = 300;
const AI_CHAT_NODE_MAX_WIDTH = 1200;
const AI_CHAT_NODE_MAX_HEIGHT = 600;
const AI_CHAT_NODE_DEFAULT_WIDTH = 500;
const AI_CHAT_NODE_DEFAULT_HEIGHT = 300;

export const AiChatNode = memo(({ id, data, selected, width, height }: AiChatNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();

  const rootRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickerCursor, setPickerCursor] = useState<number | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);
  const [isLoading, setIsLoading] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [defaultPromptDraft, setDefaultPromptDraft] = useState(() => data.defaultPrompt ?? '');
  const [selectedModelId, setSelectedModelId] = useState(() => data.model ?? 'doubao/doubao-seed-2-0-mini-260215');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [panelProviderId, setPanelProviderId] = useState(() => {
    const initialModel = CHAT_MODEL_OPTIONS.find((m) => m.id === (data.model ?? 'doubao/doubao-seed-2-0-mini-260215'));
    return initialModel?.providerId ?? 'doubao';
  });
  const modelTriggerRef = useRef<HTMLDivElement>(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);

  const templates = usePromptTemplateStore((state) => state.templates);
  const textTemplates = useMemo(() => templates.filter((t) => t.category === 'text'), [templates]);

  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const apiKeys = useSettingsStore((state) => state.apiKeys);

  const selectedModel = CHAT_MODEL_OPTIONS.find((m) => m.id === selectedModelId) ?? CHAT_MODEL_OPTIONS[0];
  const selectedProvider = CHAT_PROVIDERS.find((p) => p.id === selectedModel.providerId) ?? CHAT_PROVIDERS[0];
  const providerApiKey = apiKeys[selectedModel.providerId] ?? '';
  const providerModels = useMemo(
    () => CHAT_MODEL_OPTIONS.filter((m) => m.providerId === panelProviderId),
    [panelProviderId]
  );

  const incomingImages = useMemo(
    () => graphImageResolver.collectInputImages(id, nodes, edges),
    [id, nodes, edges]
  );

  const incomingImageItems = useMemo(
    () =>
      incomingImages.map((imageUrl, index) => ({
        imageUrl,
        displayUrl: resolveImageDisplayUrl(imageUrl),
        label: `图${index + 1}`,
      })),
    [incomingImages]
  );
  const incomingImageViewerList = useMemo(
    () => incomingImageItems.map((item) => resolveImageDisplayUrl(item.imageUrl)),
    [incomingImageItems]
  );

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.aiChat, data),
    [data]
  );

  const resolvedWidth = Math.max(AI_CHAT_NODE_MIN_WIDTH, Math.round(width ?? AI_CHAT_NODE_DEFAULT_WIDTH));
  const resolvedHeight = Math.max(AI_CHAT_NODE_MIN_HEIGHT, Math.round(height ?? AI_CHAT_NODE_DEFAULT_HEIGHT));

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
    const externalDefaultPrompt = data.defaultPrompt ?? '';
    if (externalDefaultPrompt !== defaultPromptDraft) {
      setDefaultPromptDraft(externalDefaultPrompt);
    }
  }, [data.defaultPrompt, defaultPromptDraft]);

  useEffect(() => {
    const externalModel = data.model ?? 'doubao/doubao-seed-2-0-mini-260215';
    if (externalModel !== selectedModelId) {
      setSelectedModelId(externalModel);
    }
  }, [data.model, selectedModelId]);

  const commitDefaultPromptDraft = useCallback((nextPrompt: string) => {
    setDefaultPromptDraft(nextPrompt);
    updateNodeData(id, { defaultPrompt: nextPrompt });
  }, [id, updateNodeData]);

  const syncPromptHighlightScroll = () => {
    if (!promptRef.current || !promptHighlightRef.current) return;
    promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
    promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
  };

  const commitPromptDraft = useCallback((nextPrompt: string) => {
    promptDraftRef.current = nextPrompt;
    updateNodeData(id, { prompt: nextPrompt });
  }, [id, updateNodeData]);

  useEffect(() => {
    if (incomingImages.length === 0) {
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      return;
    }

    setPickerActiveIndex((previous) => Math.min(previous, incomingImages.length - 1));
  }, [incomingImages.length]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as globalThis.Node)) {
        return;
      }
      if (modelPanelRef.current?.contains(event.target as globalThis.Node)) {
        return;
      }

      setShowImagePicker(false);
      setPickerCursor(null);
      setShowModelPicker(false);
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, []);

  const handleSend = useCallback(async () => {
    const userPrompt = promptDraft.replace(/@(?=图\d+)/g, '').trim();
    if (!userPrompt) {
      return;
    }

    if (!providerApiKey) {
      return;
    }

    if (isLoading) {
      return;
    }

    setIsLoading(true);

    // 设置 API key
    await setApiKey(selectedModel.providerId, providerApiKey);

    // 创建下游文本注释节点
    const newNodePosition = findNodePosition(
      id,
      TEXT_RESULT_NODE_DEFAULT_WIDTH,
      TEXT_RESULT_NODE_DEFAULT_HEIGHT
    );
    const newNodeId = addNode(
      CANVAS_NODE_TYPES.textAnnotation,
      newNodePosition,
      {
        content: t('node.aiChat.loading'),
        displayName: t('node.aiChat.responseTitle'),
      }
    );
    addEdge(id, newNodeId);

    try {
      const messages: ChatMessage[] = [];

      // Add system prompt if available
      const systemPrompt = data.systemPrompt?.trim();
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }

      // Add user message with default prompt appended
      const defaultPrompt = defaultPromptDraft?.trim();
      const fullPrompt = defaultPrompt
        ? `${userPrompt}\n\n${defaultPrompt}`
        : userPrompt;
      messages.push({ role: 'user', content: fullPrompt });

      const response = await chat({
        model: selectedModel.id,
        messages,
        images: incomingImages.length > 0 ? incomingImages : undefined,
      });

      // Update the text annotation node with the response
      updateNodeData(newNodeId, { content: response.content });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateNodeData(newNodeId, { content: `${t('node.aiChat.error')}: ${errorMessage}` });
    } finally {
      setIsLoading(false);
    }
  }, [id, promptDraft, providerApiKey, isLoading, findNodePosition, addNode, addEdge, t, data.systemPrompt, defaultPromptDraft, incomingImages, updateNodeData, selectedModel]);

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
        incomingImages.length
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

    if (showImagePicker && incomingImages.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPickerActiveIndex((previous) => (previous + 1) % incomingImages.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPickerActiveIndex((previous) =>
          previous === 0 ? incomingImages.length - 1 : previous - 1
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
      void handleSend();
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
        icon={<MessageSquare className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      {/* 输入区域 */}
      <div className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2 mb-2">
        <div className="relative h-full min-h-0">
          <div
            ref={promptHighlightRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="min-h-full whitespace-pre-wrap break-words px-1 py-0.5">
              {renderPromptWithHighlights(promptDraft, incomingImages.length)}
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
            placeholder={t('node.aiChat.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words"
            style={{ scrollbarGutter: 'stable' }}
          />
        </div>

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
                  className={`flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)] ${pickerActiveIndex === index
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

      {/* 默认提示词区域 */}
      <div className="mb-2">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-xs text-text-muted">{t('node.aiChat.defaultPrompt')}</span>
          {textTemplates.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowTemplatePicker(!showTemplatePicker);
                }}
                className="flex items-center gap-0.5 px-1 py-0.5 text-xs text-text-muted hover:text-text-dark rounded transition-colors"
              >
                <FileText className="w-3 h-3" />
                <ChevronDown className="w-3 h-3" />
              </button>
              {showTemplatePicker && (
                <div
                  className="absolute left-0 top-full z-30 mt-1 w-32 overflow-hidden rounded-lg border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-lg"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="max-h-[200px] overflow-y-auto">
                  {textTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        commitDefaultPromptDraft(template.content);
                        setShowTemplatePicker(false);
                      }}
                      className="w-full px-2 py-1.5 text-left text-xs text-text-dark hover:bg-bg-dark truncate"
                    >
                      {template.title || t('promptTemplate.untitled')}
                    </button>
                  ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {defaultPromptDraft && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                commitDefaultPromptDraft('');
              }}
              className="ml-auto p-0.5 text-text-muted hover:text-text-dark rounded transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <textarea
          value={defaultPromptDraft}
          onChange={(event) => {
            const nextValue = event.target.value;
            commitDefaultPromptDraft(nextValue);
          }}
          onMouseDown={(event) => event.stopPropagation()}
          placeholder={t('node.aiChat.defaultPromptPlaceholder')}
          className="ui-scrollbar nodrag nowheel w-full h-16 resize-none overflow-y-auto rounded border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 px-2 py-1 text-xs leading-5 text-text-dark outline-none placeholder:text-text-muted/60 focus:border-[rgba(255,255,255,0.2)]"
        />
      </div>

      {/* 底部控制栏 */}
      <div className="mt-2 flex shrink-0 items-center gap-1">
        <div ref={modelTriggerRef} className="relative flex">
          <UiChipButton
            title={t('modelParams.model')}
            className={`${NODE_CONTROL_CHIP_CLASS} ${NODE_CONTROL_MODEL_CHIP_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              setPanelProviderId(selectedModel.providerId);
              setShowModelPicker(!showModelPicker);
            }}
          >
            <span className="truncate">{selectedModel.label}</span>
            <span className="shrink-0 text-text-muted/80">{selectedProvider.label}</span>
          </UiChipButton>
        </div>
        <div className="ml-auto" />

        <UiButton
          onClick={(event) => {
            event.stopPropagation();
            void handleSend();
          }}
          variant="primary"
          disabled={isLoading}
          className={`shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
        >
          {isLoading ? (
            <Loader2 className={`${NODE_CONTROL_ICON_CLASS} animate-spin`} />
          ) : (
            <MessageSquare className={NODE_CONTROL_ICON_CLASS} />
          )}
          {isLoading ? t('node.aiChat.sending') : t('node.aiChat.send')}
        </UiButton>
      </div>

      {/* Model picker popup */}
      {typeof document !== 'undefined' && showModelPicker && createPortal(
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
          <UiPanel className="min-w-[280px] p-2">
            <div className="space-y-3">
              <section>
                <div className="mb-2 text-xs font-medium text-text-muted">
                  {t('modelParams.provider')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {CHAT_PROVIDERS.map((provider) => {
                    const active = provider.id === panelProviderId;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (provider.id !== panelProviderId) {
                            const firstModel = CHAT_MODEL_OPTIONS.find(
                              (m) => m.providerId === provider.id
                            );
                            if (firstModel) {
                              setSelectedModelId(firstModel.id);
                              updateNodeData(id, { model: firstModel.id });
                            }
                          }
                          setPanelProviderId(provider.id);
                        }}
                        className={`h-8 min-w-[80px] rounded-lg border text-xs transition-colors ${
                          active
                            ? 'border-accent/50 bg-accent/15 text-text-dark'
                            : 'border-[rgba(255,255,255,0.12)] bg-bg-dark/65 text-text-muted hover:border-[rgba(255,255,255,0.2)]'
                        }`}
                      >
                        {provider.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="mb-2 text-xs font-medium text-text-muted">
                  {t('modelParams.model')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {providerModels.map((model) => {
                    const active = model.id === selectedModelId;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedModelId(model.id);
                          updateNodeData(id, { model: model.id });
                          setShowModelPicker(false);
                        }}
                        className={`inline-flex min-h-9 min-w-[100px] max-w-full items-center justify-center rounded-lg border px-3 py-2 text-xs leading-4 transition-colors ${
                          active
                            ? 'border-accent/50 bg-accent/15 text-text-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                            : 'border-[rgba(255,255,255,0.12)] bg-bg-dark/65 text-text-muted hover:border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.05)]'
                        }`}
                      >
                        <span className="max-w-full break-words text-center">{model.label}</span>
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
        minWidth={AI_CHAT_NODE_MIN_WIDTH}
        minHeight={AI_CHAT_NODE_MIN_HEIGHT}
        maxWidth={AI_CHAT_NODE_MAX_WIDTH}
        maxHeight={AI_CHAT_NODE_MAX_HEIGHT}
      />
    </div>
  );
});

AiChatNode.displayName = 'AiChatNode';
