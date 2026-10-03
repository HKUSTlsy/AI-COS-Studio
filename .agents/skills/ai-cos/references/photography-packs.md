# Random photography packs and creative reshoots

This reference is only for `variable_pool` packs. Route `series_plan`, `series_deconstruct`, series redo, and seven-axis quality work to [series-photography.md](series-photography.md).

## Pack parsing

Apply [image-prompting.md](image-prompting.md) when normalizing source descriptions. Preserve source text but separate appearance from output pixels and scope each variable to its pool.

1. Claim with `ai-cosctl claim-pack-import --import <id> --json`.
2. Check `packKind === "variable_pool"`, then read only `rawText`. Extract source-grounded values into the twelve pools: `expression`, `outfitStyle`, `scene`, `moment`, `shotScale`, `focalLength`, `cameraPosition`, `composition`, `foreground`, `lighting`, `palette`, and `captureState`.
3. Keep a concise `globalStyle`, explicit `avoid` items, source-grounded tags, and `excludedDefaults`. When present, extract shared multi-person events into `groupInteractions` (A/B/C/D labels, one event per item), separate from single-person `moment`. Extract mutually exclusive camera media into `imagingMedia` (one complete compatible camera medium per item). Both optional lists allow up to 100 strings of 1–500 characters. Do not invent missing entries.
4. Move fixed subject identity, ethnicity or skin tone, body defaults, and face defaults into `excludedDefaults`. They must never become active variables. Keep explicit outfit ideas in `outfitStyle`, but the pack rules keep outfit changes disabled by default.
5. Do not manufacture a value for an absent pool. Deduplicate close repetitions without broadening the source meaning.
6. Write one editable draft with `ai-cosctl apply-pack-draft --import <id> --file <draft.json> --json`. Stop without creating a formal pack or calling imagegen.

The draft must include `name`, `description`, `globalStyle`, every pool as an array, `avoid`, `tags`, `excludedDefaults`, and rules declaring user locks first, batch diversity, and outfit disabled by default. Set `rules.candidOcclusion` to `full` only when the imported source explicitly supports candid occlusion/partial framing; otherwise use `none`. Never impose candid blur or partial framing on every photography pack.

Do not copy source instructions that automatically age up people, default everyone
to one ethnicity/gender/skin/body, invent permanent skin marks, or enable all
wardrobes. Preserve these only as excluded source assumptions. The Studio's
explicit 阿茶 web watermark remains the only signature exception.

## Creative reshoot

For new single-person batches, read `creativePolicy`. `original` keeps the COS
wardrobe; `character` permits only the explicitly authorized wardrobe changes.
`outfitSource` selects the template, user text, or an `outfit_reference` image.
That image provides clothing only, never identity, body, hair or makeup.
Head accessories remain locked independently of clothing accessories. With
`propPolicy: free`, do not force the source weapon or handheld prop back in.
These per-run choices take precedence over a pack's default outfit lock.
Older batches without this field retain their saved `allowOutfit` behavior.

1. Claim with `ai-cosctl claim --job <id> --kind reshoot --json`.
2. Inspect each variant's `orderedInputFiles`. For a random single-person reshoot, the first `edit_source` image is the clean source, followed by an optional wardrobe-only image, then character/face details. For `full_prompt`, read [full-prompts.md](full-prompts.md). For `multi_person`, read [multi-person.md](multi-person.md) instead: the first N images are distinct participants.
3. Read `execution.activeReshootBatch`. Each variant has an independent seed, selected variables, and final `compiledPrompt` already approved by the user.
4. Process variants by ascending `index`. For each variant, call imagegen exactly once with its compiled Prompt and the ordered references.
5. On success, immediately run `ai-cosctl attach-reshoot-output --job <id> --variant <variantId> --path <png> --json`.
6. On one-image failure, run `ai-cosctl fail-reshoot-variant --job <id> --variant <variantId> --type <type> --message <message> --json`, then continue to the next variant.
7. Never reroll, change locks, retry, reuse an image, or combine variants. The Studio calculates `succeeded`, `partial`, or `failed` when every variant is terminal.

The compiled Prompt permits candid partial framing and foreground occlusion at the requested scale. These effects may cover a face edge, shoulder, arm, leg, or body edge, but may not change identity, create anatomical errors, or erase all face recognition cues. Outfit remains locked unless the batch snapshot explicitly has both `allowOutfit: true` and `adultConfirmed: true`.
