import type {
  BootstrapData,
  BridgeHealth,
  CharacterCard,
  GenerationJob,
  FullPrompt,
  PhotographyPack,
  PhotographyPackImport,
  PromptImport,
  WebHandoff,
} from './ai-cos-types';

export const API_BASE = 'http://127.0.0.1:4318';

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  if (init?.method && init.method !== 'GET') {
    const session = await fetch(`${API_BASE}/api/session`).then((response) => response.json()) as { token: string };
    headers.set('x-ai-cos-token', session.token);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok)
    throw new Error(body.error || `请求失败 (${response.status})`);
  return body as T;
}

export const api = {
  saveFullPrompt: (body: unknown) => request<FullPrompt>('/api/full-prompts', { method: 'POST', body: JSON.stringify(body) }),
  createFullPromptReshoot: (id: string, body: unknown) => request<GenerationJob>(`/api/jobs/${id}/reshoots/full-prompt`, { method: 'POST', body: JSON.stringify(body) }),
  editFullPromptAdaptation: (id: string, batchId: string, body: unknown, confirm = false) => request<GenerationJob>(`/api/jobs/${id}/reshoots/${batchId}/adaptation${confirm ? '/confirm' : ''}`, { method: confirm ? 'POST' : 'PATCH', body: JSON.stringify(body) }),
  createMultiPersonDraft: (id: string, body: unknown) => request<GenerationJob>(`/api/jobs/${id}/reshoots/multi-person`, { method: 'POST', body: JSON.stringify(body) }),
  updateFace: (id: string, body: unknown) => request(`/api/faces/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveMaterial: (kind: string, id: string, archived: boolean) => request(`/api/materials/${kind}/${id}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }),
  outputMetadata: (id: string, body: unknown) => request(`/api/jobs/${id}/output-metadata`, { method: 'PATCH', body: JSON.stringify(body) }),
  backup: (jobId?: string) => request<{ url: string; name: string }>('/api/backups', { method: 'POST', body: JSON.stringify({ jobId }) }),
  discardReshoot: (id: string, batchId: string, backToPlan = false) => request<GenerationJob>(`/api/jobs/${id}/reshoots/${batchId}/${backToPlan ? 'back-to-plan' : 'discard'}`, { method: 'POST', body: '{}' }),
  recoverReshoot: (id: string, batchId: string, variantIds: string[]) => request<GenerationJob>(`/api/jobs/${id}/reshoots/${batchId}/recover`, { method: 'POST', body: JSON.stringify({ variantIds }) }),
  bootstrap: () => request<BootstrapData>('/api/bootstrap'),
  bridgeHealth: () => request<BridgeHealth>('/api/bridge/health'),
  createFace: (body: unknown) =>
    request('/api/faces', { method: 'POST', body: JSON.stringify(body) }),
  createPrompt: (body: unknown) =>
    request('/api/prompts', { method: 'POST', body: JSON.stringify(body) }),
  createPromptInbox: (body: unknown) =>
    request('/api/prompts/inbox', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createPromptImport: (body: unknown) =>
    request<PromptImport>('/api/prompts/imports', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updatePromptDrafts: (id: string, drafts: unknown[]) =>
    request<PromptImport>(`/api/prompts/imports/${id}/drafts`, {
      method: 'PATCH',
      body: JSON.stringify({ drafts }),
    }),
  confirmPromptImport: (id: string) =>
    request<{ promptImport: PromptImport }>(
      `/api/prompts/imports/${id}/confirm`,
      { method: 'POST', body: '{}' },
    ),
  createPhotographyPackImport: (body: unknown) =>
    request<PhotographyPackImport>('/api/photography-packs/imports', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updatePhotographyPackDraft: (id: string, draft: unknown) =>
    request<PhotographyPackImport>(`/api/photography-packs/imports/${id}/draft`, {
      method: 'PATCH',
      body: JSON.stringify({ draft }),
    }),
  confirmPhotographyPackImport: (id: string) =>
    request<{ packImport: PhotographyPackImport; pack: PhotographyPack }>(
      `/api/photography-packs/imports/${id}/confirm`,
      { method: 'POST', body: '{}' },
    ),
  updatePhotographyPack: (id: string, body: unknown) =>
    request<PhotographyPack>(`/api/photography-packs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  createJob: (body: unknown) =>
    request<GenerationJob>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateReferences: (id: string, body: unknown) =>
    request<GenerationJob>(`/api/jobs/${id}/references`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  saveCharacterCard: (id: string, characterCard: CharacterCard) =>
    request<GenerationJob>(`/api/jobs/${id}/character-card`, {
      method: 'PATCH',
      body: JSON.stringify({ characterCard }),
    }),
  generateBaseline: (id: string, body: unknown) =>
    request<GenerationJob>(`/api/jobs/${id}/generate-baseline`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createAdjustment: (id: string, body: unknown) =>
    request<GenerationJob>(`/api/jobs/${id}/adjustments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createReshootDraft: (id: string, body: unknown) =>
    request<GenerationJob>(`/api/jobs/${id}/reshoots/draft`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createSeriesPlanReshoot: (id: string, body: unknown) =>
    request<GenerationJob>(`/api/jobs/${id}/reshoots/series-plan`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSeriesPlanDraft: (id: string, batchId: string, body: unknown) =>
    request<GenerationJob>(`/api/jobs/${id}/reshoots/${batchId}/series-plan`, {
      method: 'PATCH',
      body: JSON.stringify({ draft: body }),
    }),
  compileSeriesPlan: (id: string, batchId: string) =>
    request<GenerationJob>(`/api/jobs/${id}/reshoots/${batchId}/compile`, {
      method: 'POST',
      body: '{}',
    }),
  recompileSeriesPlan: (id: string, batchId: string, body: unknown) =>
    request<GenerationJob>(`/api/jobs/${id}/reshoots/${batchId}/recompile`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateReshootQuality: (
    id: string,
    batchId: string,
    variantId: string,
    body: unknown,
  ) =>
    request<GenerationJob>(
      `/api/jobs/${id}/reshoots/${batchId}/variants/${variantId}/quality`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  updateReshootDraft: (id: string, batchId: string, body: unknown) =>
    request<GenerationJob>(`/api/jobs/${id}/reshoots/${batchId}/draft`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  rerollReshootDraft: (id: string, batchId: string, variantId?: string) =>
    request<GenerationJob>(`/api/jobs/${id}/reshoots/${batchId}/reroll`, {
      method: 'POST',
      body: JSON.stringify({ variantId }),
    }),
  confirmReshootDraft: (id: string, batchId: string, backend: string) =>
    request<GenerationJob>(`/api/jobs/${id}/reshoots/${batchId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ backend }),
    }),
  selectOutput: (id: string, outputId: string) =>
    request<GenerationJob>(`/api/jobs/${id}/select-output`, {
      method: 'POST',
      body: JSON.stringify({ outputId }),
    }),
  retryRun: (runId: string) =>
    request<GenerationJob | PromptImport>(`/api/runs/${runId}/retry`, {
      method: 'POST',
      body: '{}',
    }),
  getWebHandoff: (runId: string) =>
    request<WebHandoff & { jobId: string; runId: string; runStatus: string }>(
      `/api/runs/${runId}/handoff`,
    ),
  revealWebHandoffAssets: (runId: string) =>
    request<{ ok: boolean; runId: string }>(
      `/api/runs/${runId}/reveal-assets`,
      { method: 'POST', body: '{}' },
    ),
  importWebHandoffOutput: (runId: string, outputDataUrl: string) =>
    request<GenerationJob>(`/api/runs/${runId}/import-output`, {
      method: 'POST',
      body: JSON.stringify({ outputDataUrl }),
    }),
  importWebHandoffOutputs: (
    runId: string,
    outputs: Array<{ variantId: string; outputDataUrl: string }>,
    finishPartial: boolean,
  ) =>
    request<GenerationJob>(`/api/runs/${runId}/import-outputs`, {
      method: 'POST',
      body: JSON.stringify({ outputs, finishPartial }),
    }),
  cancelWebHandoff: (runId: string) =>
    request<GenerationJob>(`/api/runs/${runId}/cancel`, {
      method: 'POST',
      body: '{}',
    }),
};

export function assetUrl(url: string | null | undefined) {
  return url ? `${API_BASE}${url}` : '';
}

export function fileToDataUrl(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024)
    return Promise.reject(new Error('请选择不超过 20 MB 的 PNG/JPG/WEBP 图片'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error(`无法读取 ${file.name}`));
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.readAsDataURL(file);
  });
}
