import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CosConfig } from '@/stores/settingsStore';

export async function setCosConfig(config: CosConfig): Promise<void> {
  console.info('[COS] set_cos_config', {
    region: config.region,
    bucket: config.bucket,
    hasSecretId: Boolean(config.secretId),
    hasSecretKey: Boolean(config.secretKey),
    tauri: isTauri(),
  });
  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }
  return await invoke('set_cos_config', { config });
}
