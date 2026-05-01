import type { NodeTypes } from '@xyflow/react';

import { AiChatNode } from './AiChatNode';
import { GroupNode } from './GroupNode';
import { ImageEditNode } from './ImageEditNode';
import { ImageNode } from './ImageNode';
import { StoryboardGenNode } from './StoryboardGenNode';
import { StoryboardNode } from './StoryboardNode';
import { TextAnnotationNode } from './TextAnnotationNode';
import { UploadNode } from './UploadNode';

export const nodeTypes: NodeTypes = {
  aiChatNode: AiChatNode,
  exportImageNode: ImageNode,
  groupNode: GroupNode,
  imageNode: ImageEditNode,
  storyboardGenNode: StoryboardGenNode,
  storyboardNode: StoryboardNode,
  textAnnotationNode: TextAnnotationNode,
  uploadNode: UploadNode,
};

export { AiChatNode, GroupNode, ImageEditNode, ImageNode, StoryboardGenNode, StoryboardNode, TextAnnotationNode, UploadNode };
