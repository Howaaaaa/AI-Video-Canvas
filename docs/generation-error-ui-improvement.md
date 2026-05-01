# 生成错误提示优化

## 问题描述

当 AI 图片生成失败时，错误提示只显示原始的错误信息（如 "Network error: error sending request for url..."），用户难以理解错误原因和解决方法。

## 解决方案

### 1. 错误类型解析

在 `generationErrorReport.ts` 中添加 `parseGenerationError` 函数，解析错误信息并返回用户友好的提示：

```typescript
export interface ParsedGenerationError {
  type: 'network' | 'auth' | 'quota' | 'server' | 'timeout' | 'invalid_request' | 'unknown';
  shortMessage: string;
  suggestion: string;
}

export function parseGenerationError(errorMessage: string, errorDetails?: string): ParsedGenerationError {
  const combinedMessage = `${errorMessage} ${errorDetails || ''}`.toLowerCase();

  // Network errors
  if (combinedMessage.includes('network error') || combinedMessage.includes('error sending request')) {
    return {
      type: 'network',
      shortMessage: '网络连接失败',
      suggestion: '请检查网络连接，或稍后重试。如果问题持续，可能是服务器暂时不可用。',
    };
  }

  // Timeout errors
  if (combinedMessage.includes('timeout')) {
    return {
      type: 'timeout',
      shortMessage: '请求超时',
      suggestion: '服务器响应过慢，请稍后重试。如果问题持续，请尝试使用其他模型。',
    };
  }

  // Authentication errors
  if (combinedMessage.includes('unauthorized') || combinedMessage.includes('api key')) {
    return {
      type: 'auth',
      shortMessage: 'API 密钥无效',
      suggestion: '请检查设置中的 API 密钥是否正确配置。',
    };
  }

  // ... 其他错误类型
}
```

### 2. 错误类型与图标映射

| 错误类型 | 图标 | 简短提示 | 解决建议 |
|---------|------|---------|---------|
| network | WifiOff | 网络连接失败 | 请检查网络连接，或稍后重试 |
| timeout | Clock | 请求超时 | 服务器响应过慢，请稍后重试 |
| auth | Key | API 密钥无效 | 请检查设置中的 API 密钥是否正确配置 |
| quota | AlertTriangle | 配额不足或请求过于频繁 | 请检查账户余额，或稍后重试 |
| server | ServerOff | 服务器错误 | AI 服务暂时不可用，请稍后重试 |
| invalid_request | AlertTriangle | 请求参数无效 | 请检查提示词和参考图片是否符合要求 |
| unknown | AlertTriangle | 原始错误信息 | 请稍后重试，或尝试使用其他模型 |

### 3. UI 显示优化

在 `ImageNode.tsx` 中更新错误显示：

```tsx
{hasGenerationError ? (
  <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-red-300">
    {errorIcon}
    <span className="text-center text-[12px] font-medium leading-5 text-red-200">
      {parsedError?.shortMessage || t('node.imageNode.generationFailed')}
    </span>
    {parsedError?.suggestion && (
      <span className="max-h-[60px] overflow-y-auto break-words text-center text-[11px] leading-5 text-red-200/80">
        {parsedError.suggestion}
      </span>
    )}
    <span className="max-h-[48px] overflow-y-auto break-words text-center text-[10px] leading-4 text-red-200/60">
      {generationError}
    </span>
  </div>
) : ...}
```

### 4. 显示效果

错误信息现在分为三层：
1. **简短提示**（大字体）：用户友好的错误描述
2. **解决建议**（中字体）：具体的解决方法
3. **原始错误**（小字体、淡化）：技术细节，供高级用户参考

## 示例

### 网络错误
```
[图标: WifiOff]
网络连接失败
请检查网络连接，或稍后重试。如果问题持续，可能是服务器暂时不可用。
Network error: error sending request for url (https://grsai.dakka.com.cn/...)
```

### API 密钥错误
```
[图标: Key]
API 密钥无效
请检查设置中的 API 密钥是否正确配置。
Unauthorized: Invalid API key
```

### 服务器错误
```
[图标: ServerOff]
服务器错误
AI 服务暂时不可用，请稍后重试。
Internal server error (500)
```

## 相关文件

- `src/features/canvas/application/generationErrorReport.ts` - 错误解析逻辑
- `src/features/canvas/nodes/ImageNode.tsx` - 错误显示 UI
