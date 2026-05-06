import type { VideoModelDefinition } from '../../types';

export const LEMONDATA_SEEDANCE_2_FAST_MODEL_ID = 'lemondata/seedance-2.0-fast';

const SEEDANCE_ASPECT_RATIOS = [
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '21:9',
] as const;

export const videoModel: VideoModelDefinition = {
  id: LEMONDATA_SEEDANCE_2_FAST_MODEL_ID,
  mediaType: 'video',
  displayName: 'Seedance 2.0 Fast (LemonData)',
  providerId: 'lemondata',
  description: 'LemonData · Seedance 2.0 Fast 视频生成',
  eta: '2-3min',
  expectedDurationMs: 180000,
  defaultAspectRatio: '16:9',
  defaultDuration: 5,
  aspectRatios: SEEDANCE_ASPECT_RATIOS.map((value) => ({ value, label: value })),
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
    { value: '480p', label: '480p' },
    { value: '720p', label: '720p' },
  ],
  extraParamsSchema: [
    {
      key: 'anime_stylize',
      label: '绕开真人检测',
      labelKey: 'modelParams.animeStylize',
      type: 'enum',
      defaultValue: '1280',
      options: [
        { value: 'off', label: '关闭', labelKey: 'modelParams.animeStylizeOff' },
        { value: '1600', label: '轻度风格化', labelKey: 'modelParams.animeStylize1600' },
        { value: '1280', label: '中度风格化', labelKey: 'modelParams.animeStylize1280' },
        { value: '1024', label: '重度风格化', labelKey: 'modelParams.animeStylize1024' },
      ],
    },
    {
      key: 'output_audio',
      label: 'Generate Audio',
      labelKey: 'modelParams.generateAudio',
      type: 'boolean',
      defaultValue: true,
    },
  ],
  defaultExtraParams: {
    anime_stylize: '1280',
    output_audio: true,
  },
  operations: [
    { value: 'text-to-video', label: 'Text to Video' },
    { value: 'image-to-video', label: 'Image to Video' },
    { value: 'start-end-to-video', label: 'Start-End to Video' },
    { value: 'reference-to-video', label: 'Reference to Video' },
  ],
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: LEMONDATA_SEEDANCE_2_FAST_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? 'Image to Video' : 'Text to Video',
  }),
};