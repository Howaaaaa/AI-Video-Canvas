import type { VideoModelDefinition } from '../../types';

export const LEMONDATA_VIDUQ3_TURBO_MODEL_ID = 'lemondata/viduq3-turbo';

const VIDUQ3_ASPECT_RATIOS = [
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '21:9',
] as const;

export const videoModel: VideoModelDefinition = {
  id: LEMONDATA_VIDUQ3_TURBO_MODEL_ID,
  mediaType: 'video',
  displayName: 'Vidu Q3 Turbo (LemonData)',
  providerId: 'lemondata',
  description: 'LemonData · Vidu Q3 Turbo 视频生成',
  eta: '2-3min',
  expectedDurationMs: 180000,
  defaultAspectRatio: '16:9',
  defaultDuration: 5,
  aspectRatios: VIDUQ3_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  durations: [
    { value: 4, label: '4s' },
    { value: 5, label: '5s' },
    { value: 6, label: '6s' },
    { value: 8, label: '8s' },
    { value: 10, label: '10s' },
    { value: 12, label: '12s' },
    { value: 15, label: '15s' },
  ],
  resolutions: [
    { value: '540p', label: '540p' },
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
  ],
  extraParamsSchema: [
    {
      key: 'audio',
      label: 'Audio',
      labelKey: 'modelParams.audio',
      type: 'boolean',
      defaultValue: true,
    },
    {
      key: 'bgm',
      label: 'BGM',
      labelKey: 'modelParams.bgm',
      type: 'boolean',
      defaultValue: false,
    },
  ],
  defaultExtraParams: {
    audio: true,
    bgm: false,
  },
  operations: [
    { value: 'text-to-video', label: 'Text to Video' },
    { value: 'image-to-video', label: 'Image to Video' },
    { value: 'start-end-to-video', label: 'Start-End to Video' },
  ],
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: LEMONDATA_VIDUQ3_TURBO_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? 'Image to Video' : 'Text to Video',
  }),
};
