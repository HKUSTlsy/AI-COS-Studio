# AI COS task workflow

Studio can also prepare a `chatgpt-web-manual` handoff. That path is deliberately outside this Skill: do not claim it, control a browser, inspect cookies or tokens, upload assets to ChatGPT, or archive its result with `ai-cosctl`. The user imports a manually generated result through Studio's local API. Every baseline, adjustment, or reshoot task returned by `ai-cosctl claim` must therefore be a `built-in-imagegen` run.

## Character analysis

1. Run `ai-cosctl claim --job <id> --kind analysis --json`. Never analyze without a successful claim.
2. Inspect every `character_main` and `character_detail` path with `view_image`. Do not use face references for the role card.
3. Fill all ten fields in [character-card.md](character-card.md). Use `observed` only for clearly visible evidence, `inferred` for uncertain or unseen information, and never set `user_confirmed` during automatic analysis.
4. Save the JSON card in a task-local scratch file and run `ai-cosctl apply-character-card --job <id> --file <card.json> --json`.
5. Stop. Studio will show the card for user editing and confirmation.

## Baseline generation

1. Run `ai-cosctl claim --job <id> --kind baseline --json`.
2. Use the returned `compiledPrompt` verbatim as the constraint base.
3. Pass ordered paths from `execution.referenceFiles` to imagegen, preserving every role and purpose. Include no more than three complementary face angles.
4. Call imagegen exactly once for one image. The character main image controls visible design, pose, body orientation, camera, crop, subject placement, and visible background. Photography style changes realism only.
   Treat `aspectRatio` in the compiled Prompt as a native composition target. Do not post-crop, pad, add black bars, or stretch the result.
5. Use the local PNG result path with `ai-cosctl attach-output --job <id> --kind baseline --path <png> --json`.
6. Stop after one successful archive. Never generate extra candidates or retry silently.

## Single-category adjustment

1. Run `ai-cosctl claim --job <id> --kind adjustment --json`.
2. Inspect `execution.orderedInputFiles` in order: clean source, optional annotation, optional adjustment reference, then necessary character references. Treat annotation only as a locator.
3. Use `compiledAdjustmentPrompt`. Modify only `activeAdjustment.category` according to the saved text/module/reference inputs, and preserve every entry in `activeAdjustment.preserve`.
4. An adjustment reference may influence only the selected category. Background references may control the background; camera/light references may control camera, composition and light. Other categories may not change these. Never replace face identity. Resolve conflicts as text request > adjustment reference > Prompt module, while the clean source and preserve list win for all untouched categories. Keep already accepted branch changes; do not restore an earlier character-card design over the source image.
5. Call imagegen exactly once and archive with `ai-cosctl attach-output --job <id> --kind adjustment --path <png> --json`.

## Failure recovery

Record the real cause with `fail`. Use a concise type such as `input_validation`, `imagegen_failure`, `policy_restriction`, or `output_missing`. Never retry automatically, change the compiled Prompt, or fabricate an output.

Random photography-pack parsing and random creative reshoots use [photography-packs.md](photography-packs.md). Series-plan imports, photography-reference deconstruction, series reshoots, redo, and quality review use [series-photography.md](series-photography.md).
