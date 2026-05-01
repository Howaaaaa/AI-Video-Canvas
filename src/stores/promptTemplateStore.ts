import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PromptTemplateCategory = 'text' | 'image' | 'video';

export interface PromptTemplate {
  id: string;
  title: string;
  content: string;
  category: PromptTemplateCategory;
  createdAt: number;
  updatedAt: number;
}

interface PromptTemplateState {
  isHydrated: boolean;
  templates: PromptTemplate[];
  addTemplate: (title: string, content: string, category: PromptTemplateCategory) => void;
  updateTemplate: (id: string, title: string, content: string, category: PromptTemplateCategory) => void;
  deleteTemplate: (id: string) => void;
}

function generateId(): string {
  return `template-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTitle(input: string): string {
  return input.trim().slice(0, 100);
}

function normalizeContent(input: string): string {
  return input.trim();
}

export const usePromptTemplateStore = create<PromptTemplateState>()(
  persist(
    (set) => ({
      isHydrated: false,
      templates: [],
      addTemplate: (title, content, category) =>
        set((state) => ({
          templates: [
            ...state.templates,
            {
              id: generateId(),
              title: normalizeTitle(title),
              content: normalizeContent(content),
              category,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        })),
      updateTemplate: (id, title, content, category) =>
        set((state) => ({
          templates: state.templates.map((template) =>
            template.id === id
              ? {
                  ...template,
                  title: normalizeTitle(title),
                  content: normalizeContent(content),
                  category,
                  updatedAt: Date.now(),
                }
              : template
          ),
        })),
      deleteTemplate: (id) =>
        set((state) => ({
          templates: state.templates.filter((template) => template.id !== id),
        })),
    }),
    {
      name: 'prompt-template-storage',
      version: 2,
      migrate: (persistedState, version) => {
        const state = persistedState as { templates: PromptTemplate[] };
        if (version < 2 && state.templates) {
          state.templates = state.templates.map((template) => ({
            ...template,
            category: 'text' as PromptTemplateCategory,
          }));
        }
        return state;
      },
      onRehydrateStorage: () => {
        return (_state, error) => {
          if (error) {
            console.error('failed to hydrate prompt template storage', error);
          }
          queueMicrotask(() => {
            usePromptTemplateStore.setState({ isHydrated: true });
          });
        };
      },
    }
  )
);