import type { ImageModelDefinition } from '../../types';
import { createFixedResolutionPricing } from '@/features/canvas/pricing';

export const KIE_GPT_IMAGE_2_MODEL_ID = 'kie/gpt-image-2';

const GPT_IMAGE_2_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '9:16',
  '16:9',
  '4:3',
  '3:4',
] as const;

export const imageModel: ImageModelDefinition = {
  id: KIE_GPT_IMAGE_2_MODEL_ID,
  mediaType: 'image',
  displayName: 'GPT Image 2 (KIE)',
  providerId: 'kie',
  description: 'KIE · GPT Image 2 图像生成与编辑',
  eta: '1min',
  expectedDurationMs: 60000,
  defaultAspectRatio: 'auto',
  defaultResolution: '1K',
  aspectRatios: GPT_IMAGE_2_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: [
    { value: '1K', label: '1K' },
    { value: '2K', label: '2K' },
    { value: '4K', label: '4K' },
  ],
  pricing: createFixedResolutionPricing({
    currency: 'USD',
    standardRates: {
      '1K': 0.04,
      '2K': 0.06,
      '4K': 0.09,
    },
    discountedRates: {
      '1K': 0.025,
      '2K': 0.04,
      '4K': 0.06,
    },
  }),
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: KIE_GPT_IMAGE_2_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '图生图' : '文生图',
  }),
};
