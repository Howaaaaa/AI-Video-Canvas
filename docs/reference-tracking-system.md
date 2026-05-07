# 文件引用追踪系统

## 概述

项目持久化时需要追踪图片和视频文件的引用关系，防止孤儿文件堆积，同时避免误删正在使用的文件。

系统分为两层：
- **前端编码层**：节点数据中的文件路径通过 `__img_ref__:N` 编码到 `imagePool` 数组
- **Rust 引用追踪层**：解析 JSON 提取文件路径，写入 SQLite ref 表，启动时清理孤儿文件

## 追踪链路

```
前端节点 data 字段
  → mapNodeImageReferences() 编码为 __img_ref__:N
  → imagePool 数组随 history_json 存 SQLite
  → Rust 端 upsert_project_record 时解析 JSON
  → 提取字段值，resolve_image_ref 解码
  → 写入 project_image_refs / project_video_refs
  → 启动时 cleanup_unreferenced_* 扫描目录，删除不在 ref 表中的文件
```

## 字段追踪一览

| Rust 扫描的 key | 前端字段 | 写入表 | 说明 |
|---|---|---|---|
| `imageUrl` | `data.imageUrl` | `project_image_refs` | 原图 |
| `previewImageUrl` | `data.previewImageUrl` | `project_image_refs` | 预览图（384px） |
| `tinyPreviewImageUrl` | `data.tinyPreviewImageUrl` | `project_image_refs` | 极小缩略图（64px，已禁用） |
| `videoUrl` | `data.videoUrl` | `project_video_refs` | 视频文件 |

## SQLite 表结构

### project_image_refs

```sql
CREATE TABLE IF NOT EXISTS project_image_refs (
  project_id TEXT NOT NULL,
  path       TEXT NOT NULL,
  PRIMARY KEY(project_id, path)
);
CREATE INDEX IF NOT EXISTS idx_project_image_refs_path ON project_image_refs(path);
```

### project_video_refs

```sql
CREATE TABLE IF NOT EXISTS project_video_refs (
  project_id TEXT NOT NULL,
  path       TEXT NOT NULL,
  PRIMARY KEY(project_id, path)
);
CREATE INDEX IF NOT EXISTS idx_project_video_refs_path ON project_video_refs(path);
```

两个表结构完全相同，仅表名和索引名不同。

## 清理时机

| 时机 | 清理图片 | 清理视频 | 安全性 |
|---|---|---|---|
| 启动时 hydrate() | cleanup_unreferenced_images | cleanup_unreferenced_videos | 安全：此时所有项目已加载，ref 表完整 |
| 删项目 | prune_unreferenced_images | prune_unreferenced_videos | 安全：项目已删，ref 已删 |
| 删分组（含项目） | prune_unreferenced_images | prune_unreferenced_videos | 同上 |
| 每次 upsert 保存 | **不清理** | **不清理** | 防止竞争条件（之前的 bug） |

## 新增字段时的操作

当新增一个节点字段来存储本地文件路径时：

### 1. 确认是否需要追踪

- 字段值存的是本地文件路径（`<app_data>/images/` 或 `<app_data>/videos/` 下）→ **需要追踪**
- 字段值存的是远程 URL / base64 / blob → **不需要追踪**

### 2. 确认前端编码

检查 `src/stores/projectStore.ts` 的 `mapNodeImageReferences` 函数，确认新字段参与了 `__img_ref__:N` 编码。如果没有，加上：

```typescript
if ('yourNewField' in nextData) {
  nextData.yourNewField = mapImageUrl(nextData.yourNewField as string | null | undefined) ?? null;
}
```

### 3. 添加 Rust 端扫描

**文件类型对应模块**位于 `src-tauri/src/commands/project_state.rs`：

#### 图片类字段

在 `collect_image_paths_from_nodes` 的 key 数组里添加：

```rust
for key in ["imageUrl", "previewImageUrl", "tinyPreviewImageUrl", "yourNewField"] {
```

如果图片字段也可能出现在帧（frames）数据中，同步更新 frames 循环内的 key 数组。

#### 视频类字段

在 `collect_video_paths_from_nodes` 里添加：

```rust
if let Some(raw_value) = data.get("yourNewVideoField").and_then(|value| value.as_str()) {
    if let Some(path) = resolve_image_ref(raw_value, image_pool) {
        paths.insert(path);
    }
}
```

### 4. 文件存新目录时

如果文件存在独立目录（非 `images/` 或 `videos/`），还需要：

1. 新建 SQLite 表（参考 `project_video_refs` 结构）
2. 新建 `extract_project_*_paths` + `collect_*_paths_from_nodes` 函数
3. 新建 `resolve_*_dir` + `prune_unreferenced_*` 函数
4. 新建 `cleanup_unreferenced_*` Tauri 命令
5. 在 `upsert_project_record` 里维护新 ref 表（**不清理**）
6. 在 `delete_project_record` / `delete_project_group` 里删 ref + 清理

## 关键代码位置

| 文件 | 内容 |
|---|---|
| `src/stores/projectStore.ts` | 前端 `__img_ref__` 编解码、`mapNodeImageReferences`、hydrate 启动清理 |
| `src/commands/projectState.ts` | 前端 Tauri 命令绑定 |
| `src-tauri/src/commands/project_state.rs` | Rust 端 ref 提取、prune、全部 Tauri 命令实现 |
| `src-tauri/src/lib.rs` | Tauri 命令注册 |

### Rust 端核心函数速查

| 函数 | 位置（行号参考） | 作用 |
|---|---|---|
| `resolve_image_ref` | ~140 | 解码 `__img_ref__:N` 为真实路径 |
| `extract_project_image_paths` | ~200 | 从 nodes+history 提取所有图片路径 |
| `collect_image_paths_from_nodes` | ~215 | 扫描节点 data 中的图片字段 |
| `extract_project_video_paths` | ~240 | 从 nodes+history 提取所有视频路径 |
| `collect_video_paths_from_nodes` | ~260 | 扫描节点 data 中的视频字段 |
| `prune_unreferenced_images` | ~290 | 删除 images/ 中不在 ref 表的文件 |
| `prune_unreferenced_videos` | ~340 | 删除 videos/ 中不在 ref 表的文件 |

## 历史

- 2026-04-27：发现 `tinyPreviewImageUrl` 持久化丢失，禁用 tiny 缩略图层级。根因是 Rust 端未扫描 `tinyPreviewImageUrl`，导致文件在 prune 时被误删。
- 2026-05-07：修复图片保存时的竞争条件（prune 在 upsert 中被调用），改为仅启动时和删项目时清理。
- 2026-05-07：新增 `project_video_refs` 表和完整视频引用追踪系统（平行于图片架构）。
