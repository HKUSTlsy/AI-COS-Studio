import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { normalizePhotographyPackDraft, PHOTOGRAPHY_POOL_KEYS } from '../server/domain.mjs';

void test('摄影包 schema 与运行时一致：允许关闭遮挡，不放宽身份与换装锁定', async () => {
  const schema = JSON.parse(await fs.readFile(new URL('../schemas/photography-pack.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  const pools = Object.fromEntries(PHOTOGRAPHY_POOL_KEYS.map((key) => [key, key === 'moment' ? ['回头'] : []]));
  for (const candidOcclusion of ['none', 'full']) {
    const pack = { ...normalizePhotographyPackDraft({ name: '测试包', globalStyle: '真人摄影', pools, rules: { candidOcclusion } }), id: 'pack-test', version: 1, source: {} };
    assert.equal(validate(pack), true, JSON.stringify(validate.errors));
    for (const invalid of [{ candidOcclusion: 'unknown' }, { userLocksWin: false }, { outfitEnabledByDefault: true }]) {
      assert.equal(validate({ ...pack, rules: { ...pack.rules, ...invalid } }), false);
    }
  }
});
