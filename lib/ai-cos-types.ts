export type WorkflowStep =
  | 'references'
  | 'character_card'
  | 'configuration'
  | 'adjustment';
export type RunKind =
  | 'analysis'
  | 'baseline'
  | 'adjustment'
  | 'prompt_split'
  | 'pack_parse'
  | 'series_deconstruct'
  | 'prompt_adapt'
  | 'reshoot';
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_user'
  | 'succeeded'
  | 'failed'
  | 'interrupted';
export type GenerationBackend =
  | 'built-in-imagegen'
  | 'chatgpt-web-manual';
export type AdjustmentCategory =
  | 'pose'
  | 'outfit'
  | 'background'
  | 'body_proportion'
  | 'makeup'
  | 'hair_accessory'
  | 'camera_lighting'
  | 'other';
export type PromptCategory =
  | 'style'
  | 'camera_angle'
  | 'scene_lighting'
  | 'pose'
  | 'outfit'
  | 'body_proportion'
  | 'makeup'
  | 'hair_accessory';
export type AspectRatio = 'source' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
export type PhotographyPoolKey =
  | 'expression'
  | 'outfitStyle'
  | 'scene'
  | 'moment'
  | 'shotScale'
  | 'focalLength'
  | 'cameraPosition'
  | 'composition'
  | 'foreground'
  | 'lighting'
  | 'palette'
  | 'captureState';
export type ReshootLockKey = Exclude<PhotographyPoolKey, 'expression' | 'outfitStyle'>;
export type Certainty = 'observed' | 'inferred' | 'user_confirmed';
export type CharacterCardKey =
  | 'hairstyle'
  | 'hairAccessories'
  | 'iris'
  | 'makeup'
  | 'bodySilhouette'
  | 'outfitLayers'
  | 'colors'
  | 'materials'
  | 'accessories'
  | 'footwear';

export type CharacterCard = Record<
  CharacterCardKey,
  { value: string; certainty: Certainty; strongLock: boolean }
>;
export type CharacterProfile = CharacterCard;

export interface OutputResolution {
  version: string;
  mode: 'maximum_native';
  control: 'prompt_only';
  aspectRatio: AspectRatio;
  pixelWidth: number | null;
  pixelHeight: number | null;
  experimental: boolean;
}
export interface StoredImage {
  path: string;
  url: string;
  mime?: string;
  bytes: number;
  pixelWidth?: number;
  pixelHeight?: number;
  actualRatio?: string;
  outputResolution?: OutputResolution;
  resolutionCheck?: { status: 'matched' | 'below_target' | 'different_ratio' | 'different_size' | 'unknown'; pixelWidth: number | null; pixelHeight: number | null };
}
export interface FaceImage extends StoredImage {
  angle: 'front' | 'three_quarter' | 'profile';
}
export interface FaceProfile {
  archivedAt?: string | null;
  versions?: FaceProfile[];
  id: string;
  name: string;
  sourceType: 'preset' | 'private';
  authorizationConfirmed: boolean;
  images: FaceImage[];
  coverImage: string | null;
  coverAngle: 'front' | 'three_quarter' | 'profile';
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface PromptModule {
  archivedAt?: string | null;
  versions?: PromptModule[];
  id: string;
  name: string;
  category: PromptCategory;
  rawText: string;
  normalizedText: string;
  avoid: string[];
  tags: string[];
  thumbnail: string | null;
  version: number;
  source: 'preset' | 'user';
  sourceImportId?: string;
  provenance?: {
    sourceUrl: string;
    method: string;
    revision?: string;
    ruleVersion?: string;
    sources?: Array<{ caseId: number; title: string; adaptation: string; url: string }>;
  };
  updatedAt: string;
}
export interface FullPrompt {
  id: string;
  name: string;
  rawText: string;
  originalText: string;
  sourceUrl: string;
  sourceHash: string;
  version: number;
  versions?: FullPrompt[];
  createdAt: string;
  updatedAt: string;
}
export interface CreativePolicy {
  mode: 'original' | 'character';
  outfitSource: 'template' | 'text' | 'reference';
  outfitDirection: string;
  propPolicy: 'preserve' | 'free';
}
export interface PromptPatch { before: string; after: string; reason: string; included: boolean }
export interface PromptAdaptation { patches: PromptPatch[]; warnings: string[]; adaptedText: string }
export interface ReferenceImage extends StoredImage {
  role: string;
  purpose: string;
}
export interface WebHandoff {
  id: string;
  kind: 'baseline' | 'adjustment' | 'reshoot_batch';
  status: 'prepared' | 'completed' | 'cancelled' | 'invalidated';
  directory: string;
  prompt: string;
  promptFile: string;
  prompts?: Array<{
    variantId: string;
    index: number;
    prompt: string;
    promptFile: string;
    outputId: string | null;
    importStatus: 'pending' | 'imported' | 'skipped_by_user';
    orderedAssets?: Array<ReferenceImage & { fileName: string; inputNumber: number }>;
  }>;
  manifestFile: string;
  assets: Array<ReferenceImage & { fileName: string }>;
  snapshot: Record<string, unknown>;
  createdAt: string;
  importedAt: string | null;
  invalidatedAt: string | null;
  outputId: string | null;
  outputIds?: string[];
}
export interface ExecutionRun {
  id: string;
  kind: RunKind;
  status: RunStatus;
  progress: string;
  events: Array<{ at: string; type: string; message: string }>;
  retryOf: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: { type: string; message: string } | null;
  backend: GenerationBackend | null;
  handoff: WebHandoff | null;
  codexThreadId?: string;
  codexTurnId?: string;
}
export interface BaselineVersion extends StoredImage {
  id: string;
  kind: 'baseline';
  version: number;
  fileName: string;
  prompt: string;
  aspectRatio: AspectRatio;
  references?: ReferenceImage[];
  referenceVersion: number;
  characterCardVersion: number;
  configurationVersion: number;
  faceSnapshot?: FaceProfile | null;
  styleSnapshot?: PromptModule | null;
  createdAt: string;
  backend: GenerationBackend;
  migratedFrom?: string;
}
export interface AdjustmentVersion extends StoredImage {
  id: string;
  kind: 'adjustment';
  version: number;
  fileName: string;
  sourceOutputId: string;
  category: AdjustmentCategory;
  request: string;
  preserve: string[];
  annotation?: StoredImage | null;
  adjustmentReference?: (StoredImage & {
    role: 'adjustment_reference';
    category: AdjustmentCategory;
    purpose: string;
  }) | null;
  promptModule?: PromptModule | null;
  conflictPriority?: string[];
  sourceAspectRatio?: string;
  prompt: string;
  referenceVersion: number;
  characterCardVersion: number;
  configurationVersion: number;
  createdAt: string;
  backend: GenerationBackend;
}
export interface PhotographyPackBaseDraft {
  kind: 'variable_pool' | 'series_plan';
  name: string;
  description: string;
  globalStyle: string;
  avoid: string[];
  tags: string[];
  excludedDefaults: string[];
}
export interface VariablePhotographyPackDraft extends PhotographyPackBaseDraft {
  kind: 'variable_pool';
  groupInteractions?: string[];
  imagingMedia?: string[];
  pools: Record<PhotographyPoolKey, string[]>;
  rules: {
    userLocksWin: true;
    avoidBatchDuplicates: true;
    candidOcclusion: 'full' | 'none';
    outfitEnabledByDefault: false;
  };
}
export interface SeriesPlanPackDraft extends PhotographyPackBaseDraft {
  kind: 'series_plan';
  seriesDNA: Record<'themeFramework' | 'editorialTone' | 'makeupSystem' | 'hairSystem' | 'outfitSystem' | 'sceneSystem' | 'propSystem', string>;
  imagingProfile: Record<'whiteBalance' | 'colorCast' | 'blackPoint' | 'highlightRollOff' | 'sharpness' | 'microContrast' | 'softening' | 'noiseCompression' | 'depthOfField', string>;
  visualHierarchy: Record<'subjectClarity' | 'dominantShapes' | 'secondaryDetails' | 'lowDetailSpace', string>;
  workflowRules: Record<'referenceAssignment' | 'lightingTopology' | 'subjectEventCausality' | 'storyboardDiversity' | 'antiCommercialPolish' | 'redoPolicy', string>;
  qualityGates: string[];
  rules: {
    userLocksWin: true;
    identityFromStudioOnly: true;
    photoReferenceIdentity: false;
    outfitEnabledByDefault: false;
    resetToOriginalInputs: true;
    generatedInputsOnRedo: false;
    watermarkEnabledByDefault: false;
  };
}
export type PhotographyPackDraft = VariablePhotographyPackDraft | SeriesPlanPackDraft;
export type PhotographyPack = PhotographyPackDraft & {
  archivedAt?: string | null;
  versions?: PhotographyPack[];
  id: string;
  version: number;
  sourceImportId: string;
  source: {
    type: 'paste' | 'github';
    url: string | null;
    normalizedUrl: string | null;
    resolvedUrl: string | null;
    hash: string;
    rawFile: string;
    files?: Array<{ path: string; rawFile: string; resolvedUrl: string; bytes: number; hash: string }>;
    revision?: string | null;
    license?: string | null;
    importedAt: string;
    authorizationNote: string;
  };
  createdAt: string;
  updatedAt: string;
};
export interface PhotographyPackImport {
  id: string;
  title: string;
  packKind: 'variable_pool' | 'series_plan';
  sourceType: 'paste' | 'github';
  sourceUrl: string | null;
  normalizedSourceUrl: string | null;
  resolvedUrl: string | null;
  sourceHash: string;
  sourceFiles: Array<{ path: string; rawFile: string; resolvedUrl: string; bytes: number; hash: string }>;
  revision: string | null;
  licenseSnapshot: string | null;
  rawText: string;
  rawFile: string;
  authorizationNote: string;
  status: 'queued' | 'running' | 'draft_ready' | 'completed' | 'failed' | 'interrupted';
  draft: PhotographyPackDraft | null;
  packId: string | null;
  executionRuns: ExecutionRun[];
  activeRunId: string | null;
  error: GenerationJob['error'];
  createdAt: string;
  updatedAt: string;
}
export interface CreativeReshootVariant {
  outputResolution?: OutputResolution;
  id: string;
  index: number;
  seed: string;
  selections: Partial<Record<PhotographyPoolKey, string>>;
  shotSpec?: SeriesShot | null;
  referenceRoles?: Array<{ referenceId: string; role: 'photo_main' | 'photo_auxiliary'; purpose: string }>;
  orderedInputFiles?: Array<{ role: string; purpose: string; path: string }>;
  compiledPrompt: string;
  userEdited: boolean;
  status: 'draft' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped_by_user';
  outputId: string | null;
  qualityReview?: ReshootQualityReview | null;
  error: { type: string; message: string } | null;
}
export interface MultiPersonParticipant {
  label: string;
  name: string;
  jobId: string;
  outputId: string;
  sourceImage: BaselineVersion | AdjustmentVersion | CreativeReshootVersion;
  context: { characterCard: CharacterCard; faceSnapshot: FaceProfile | null; references: ReferenceImage[] };
  position: string;
  adultConfirmed: boolean;
  wardrobe: 'locked' | 'swimwear';
  outfitConfirmed: boolean;
  outfitDirection: string;
}
export interface MultiPersonSnapshot {
  version: 1;
  participants: MultiPersonParticipant[];
  event: string;
  medium: string;
  sceneReference: StoredImage | null;
}
export interface CreativeReshootBatch {
  creativePolicy?: CreativePolicy;
  outfitReference?: ReferenceImage | null;
  templateSnapshot?: FullPrompt | null;
  adaptationDraft?: PromptAdaptation | null;
  adaptationConfirmedAt?: string | null;
  outputResolution?: OutputResolution;
  realismStyleSnapshot?: PromptModule | null;
  id: string;
  mode: 'variable_pool' | 'series_plan' | 'multi_person' | 'full_prompt';
  multiPerson?: MultiPersonSnapshot | null;
  status: 'plan_ready' | 'draft' | 'queued' | 'running' | 'waiting_user' | 'succeeded' | 'partial' | 'failed' | 'interrupted' | 'cancelled';
  sourceOutputId: string;
  sourceImage: BaselineVersion | AdjustmentVersion | CreativeReshootVersion;
  packId: string | null;
  packVersion: number | null;
  packSnapshot: PhotographyPack | null;
  quantity: number;
  aspectRatio: AspectRatio;
  allowOutfit: boolean;
  adultConfirmed: boolean;
  locks: Partial<Record<ReshootLockKey, string>>;
  variants: CreativeReshootVariant[];
  photographyReferences: SeriesPhotographyReference[];
  seriesPlanDraft: SeriesPlanDraft | null;
  diagnosticOutputId: string | null;
  feedback?: string;
  backend: GenerationBackend | null;
  runId: string | null;
  referenceVersion: number;
  characterCardVersion: number;
  configurationVersion: number;
  createdAt: string;
  updatedAt: string;
}
export interface CreativeReshootVersion extends StoredImage {
  creativePolicy?: CreativePolicy;
  outfitReference?: ReferenceImage | null;
  templateSnapshot?: FullPrompt | null;
  adaptationSnapshot?: PromptAdaptation | null;
  realismStyleSnapshot?: PromptModule | null;
  id: string;
  kind: 'reshoot';
  version: number;
  fileName: string;
  sourceOutputId: string;
  batchId: string;
  variantId: string;
  packId: string | null;
  packVersion: number | null;
  packSnapshot: PhotographyPack | null;
  mode: 'variable_pool' | 'series_plan' | 'multi_person' | 'full_prompt';
  multiPerson?: MultiPersonSnapshot | null;
  seriesPlanSnapshot?: SeriesPlanDraft | null;
  shotSpec?: SeriesShot | null;
  referenceRoles?: CreativeReshootVariant['referenceRoles'];
  diagnosticOutputId?: string | null;
  seed: string;
  selections: Partial<Record<PhotographyPoolKey, string>>;
  prompt: string;
  aspectRatio: AspectRatio;
  allowOutfit: boolean;
  referenceVersion: number;
  characterCardVersion: number;
  configurationVersion: number;
  createdAt: string;
  backend: GenerationBackend;
  qualityReview?: ReshootQualityReview | null;
}
export interface SeriesPhotographyReference extends ReferenceImage {
  id: string;
  name: string;
  role: 'photography_reference';
}
export interface SeriesLightingSetup {
  id: string;
  name: string;
  referenceIds: string[];
  description: string;
  topology: string;
}
export interface SeriesShot {
  id: string;
  index: number;
  title: string;
  mainReferenceId: string;
  auxiliaryReferenceIds: string[];
  lightingSetupId: string;
  shotScale: string;
  camera: string;
  composition: string;
  subjectEvent: string;
  expressionResponse: string;
  poseGazeProps: string;
  lightingPrediction: string;
  customPrompt: string;
}
export interface SeriesPlanDraft {
  commonPackage: Record<'theme' | 'editorialTone' | 'makeupHair' | 'wardrobe' | 'sceneProps', string>;
  imagingProfile: string;
  visualHierarchy: string;
  lightingSetups: SeriesLightingSetup[];
  excludedReferenceIds: string[];
  shots: SeriesShot[];
}
export type QualityAxisStatus = 'pass' | 'warn' | 'fail' | 'unreviewed';
export interface ReshootQualityReview {
  axes: Record<'seriesPackage' | 'lightingExposure' | 'colorRelation' | 'imagingTexture' | 'subjectEventExpression' | 'visualHierarchy' | 'absoluteFidelity', { status: QualityAxisStatus; note: string }>;
  technicalIssues: string[];
  summary: string;
  reviewer: string;
  adoptionStatus: 'test' | 'failed' | 'final';
  reviewedAt: string;
}
export interface ActiveAdjustment {
  outputResolution?: OutputResolution;
  id: string;
  sourceOutputId: string;
  sourceImage: BaselineVersion | AdjustmentVersion | CreativeReshootVersion;
  category: AdjustmentCategory;
  request: string;
  preserve: string[];
  annotation: StoredImage | null;
  adjustmentReference: (StoredImage & {
    role: 'adjustment_reference';
    category: AdjustmentCategory;
    purpose: string;
  }) | null;
  promptModule: PromptModule | null;
  references?: ReferenceImage[];
  conflictPriority: string[];
  createdAt: string;
}
export interface FaceReview {
  status: 'pending' | 'accepted' | 'rejected';
  checks: { identity: boolean; anatomy: boolean; texture: boolean };
  note: string;
  reviewer: 'user';
  reviewedAt: string;
}
export interface GenerationJob {
  outputResolution?: OutputResolution;
  coverOutputId?: string;
  outputAnnotations?: Record<string, { favorite?: boolean; adopted?: boolean; note?: string; faceReview?: FaceReview; faceReviewHistory?: FaceReview[] }>;
  schemaVersion: 5;
  storageMigrationVersion: 2;
  id: string;
  title: string;
  characterId: string;
  workflowStep: WorkflowStep;
  referenceVersion: number;
  references: ReferenceImage[];
  referenceHistory: Array<{
    version: number;
    references: ReferenceImage[];
    createdAt: string;
  }>;
  characterCard: CharacterCard;
  characterCardVersion: number;
  characterCardHistory: Array<{
    version: number;
    card: CharacterCard;
    source: string;
    createdAt: string;
  }>;
  faceProfileId: string | null;
  styleModuleId: string | null;
  faceSnapshot: FaceProfile | null;
  styleSnapshot: PromptModule | null;
  aspectRatio: AspectRatio;
  configurationVersion: number;
  configurationHistory: Array<{
    outputResolution?: OutputResolution;
    version: number;
    faceProfileId: string | null;
    styleModuleId: string | null;
    aspectRatio: AspectRatio;
    backend?: GenerationBackend;
    compiledPrompt: string;
    createdAt: string;
  }>;
  compiledPrompt: string;
  compiledAdjustmentPrompt: string;
  baselineVersions: BaselineVersion[];
  adjustmentVersions: AdjustmentVersion[];
  reshootBatches: CreativeReshootBatch[];
  reshootVersions: CreativeReshootVersion[];
  activeReshootBatchId: string | null;
  legacyCandidates: StoredImage[];
  executionRuns: ExecutionRun[];
  activeRunId: string | null;
  selectedOutputId: string | null;
  activeAdjustment: ActiveAdjustment | null;
  backend: GenerationBackend | null;
  createdAt: string;
  updatedAt: string;
  error: {
    type: string;
    message: string;
    recoverable: boolean;
    hint: string;
    at?: string;
    runId?: string | null;
    kind?: RunKind | null;
  } | null;
  legacyError?: unknown;
}
export interface PromptDraft {
  draftId: string;
  name: string;
  category: PromptCategory;
  rawText: string;
  normalizedText: string;
  avoid: string[];
  tags: string[];
  included: boolean;
}
export interface PromptImport {
  id: string;
  title: string;
  rawText: string;
  status:
    | 'queued'
    | 'running'
    | 'draft_ready'
    | 'completed'
    | 'failed'
    | 'interrupted';
  createdAt: string;
  updatedAt: string;
  drafts: PromptDraft[];
  moduleIds: string[];
  executionRuns: ExecutionRun[];
  activeRunId: string | null;
  error: GenerationJob['error'];
}
export type PromptInboxItem = PromptImport;
export interface BridgeHealth {
  connected: boolean;
  status: 'offline' | 'starting' | 'ready' | 'running';
  executable: string | null;
  activeJobId: string | null;
  activeTargetType?: 'job' | 'prompt_import' | 'pack_import' | 'prompt_creation' | null;
  activeTargetId?: string | null;
  activeRunId: string | null;
  queueDepth: number | null;
  error: string | null;
}
export interface BootstrapData {
  promptCreations?: import('./prompt-creation-types').PromptCreation[];
  fullPrompts: FullPrompt[];
  faces: FaceProfile[];
  prompts: PromptModule[];
  jobs: GenerationJob[];
  promptInbox: PromptInboxItem[];
  promptImports: PromptImport[];
  photographyPacks: PhotographyPack[];
  photographyPackImports: PhotographyPackImport[];
  bridge: BridgeHealth;
}
