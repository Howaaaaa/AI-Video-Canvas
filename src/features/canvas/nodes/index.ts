import type { NodeTypes } from '@xyflow/react';

import { AiChatNode } from './AiChatNode';
import { AiVideoNode } from './AiVideoNode';
import { ExportVideoNode } from './ExportVideoNode';
import { GroupNode } from './GroupNode';
import { ImageEditNode } from './ImageEditNode';
import { ImageNode } from './ImageNode';
import { StoryboardGenNode } from './StoryboardGenNode';
import { StoryboardNode } from './StoryboardNode';
import { TextAnnotationNode } from './TextAnnotationNode';
import { UploadNode } from './UploadNode';

export const nodeTypes: NodeTypes = {
  aiChatNode: AiChatNode,
  aiVideoNode: AiVideoNode,
  exportImageNode: ImageNode,
  exportVideoNode: ExportVideoNode,
  groupNode: GroupNode,
  imageNode: ImageEditNode,
  storyboardGenNode: StoryboardGenNode,
  storyboardNode: StoryboardNode,
  textAnnotationNode: TextAnnotationNode,
  uploadNode: UploadNode,
};

export { AiChatNode, AiVideoNode, ExportVideoNode, GroupNode, ImageEditNode, ImageNode, StoryboardGenNode, StoryboardNode, TextAnnotationNode, UploadNode };
