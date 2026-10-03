import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import Ajv2020 from 'ajv/dist/2020.js';

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-cos-test-'));
process.env.AI_COS_DATA_DIR = testRoot;

const domain = await import('../server/domain.mjs');
const store = await import(`../server/store.mjs?test=${Date.now()}`);
const bridge = await import('../server/codex-bridge.mjs');
const onePixelPng = `data:image/png;base64,${(await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()).toString('base64')}`;
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
    {
      value: `${key} specification`,
      certainty: key === 'materials' ? 'inferred' : 'observed',
      strongLock: ['hairstyle', 'iris', 'colors'].includes(key),
    },
  ]),
);

test.after(async () => fs.rm(testRoot, { recursive: true, force: true }));

void test('参考图顺序与基准/调整版本名确定', () => {
  const sorted = domain.sortReferences([
    { role: 'face_profile', path: 'z' },
    { role: 'character_detail', path: 'b' },
    { role: 'character_main', path: 'a' },
    { role: 'face_front', path: 'c' },
  ]);
  assert.deepEqual(
    sorted.map((item) => item.role),
    ['character_main', 'character_detail', 'face_front', 'face_profile'],
  );
  assert.equal(
    domain.nextVersionName('baseline', [{ fileName: 'baseline-v001.png' }]),
    'baseline-v002.png',
  );
  assert.equal(
    domain.nextVersionName('baseline', [
      { version: 1, fileName: 'candidate-01.png' },
    ]),
    'baseline-v002.png',
  );
  assert.equal(
    domain.nextVersionName('adjustment', [
      { fileName: 'adjustment-v002.png' },
    ]),
    'adjustment-v003.png',
  );
  assert.equal(
    domain.nextVersionName('reshoot', [{ fileName: 'reshoot-v003.png' }]),
    'reshoot-v004.png',
  );
});

void test('基准 Prompt 先呈现画面，显式保持角色约束优先于摄影风格', () => {
  const prompt = domain.compileBaselinePrompt({
    characterCard: card,
    faceProfile: { name: '授权脸模' },
    references: [{ role: 'character_main', path: 'x', purpose: '锁定角色' }],
    styleModule: {
      category: 'style',
      normalizedText: 'STYLE_TOKEN',
      avoid: [],
    },
  });
  assert.ok(
    prompt.indexOf('【主图整体一比一映射】') < prompt.indexOf('STYLE_TOKEN'),
  );
  assert.ok(prompt.indexOf('【主图整体一比一映射】') < prompt.indexOf('【脸部身份】'));
  assert.match(prompt, /姿态、身体朝向、手势、景别、机位、人物占比/);
  assert.match(prompt, /角色卡和主图优先于摄影风格/);
  for (const field of Object.values(card)) assert.ok(prompt.includes(field.value));
});

void test('基准 Prompt 校验画幅枚举并把 9:16 作为原生构图目标', () => {
  const prompt = domain.compileBaselinePrompt({
    characterCard: card,
    faceProfile: null,
    references: [{ role: 'character_main', path: 'x', purpose: '锁定角色' }],
    aspectRatio: '9:16',
  });
  assert.match(prompt, /9:16 原生构图/);
  assert.match(prompt, /不后期放大、拉伸、裁切或补边/);
  assert.throws(
    () => domain.compileBaselinePrompt({ characterCard: card, aspectRatio: '2:1' }),
    /画幅比例无效/,
  );
});

void test('调整 Prompt 只允许一个类别并自动保持其他字段', () => {
  const preserve = domain.buildAdjustmentPreserve(card, 'makeup');
  assert.ok(preserve.some((item) => item.startsWith('发型：')));
  assert.ok(!preserve.some((item) => item.startsWith('妆容：')));
  const prompt = domain.compileAdjustmentPrompt({
    characterCard: card,
    faceProfile: null,
    category: 'makeup',
    request: '仅把眼线改得更纤细',
    preserve,
  });
  assert.match(prompt, /【本轮唯一调整类别】妆容/);
  assert.match(prompt, /干净源图和保持项对所有非调整类别优先/);
  assert.throws(
    () =>
      domain.compileAdjustmentPrompt({
        characterCard: card,
        category: 'not-valid',
        request: 'x',
      }),
    /类别无效/,
  );
});

void test('调整允许只使用参考图，并固定冲突优先级', () => {
  const prompt = domain.compileAdjustmentPrompt({
    characterCard: card,
    faceProfile: null,
    category: 'outfit',
    request: '',
    preserve: domain.buildAdjustmentPreserve(card, 'outfit'),
    adjustmentReference: {
      purpose: '只参考外套的剪裁和布料',
    },
  });
  assert.match(prompt, /文字要求 > 调整参考图 > Prompt 模块/);
  assert.match(prompt, /不提供人物身份或其他设定/);
  assert.throws(
    () =>
      domain.compileAdjustmentPrompt({
        characterCard: card,
        category: 'outfit',
        request: '',
      }),
    /至少提供一项/,
  );
});

void test('Prompt 分类扩展为 8 类且草稿拒绝重复分类', () => {
  assert.deepEqual(domain.PROMPT_CATEGORIES, [
    'style',
    'camera_angle',
    'scene_lighting',
    'pose',
    'outfit',
    'body_proportion',
    'makeup',
    'hair_accessory',
  ]);
  assert.throws(
    () =>
      domain.validatePromptDrafts([
        {
          name: 'A',
          category: 'makeup',
          rawText: 'a',
          normalizedText: 'a',
        },
        {
          name: 'B',
          category: 'makeup',
          rawText: 'b',
          normalizedText: 'b',
        },
      ]),
    /重复分类/,
  );
});

void test('摄影方案包校验十二个变量池，并以固定种子产生可复现差异', () => {
  const pack = domain.normalizePhotographyPackDraft({
    name: '抓拍测试包',
    rules: { candidOcclusion: 'full' },
    description: 'test',
    globalStyle: 'natural candid editorial photography',
    pools: {
      expression: ['轻笑', '惊讶'],
      outfitStyle: ['风衣', '夹克'],
      scene: ['街角', '车站', '天台'],
      moment: ['转身', '快步', '抬手'],
      shotScale: ['中景', '全身'],
      focalLength: ['35mm', '50mm', '85mm'],
      cameraPosition: ['平视', '低机位', '肩后'],
      composition: ['偏心', '对角线', '框中框'],
      foreground: ['玻璃反光', '路人边缘', '植物叶片'],
      lighting: ['阴天软光', '夕阳侧逆光', '霓虹混合光'],
      palette: ['低饱和', '冷暖对照'],
      captureState: ['轻微运动拖影', '浅景深'],
    },
    avoid: ['identity drift'],
    tags: ['抓拍'],
    excludedDefaults: ['默认韩国网红身份', '固定肤色', '固定身材'],
  });
  assert.deepEqual(Object.keys(pack.pools), domain.PHOTOGRAPHY_POOL_KEYS);
  assert.equal(pack.rules.outfitEnabledByDefault, false);
  const first = domain.selectPhotographyVariables({
    pack,
    quantity: 3,
    locks: { scene: '用户锁定室内' },
    seed: 'fixed-seed',
  });
  const second = domain.selectPhotographyVariables({
    pack,
    quantity: 3,
    locks: { scene: '用户锁定室内' },
    seed: 'fixed-seed',
  });
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((item) => item.selections.scene), [
    '用户锁定室内',
    '用户锁定室内',
    '用户锁定室内',
  ]);
  assert.equal(new Set(first.map((item) => item.selections.moment)).size, 3);
  const prompt = domain.compileReshootPrompt({
    characterCard: card,
    faceProfile: null,
    pack,
    selections: first[0].selections,
    locks: { scene: '用户锁定室内' },
    allowOutfit: false,
    aspectRatio: '16:9',
  });
  assert.match(prompt, /【服装锁定】/);
  assert.match(prompt, /前景遮住脸部边缘或身体局部/);
  assert.match(prompt, /环境（用户锁定）：用户锁定室内/);
  assert.match(prompt, /用户锁定变量 > 摄影方案/);
});

void test('GitHub 摄影 Skill 链接只接受白名单并规范到 SKILL.md', async () => {
  assert.equal(
    store.normalizeGitHubSkillUrl(
      'https://github.com/nuyoah-ai-works/nuyoah-xiezhen-prompt',
    ),
    'https://github.com/nuyoah-ai-works/nuyoah-xiezhen-prompt',
  );
  assert.equal(
    store.normalizeGitHubSkillUrl(
      'https://github.com/vibeshotclub/vsc-skills/tree/main/vibeshot-candid-photography',
    ),
    'https://raw.githubusercontent.com/vibeshotclub/vsc-skills/main/vibeshot-candid-photography/SKILL.md',
  );
  assert.equal(
    store.normalizeGitHubSkillUrl(
      'https://github.com/a/b/blob/main/SKILL.md',
    ),
    'https://raw.githubusercontent.com/a/b/main/SKILL.md',
  );
  assert.throws(
    () => store.normalizeGitHubSkillUrl('http://127.0.0.1:8000/SKILL.md'),
    /公开 HTTPS GitHub|只允许/,
  );
  assert.throws(
    () => store.normalizeGitHubSkillUrl('https://example.com/SKILL.md'),
    /只允许/,
  );
  await assert.rejects(
    () =>
      store.createPhotographyPackImport({
        title: '禁止把普通文档作为系列入口',
        packKind: 'series_plan',
        sourceUrl:
          'https://github.com/nuyoah-ai-works/nuyoah-xiezhen-prompt/blob/main/references/prompt-logic.md',
      }),
    /入口必须是仓库中的 SKILL\.md/,
  );
});

void test('角色卡与 GenerationJob v5 JSON Schema 可验证', async () => {
  const [characterSchema, jobSchema] = await Promise.all(
    ['character-profile.schema.json', 'generation-job.schema.json'].map(
      async (name) =>
        JSON.parse(
          await fs.readFile(new URL(`../schemas/${name}`, import.meta.url), 'utf8'),
        ),
    ),
  );
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(characterSchema);
  const validateCard = ajv.getSchema(characterSchema.$id);
  assert.equal(validateCard(card), true);
  const invalid = structuredClone(card);
  delete invalid.iris;
  assert.equal(validateCard(invalid), false);
  const validateJob = ajv.compile(jobSchema);
  const job = await store.createJob({
    title: 'Schema test',
    mainReference: { dataUrl: onePixelPng },
  });
  assert.equal(validateJob(job), true, JSON.stringify(validateJob.errors));
});

void test('安全校验拒绝路径穿越、损坏图片与未授权私人脸模', async () => {
  assert.throws(() => store.resolveUnder(testRoot, '../outside'), /路径越界/);
  await assert.rejects(
    () =>
      store.createJob({
        mainReference: { dataUrl: 'data:image/png;base64,ZmFrZQ==' },
      }),
    /损坏/,
  );
  await assert.rejects(
    () =>
      store.createFace({
        name: '未授权',
        sourceType: 'private',
        authorizationConfirmed: false,
        images: [{ angle: 'front', dataUrl: onePixelPng }],
      }),
    /授权/,
  );
});

void test('完整 v5 模拟流：自动排队、单张基准、单项调整与版本分支', async () => {
  const job = await store.createJob({
    title: '集成测试',
    mainReference: { dataUrl: onePixelPng },
  });
  assert.equal(job.workflowStep, 'references');
  assert.equal(job.executionRuns[0].status, 'queued');
  const claimed = await store.claimJob(job.id, 'analysis');
  assert.equal(claimed.executionRuns[0].status, 'running');
  await assert.rejects(() => store.claimJob(job.id, 'analysis'), /重复执行/);
  const analyzed = await store.applyCharacterCard(job.id, card);
  assert.equal(analyzed.workflowStep, 'character_card');
  const edited = structuredClone(card);
  edited.iris.value = 'user-edited iris';
  const saved = await store.saveCharacterCard(job.id, edited);
  assert.equal(saved.workflowStep, 'configuration');
  assert.equal(saved.characterCard.iris.certainty, 'user_confirmed');
  const state = await store.getBootstrap();
  const style = state.prompts.find((item) => item.category === 'style');
  const configured = await store.configureAndQueueBaseline(job.id, {
    faceProfileId: null,
    styleModuleId: style.id,
    aspectRatio: '9:16',
  });
  assert.equal(configured.aspectRatio, '9:16');
  assert.equal(configured.configurationHistory.at(-1).aspectRatio, '9:16');
  assert.equal(configured.outputResolution.pixelHeight, 3840);
  assert.deepEqual(configured.configurationHistory.at(-1).outputResolution, configured.outputResolution);
  assert.deepEqual(configured.executionRuns.at(-1).inputSnapshot.outputResolution, configured.outputResolution);
  assert.equal(configured.executionRuns.at(-1).kind, 'baseline');
  await store.claimJob(job.id, 'baseline');
  const source = path.join(testRoot, 'mock.png');
  await fs.writeFile(source, Buffer.from(onePixelPng.split(',')[1], 'base64'));
  const generated = await store.attachOutput(job.id, source, 'baseline');
  assert.equal(generated.workflowStep, 'configuration');
  assert.equal(generated.baselineVersions.length, 1);
  assert.equal(generated.baselineVersions[0].fileName, 'baseline-v001.png');
  assert.equal(generated.baselineVersions[0].aspectRatio, '9:16');
  assert.equal(generated.baselineVersions[0].pixelWidth, 1);
  assert.equal(generated.baselineVersions[0].pixelHeight, 1);
  assert.equal(generated.baselineVersions[0].actualRatio, '1:1');
  assert.equal(generated.baselineVersions[0].resolutionCheck.status, 'different_ratio');
  assert.equal(generated.baselineVersions[0].outputResolution.pixelWidth, 2160);
  const adjusting = await store.createAdjustment(job.id, {
    sourceOutputId: generated.baselineVersions[0].id,
    category: 'outfit',
    request: '',
    adjustmentReferenceDataUrl: onePixelPng,
  });
  assert.equal(adjusting.executionRuns.at(-1).kind, 'adjustment');
  assert.ok(adjusting.activeAdjustment.preserve.length > 5);
  assert.equal(adjusting.activeAdjustment.adjustmentReference.role, 'adjustment_reference');
  assert.equal(adjusting.activeAdjustment.request, '');
  assert.equal(adjusting.activeAdjustment.outputResolution.pixelWidth, 2880);
  await store.claimJob(job.id, 'adjustment');
  const completed = await store.attachOutput(job.id, source, 'adjustment');
  assert.equal(completed.adjustmentVersions[0].fileName, 'adjustment-v001.png');
  assert.equal(completed.adjustmentVersions[0].sourceOutputId, 'baseline-v001');
  assert.equal(completed.adjustmentVersions[0].resolutionCheck.status, 'below_target');
  assert.equal(
    completed.adjustmentVersions[0].adjustmentReference.category,
    'outfit',
  );
  assert.deepEqual(completed.adjustmentVersions[0].conflictPriority, [
    'explicit_text',
    'adjustment_reference',
    'prompt_module',
  ]);
  assert.equal(completed.backend, 'built-in-imagegen');
});

void test('网页版交接准备有序素材并等待用户导回后归档', async () => {
  const job = await store.createJob({
    title: 'Web handoff test',
    mainReference: { dataUrl: onePixelPng },
  });
  await store.claimJob(job.id, 'analysis');
  await store.applyCharacterCard(job.id, card);
  await store.saveCharacterCard(job.id, card);
  const style = (await store.getBootstrap()).prompts.find(
    (item) => item.category === 'style',
  );
  const prepared = await store.configureAndQueueBaseline(job.id, {
    faceProfileId: null,
    styleModuleId: style.id,
    aspectRatio: '3:4',
    backend: 'chatgpt-web-manual',
  });
  const run = prepared.executionRuns.at(-1);
  assert.equal(run.status, 'waiting_user');
  assert.equal(run.backend, 'chatgpt-web-manual');
  assert.equal(run.handoff.status, 'prepared');
  assert.equal(run.handoff.snapshot.outputResolution.pixelWidth, 2448);
  assert.equal(run.handoff.assets[0].role, 'character_main');
  assert.match(run.handoff.assets[0].fileName, /^01-character_main\.png$/);
  assert.match(run.handoff.prompt, /真人 COS 基准照/);
  const nextTask = await store.nextQueuedTask();
  assert.notEqual(nextTask?.run.id, run.id);
  const handoff = await store.getWebHandoff(run.id);
  assert.equal(handoff.runStatus, 'waiting_user');
  assert.equal(handoff.jobId, job.id);
  const completed = await store.importWebHandoffOutput(run.id, onePixelPng);
  assert.equal(completed.activeRunId, null);
  assert.equal(completed.backend, 'chatgpt-web-manual');
  assert.equal(completed.baselineVersions[0].backend, 'chatgpt-web-manual');
  assert.equal(completed.baselineVersions[0].fileName, 'baseline-v001.png');
  assert.equal(completed.baselineVersions[0].actualRatio, '1:1');
  assert.equal(completed.baselineVersions[0].resolutionCheck.status, 'different_ratio');
  await assert.rejects(
    () => store.importWebHandoffOutput(run.id, onePixelPng),
    /不能重复导入/,
  );
  const adjustmentPrepared = await store.createAdjustment(job.id, {
    sourceOutputId: completed.baselineVersions[0].id,
    category: 'pose',
    request: '只调整手臂动作',
    adjustmentReferenceDataUrl: onePixelPng,
    backend: 'chatgpt-web-manual',
  });
  const adjustmentRun = adjustmentPrepared.executionRuns.at(-1);
  assert.deepEqual(
    adjustmentRun.handoff.assets.slice(0, 3).map((asset) => asset.role),
    ['edit_source', 'adjustment_reference', 'character_main'],
  );
  const cancelled = await store.cancelWebHandoff(adjustmentRun.id);
  assert.equal(cancelled.activeRunId, null);
  assert.equal(
    cancelled.executionRuns.find((item) => item.id === adjustmentRun.id).handoff
      .status,
    'cancelled',
  );
  assert.equal(cancelled.baselineVersions.length, 1);
  await assert.rejects(
    () => store.retryRun(adjustmentRun.id),
    /重新准备一次交接/,
  );
  const nextAdjustment = await store.createAdjustment(job.id, {
    sourceOutputId: completed.baselineVersions[0].id,
    category: 'makeup', request: '只改唇妆', backend: 'chatgpt-web-manual',
  });
  const importedAdjustment = await store.importWebHandoffOutput(nextAdjustment.activeRunId, onePixelPng);
  assert.equal(importedAdjustment.adjustmentVersions.at(-1).outputResolution.pixelWidth, 2880);
  assert.equal(importedAdjustment.adjustmentVersions.at(-1).resolutionCheck.status, 'below_target');
  assert.equal(importedAdjustment.adjustmentVersions.at(-1).pixelWidth, 1);
});

void test('修改输入会让等待中的网页版交接失效且不会删除记录', async () => {
  const job = await store.createJob({
    title: 'Invalidate handoff test',
    mainReference: { dataUrl: onePixelPng },
  });
  await store.claimJob(job.id, 'analysis');
  await store.applyCharacterCard(job.id, card);
  await store.saveCharacterCard(job.id, card);
  const style = (await store.getBootstrap()).prompts.find(
    (item) => item.category === 'style',
  );
  const prepared = await store.configureAndQueueBaseline(job.id, {
    styleModuleId: style.id,
    backend: 'chatgpt-web-manual',
  });
  const runId = prepared.activeRunId;
  const changed = structuredClone(card);
  changed.makeup.value = 'updated makeup';
  const saved = await store.saveCharacterCard(job.id, changed);
  const oldRun = saved.executionRuns.find((run) => run.id === runId);
  assert.equal(oldRun.status, 'interrupted');
  assert.equal(oldRun.handoff.status, 'invalidated');
  assert.equal(saved.activeRunId, null);
  assert.equal(saved.characterCard.makeup.certainty, 'user_confirmed');
  const secondHandoff = await store.configureAndQueueBaseline(job.id, {
    styleModuleId: style.id,
    aspectRatio: '1:1',
    backend: 'chatgpt-web-manual',
  });
  const secondRunId = secondHandoff.activeRunId;
  const reconfigured = await store.configureAndQueueBaseline(job.id, {
    styleModuleId: style.id,
    aspectRatio: '16:9',
    backend: 'built-in-imagegen',
  });
  assert.equal(
    reconfigured.executionRuns.find((run) => run.id === secondRunId).handoff
      .status,
    'invalidated',
  );
  assert.equal(reconfigured.executionRuns.at(-1).backend, 'built-in-imagegen');
  assert.equal(reconfigured.aspectRatio, '16:9');
  await store.claimJob(job.id, 'baseline');
  await store.failJob(job.id, 'test_cleanup', '测试清理');
});

void test('Prompt 整段导入只写草稿，用户确认后才原子入库', async () => {
  const imported = await store.createPromptImport({
    title: '造型合集',
    rawText: 'soft editorial light; silver embroidered coat; sharp eyeliner',
  });
  assert.equal(imported.status, 'queued');
  const importSchema = JSON.parse(
    await fs.readFile(
      new URL('../schemas/prompt-import.schema.json', import.meta.url),
      'utf8',
    ),
  );
  const validateImport = new Ajv2020({ strict: false }).compile(importSchema);
  assert.equal(validateImport(imported), true, JSON.stringify(validateImport.errors));
  const before = await store.getBootstrap();
  const beforeCount = before.prompts.length;
  await store.claimPromptImport(imported.id);
  const draftReady = await store.applyPromptDrafts(imported.id, [
    {
      draftId: 'draft-01',
      name: '银色刺绣外套',
      category: 'outfit',
      rawText: 'silver embroidered coat',
      normalizedText: 'silver embroidered tailored coat',
      avoid: ['do not change face identity'],
      tags: ['刺绣'],
      included: true,
    },
    {
      draftId: 'draft-02',
      name: '凌厉眼线',
      category: 'makeup',
      rawText: 'sharp eyeliner',
      normalizedText: 'precise sharp black eyeliner',
      avoid: [],
      tags: ['眼妆'],
      included: false,
    },
  ]);
  assert.equal(draftReady.status, 'draft_ready');
  assert.equal((await store.getBootstrap()).prompts.length, beforeCount);
  const confirmed = await store.confirmPromptImport(imported.id);
  assert.equal(confirmed.modules.length, 1);
  assert.equal(confirmed.modules[0].category, 'outfit');
  assert.equal((await store.getPromptImport(imported.id)).status, 'completed');
  assert.equal((await store.getBootstrap()).prompts.length, beforeCount + 1);
});

void test('摄影方案包确认后才入库，并支持内置重拍部分成功与网页批次导回', async () => {
  const packImport = await store.createPhotographyPackImport({
    title: '本地抓拍包',
    rawText: 'candid street photography; turning; passing foreground; 35mm; cloudy light',
    authorizationNote: 'test fixture',
  });
  assert.equal(packImport.status, 'queued');
  assert.equal((await store.getBootstrap()).photographyPacks.length, 0);
  await store.claimPhotographyPackImport(packImport.id);
  const pools = Object.fromEntries(
    domain.PHOTOGRAPHY_POOL_KEYS.map((key) => [key, []]),
  );
  Object.assign(pools, {
    expression: ['轻笑', '专注'],
    outfitStyle: ['夹克', '风衣'],
    scene: ['街角', '站台', '天台'],
    moment: ['转身', '迈步', '抬手'],
    shotScale: ['中景', '全身', '近景'],
    focalLength: ['35mm', '50mm', '85mm'],
    cameraPosition: ['平视', '低机位', '肩后'],
    composition: ['偏心', '对角线', '框中框'],
    foreground: ['玻璃', '路人', '植物'],
    lighting: ['阴天', '夕阳', '霓虹'],
    palette: ['低饱和', '冷暖'],
    captureState: ['运动拖影', '浅景深'],
  });
  const draftReady = await store.applyPhotographyPackDraft(packImport.id, {
    name: '本地抓拍包',
    description: '自然瞬间',
    globalStyle: 'natural candid photography',
    pools,
    avoid: ['identity drift'],
    tags: ['抓拍'],
    excludedDefaults: ['固定人物身份'],
  });
  assert.equal(draftReady.status, 'draft_ready');
  assert.equal((await store.getBootstrap()).photographyPacks.length, 0);
  const confirmedPack = await store.confirmPhotographyPackImport(packImport.id);
  assert.equal(confirmedPack.pack.version, 1);
  assert.equal((await store.getBootstrap()).photographyPacks.length, 1);

  const created = await store.createJob({
    title: 'Reshoot integration',
    mainReference: { dataUrl: onePixelPng },
  });
  await store.claimJob(created.id, 'analysis');
  await store.applyCharacterCard(created.id, card);
  await store.saveCharacterCard(created.id, card);
  const style = (await store.getBootstrap()).prompts.find(
    (item) => item.category === 'style',
  );
  await store.configureAndQueueBaseline(created.id, {
    styleModuleId: style.id,
    backend: 'built-in-imagegen',
  });
  await store.claimJob(created.id, 'baseline');
  const source = path.join(testRoot, 'reshoot-source.png');
  await fs.writeFile(source, Buffer.from(onePixelPng.split(',')[1], 'base64'));
  const baseline = await store.attachOutput(created.id, source, 'baseline');
  await assert.rejects(() => store.createReshootDraft(created.id, { sourceOutputId: baseline.selectedOutputId, packId: confirmedPack.pack.id }), /人工验收/);
  await store.updateOutputMetadata(created.id, { outputId: baseline.selectedOutputId, faceReview: { status: 'accepted', checks: { identity: true, anatomy: true, texture: true } } });
  await assert.rejects(
    () =>
      store.createReshootDraft(created.id, {
        sourceOutputId: baseline.selectedOutputId,
        packId: confirmedPack.pack.id,
        allowOutfit: true,
        adultConfirmed: false,
      }),
    /成年人/,
  );
  const drafted = await store.createReshootDraft(created.id, {
    sourceOutputId: baseline.selectedOutputId,
    packId: confirmedPack.pack.id,
    realismStyleId: 'realism-phone-v1',
    quantity: 3,
    aspectRatio: '9:16',
    locks: { scene: '锁定室内' },
    allowOutfit: false,
  });
  const batch = drafted.reshootBatches.at(-1);
  assert.equal(batch.realismStyleSnapshot.id, 'realism-phone-v1');
  assert.equal(batch.outputResolution.pixelHeight, 3840);
  assert.equal(batch.variants[0].outputResolution.pixelWidth, 2160);
  assert.match(batch.variants[0].compiledPrompt, /手机生活照片/);
  const originalStyle = (await store.getBootstrap()).prompts.find((item) => item.id === 'realism-phone-v1');
  await store.createPromptModule({ ...originalStyle, normalizedText: '后来编辑的手机预设' });
  const rerolled = await store.rerollReshootDraft(created.id, batch.id);
  assert.match(rerolled.reshootBatches.at(-1).variants[0].compiledPrompt, /手机生活照片/);
  assert.doesNotMatch(rerolled.reshootBatches.at(-1).variants[0].compiledPrompt, /后来编辑/);
  assert.equal(batch.variants.length, 3);
  assert.equal(new Set(batch.variants.map((item) => item.selections.moment)).size, 3);
  assert.ok(batch.variants.every((item) => !item.selections.outfitStyle));
  const queued = await store.confirmReshootDraft(
    created.id,
    batch.id,
    { backend: 'built-in-imagegen' },
  );
  assert.equal(queued.executionRuns.at(-1).kind, 'reshoot');
  assert.ok(queued.reshootBatches.at(-1).variants.every((item) => !item.compiledPrompt.includes('【Studio 网页重拍默认署名】')));
  await store.claimJob(created.id, 'reshoot');
  await store.attachReshootOutput(created.id, batch.variants[0].id, source);
  await store.failReshootVariant(
    created.id,
    batch.variants[1].id,
    'mock_imagegen',
    '模拟单张失败',
  );
  const partial = await store.attachReshootOutput(
    created.id,
    batch.variants[2].id,
    source,
  );
  assert.equal(partial.activeRunId, null);
  assert.equal(partial.reshootBatches.at(-1).status, 'partial');
  assert.deepEqual(
    partial.reshootVersions.map((item) => item.fileName),
    ['reshoot-v001.png', 'reshoot-v002.png'],
  );
  assert.equal(partial.reshootVersions[0].sourceOutputId, 'baseline-v001');
  assert.equal(partial.reshootVersions[0].outputResolution.pixelHeight, 3840);
  assert.equal(partial.reshootVersions[0].resolutionCheck.status, 'different_ratio');
  assert.equal(partial.reshootVersions[0].realismStyleSnapshot.version, 1);

  const webDraft = await store.createReshootDraft(created.id, {
    sourceOutputId: partial.reshootVersions[0].id,
    packId: confirmedPack.pack.id,
    quantity: 2,
    aspectRatio: 'source',
    realismStyleId: 'realism-natural-v1',
  });
  const webBatch = webDraft.reshootBatches.at(-1);
  const webPrepared = await store.confirmReshootDraft(created.id, webBatch.id, {
    backend: 'chatgpt-web-manual',
  });
  const webRun = webPrepared.executionRuns.at(-1);
  assert.equal(webRun.status, 'waiting_user');
  assert.equal(webRun.handoff.kind, 'reshoot_batch');
  assert.equal(webRun.handoff.prompts.length, 2);
  assert.match(webRun.handoff.prompts[0].promptFile, /prompt-01\.txt$/);
  for (const slot of webRun.handoff.prompts) {
    assert.equal(slot.outputResolution.pixelWidth, 2880);
    assert.equal(slot.prompt.split('【原生输出尺寸').length, 2);
    assert.match(slot.prompt, /右下角/);
    assert.match(slot.prompt, /“阿茶”/);
    assert.match(slot.prompt, /草书手写/);
    assert.equal((await fs.readFile(path.join(store.DATA_ROOT, slot.promptFile), 'utf8')).trim(), slot.prompt);
    assert.equal(webPrepared.reshootBatches.at(-1).variants.find((item) => item.id === slot.variantId).compiledPrompt, slot.prompt);
  }
  const webPartial = await store.importWebHandoffOutputs(
    webRun.id,
    [{ variantId: webBatch.variants[0].id, outputDataUrl: onePixelPng }],
    true,
  );
  assert.equal(webPartial.reshootBatches.at(-1).status, 'partial');
  assert.equal(webPartial.reshootBatches.at(-1).variants[1].status, 'skipped_by_user');
  assert.equal(webPartial.reshootVersions.at(-1).backend, 'chatgpt-web-manual');
  assert.equal(webPartial.reshootVersions.at(-1).resolutionCheck.status, 'below_target');
  assert.equal(webPartial.reshootVersions.at(-1).outputResolution.pixelWidth, 2880);
  assert.equal(webPartial.reshootVersions.at(-1).prompt, webRun.handoff.prompts[0].prompt);
  assert.equal(webPartial.reshootVersions.at(-1).realismStyleSnapshot.id, 'realism-natural-v1');
  assert.match(webPartial.reshootVersions.at(-1).prompt, /concise-photo-v1/);
});

void test('系列写真企划隔离身份、约束同布光参考并按原始输入返工', async () => {
  const seriesPack = domain.normalizePhotographyPackDraft({
    kind: 'series_plan',
    name: 'Nuyoah 方法测试包',
    description: '系列视觉、布光拓扑与返工规则',
    globalStyle: 'evidence-grounded editorial series planning',
    seriesDNA: {
      themeFramework: '同一安静室内写真主题',
      editorialTone: '克制、生活化、非广告摆拍',
      makeupSystem: '保持角色卡妆容，只参考质感',
      hairSystem: '保持角色卡发型发饰',
      outfitSystem: '默认锁定角色服装',
      sceneSystem: '窗边与素色墙面属于同一空间系统',
      propSystem: '少量可交互日常道具',
    },
    imagingProfile: {
      whiteBalance: '中性略暖',
      colorCast: '阴影轻微冷色偏',
      blackPoint: '黑位不死黑',
      highlightRollOff: '窗光高光柔和滚降',
      sharpness: '中等锐度',
      microContrast: '低至中微反差',
      softening: '仅光学柔化',
      noiseCompression: '保留轻微真实噪点与压缩',
      depthOfField: '主体清晰，背景逐层退化',
    },
    visualHierarchy: {
      subjectClarity: '面部与关键角色饰品清晰',
      dominantShapes: '窗框和墙面形成主导大形',
      secondaryDetails: '道具与织物为次级细节',
      lowDetailSpace: '保留低细节留白',
    },
    workflowRules: {
      referenceAssignment: '每个分镜一张主参考，最多两张同布光辅助参考',
      lightingTopology: '光源固定在世界空间，不随相机旋转',
      subjectEventCausality: '先有现场事件，再产生表情、视线与身体响应',
      storyboardDiversity: '分镜在事件、景别和机位上形成差异',
      antiCommercialPolish: '仅在参考不支持时避免商业轮廓光和过度磨皮',
      redoPolicy: '返工从干净源图、原始写真参考与反馈重新编译',
    },
    qualityGates: domain.SERIES_QUALITY_AXES.map(
      (key) => domain.SERIES_QUALITY_LABELS[key],
    ),
    avoid: ['reference person identity', 'watermark'],
    excludedDefaults: ['默认写真人物脸部', '默认肤色', '默认身材'],
  });
  assert.equal(seriesPack.kind, 'series_plan');
  assert.equal(seriesPack.rules.identityFromStudioOnly, true);
  assert.throws(
    () => domain.selectPhotographyVariables({ pack: seriesPack, quantity: 1 }),
    /不能按随机变量池/,
  );

  const packImport = await store.createPhotographyPackImport({
    title: '系列写真测试包',
    packKind: 'series_plan',
    rawText: 'series planning fixture',
    authorizationNote: 'MIT fixture',
  });
  await store.claimPhotographyPackImport(packImport.id);
  await store.applyPhotographyPackDraft(packImport.id, seriesPack);
  const confirmed = await store.confirmPhotographyPackImport(packImport.id);
  assert.equal(confirmed.pack.kind, 'series_plan');
  const [packSchema, packImportSchema] = await Promise.all(
    ['photography-pack.schema.json', 'photography-pack-import.schema.json'].map(
      async (name) =>
        JSON.parse(
          await fs.readFile(new URL(`../schemas/${name}`, import.meta.url), 'utf8'),
        ),
    ),
  );
  const schemaAjv = new Ajv2020({ strict: false });
  const validatePack = schemaAjv.compile(packSchema);
  const validatePackImport = schemaAjv.compile(packImportSchema);
  assert.equal(validatePack(confirmed.pack), true, JSON.stringify(validatePack.errors));
  assert.equal(
    validatePackImport(confirmed.packImport),
    true,
    JSON.stringify(validatePackImport.errors),
  );

  const created = await store.createJob({
    title: 'Series plan integration',
    mainReference: { dataUrl: onePixelPng },
  });
  await store.claimJob(created.id, 'analysis');
  await store.applyCharacterCard(created.id, card);
  await store.saveCharacterCard(created.id, card);
  const style = (await store.getBootstrap()).prompts.find(
    (item) => item.category === 'style',
  );
  await store.configureAndQueueBaseline(created.id, {
    styleModuleId: style.id,
    backend: 'built-in-imagegen',
  });
  await store.claimJob(created.id, 'baseline');
  const source = path.join(testRoot, 'series-source.png');
  await fs.writeFile(source, Buffer.from(onePixelPng.split(',')[1], 'base64'));
  const baseline = await store.attachOutput(created.id, source, 'baseline');
  await store.updateOutputMetadata(created.id, { outputId: baseline.selectedOutputId, faceReview: { status: 'accepted', checks: { identity: true, anatomy: true, texture: true } } });
  const queued = await store.createSeriesPlanReshoot(created.id, {
    sourceOutputId: baseline.selectedOutputId,
    packId: confirmed.pack.id,
    realismStyleId: 'realism-low-light-v1',
    photographyReferences: [
      { name: '窗边主参考', dataUrl: onePixelPng },
      { name: '同布光辅助', dataUrl: onePixelPng },
    ],
    quantity: 2,
    aspectRatio: '3:4',
  });
  assert.equal(queued.reshootBatches.at(-1).mode, 'series_plan');
  assert.equal(queued.reshootBatches.at(-1).outputResolution.pixelWidth, 2448);
  assert.equal(queued.executionRuns.at(-1).kind, 'series_deconstruct');
  await store.claimJob(created.id, 'series_deconstruct');
  const planDraft = {
    commonPackage: {
      theme: '窗边安静写真',
      editorialTone: '自然、克制',
      makeupHair: '沿用角色设定',
      wardrobe: '沿用角色服装',
      sceneProps: '窗帘和木椅',
    },
    imagingProfile: '中性略暖白平衡、柔和高光滚降、真实噪点和浅景深',
    visualHierarchy: '面部与发饰清晰，窗框为大形，道具为次级细节，墙面留白',
    lightingSetups: [
      {
        id: 'light-01',
        name: '左侧窗光',
        referenceIds: ['photo-ref-01', 'photo-ref-02'],
        description: '左侧大窗作为主光，室内环境为弱填充',
        topology: '光源在人物左前方世界空间固定，右后方自然衰减',
      },
    ],
    excludedReferenceIds: [],
    shots: [
      {
        id: 'shot-01',
        title: '坐下整理袖口',
        mainReferenceId: 'photo-ref-01',
        auxiliaryReferenceIds: ['photo-ref-02'],
        lightingSetupId: 'light-01',
        shotScale: '中景',
        camera: '平视三分之二侧面',
        composition: '人物偏左，窗框形成大形',
        subjectEvent: '坐下时整理袖口',
        expressionResponse: '视线落在袖口，表情专注，肩膀自然前倾',
        poseGazeProps: '双手接触袖口，身体重心落在椅面',
        lightingPrediction: '左脸和袖口较亮，右侧柔和衰减',
        customPrompt: '',
      },
      {
        id: 'shot-02',
        title: '起身看向窗外',
        mainReferenceId: 'photo-ref-02',
        auxiliaryReferenceIds: ['photo-ref-01'],
        lightingSetupId: 'light-01',
        shotScale: '全身',
        camera: '稍低机位侧面',
        composition: '竖幅全身与大面积墙面留白',
        subjectEvent: '听到窗外声音后起身',
        expressionResponse: '视线转向窗外，眉眼轻微警觉，身体向声音方向响应',
        poseGazeProps: '一手扶椅背，站立重心稳定',
        lightingPrediction: '窗侧轮廓自然变亮，背光侧保持细节',
        customPrompt: '',
      },
    ],
  };
  const planned = await store.applySeriesPlanDraft(created.id, planDraft);
  const plannedBatch = planned.reshootBatches.at(-1);
  assert.equal(plannedBatch.status, 'plan_ready');
  const compiled = await store.compileSeriesPlan(created.id, plannedBatch.id);
  const compiledBatch = compiled.reshootBatches.at(-1);
  assert.equal(compiledBatch.realismStyleSnapshot.id, 'realism-low-light-v1');
  assert.ok(compiledBatch.variants.every((item) => item.compiledPrompt.includes(compiledBatch.realismStyleSnapshot.normalizedText)));
  assert.equal(compiledBatch.status, 'draft');
  assert.equal(compiledBatch.variants.length, 2);
  const prompt = compiledBatch.variants[0].compiledPrompt;
  assert.match(prompt, /妆发不采用写真人物/);
  assert.match(prompt, /不提供新的妆容、发型或身份/);
  assert.ok(prompt.indexOf('【本张新分镜】') < prompt.indexOf('【角色强约束】'));
  assert.match(prompt, /角色强约束 > 用户锁定/);
  assert.match(prompt, /写真参考中的人物一律不承担身份/);
  assert.match(prompt, /光源和遮挡物固定在世界空间中/);
  assert.match(prompt, /concise-photo-v1/);
  assert.match(prompt, /保持系列曝光、色彩与锐度逻辑/);
  assert.doesNotMatch(prompt, /photography-v2 · reshoot/);

  const executing = await store.confirmReshootDraft(created.id, compiledBatch.id, {
    backend: 'built-in-imagegen',
  });
  assert.equal(executing.executionRuns.at(-1).kind, 'reshoot');
  await store.claimJob(created.id, 'reshoot');
  await store.attachReshootOutput(created.id, compiledBatch.variants[0].id, source);
  const completed = await store.attachReshootOutput(
    created.id,
    compiledBatch.variants[1].id,
    source,
  );
  const firstOutput = completed.reshootVersions.find(
    (item) => item.variantId === compiledBatch.variants[0].id,
  );
  assert.equal(firstOutput.mode, 'series_plan');
  assert.equal(firstOutput.outputResolution.pixelWidth, 2448);
  assert.equal(firstOutput.resolutionCheck.status, 'different_ratio');
  assert.equal(firstOutput.qualityReview, null);
  const quality = {
    axes: Object.fromEntries(
      domain.SERIES_QUALITY_AXES.map((key) => [key, { status: 'pass', note: '通过' }]),
    ),
    technicalIssues: [],
    summary: '七项检查通过',
  };
  await store.applyReshootQuality(created.id, compiledBatch.variants[0].id, quality);
  const adopted = await store.applyReshootQuality(
    created.id,
    compiledBatch.variants[0].id,
    { ...quality, confirmFinal: true },
    { userFinal: true },
  );
  assert.equal(
    adopted.reshootVersions.find((item) => item.id === firstOutput.id).qualityReview
      .adoptionStatus,
    'final',
  );
  const redo = await store.recompileSeriesPlan(created.id, compiledBatch.id, {
    variantId: compiledBatch.variants[0].id,
    diagnosticOutputId: firstOutput.id,
    feedback: '布光过平，保留原始参考的侧向明暗关系',
  });
  const redoBatch = redo.reshootBatches.at(-1);
  assert.equal(redoBatch.realismStyleSnapshot.id, 'realism-low-light-v1');
  assert.ok(redoBatch.variants[0].compiledPrompt.includes(compiledBatch.realismStyleSnapshot.normalizedText));
  assert.equal(redoBatch.sourceOutputId, 'baseline-v001');
  assert.equal(redoBatch.diagnosticOutputId, firstOutput.id);
  assert.deepEqual(
    redoBatch.photographyReferences.map((item) => item.id),
    ['photo-ref-01', 'photo-ref-02'],
  );
  const handoffPrepared = await store.confirmReshootDraft(created.id, redoBatch.id, {
    backend: 'chatgpt-web-manual',
  });
  const handoffRun = handoffPrepared.executionRuns.at(-1);
  assert.equal(handoffRun.status, 'waiting_user');
  assert.ok(handoffRun.handoff.prompts.every((slot) => slot.prompt.includes('“阿茶”') && !slot.prompt.includes('默认不添加署名或水印。')));
  assert.deepEqual(
    handoffRun.handoff.assets.slice(0, 3).map((item) => item.role),
    ['edit_source', 'photography_reference', 'photography_reference'],
  );
  assert.ok(
    handoffRun.handoff.assets.every((item) => item.path !== firstOutput.path),
  );
  await store.cancelWebHandoff(handoffRun.id);
});

void test('失败阶段只能由用户动作重新排队', async () => {
  const job = await store.createJob({
    title: 'Retry test',
    mainReference: { dataUrl: onePixelPng },
  });
  await store.claimJob(job.id, 'analysis');
  const failed = await store.failJob(job.id, 'mock_failure', '模拟失败');
  const failedRun = failed.executionRuns.at(-1);
  assert.equal(failedRun.status, 'failed');
  assert.equal((await store.getJob(job.id)).activeRunId, null);
  const retried = await store.retryRun(failedRun.id);
  assert.equal(retried.executionRuns.at(-1).status, 'queued');
  assert.equal(retried.executionRuns.at(-1).retryOf, failedRun.id);
});

void test('v1 失败任务有首张候选时迁移为可调整的基准图', () => {
  const migrated = store.migrateLegacyJob({
    id: 'job-legacy',
    title: 'Legacy',
    characterId: 'character-legacy',
    references: [{ role: 'character_main', path: 'characters/x.png' }],
    characterCard: card,
    characterCardVersion: 1,
    compiledPrompt: 'legacy prompt',
    candidates: [
      {
        path: 'outputs/job-legacy/candidate-01.png',
        url: '/assets/outputs/job-legacy/candidate-01.png',
        fileName: 'candidate-01.png',
        bytes: 10,
      },
    ],
    refinements: [],
    status: 'failed',
    error: { message: '候选数不足' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(migrated.schemaVersion, 5);
  assert.equal(migrated.workflowStep, 'adjustment');
  assert.equal(migrated.baselineVersions.length, 1);
  assert.equal(migrated.selectedOutputId, 'baseline-v001');
  assert.equal(migrated.error, null);
  assert.equal(migrated.legacyError.message, '候选数不足');
  assert.deepEqual(migrated.reshootBatches, []);
  assert.deepEqual(migrated.reshootVersions, []);
});

void test('桥接任务使用临时 Skill 流程且不包含模型覆盖', () => {
  const baseline = bridge.buildTaskPrompt('job-123', 'baseline');
  assert.match(baseline, /\$ai-cos/);
  assert.match(baseline, /imagegen 一次且只生成一张图/);
  assert.match(baseline, /attach-output --kind baseline/);
  assert.doesNotMatch(baseline, /gpt-/i);
});

void test('Prompt 拆分桥接明确禁止 imagegen 与直接入库', () => {
  const task = bridge.buildTaskPrompt(
    'prompt-import-123',
    'prompt_split',
    'prompt_import',
  );
  assert.match(task, /apply-prompt-drafts/);
  assert.match(task, /不要直接创建 Prompt 模块/);
  assert.match(task, /不要调用 imagegen/);
  assert.match(task, /outfit、body_proportion、makeup、hair_accessory/);
});

void test('摄影包解析只写草稿，重拍桥接逐方案归档并继续单张失败', () => {
  const parse = bridge.buildTaskPrompt(
    'pack-import-123',
    'pack_parse',
    'pack_import',
  );
  assert.match(parse, /apply-pack-draft/);
  assert.match(parse, /不得编造缺失内容/);
  assert.match(parse, /不要调用 imagegen/);
  const reshoot = bridge.buildTaskPrompt('job-reshoot', 'reshoot', 'job');
  assert.match(reshoot, /每个 variant/);
  assert.match(reshoot, /attach-reshoot-output/);
  assert.match(reshoot, /fail-reshoot-variant/);
  assert.match(reshoot, /不得自动重试/);
  const series = bridge.buildTaskPrompt(
    'job-series',
    'series_deconstruct',
    'job',
  );
  assert.match(series, /claim-series-plan/);
  assert.match(series, /同一布光子方案辅助参考/);
  assert.match(series, /不要调用 imagegen/);
});

void test('模拟 App Server 完成临时 prompt_split 任务并只写回草稿', async () => {
  const fakeCodex = path.join(testRoot, 'fake-codex.mjs');
  const ctl = path.resolve('scripts/ai-cosctl.mjs');
  await fs.writeFile(
    fakeCodex,
    `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
let buffer = '';
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf('\\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method === 'initialize') send({ id: message.id, result: {} });
      else if (message.method === 'thread/start') {
        if (!message.params.ephemeral) send({ id: message.id, error: { message: 'thread must be ephemeral' } });
        else send({ id: message.id, result: { thread: { id: 'thread-mock' } } });
      } else if (message.method === 'turn/start') {
        const hasSkill = message.params.input.some((item) => item.type === 'skill' && item.name === 'ai-cos');
        const prompt = message.params.input.find((item) => item.type === 'text')?.text || '';
        const importId = prompt.match(/prompt-import-[A-Za-z0-9-]+/)?.[0];
        const runId = prompt.match(/--run (run-[A-Za-z0-9-]+)/)?.[1];
        send({ id: message.id, result: { turn: { id: 'turn-mock' } } });
        setTimeout(() => {
          const claim = spawnSync(process.execPath, [process.env.AI_COS_TEST_CTL, 'claim-prompt-import', '--inbox', importId, '--run', runId, '--json'], { env: process.env, encoding: 'utf8' });
          const drafts = [{ draftId: 'draft-01', name: '模拟姿态', category: 'pose', rawText: 'standing pose', normalizedText: 'balanced standing pose', avoid: [], tags: ['姿态'], included: true }];
          const apply = spawnSync(process.execPath, [process.env.AI_COS_TEST_CTL, 'apply-prompt-drafts', '--inbox', importId, '--run', runId, '--json'], { env: process.env, input: JSON.stringify(drafts), encoding: 'utf8' });
          if (!hasSkill || claim.status !== 0 || apply.status !== 0) send({ method: 'turn/completed', params: { turn: { id: 'turn-mock', status: 'failed', error: { message: claim.stderr || apply.stderr || 'mock failed' } } } });
          else send({ method: 'turn/completed', params: { turn: { id: 'turn-mock', status: 'completed' } } });
        }, 50);
      }
    }
    newline = buffer.indexOf('\\n');
  }
});
`,
    { mode: 0o755 },
  );
  await fs.chmod(fakeCodex, 0o755);
  const previousCodexPath = process.env.AI_COS_CODEX_PATH;
  process.env.AI_COS_CODEX_PATH = fakeCodex;
  process.env.AI_COS_TEST_CTL = ctl;
  const imported = await store.createPromptImport({
    title: '桥接模拟',
    rawText: 'standing pose',
  });
  const worker = new bridge.CodexBridge();
  try {
    const result = await worker.run(
      'prompt_import',
      imported.id,
      imported.executionRuns[0],
    );
    assert.equal(result.status, 'draft_ready');
    assert.equal(result.drafts.length, 1);
    assert.equal(result.moduleIds.length, 0);
  } finally {
    worker.stop();
    if (previousCodexPath) process.env.AI_COS_CODEX_PATH = previousCodexPath;
    else delete process.env.AI_COS_CODEX_PATH;
    delete process.env.AI_COS_TEST_CTL;
  }
});

void test('Prompt 编辑生成新版本', async () => {
  const first = await store.createPromptModule({
    name: '版本测试',
    category: 'pose',
    normalizedText: 'pose one',
    rawText: 'raw',
    avoid: [],
    tags: [],
  });
  const second = await store.createPromptModule({ ...first, normalizedText: 'pose two' });
  assert.equal(second.version, 2);
  assert.equal(second.id, first.id);
});
