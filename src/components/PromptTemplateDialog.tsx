import { useState, useCallback, useEffect } from 'react';
import { X, Plus, Trash2, Copy, Check, FileText, Image, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePromptTemplateStore, type PromptTemplate, type PromptTemplateCategory } from '@/stores/promptTemplateStore';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';

interface PromptTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_ICONS: Record<PromptTemplateCategory, React.ReactNode> = {
  text: <FileText className="w-3.5 h-3.5" />,
  image: <Image className="w-3.5 h-3.5" />,
  video: <Video className="w-3.5 h-3.5" />,
};

export function PromptTemplateDialog({ isOpen, onClose }: PromptTemplateDialogProps) {
  const { t } = useTranslation();
  const templates = usePromptTemplateStore((state) => state.templates);
  const addTemplate = usePromptTemplateStore((state) => state.addTemplate);
  const updateTemplate = usePromptTemplateStore((state) => state.updateTemplate);
  const deleteTemplate = usePromptTemplateStore((state) => state.deleteTemplate);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState<PromptTemplateCategory>('text');
  const [isNewTemplate, setIsNewTemplate] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<PromptTemplateCategory>('text');

  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);

  const selectedTemplate = selectedId ? templates.find((t) => t.id === selectedId) : null;

  const filteredTemplates = templates.filter((t) => t.category === activeCategory);

  useEffect(() => {
    if (isOpen) {
      setSelectedId(null);
      setEditTitle('');
      setEditContent('');
      setEditCategory('text');
      setIsNewTemplate(false);
      setCopiedId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedTemplate && !isNewTemplate) {
      setEditTitle(selectedTemplate.title);
      setEditContent(selectedTemplate.content);
      setEditCategory(selectedTemplate.category);
    }
  }, [selectedTemplate, isNewTemplate]);

  const handleSelectTemplate = useCallback((template: PromptTemplate) => {
    setSelectedId(template.id);
    setEditTitle(template.title);
    setEditContent(template.content);
    setEditCategory(template.category);
    setIsNewTemplate(false);
  }, []);

  const handleNewTemplate = useCallback(() => {
    setSelectedId(null);
    setEditTitle('');
    setEditContent('');
    setEditCategory(activeCategory);
    setIsNewTemplate(true);
  }, [activeCategory]);

  const handleSave = useCallback(() => {
    const trimmedTitle = editTitle.trim();
    const trimmedContent = editContent.trim();

    if (!trimmedTitle || !trimmedContent) {
      return;
    }

    if (isNewTemplate) {
      addTemplate(trimmedTitle, trimmedContent, editCategory);
      setIsNewTemplate(false);
    } else if (selectedId) {
      updateTemplate(selectedId, trimmedTitle, trimmedContent, editCategory);
    }

    onClose();
  }, [editTitle, editContent, editCategory, isNewTemplate, selectedId, addTemplate, updateTemplate, onClose]);

  const handleDelete = useCallback((id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    deleteTemplate(id);
    if (selectedId === id) {
      setSelectedId(null);
      setEditTitle('');
      setEditContent('');
      setEditCategory('text');
      setIsNewTemplate(false);
    }
  }, [deleteTemplate, selectedId]);

  const handleCopy = useCallback(async (template: PromptTemplate, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(template.content);
      setCopiedId(template.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy template content', error);
    }
  }, []);

  if (!shouldRender) return null;

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 flex items-center justify-center`}>
      <div
        className={`absolute inset-0 bg-black/90 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`relative w-[min(96vw,800px)] transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="relative mx-auto h-[480px] w-[600px] overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl flex">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1 hover:bg-bg-dark rounded transition-colors z-10"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>

          {/* Sidebar - Template List */}
          <div className="w-[200px] bg-bg-dark border-r border-border-dark flex flex-col">
            <div className="px-4 py-4 flex items-center justify-between">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                {t('promptTemplate.title')}
              </span>
              <button
                type="button"
                onClick={handleNewTemplate}
                className="p-1 hover:bg-surface-dark rounded transition-colors"
                title={t('promptTemplate.add')}
              >
                <Plus className="w-4 h-4 text-text-muted" />
              </button>
            </div>

            {/* Category tabs */}
            <div className="px-2 pb-2 flex gap-1">
              {(['text', 'image', 'video'] as const).map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs transition-colors ${
                    activeCategory === category
                      ? 'bg-accent/20 text-text-dark'
                      : 'text-text-muted hover:bg-surface-dark hover:text-text-dark'
                  }`}
                >
                  {CATEGORY_ICONS[category]}
                  <span>{t(`promptTemplate.category.${category}`)}</span>
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto ui-scrollbar">
              {filteredTemplates.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs text-text-muted">{t('promptTemplate.emptyHint')}</p>
                </div>
              ) : (
                <div className="px-2 py-1 space-y-1">
                  {filteredTemplates.map((template) => (
                    <div
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      className={`group flex items-center gap-2 px-2 py-2 rounded cursor-pointer transition-colors ${
                        selectedId === template.id
                          ? 'bg-accent/10 text-text-dark'
                          : 'text-text-muted hover:bg-surface-dark hover:text-text-dark'
                      }`}
                    >
                      <span className="flex-1 text-sm truncate">{template.title || t('promptTemplate.untitled')}</span>
                      <button
                        type="button"
                        onClick={(e) => handleCopy(template, e)}
                        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-bg-dark rounded transition-opacity"
                        title={t('promptTemplate.copy')}
                      >
                        {copiedId === template.id ? (
                          <Check className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-text-muted" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(template.id, e)}
                        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-opacity"
                        title={t('promptTemplate.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-red-400" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Content - Editor */}
          <div className="flex-1 flex flex-col">
            <div className="px-6 py-5 border-b border-border-dark">
              <h2 className="text-lg font-semibold text-text-dark">
                {isNewTemplate ? t('promptTemplate.add') : selectedTemplate ? t('promptTemplate.edit') : t('promptTemplate.title')}
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto ui-scrollbar p-6 space-y-4">
              {(selectedTemplate || isNewTemplate) ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-text-dark mb-2">
                      {t('promptTemplate.titleLabel')}
                    </label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder={t('promptTemplate.titlePlaceholder')}
                      className="w-full rounded border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark placeholder:text-text-muted focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-dark mb-2">
                      {t('promptTemplate.categoryLabel')}
                    </label>
                    <div className="flex gap-2">
                      {(['text', 'image', 'video'] as const).map((category) => (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setEditCategory(category)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                            editCategory === category
                              ? 'bg-accent/20 text-text-dark'
                              : 'text-text-muted border border-border-dark hover:bg-surface-dark hover:text-text-dark'
                          }`}
                        >
                          {CATEGORY_ICONS[category]}
                          <span>{t(`promptTemplate.category.${category}`)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1">
                    <label className="block text-sm font-medium text-text-dark mb-2">
                      {t('promptTemplate.contentLabel')}
                    </label>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder={t('promptTemplate.contentPlaceholder')}
                      rows={10}
                      className="w-full rounded border border-border-dark bg-bg-dark px-3 py-2 text-sm text-text-dark placeholder:text-text-muted focus:border-accent focus:outline-none resize-none"
                    />
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-text-muted">
                    {filteredTemplates.length > 0 ? t('promptTemplate.selectHint') : t('promptTemplate.emptyHint')}
                  </p>
                </div>
              )}
            </div>

            {(selectedTemplate || isNewTemplate) && (
              <div className="px-6 py-4 border-t border-border-dark flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-text-dark border border-border-dark rounded hover:bg-bg-dark transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!editTitle.trim() || !editContent.trim()}
                  className="px-4 py-2 text-sm font-medium bg-accent text-white rounded hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('common.save')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}