/** Only the newest attempt in a stage may surface as its current error. */
export function latestStageFailure<T extends { kind: string; status: string }>(runs: T[], kind?: string): T | undefined {
  const latest = [...runs].reverse().find((run) => !kind || run.kind === kind);
  return latest && ['failed', 'interrupted'].includes(latest.status) ? latest : undefined;
}

/** No extra style and no face model are both valid baseline configurations. */
export function baselineBlockReason(running: boolean, faceId: string, faces: { id: string; authorizationConfirmed: boolean }[]): string | null {
  if (running) return '当前任务正在执行，完成后可以生成新版本。';
  if (!faceId) return null;
  const face = faces.find((item) => item.id === faceId);
  if (!face) return '所选脸模已不可用，请重新选择。';
  if (!face.authorizationConfirmed) return '请先在脸模库确认该脸模的使用授权。';
  return null;
}

/** Keep explicit history selection; otherwise prioritize unfinished work, not old errors. */
export function selectImportRecord<T extends { id: string; status: string }>(imports: T[], selectedId = ''): T | null {
  return imports.find((item) => item.id === selectedId)
    || imports.find((item) => item.status === 'running')
    || imports.find((item) => item.status === 'queued')
    || imports.find((item) => item.status === 'draft_ready')
    || imports[0] || null;
}
