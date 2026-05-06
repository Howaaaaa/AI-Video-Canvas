import { invoke } from '@tauri-apps/api/core';

export interface ProjectSummaryRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  projectGroupId?: string | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  nodesJson: string;
  edgesJson: string;
  viewportJson: string;
  historyJson: string;
}

export interface ProjectGroupRecord {
  id: string;
  name: string;
  projectCount: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export async function listProjectSummaries(): Promise<ProjectSummaryRecord[]> {
  return await invoke<ProjectSummaryRecord[]>('list_project_summaries');
}

export async function getProjectRecord(projectId: string): Promise<ProjectRecord | null> {
  return await invoke<ProjectRecord | null>('get_project_record', { projectId });
}

export async function upsertProjectRecord(record: ProjectRecord): Promise<void> {
  await invoke('upsert_project_record', { record });
}

export async function updateProjectViewportRecord(
  projectId: string,
  viewportJson: string
): Promise<void> {
  await invoke('update_project_viewport_record', { projectId, viewportJson });
}

export async function renameProjectRecord(
  projectId: string,
  name: string,
  updatedAt: number
): Promise<void> {
  await invoke('rename_project_record', { projectId, name, updatedAt });
}

export async function deleteProjectRecord(projectId: string): Promise<void> {
  await invoke('delete_project_record', { projectId });
}

export async function listProjectGroups(): Promise<ProjectGroupRecord[]> {
  return await invoke<ProjectGroupRecord[]>('list_project_groups');
}

export async function createProjectGroup(
  id: string,
  name: string,
  createdAt: number
): Promise<void> {
  await invoke('create_project_group', { id, name, createdAt });
}

export async function renameProjectGroup(
  groupId: string,
  name: string,
  updatedAt: number
): Promise<void> {
  await invoke('rename_project_group', { groupId, name, updatedAt });
}

export async function deleteProjectGroup(
  groupId: string,
  deleteProjects: boolean
): Promise<void> {
  await invoke('delete_project_group', { groupId, deleteProjects });
}

export async function assignProjectToGroup(
  projectId: string,
  groupId: string | null
): Promise<void> {
  await invoke('assign_project_to_group', { projectId, groupId });
}
