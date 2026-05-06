import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare, Folder, FolderOpen, Pencil, Plus, Square, Trash2 } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { getConfiguredApiKeyCount, useSettingsStore } from '@/stores/settingsStore';
import { UiButton, UiSelect } from '@/components/ui/primitives';
import { MissingApiKeyHint } from '@/features/settings/MissingApiKeyHint';
import { listModelProviders } from '@/features/canvas/models';
import { RenameDialog } from './RenameDialog';
import { projectEmoji } from './projectEmoji';

interface GroupDetailProps {
  groupId: string;
  onBack: () => void;
}

type ProjectSortField = 'name' | 'createdAt' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

export function GroupDetail({ groupId, onBack }: GroupDetailProps) {
  const { t } = useTranslation();
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [sortField, setSortField] = useState<ProjectSortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<Set<string> | null>(null);
  const providerIds = useMemo(() => listModelProviders().map((provider) => provider.id), []);
  const configuredApiKeyCount = useSettingsStore((state) =>
    getConfiguredApiKeyCount(state.apiKeys, providerIds)
  );

  const { projects, groups, openProject, deleteProject, renameProject, createProject, assignProjectToGroup } =
    useProjectStore();
  const group = groups.find((g) => g.id === groupId);
  const groupProjects = useMemo(
    () => projects.filter((p) => p.projectGroupId === groupId),
    [projects, groupId]
  );
  const otherGroups = useMemo(
    () => groups.filter((g) => g.id !== groupId),
    [groups, groupId]
  );

  const isSelecting = selectedIds.size > 0;
  const selectedCount = selectedIds.size;

  const exitSelectMode = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleProjectClick = useCallback(
    (projectId: string) => {
      if (!isSelecting) {
        openProject(projectId, groupId);
      }
    },
    [isSelecting, openProject, groupId]
  );

  const handleBulkMoveToGroup = useCallback(
    (targetGroupId: string) => {
      selectedIds.forEach((pid) => assignProjectToGroup(pid, targetGroupId));
      exitSelectMode();
    },
    [selectedIds, assignProjectToGroup, exitSelectMode]
  );

  const handleBulkRemoveFromGroup = useCallback(() => {
    selectedIds.forEach((pid) => assignProjectToGroup(pid, null));
    exitSelectMode();
  }, [selectedIds, assignProjectToGroup, exitSelectMode]);

  const handleBulkDelete = useCallback(() => {
    setConfirmDeleteIds(new Set(selectedIds));
  }, [selectedIds]);

  const handleConfirmDelete = useCallback(() => {
    if (!confirmDeleteIds) return;
    confirmDeleteIds.forEach((pid) => deleteProject(pid));
    setConfirmDeleteIds(null);
    setSelectedIds(new Set());
  }, [confirmDeleteIds, deleteProject]);

  const handleCreateProject = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
    setShowRenameDialog(true);
  };

  const handleRenameClick = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(id);
    setEditingProjectName(name);
    setShowRenameDialog(true);
  };

  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteIds(new Set([id]));
  };

  const handleConfirm = (name: string) => {
    if (editingProjectId) {
      renameProject(editingProjectId, name);
    } else {
      createProject(name, groupId);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  const sortedProjects = useMemo(() => {
    const list = [...groupProjects];
    const direction = sortDirection === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      if (sortField === 'name') {
        return a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base' }) * direction;
      }

      const left = sortField === 'createdAt' ? a.createdAt : a.updatedAt;
      const right = sortField === 'createdAt' ? b.createdAt : b.updatedAt;
      return (left - right) * direction;
    });

    return list;
  }, [groupProjects, sortDirection, sortField]);

  const handleSelectAll = () => {
    if (selectedIds.size === groupProjects.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(groupProjects.map((p) => p.id)));
    }
  };

  return (
    <div className="ui-scrollbar h-full w-full overflow-auto p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header: breadcrumb + title + subtitle */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 text-text-muted hover:text-text-dark transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              {t('project.title')}
            </button>
            <svg className="w-4 h-4 text-text-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <h1 className="text-2xl font-bold text-text-dark">
              {group?.name ?? ''}
            </h1>
          </div>
          <p className="text-sm text-text-muted flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5" />
            {t('project.groupProjectCountOnly', { count: groupProjects.length })}
          </p>
        </div>

        {/* Action bar: sort controls + action buttons */}
        <div className="flex items-center justify-between mb-6 rounded-lg bg-surface-dark px-3 py-2">
          <div className="flex items-center gap-1.5">
            <UiSelect
              aria-label={t('project.sortBy')}
              value={sortField}
              onChange={(event) => setSortField(event.target.value as ProjectSortField)}
              className="h-7 w-[100px] rounded-lg text-xs"
            >
              <option value="name">{t('project.sortByName')}</option>
              <option value="createdAt">{t('project.sortByCreatedAt')}</option>
              <option value="updatedAt">{t('project.sortByUpdatedAt')}</option>
            </UiSelect>
            <UiSelect
              aria-label={t('project.sortDirection')}
              value={sortDirection}
              onChange={(event) => setSortDirection(event.target.value as SortDirection)}
              className="h-7 w-[60px] rounded-lg text-xs"
            >
              <option value="asc">{t('project.sortAsc')}</option>
              <option value="desc">{t('project.sortDesc')}</option>
            </UiSelect>
          </div>
          <div className="flex items-center gap-2">
            {selectedCount > 0 && (
              <>
                {otherGroups.length > 0 && (
                  <UiSelect
                    value=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) {
                        handleBulkMoveToGroup(val);
                      }
                    }}
                    className="h-8 w-auto min-w-[120px] rounded-lg text-xs"
                  >
                    <option value="" disabled>
                      {t('project.moveToGroup')}
                    </option>
                    {otherGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </UiSelect>
                )}
                <button
                  type="button"
                  onClick={handleBulkRemoveFromGroup}
                  className="flex items-center h-8 px-3 rounded-lg text-xs text-text-dark border border-border-dark hover:bg-bg-dark transition-colors"
                >
                  {t('project.removeFromGroup')}
                </button>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('project.delete')}
                </button>
                <span className="inline-flex items-center h-8 rounded-md bg-accent/10 px-2.5 text-xs text-accent font-medium whitespace-nowrap">
                  {t('project.selectedCount', { count: selectedCount })}
                </span>
                <button
                  type="button"
                  onClick={exitSelectMode}
                  className="flex items-center h-8 px-3 rounded-lg text-xs text-text-muted hover:text-text-dark hover:bg-bg-dark transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <div className="h-5 w-px bg-border-dark" />
              </>
            )}
            <UiButton type="button" variant="primary" onClick={handleCreateProject} className="gap-2">
              <Plus className="w-5 h-5" />
              {t('project.newProject')}
            </UiButton>
          </div>
        </div>

        {configuredApiKeyCount === 0 && <MissingApiKeyHint className="mb-8" />}

        {groupProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">{t('project.empty')}</p>
            <p className="text-sm mt-2">{t('project.emptyHint')}</p>
          </div>
        ) : (
          <>
            {/* Select-all hint */}
            {isSelecting && groupProjects.length > 0 && (
              <div className="mb-3 text-xs text-text-muted flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="flex items-center gap-1 hover:text-text-dark transition-colors"
                >
                  {selectedIds.size === groupProjects.length ? (
                    <CheckSquare className="w-3.5 h-3.5" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                  {selectedIds.size === groupProjects.length
                    ? t('common.cancel')
                    : t('project.selectAll')}
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedProjects.map((project) => {
                const isSelected = selectedIds.has(project.id);
                return (
                  <div
                    key={project.id}
                    onClick={() => handleProjectClick(project.id)}
                    className={`
                      relative rounded-lg p-4 pl-5 transition-all group overflow-hidden cursor-pointer hover:shadow-lg
                      ${isSelected
                        ? 'bg-accent/10'
                        : 'bg-surface-dark'
                      }
                    `}
                  >
                    <div className={`absolute left-0 top-0 bottom-0 w-[3px] transition-colors ${isSelected ? 'bg-accent' : 'bg-accent/25 group-hover:bg-accent/50'}`} />
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={(e) => toggleSelect(e, project.id)}
                          className="shrink-0 focus:outline-none"
                        >
                          <span className="relative block w-5 h-5">
                            {/* Emoji - visible by default, fades out on hover */}
                            <span className={`absolute inset-0 flex items-center justify-center text-base leading-none transition-opacity ${isSelected ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'}`}>
                              {projectEmoji(project.id)}
                            </span>
                            {/* Checkbox - hidden by default, fades in on hover or selected */}
                            <span className={`absolute inset-0 flex items-center justify-center transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                              {isSelected ? (
                                <CheckSquare className="w-5 h-5 text-accent" />
                              ) : (
                                <Square className="w-5 h-5 text-text-muted" />
                              )}
                            </span>
                          </span>
                        </button>
                        <h3 className="font-semibold text-text-dark truncate">
                          {project.name}
                        </h3>
                      </div>
                      {!isSelecting && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            type="button"
                            onClick={(e) => handleRenameClick(project.id, project.name, e)}
                            className="p-1 hover:bg-bg-dark rounded"
                            title={t('project.rename')}
                          >
                            <Pencil className="w-4 h-4 text-text-muted hover:text-text-dark" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteClick(project.id, e)}
                            className="p-1 hover:bg-bg-dark rounded"
                            title={t('project.delete')}
                          >
                            <Trash2 className="w-4 h-4 text-text-muted hover:text-red-500" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-text-muted">
                      <p>
                        {t('project.modified')}: {formatDate(project.updatedAt)}
                      </p>
                      <p>
                        {t('project.created')}: {formatDate(project.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Delete confirm dialog */}
      {confirmDeleteIds && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 transition-opacity duration-200"
            onClick={() => setConfirmDeleteIds(null)}
          />
          <div className="relative w-80 rounded-lg border border-border-dark bg-surface-dark p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-text-dark mb-2">
              {confirmDeleteIds.size > 1
                ? t('project.delete')
                : t('project.deleteConfirmTitle')}
            </h2>
            <p className="text-sm text-text-muted mb-1">
              {confirmDeleteIds.size > 1
                ? t('project.deleteConfirmBatch', { count: confirmDeleteIds.size })
                : t('project.deleteConfirmMessage', {
                    name: projects.find((p) => p.id === [...confirmDeleteIds][0])?.name ?? '',
                  })}
            </p>
            <p className="text-xs text-text-muted/60 mb-4">
              {t('project.deleteConfirmTip')}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteIds(null)}
                className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-dark hover:bg-bg-dark transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-lg text-sm bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors font-medium"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      <RenameDialog
        isOpen={showRenameDialog}
        title={editingProjectId ? t('project.renameTitle') : t('project.newProjectTitle')}
        defaultValue={editingProjectName}
        onClose={() => setShowRenameDialog(false)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
