import type { ImageModelDefinition } from '../../types';
import { createMultiplierPricing, isHighThinkingEnabled } from '@/features/canvas/pricing';

export const APIPUDDING_NANO_BANANA_2_MODEL_ID = 'apipudding/nano-banana-2';

const ASPECT_RATIOS = [
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
] as const;

export const imageModel: ImageModelDefinition = {
  id: APIPUDDING_NANO_BANANA_2_MODEL_ID,
  mediaType: 'image',
  displayName: 'Nano Banana 2 (布丁)',
  providerId: 'apipudding',
  description: '布丁 · Nano Banana 2 图像生成与编辑',
  eta: '1min',
  expectedDurationMs: 60000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: [
    { value: '1K', label: '1K' },
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
    baseAmount: 0.5,
    resolutionMultipliers: {
      '1K': 1,
    },
    resolveExtraCharges: ({ extraParams }) =>
      (extraParams?.enable_web_search === true ? 0.015 : 0) +
      (isHighThinkingEnabled(extraParams) ? 0.002 : 0),
  }),
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: APIPUDDING_NANO_BANANA_2_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
  }),
};
