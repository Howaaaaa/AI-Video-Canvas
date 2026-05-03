---
title: "LemonData Video API"
url: "https://docs.lemondata.cc/zh/api-reference/video/create-video"
captured_at: "2026-05-03"
---
# LemonData Video API 文档

## 视频生成

### 端点信息
- **方法**: POST
- **路径**: `/v1/videos/generations`
- **Base URL**: `https://api.lemondata.cc`

### 请求示例

seedance-2.0-fast 文生视频：
```bash
curl --request POST \
  --url https://api.lemondata.cc/v1/videos/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --header 'User-Agent: Mozilla/5.0' \
  --data '
{
  "model": "seedance-2.0-fast",
  "operation": "text-to-video",
  "prompt": "一只猫在阳光下散步",
  "duration": 5,
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "watermark": false,
  "output_audio": false
}
'
```

seedance-2.0-fast 参考图生视频：
```bash
curl --request POST \
  --url https://api.lemondata.cc/v1/videos/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --header 'User-Agent: Mozilla/5.0' \
  --data '
{
  "model": "seedance-2.0-fast",
  "operation": "reference-to-video",
  "prompt": "一段多参考图引导的视频",
  "duration": 8,
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "watermark": false,
  "output_audio": false,
  "image_urls": [
    "https://your-cos-bucket.cos.ap-nanjing.myqcloud.com/upload/ref1.png",
    "https://your-cos-bucket.cos.ap-nanjing.myqcloud.com/upload/ref2.png"
  ]
}
'
```

viduq3-turbo 图生视频：
```bash
curl --request POST \
  --url https://api.lemondata.cc/v1/videos/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --header 'User-Agent: Mozilla/5.0' \
  --data '
{
  "model": "viduq3-turbo",
  "operation": "image-to-video",
  "prompt": "一段剧情演绎",
  "duration": 8,
  "aspect_ratio": "9:16",
  "resolution": "1080p",
  "watermark": false,
  "audio": true,
  "bgm": false,
  "image": "https://your-cos-bucket.cos.ap-nanjing.myqcloud.com/upload/xxx.png"
}
'
```

### 响应示例（提交成功）
```json
{
  "id": "ldtask_a43bfdd0da6057b1143d21c68a09ddd6",
  "task_id": "ldtask_a43bfdd0da6057b1143d21c68a09ddd6",
  "poll_url": "/v1/tasks/ldtask_a43bfdd0da6057b1143d21c68a09ddd6",
  "status": "pending",
  "model": "viduq3-turbo",
  "created": 1706000000
}
```

### 503 模型不可用错误响应
当模型通道全部不可用时，返回 503，error 对象中包含重试建议：
```json
{
  "error": {
    "message": "Model [redacted] is temporarily unavailable. Please try again later.",
    "type": "all_channels_failed",
    "code": "model_unavailable",
    "retryable": true,
    "retry_after": 30,
    "hint": "All channels for 'viduq3-turbo' are temporarily unavailable.",
    "supported_operations": ["image-to-video", "start-end-to-video", "text-to-video"],
    "supported_parameters": ["aspect_ratio", "audio", "bgm", "duration", "end_image", "image", "operation", "prompt", "resolution"],
    "allowed_resolutions": ["540p", "720p", "1080p"],
    "recommended_request": {
      "operation": "text-to-video",
      "duration": 5,
      "aspect_ratio": "16:9",
      "resolution": "720p",
      "output_audio": true
    }
  }
}
```
注意：该错误仍会扣费（pre:video 计费），不应在客户端自动重试，应提示用户切换模型或等待后手动重试。

---

## 请求参数

### Authorization
- **类型**: string
- **位置**: header
- **必填**: 是
- **说明**: `Bearer YOUR_API_KEY`

### 请求体 (application/json)

#### model
- **类型**: string
- **必填**: 是
- **说明**: 视频模型 ID
- **可用模型**:
  - `seedance-2.0-fast` — 支持 text-to-video / image-to-video / start-end-to-video / reference-to-video
  - `viduq3-turbo` — 支持 text-to-video / image-to-video / start-end-to-video（不支持 reference-to-video）

#### operation
- **类型**: string
- **必填**: 是
- **说明**: 视频生成操作模式。不同模型支持的模式不同（见模型概览表）。

#### prompt
- **类型**: string
- **必填**: 是
- **说明**: 描述视频内容的文本提示词

#### duration
- **类型**: integer
- **必填**: 是
- **说明**: 生成视频时长（秒）。可用值取决于模型。

#### aspect_ratio
- **类型**: string
- **必填**: 是
- **说明**: 宽高比，如 `16:9`、`9:16`、`1:1`、`3:4`、`4:3`、`21:9`

#### resolution
- **类型**: string
- **必填**: 是
- **说明**: 输出分辨率。不同模型支持不同选项（见模型概览表）。

#### watermark
- **类型**: boolean
- **说明**: 是否添加水印。固定传 `false`。

---

## 模型差异化参数

### 图片输入参数

| 参数 | seedance-2.0-fast | viduq3-turbo | 适用操作 |
|------|:--:|:--:|------|
| `image_url` | ✓ | — | image-to-video、start-end-to-video 起始帧 |
| `end_image_url` | ✓ | — | start-end-to-video 结束帧 |
| `image_urls` | ✓（最多 9） | — | reference-to-video 多参考图 |
| `image` | — | ✓ | image-to-video、start-end-to-video 起始帧 |
| `end_image` | — | ✓ | start-end-to-video 结束帧 |

### 音频参数

| 参数 | seedance-2.0-fast | viduq3-turbo |
|------|:--:|:--:|
| `output_audio` | ✓（bool） | — |
| `audio` | — | ✓（bool） |
| `bgm` | — | ✓（bool） |

---

## 查询任务状态

### 端点信息
- **方法**: GET
- **路径**: 优先使用提交响应中的 `poll_url`（通常为 `/v1/tasks/{task_id}`）
- **完整 URL**: `https://api.lemondata.cc/v1/tasks/{task_id}`

### 请求示例
```bash
curl --request GET \
  --url https://api.lemondata.cc/v1/tasks/ldtask_a43bfdd0da6057b1143d21c68a09ddd6 \
  --header 'Authorization: Bearer <token>' \
  --header 'User-Agent: Mozilla/5.0'
```

### 响应示例

进行中：
```json
{
  "id": "ldtask_a43bfdd0da6057b1143d21c68a09ddd6",
  "status": "pending",
  "task_id": "ldtask_a43bfdd0da6057b1143d21c68a09ddd6",
  "poll_url": "/v1/tasks/ldtask_a43bfdd0da6057b1143d21c68a09ddd6"
}
```

完成：
```json
{
  "status": "completed",
  "video_url": "https://lemondata-output.cos.ap-nanjing.myqcloud.com/xxx.mp4",
  "error": null
}
```

失败：
```json
{
  "status": "failed",
  "video_url": null,
  "error": "Generation failed: prompt content policy violation"
}
```

### 状态值
- `pending` / `queued` — 排队等待
- `running` / `processing` — 处理中
- `completed` / `succeeded` — 成功，`video_url` 包含结果
- `failed` — 失败，`error` 包含原因

### 轮询策略
- 间隔：**20 秒**
- 超时：**20 分钟**
- 优先使用创建响应返回的 `poll_url`

---

## 查询模型信息

### 端点信息
- **方法**: GET
- **路径**: `/v1/models/{model_id}`
- **示例**: `GET https://api.lemondata.cc/v1/models/viduq3-turbo`

返回模型完整参数 schema（分辨率、时长、比例、支持的操作等）。

---

## 模型能力对比

| | seedance-2.0-fast | viduq3-turbo |
|------|------|------|
| text-to-video | ✓ | ✓ |
| image-to-video | ✓ | ✓ |
| start-end-to-video | ✓ | ✓ |
| reference-to-video | ✓（最多 9 图） | ✗ |
| 最大参考图 | 9 | 2 |
| 分辨率 | 480p, 720p | 540p, 720p, 1080p |
| 时长（秒） | 4, 5, 6, 8, 10, 12, 15 | 4, 5, 6, 8, 10, 12, 15 |
| 宽高比 | 1:1, 3:4, 4:3, 9:16, 16:9, 21:9 | 1:1, 3:4, 4:3, 9:16, 16:9, 21:9 |
| 音频控制 | `output_audio` | `audio` + `bgm` |
| 起始帧参数 | `image_url` | `image` |
| 结束帧参数 | `end_image_url` | `end_image` |
| 多参考图参数 | `image_urls` | 不支持 |

---

## 错误码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | API Key 无效或缺失 |
| 422 | 参数校验失败 |
| 500 | 服务器内部错误 |
| 503 | 模型通道不可用（含 `retryable`/`retry_after` 提示，但仍会扣费，不应自动重试） |
