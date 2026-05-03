import { invoke } from '@tauri-apps/api/core';
import { saveImageSourceToDirectory, saveImageSourceToPath } from './image';

function ensureMp4Extension(filePath: string): string {
  if (filePath.toLowerCase().endsWith('.mp4')) {
    return filePath;
  }
  return `${filePath}.mp4`;
}

export async function prepareNodeVideoBinary(
  bytes: Uint8Array,
  extension?: string,
): Promise<string> {
  return await invoke('prepare_node_video_binary', {
    bytes: Array.from(bytes),
    extension,
  });
}

export async function downloadRemoteVideo(url: string): Promise<string> {
  return await invoke('download_remote_video', { url });
}

export async function copyVideoToClipboard(source: string): Promise<void> {
  return await invoke('copy_video_to_clipboard', { source });
}

export async function saveVideoSourceToPath(source: string, targetPath: string): Promise<string> {
  return saveImageSourceToPath(source, ensureMp4Extension(targetPath));
}

export async function saveVideoSourceToDirectory(
  source: string,
  targetDir: string,
  suggestedFileName?: string
): Promise<string> {
  return saveImageSourceToDirectory(source, targetDir, suggestedFileName);
}
