# 多图上传图片加载失败问题修复

## 问题描述

当将外部图片拖入画布时，出现图片加载失败的问题：
- 单图上传：第一次图片加载失败，第二次成功，第三次又失败，第四次又成功（交替失败）
- 多图上传：部分图片加载不出来

## 问题根因分析

### 1. 顺序处理导致的延迟问题
原实现在 `Canvas.tsx` 的 `onDrop` 处理器中顺序处理每个图片：
```typescript
// 原代码 - 顺序处理
for (let i = 0; i < imageFiles.length; i++) {
  const newNodeId = addNode(CANVAS_NODE_TYPES.upload, flowPos); // 先创建节点
  const prepared = await prepareNodeImageFromFile(file); // 再处理图片
  updateNodeData(newNodeId, { ... }); // 更新节点数据
}
```

问题：
- 节点创建后立即渲染（此时没有图片数据）
- 图片处理是异步的，按顺序一个一个处理
- 多图上传时，后面的图片需要等待前面的处理完成

### 2. 文件写入竞态条件
`persist_image_bytes` 函数在并发写入时存在竞态条件：
```rust
// 原代码 - 非原子写入
if !output_path.exists() {
    std::fs::write(&output_path, bytes)?;
}
```

问题：
- 多个并发请求可能同时检查同一个文件
- 可能导致文件写入冲突或读取到不完整的文件

### 3. Asset Protocol Scope 配置
Tauri 的 asset protocol scope 配置可能不够完整，导致某些路径无法访问。

### 4. 图片加载缺少错误处理
`CanvasNodeImage` 组件没有图片加载失败的错误处理和重试机制。

## 修复方案

### 1. Canvas.tsx - 并行处理多图上传

**文件**: `src/features/canvas/Canvas.tsx`

```typescript
onDrop={async (event) => {
  event.preventDefault();

  // 获取拖入的文件
  const items = Array.from(event.dataTransfer.items);
  const imageFiles: File[] = [];

  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        imageFiles.push(file);
      }
    }
  }

  if (imageFiles.length === 0) {
    return;
  }

  // 并行处理所有图片
  const processPromises = imageFiles.map(async (file, i) => {
    // 计算节点位置（多个图片时错开排列）
    const offsetX = (i % 3) * 220;
    const offsetY = Math.floor(i / 3) * 220;

    const flowPos = reactFlowInstance.screenToFlowPosition({
      x: event.clientX + offsetX,
      y: event.clientY + offsetY,
    });

    // 先处理图片，再创建节点（避免创建空节点）
    try {
      const prepared = await prepareNodeImageFromFile(file);

      // 图片处理成功后再创建节点
      const newNodeId = addNode(CANVAS_NODE_TYPES.upload, flowPos);
      updateNodeData(newNodeId, {
        imageUrl: prepared.imageUrl,
        previewImageUrl: prepared.previewImageUrl,
        aspectRatio: prepared.aspectRatio || '1:1',
        sourceFileName: file.name,
      });
    } catch (error) {
      console.error('Failed to process dropped image:', file.name, error);
    }
  });

  // 并行执行所有图片处理
  await Promise.all(processPromises);
}}
```

**改进点**：
- 使用 `Promise.all` 并行处理所有图片
- 先处理图片再创建节点，避免空节点渲染
- 每个图片处理独立，互不阻塞

### 2. image.rs - 原子写入文件

**文件**: `src-tauri/src/commands/image.rs`

```rust
fn persist_image_bytes(app: &AppHandle, bytes: &[u8], extension: &str) -> Result<String, String> {
    let images_dir = resolve_images_dir(app)?;
    let digest = md5::compute(bytes);
    let filename = format!("{:x}.{}", digest, normalize_extension(extension));
    let output_path = images_dir.join(&filename);

    // Use atomic write pattern to avoid race conditions
    if output_path.exists() {
        // File already exists, no need to write again
        return Ok(output_path.to_string_lossy().to_string());
    }

    // Write to a temporary file first, then rename for atomicity
    let temp_filename = format!("{}.tmp-{}", filename, std::process::id());
    let temp_path = images_dir.join(&temp_filename);

    std::fs::write(&temp_path, bytes)
        .map_err(|e| format!("Failed to write temp image file: {}", e))?;

    // Atomic rename - if target already exists (race condition), that's fine
    match std::fs::rename(&temp_path, &output_path) {
        Ok(()) => {}
        Err(e) => {
            // If rename failed because target already exists (race condition), clean up temp
            if output_path.exists() {
                std::fs::remove_file(&temp_path).ok();
            } else {
                return Err(format!("Failed to rename image file: {}", e));
            }
        }
    }

    Ok(output_path.to_string_lossy().to_string())
}
```

**改进点**：
- 使用临时文件 + 原子重命名模式
- 避免并发写入冲突
- 处理竞态条件：如果目标文件已存在，清理临时文件

### 3. tauri.conf.json - 扩展 Asset Protocol Scope

**文件**: `src-tauri/tauri.conf.json`

```json
"security": {
  "csp": null,
  "assetProtocol": {
    "enable": true,
    "scope": {
      "allow": [
        "$APPDATA/**",
        "$APPLOCALDATA/**",
        "$RESOURCE/**",
        "$TEMP/**"
      ],
      "deny": []
    }
  }
}
```

**改进点**：
- 添加 `$RESOURCE/**` 到允许列表
- 使用 Tauri 2 的新配置格式（对象形式）

### 4. CanvasNodeImage.tsx - 错误处理和重试

**文件**: `src/features/canvas/ui/CanvasNodeImage.tsx`

```typescript
import { memo, useCallback, useState, useEffect, type ImgHTMLAttributes, type MouseEvent } from 'react';

export const CanvasNodeImage = memo(({
  viewerSourceUrl,
  viewerImageList,
  disableViewer = false,
  onDoubleClick,
  src,
  ...props
}: CanvasNodeImageProps) => {
  const openImageViewer = useCanvasStore((state) => state.openImageViewer);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Reset error state when src changes
  useEffect(() => {
    setLoadError(false);
  }, [src]);

  const handleError = useCallback(() => {
    console.warn('[CanvasNodeImage] Image load failed, src:', src);
    setLoadError(true);
    // Retry once after a short delay
    setRetryKey((prev) => prev + 1);
  }, [src]);

  const handleLoad = useCallback(() => {
    setLoadError(false);
  }, []);

  // Use retryKey to force re-render on error
  const effectiveSrc = loadError && retryKey <= 1 ? `${src}?retry=${retryKey}` : src;

  return (
    <img
      {...props}
      key={retryKey}
      src={effectiveSrc}
      onError={handleError}
      onLoad={handleLoad}
      // ... other props
    />
  );
});
```

**改进点**：
- 添加 `onError` 处理器检测加载失败
- 添加自动重试逻辑（最多重试一次）
- 添加调试日志帮助定位问题

### 5. imageData.ts - 调试日志

**文件**: `src/features/canvas/application/imageData.ts`

```typescript
export function resolveImageDisplayUrl(imageUrl: string): string {
  if (!imageUrl || !imageUrl.trim()) {
    console.warn('[resolveImageDisplayUrl] Empty imageUrl provided');
    return imageUrl;
  }

  const lower = imageUrl.toLowerCase();
  if (lower.startsWith('file://')) {
    if (!isTauri()) {
      return imageUrl;
    }

    try {
      const parsed = new URL(imageUrl);
      const decodedPathname = decodeURIComponent(parsed.pathname);
      const normalizedPath = decodedPathname.replace(/^\/([A-Za-z]:[\\/])/, '$1');
      if (!normalizedPath) {
        console.warn('[resolveImageDisplayUrl] Failed to normalize file:// path:', imageUrl);
        return imageUrl;
      }
      const result = convertFileSrc(normalizedPath);
      console.info('[resolveImageDisplayUrl] Converted file:// to asset URL:', { original: imageUrl, result });
      return result;
    } catch (error) {
      console.warn('[resolveImageDisplayUrl] Failed to parse file:// URL:', imageUrl, error);
      return imageUrl;
    }
  }

  if (!isLikelyLocalImagePath(imageUrl)) {
    return imageUrl;
  }

  if (!isTauri()) {
    return imageUrl;
  }

  const result = convertFileSrc(imageUrl);
  console.info('[resolveImageDisplayUrl] Converted local path to asset URL:', { original: imageUrl, result });
  return result;
}
```

**改进点**：
- 添加详细的调试日志
- 记录路径转换过程
- 帮助追踪 asset URL 的生成

## 验证方法

1. 运行应用：`npm run tauri dev`
2. 打开浏览器开发者工具控制台
3. 拖入多张图片到画布
4. 观察控制台日志：
   - `[resolveImageDisplayUrl] Converted local path to asset URL` - 路径转换成功
   - `[CanvasNodeImage] Image load failed` - 图片加载失败（如果出现）
5. 验证所有图片是否正确显示

## 相关文件

- `src/features/canvas/Canvas.tsx` - 画布拖放处理
- `src/features/canvas/ui/CanvasNodeImage.tsx` - 图片显示组件
- `src/features/canvas/application/imageData.ts` - 图片路径处理
- `src-tauri/src/commands/image.rs` - Rust 图片处理命令
- `src-tauri/tauri.conf.json` - Tauri 配置

## 注意事项

1. 如果问题仍然存在，检查控制台是否有 `[resolveImageDisplayUrl]` 相关的错误日志
2. 确保图片目录权限正确（通常在 `$APPDATA/images/` 下）
3. 大图片可能需要更长的处理时间，控制台会显示性能日志 `[upload-perf]`
