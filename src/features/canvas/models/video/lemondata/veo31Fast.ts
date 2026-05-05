import type { VideoModelDefinition } from '../../types';

export const LEMONDATA_VEO31_FAST_MODEL_ID = 'lemondata/veo3.1-fast';

const VEO31_ASPECT_RATIOS = ['auto', '16:9', '9:16'] as const;

export const videoModel: VideoModelDefinition = {
  id: LEMONDATA_VEO31_FAST_MODEL_ID,
  mediaType: 'video',
  displayName: 'Veo 3.1 Fast (LemonData)',
  providerId: 'lemondata',
  description: 'LemonData · Google Veo 3.1 Fast 视频生成',
  eta: '1-2min',
  expectedDurationMs: 120000,
  defaultAspectRatio: 'auto',
  defaultDuration: 8,
  aspectRatios: VEO31_ASPECT_RATIOS.map((value) => ({ value, label: value === 'auto' ? 'Auto' : value })),
  durations: [
    { value: 4, label: '4s' },
    { value: 6, label: '6s' },
    { value: 8, label: '8s' },
  ],
  resolutions: [
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
  ],
  extraParamsSchema: [
    {
      key: 'generate_audio',
      label: 'Generate Audio',
      labelKey: 'modelParams.generateAudio',
      type: 'boolean',
      defaultValue: true,
    },
  ],
  defaultExtraParams: {
    generate_audio: true,
  },
  operations: [
    { value: 'text-to-video', label: 'Text to Video' },
    { value: 'image-to-video', label: 'Image to Video' },
    { value: 'start-end-to-video', label: 'Start-End to Video' },
    { value: 'reference-to-video', label: 'Reference to Video' },
  ],
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: LEMONDATA_VEO31_FAST_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? 'Image to Video' : 'Text to Video',
  }),
};
