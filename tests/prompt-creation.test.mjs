import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-cos-creation-'));
process.env.AI_COS_DATA_DIR = root;
process.env.AI_COS_VSC_ROOT = path.join(root, 'skills');
for (const name of [
  'vsc',
  'character-candid-photography',
  'vibeshot-candid-photography',
  'summer-boyfriend-pov',
  'rare-style-explorer',
  'shan-ze-school',
]) {
  await fs.mkdir(path.join(process.env.AI_COS_VSC_ROOT, name), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(process.env.AI_COS_VSC_ROOT, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test fixture\n---\nNo model execution.`,
  );
}
const store = await import('../server/store.mjs');
const c = await import('../server/prompt-creation.mjs');
const { CodexBridge, buildTaskPrompt } =
  await import('../server/codex-bridge.mjs');
const png = await sharp({
  create: { width: 24, height: 32, channels: 3, background: '#aabbcc' },
})
  .png()
  .toBuffer();
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const pngPath = path.join(root, 'test.png');
await fs.writeFile(pngPath, png);
const person = {
  sourceType: 'text',
  description: '成年原创人物',
  scope: 'original',
  position: '',
  adultConfirmed: true,
};
const input = (extra = {}) => ({
  brief: '街头买咖啡，自然抓拍',
  quantity: 2,
  participants: [person],
  ...extra,
});
async function ready(extra = {}) {
  const item = await c.createPromptCreation(input(extra));
  await c.claimPromptCreation(item.id, item.activeRunId);
  return c.applyCreationDrafts(item.id, item.activeRunId, {
    selectedSkill: 'character-candid-photography',
    drafts: Array.from({ length: item.quantity }, (_, i) => ({
      title: `Draft ${i}`,
      prompt: `  Complete prompt ${i}.\nKeep whitespace.  `,
    })),
  });
}
async function sourceJob() {
  const job = await store.createJob({
    title: '已验收测试角色',
    mainReference: { dataUrl },
  });
  await store.claimJob(job.id, 'analysis');
  const card = Object.fromEntries(
    [
      'hairstyle',
      'hairAccessories',
      'iris',
      'makeup',
      'bodySilhouette',
      'outfitLayers',
      'colors',
      'materials',
      'accessories',
      'footwear',
    ].map((key) => [
      key,
      { value: `LOCK_${key}`, certainty: 'observed', strongLock: true },
    ]),
  );
  await store.applyCharacterCard(job.id, card);
  await store.saveCharacterCard(job.id, card);
  await store.configureAndQueueBaseline(job.id, {});
  await store.claimJob(job.id, 'baseline');
  const result = await store.attachOutput(job.id, pngPath, 'baseline');
  return store.updateOutputMetadata(job.id, {
    outputId: result.selectedOutputId,
    faceReview: {
      status: 'accepted',
      checks: { identity: true, anatomy: true, texture: true },
    },
  });
}
test.after(async () => fs.rm(root, { recursive: true, force: true }));

void test('无图需求进入独立 FIFO 文字任务，原流程和完整库不受影响', async () => {
  const before = await store.getBootstrap();
  const item = await c.createPromptCreation(
    input({ participants: [{ ...person, description: '' }] }),
  );
  assert.equal(item.executionRuns[0].kind, 'prompt_compose');
  assert.deepEqual(c.creationAssets(item), []);
  assert.equal(item.batches.length, 0);
  const queued = await store.nextQueuedTask();
  assert.equal(queued.targetType, 'prompt_creation');
  assert.equal(queued.targetId, item.id);
  assert.equal(
    (await store.findExecutionRun(item.activeRunId)).type,
    'prompt_creation',
  );
  await c.claimPromptCreation(item.id, item.activeRunId);
  await assert.rejects(
    c.claimPromptCreation(item.id, item.activeRunId),
    /版本失效/,
  );
  await c.finishPromptCreationRun(
    item.id,
    item.activeRunId,
    'failed',
    'fixture stop',
  );
  const after = await store.getBootstrap();
  assert.deepEqual(after.jobs, before.jobs);
  assert.deepEqual(after.fullPrompts, before.fullPrompts);
  await assert.rejects(c.createPromptCreation(input({ quantity: 5 })), /数量/);
  await assert.rejects(
    c.createPromptCreation(input({ skill: 'codex-image-to-eagle' })),
    /技能/,
  );
});

void test('偷拍感入口复用角色抓拍 Skill，保留来源、边界和明确选择，不生成重复路由', async () => {
  const name = 'character-candid-photography';
  const capabilities = await c.vscCapabilities();
  assert.equal(capabilities.filter((entry) => entry.name === name).length, 1);
  const capability = capabilities.find((entry) => entry.name === name);
  assert.equal(capability.label, '色狼偷拍感（虚构摆拍）');
  assert.equal(capability.available, true);
  assert.match(capability.description, /原“角色自然抓拍”/);
  assert.match(capability.description, /成年角色、知情同意/);
  assert.equal(capability.sourceUrl, 'https://x.com/VoxcatAI/status/2097511865857507750');

  let item = await c.createPromptCreation(input({ skill: name, quantity: 1 }));
  assert.equal(item.skill, name);
  assert.equal(item.capabilities.find((entry) => entry.name === name).hash, capability.hash);
  await c.claimPromptCreation(item.id, item.activeRunId);
  await assert.rejects(c.applyCreationDrafts(item.id, item.activeRunId, {
    selectedSkill: 'vibeshot-candid-photography',
    drafts: [{ title: '错误路由', prompt: '不能用生活人像替换用户明确选择的角色抓拍' }],
  }), /技能不在本轮可用范围/);
  item = await c.applyCreationDrafts(item.id, item.activeRunId, {
    selectedSkill: name,
    drafts: [{ title: '门框后的偶然一瞥', prompt: '成年原创角色的知情同意虚构摆拍，门框遮挡、长焦构图；身份和服装按用户锁定。' }],
  });
  assert.equal(item.drafts[0].selectedSkill, name);
  assert.equal(item.executionRuns.at(-1).status, 'succeeded');
  assert.equal(item.outputs.length, 0);

  const hiddenPath = `${capability.path}.temporarily-unavailable`;
  await fs.rename(capability.path, hiddenPath);
  try {
    const unavailable = (await c.vscCapabilities()).find((entry) => entry.name === name);
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.label, capability.label);
    assert.equal(unavailable.description, capability.description);
    await assert.rejects(c.createPromptCreation(input({ skill: name })), /尚未安装/);
  } finally {
    await fs.rename(hiddenPath, capability.path);
  }
});

void test('整段保留、逐条修改、用户保存版本、确认前不生图且不能扩大修改集合', async () => {
  let item = await ready();
  const original = item.drafts[0].prompt;
  assert.equal(original, '  Complete prompt 0.\nKeep whitespace.  ');
  assert.equal(item.activeRunId, null);
  assert.equal(item.batches.length, 0);
  assert.ok(item.drafts[0].previews['built-in-imagegen'].startsWith(original));
  const untouched = structuredClone(item.drafts[1]);
  item = await c.reviseCreation(item.id, {
    version: item.version,
    draftIds: [item.drafts[0].id],
    feedback: '只改第一张的场景',
  });
  await c.claimPromptCreation(item.id, item.activeRunId);
  await assert.rejects(
    c.applyCreationDrafts(item.id, item.activeRunId, {
      selectedSkill: 'character-candid-photography',
      drafts: [{ id: untouched.id, title: 'bad', prompt: 'bad' }],
    }),
    /编号/,
  );
  item = await c.applyCreationDrafts(item.id, item.activeRunId, {
    selectedSkill: 'character-candid-photography',
    drafts: [
      { id: item.drafts[0].id, title: 'Revised', prompt: '  User revision  ' },
    ],
  });
  assert.deepEqual(item.drafts[1], untouched);
  assert.equal(item.draftHistory.at(-1).drafts[0].prompt, original);
  const staleVersion = item.version;
  item = await c.editCreationDrafts(item.id, {
    version: item.version,
    drafts: item.drafts.map((d) => ({
      ...d,
      prompt: `${d.prompt}\nuser note`,
    })),
  });
  await assert.rejects(
    c.confirmCreationGeneration(item.id, {
      version: staleVersion,
      backend: 'built-in-imagegen',
      draftIds: [item.drafts[0].id],
    }),
    /已更新/,
  );
});

void test('混合多人：脸模角度归属、源图版本冻结、单人授权和角色演绎不保留服装锁', async () => {
  const face = await store.createFace({
    name: '授权脸模',
    sourceType: 'private',
    authorizationConfirmed: true,
    images: [
      { angle: 'front', dataUrl },
      { angle: 'profile', dataUrl },
    ],
  });
  const job = await sourceJob();
  const participants = [
    { ...person, position: '左侧' },
    { ...person, sourceType: 'face', faceId: face.id, position: '中间' },
    {
      ...person,
      sourceType: 'output',
      jobId: job.id,
      outputId: job.selectedOutputId,
      scope: 'character',
      stylingConfirmed: true,
      position: '右侧',
    },
  ];
  const item = await ready({ participants });
  assert.equal(c.creationAssets(item).length, 3);
  assert.deepEqual(
    c.creationAssets(item).map((image) => image.role),
    ['person_B_face', 'person_B_face', 'person_C_source'],
  );
  const prompt = item.drafts[0].previews['built-in-imagegen'];
  assert.match(prompt, /共 3 人/);
  assert.match(prompt, /LOCK_hairAccessories/);
  assert.doesNotMatch(prompt, /LOCK_outfitLayers/);
  await store.saveCharacterCard(
    job.id,
    Object.fromEntries(
      Object.entries(job.characterCard).map(([key, value]) => [
        key,
        { ...value, value: 'NEW' },
      ]),
    ),
  );
  assert.equal(
    (await c.getPromptCreation(item.id)).drafts[0].previews[
      'built-in-imagegen'
    ],
    prompt,
  );
  await assert.rejects(
    c.createPromptCreation(
      input({
        participants: participants.map((p) => ({
          ...p,
          stylingConfirmed: false,
        })),
      }),
    ),
    /逐人/,
  );
  await assert.rejects(
    c.createPromptCreation(
      input({ participants: [participants[1], participants[1]] }),
    ),
    /同一身份/,
  );
  await store.archiveMaterial('face', face.id, true);
  await assert.rejects(
    c.confirmCreationGeneration(item.id, {
      version: item.version,
      draftIds: [item.drafts[0].id],
      backend: 'built-in-imagegen',
    }),
    /授权/,
  );
});

void test('网页交接支持零参考、逐槽映射、坏图回滚、部分导回和重复保护', async () => {
  let item = await ready({ aspectRatio: '9:16' });
  item = await c.confirmCreationGeneration(item.id, {
    version: item.version,
    draftIds: item.drafts.map((d) => d.id),
    backend: 'chatgpt-web-manual',
  });
  const run = item.executionRuns.at(-1),
    batch = item.batches.at(-1);
  assert.equal(run.status, 'waiting_user');
  assert.equal(run.handoff.assets.length, 0);
  assert.deepEqual(run.handoff.prompts[0].orderedAssets, []);
  assert.match(run.handoff.prompts[0].prompt, /阿茶/);
  assert.match(run.handoff.prompts[0].prompt, /2160 × 3840/);
  await assert.rejects(c.claimPromptCreation(item.id, run.id), /失效/);
  await assert.rejects(
    c.importCreationOutputs(
      item.id,
      run.id,
      [{ variantId: '../foreign', outputDataUrl: dataUrl }],
      true,
    ),
    /不属于/,
  );
  await assert.rejects(
    c.importCreationOutputs(item.id, run.id, [
      { variantId: batch.variants[0].id, outputDataUrl: dataUrl },
      { variantId: batch.variants[1].id, outputDataUrl: 'not-an-image' },
    ]),
    /图片/,
  );
  assert.deepEqual(await fs.readdir(path.join(root, 'outputs', item.id)), []);
  item = await c.importCreationOutputs(
    item.id,
    run.id,
    [{ variantId: batch.variants[0].id, outputDataUrl: dataUrl }],
    true,
  );
  assert.equal(item.batches.at(-1).status, 'partial');
  assert.equal(item.outputs[0].pixelWidth, 24);
  assert.equal(item.batches.at(-1).variants[1].status, 'skipped_by_user');
  await assert.rejects(
    c.importCreationOutputs(
      item.id,
      run.id,
      [{ variantId: batch.variants[0].id, outputDataUrl: dataUrl }],
      true,
    ),
    /失效/,
  );
});

void test('图片独立归档；同一图片不能填多个槽，单张失败保留成功且不重试', async () => {
  let item = await ready();
  item = await c.confirmCreationGeneration(item.id, {
    version: item.version,
    draftIds: item.drafts.map((d) => d.id),
    backend: 'built-in-imagegen',
  });
  const runId = item.activeRunId,
    variants = item.batches.at(-1).variants;
  await c.claimPromptCreation(item.id, runId);
  item = await c.attachCreationOutput(item.id, runId, variants[0].id, pngPath);
  await assert.rejects(
    c.attachCreationOutput(item.id, runId, variants[1].id, pngPath),
    /同一张/,
  );
  item = await c.failCreationVariant(
    item.id,
    runId,
    variants[1].id,
    '真实失败测试',
  );
  assert.equal(item.batches.at(-1).status, 'partial');
  assert.equal(item.outputs.length, 1);
  assert.equal(item.executionRuns.length, 2);
  assert.equal(item.activeRunId, null);
  await assert.rejects(store.retryRun(runId), /新批次/);
});

void test('取消、孤立执行中断与旧 run 栅栏；人工重试只复用原输入', async () => {
  let item = await c.createPromptCreation(input());
  const old = item.activeRunId;
  await c.claimPromptCreation(item.id, old);
  await store.interruptOrphanedRuns();
  item = await c.getPromptCreation(item.id);
  assert.equal(item.executionRuns.at(-1).status, 'interrupted');
  item = await store.retryRun(old);
  await c.finishPromptCreationRun(item.id, old, 'failed', 'late failure');
  await assert.rejects(c.claimPromptCreation(item.id, old), /版本失效/);
  assert.equal(
    (await c.getPromptCreation(item.id)).activeRunId,
    item.activeRunId,
  );
  await c.finishPromptCreationRun(
    item.id,
    item.activeRunId,
    'interrupted',
    'end fixture',
  );
});

void test('App Server 显式 VSC + 隔离临时线程：文字阶段零图片，确认后按 variant 出图', async () => {
  const fixture = fileURLToPath(
    new URL('./fixtures/bridge-creation.mjs', import.meta.url),
  );
  await fs.chmod(fixture, 0o755);
  process.env.AI_COS_CODEX_PATH = fixture;
  const bridge = new CodexBridge();
  try {
    let item = await c.createPromptCreation(input());
    await bridge.run('prompt_creation', item.id, item.executionRuns[0]);
    item = await c.getPromptCreation(item.id);
    assert.equal(item.drafts.length, 2);
    assert.equal(item.outputs.length, 0);
    const turn = JSON.parse(
      await fs.readFile(path.join(root, 'fixture-turn.json'), 'utf8'),
    );
    assert.equal(turn.input[2].name, 'vsc');
    assert.equal(turn.sandboxPolicy.networkAccess, false);
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(root, 'fixture-thread.json'), 'utf8'),
      ).ephemeral,
      true,
    );
    assert.match(
      buildTaskPrompt(item.id, 'prompt_compose', 'prompt_creation', 'run-test'),
      /不调用 imagegen/,
    );
    item = await c.confirmCreationGeneration(item.id, {
      version: item.version,
      draftIds: item.drafts.map((d) => d.id),
      backend: 'built-in-imagegen',
    });
    await bridge.run('prompt_creation', item.id, item.executionRuns.at(-1));
    item = await c.getPromptCreation(item.id);
    assert.equal(item.outputs.length, 2);
    assert.equal(item.batches.at(-1).status, 'succeeded');
    assert.notEqual(item.outputs[0].path, item.outputs[1].path);
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(root, 'fixture-turn.json'), 'utf8'),
      ).input.length,
      2,
    );
    const explicit = await c.createPromptCreation(input({ skill: 'character-candid-photography' }));
    await bridge.run('prompt_creation', explicit.id, explicit.executionRuns[0]);
    const explicitTurn = JSON.parse(await fs.readFile(path.join(root, 'fixture-turn.json'), 'utf8'));
    assert.equal(explicitTurn.input[2].name, 'character-candid-photography');
    assert.equal(explicitTurn.input[2].path, path.join(process.env.AI_COS_VSC_ROOT, 'character-candid-photography', 'SKILL.md'));
    assert.match(explicitTurn.input[0].text, /\$character-candid-photography/);
    assert.equal((await c.getPromptCreation(explicit.id)).outputs.length, 0);
  } finally {
    bridge.stop();
  }
});

void test('真实 HTTP API + 模拟 App Server 完整文字到网页交接与导回；CLI 能读取新任务', async () => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const child = spawn(process.execPath, ['server/local-api.mjs'], {
    env: { ...process.env, AI_COS_API_PORT: String(port) },
    stdio: 'pipe',
  });
  let errors = '';
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const base = `http://127.0.0.1:${port}`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    for (let i = 0; i < 100; i++) {
      if (
        await fetch(`${base}/health`)
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      await sleep(40);
    }
    const { token } = await fetch(`${base}/api/session`).then((r) => r.json());
    const post = async (route, body) => {
      const response = await fetch(`${base}${route}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ai-cos-token': token,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      assert.ok(response.ok, JSON.stringify(data));
      return data;
    };
    let item = await post('/api/prompt-creations', input({ quantity: 1 }));
    for (let i = 0; i < 100 && !item.drafts.length; i++) {
      await sleep(60);
      item = await fetch(`${base}/api/prompt-creations/${item.id}`).then((r) =>
        r.json(),
      );
    }
    assert.equal(item.drafts.length, 1, errors);
    const fromCli = JSON.parse(
      execFileSync(
        process.execPath,
        [
          'scripts/ai-cosctl.mjs',
          'show-creation',
          '--creation',
          item.id,
          '--json',
        ],
        { env: process.env, encoding: 'utf8' },
      ),
    );
    assert.equal(fromCli.execution.orderedInputFiles.length, 0);
    item = await post(`/api/prompt-creations/${item.id}/generate`, {
      version: item.version,
      draftIds: [item.drafts[0].id],
      backend: 'chatgpt-web-manual',
    });
    item = await post(`/api/prompt-creations/${item.id}/import-outputs`, {
      runId: item.activeRunId,
      outputs: [
        { variantId: item.batches[0].variants[0].id, outputDataUrl: dataUrl },
      ],
    });
    assert.equal(item.outputs.length, 1);
    assert.equal(item.activeRunId, null);
    assert.equal((await fetch(`${base}${item.outputs[0].url}`)).status, 200);
    assert.ok(
      (
        await fetch(`${base}/api/bootstrap`).then((r) => r.json())
      ).promptCreations.some((entry) => entry.id === item.id),
    );
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
});
