import { compileBaselinePrompt, compileAdjustmentPrompt, compileReshootPrompt, compileSeriesReshootPrompt, compileFullPromptReshoot, buildAdjustmentPreserve, PHOTOGRAPHY_POOL_KEYS } from '../../server/domain.mjs';
import { compileMultiPersonPrompt } from '../../server/multi-person.mjs';
import { maximumNativeResolution } from '../../lib/image-output-policy.mjs';

export const card = Object.fromEntries(Object.entries({ hairstyle: '银色长发，侧分刘海', hairAccessories: '左侧蓝色蝴蝶发饰', iris: '蓝色虹膜', makeup: '浅粉眼影与豆沙唇色', bodySilhouette: '自然高挑比例', outfitLayers: '白色衬衫与深蓝长裙', colors: '银白与深蓝', materials: '棉布、丝绸与金属扣', accessories: '银色胸针', footwear: '黑色短靴' }).map(([key, value]) => [key, { value, certainty: 'user_confirmed', strongLock: true }]));
export const references = [{ role: 'character_main', purpose: '核对角色设计', path: 'main.png' }];
export const pack = { name: '测试摄影包', globalStyle: '自然生活摄影', pools: Object.fromEntries(PHOTOGRAPHY_POOL_KEYS.map((key) => [key, key === 'moment' ? ['轻扶窗框看向室外'] : []])), rules: { candidOcclusion: 'full' }, avoid: [] };
export const selections = { scene: '安静的窗边', moment: '轻扶窗框看向室外', expression: '轻微微笑', shotScale: '中景', cameraPosition: '平视', focalLength: '自然人像透视', composition: '人物偏右，左侧留白', foreground: '窗帘边缘', lighting: '左侧柔和窗光', palette: '中性暖色', captureState: '静止清晰' };
export const photoRefs = [{ id: 'photo-1', name: '窗光主图' }, { id: 'photo-2', name: '同布光补充' }];
export const shot = { id: 'shot-1', mainReferenceId: 'photo-1', auxiliaryReferenceIds: ['photo-2'], lightingSetupId: 'light-1', shotScale: '中景', camera: '平视', composition: '人物偏右', subjectEvent: '轻扶窗框看向室外', expressionResponse: '放松的微笑', poseGazeProps: '手掌触碰窗框', lightingPrediction: '左脸亮、右脸暗' };
export const plan = { commonPackage: { theme: '安静午后', wardrobe: '白衬衫', sceneProps: '木窗' }, imagingProfile: '柔和高光，中等反差', visualHierarchy: '人物清楚，窗框次要，墙面留白', lightingSetups: [{ id: 'light-1', referenceIds: ['photo-1', 'photo-2'], description: '左侧窗光', topology: '窗户固定在房间左侧' }], shots: [shot] };
export const seriesPack = { name: '写真方法', kind: 'series_plan', globalStyle: '自然摄影', seriesDNA: {}, imagingProfile: {}, visualHierarchy: {}, workflowRules: {}, avoid: [] };
export const original = '  A person leans against the window, their hand resting on the wooden frame.\nSoft light falls across the shirt folds; the room stays quiet and dim.  ';
export function promptSamples() {
  const outputResolution = maximumNativeResolution('9:16');
  const input = { characterCard: card, references, aspectRatio: '9:16', outputResolution };
  const group = { event: '角色 A 把书递给角色 B，B 伸手接住', medium: '自然手机成像', participants: ['A', 'B'].map((label, i) => ({ label, name: label, jobId: `job-${label}`, outputId: `image-${label}`, adultConfirmed: true, wardrobe: 'locked', position: i ? '右侧' : '左侧', sourceImage: { path: `${label}.png` }, context: { characterCard: card, references } })) };
  return {
    baseline: compileBaselinePrompt(input),
    adjustment: compileAdjustmentPrompt({ ...input, category: 'background', request: '背景改为素灰墙面', preserve: buildAdjustmentPreserve(card, 'background') }),
    random: compileReshootPrompt({ ...input, pack, selections }),
    series: compileSeriesReshootPrompt({ ...input, pack: seriesPack, plan, shot, references: photoRefs, characterReferences: references }),
    full: compileFullPromptReshoot({ ...input, adaptedText: original, creative: { mode: 'original' } }),
    multi: compileMultiPersonPrompt({ group, pack, selections, aspectRatio: '9:16', outputResolution }),
  };
}
