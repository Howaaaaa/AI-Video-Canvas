import type { ImageModelDefinition } from '../../types';
import { createMultiplierPricing, isHighThinkingEnabled } from '@/features/canvas/pricing';

export const APIPUDDING_NANO_BANANA_2_2K_MODEL_ID = 'apipudding/nano-banana-2-2k';

export const imageModel: ImageModelDefinition = {
  id: APIPUDDING_NANO_BANANA_2_2K_MODEL_ID,
  mediaType: 'image',
  displayName: 'Nano Banana 2-2K (布丁)',
  providerId: 'apipudding',
  description: '布丁 · Nano Banana 2-2K 固定 2K 分辨率',
  eta: '1min',
  expectedDurationMs: 60000,
  defaultAspectRatio: '1:1',
  defaultResolution: '2K',
  aspectRatios: [
    { value: '16:9', label: '16:9' },
    { value: '1:1', label: '1:1' },
    { value: '9:16', label: '9:16' },
  ],
  resolutions: [
    { value: '2K', label: '2K' },
  ],
  extraParamsSchema: [
    {
      key: 'thinking_level',
      label: 'Thinking level',
      labelKey: 'modelParams.thinkingLevel',
      type: 'enum',
      defaultValue: 'off',
      options: [
        { value: 'off', label: 'Off', labelKey: 'modelParams.thinkingDisabled' },
        { value: 'minimal', label: 'Minimal', labelKey: 'modelParams.thinkingMinimal' },
        { value: 'high', label: 'High', labelKey: 'modelParams.thinkingHigh' },
      ],
    },
  ],
  defaultExtraParams: {
    thinking_level: 'off',
  },
  pricing: createMultiplierPricing({
    currency: 'CNY',
    baseAmount: 0.6,
    resolutionMultipliers: {
      '2K': 1,
    },
    resolveExtraCharges: ({ extraParams }) =>
      (extraParams?.enable_web_search === true ? 0.015 : 0) +
      (isHighThinkingEnabled(extraParams) ? 0.002 : 0),
  }),
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: APIPUDDING_NANO_BANANA_2_2K_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
  }),
};
