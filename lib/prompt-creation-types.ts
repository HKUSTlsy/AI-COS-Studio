import type {
  AspectRatio,
  ExecutionRun,
  GenerationBackend,
  OutputResolution,
  WebHandoff,
} from './ai-cos-types';

export interface CreationPerson {
  sourceType: 'text' | 'face' | 'output';
  description: string;
  scope: 'original' | 'character' | 'free';
  position: string;
  adultConfirmed: boolean;
  stylingConfirmed: boolean;
  faceId?: string;
  jobId?: string;
  outputId?: string;
  label?: string;
  images?: { path: string; url: string; role: string; purpose: string }[];
}
export interface VscCapability {
  name: string;
  label: string;
  description?: string;
  sourceUrl?: string;
  available: boolean;
  path: string;
  hash: string | null;
}
export interface CreationDraft {
  id: string;
  title: string;
  prompt: string;
  selectedSkill: string;
  previews: Record<GenerationBackend, string>;
}
export interface CreationVariant {
  id: string;
  draftId: string;
  index: number;
  compiledPrompt: string;
  status: string;
  error?: string;
  outputId?: string;
}
export interface CreationBatch {
  id: string;
  runId: string;
  status: string;
  backend: GenerationBackend;
  variants: CreationVariant[];
  createdAt: string;
  inputSnapshot: unknown;
}
export interface CreationOutput {
  id: string;
  version: number;
  url: string;
  fileName: string;
  prompt: string;
  batchId: string;
  variantId: string;
  backend: GenerationBackend;
  pixelWidth: number;
  pixelHeight: number;
  actualRatio: string;
  aspectRatio: AspectRatio;
  createdAt: string;
  outputResolution?: OutputResolution;
}
export interface PromptCreation {
  id: string;
  name: string;
  brief: string;
  skill: string;
  quantity: number;
  version: number;
  participants: CreationPerson[];
  capabilities: VscCapability[];
  aspectRatio: AspectRatio;
  drafts: CreationDraft[];
  draftHistory: { version: number; drafts: CreationDraft[]; at: string }[];
  executionRuns: (Omit<ExecutionRun, 'kind' | 'handoff'> & {
    kind: 'prompt_compose' | 'prompt_render';
    handoff: WebHandoff | null;
  })[];
  activeRunId: string | null;
  batches: CreationBatch[];
  outputs: CreationOutput[];
  createdAt: string;
  updatedAt: string;
}
