---
name: ai-cos
description: Operate the local AI COS Studio for anime-reference-to-photoreal-cosplay work. Use when the Studio bridge asks Codex to analyze a character, generate one high-fidelity baseline COS image, make one isolated adjustment, parse a photography pack, deconstruct a series-photo reference set, execute a creative reshoot batch, compose complete VSC prompts from text or mixed-source people, render confirmed prompt creations, review series quality, inspect the workbench, manage authorized faces, or split photography prompts into modules.
---

# AI COS Studio

Use the project wrapper for every task read or state change:

```bash
.agents/skills/ai-cos/scripts/ai-cosctl <command>
```

Every machine claim, apply, attach, and fail command requires `--run <runId>`.
Use the run ID supplied by the bridge, or read it with `show --job <id> --json`
(`show-prompt` / `show-pack` for imports) before claiming. Keep that same ID for
the entire execution, including quality review. Never switch to a newer run ID
after a stale-write rejection: stop, because the user has cancelled or replaced
that execution. An expired run cannot claim, fail, or archive into its successor.

## Route the request

- Compose whole Prompts using VSC (`prompt_compose`), or generate user-confirmed Prompt creation images (`prompt_render`): follow [prompt-creation.md](references/prompt-creation.md). Text-only and mixed-source group creation do not require a baseline job.
- Open or inspect the workbench: run `ai-cosctl open` and reuse the local service.
- Continue the current task: run `ai-cosctl current --json`, inspect `workflowStep` and `execution.run`, then follow the matching workflow.
- Analyze a character: follow [workflow.md](references/workflow.md#character-analysis) and [character-card.md](references/character-card.md).
- Generate a baseline: follow [workflow.md](references/workflow.md#baseline-generation).
- Make one adjustment: follow [workflow.md](references/workflow.md#single-category-adjustment).
- Split an imported Prompt: follow [prompt-modules.md](references/prompt-modules.md).
- Adapt a complete saved Prompt (`prompt_adapt`) or execute a `full_prompt` reshoot: follow [full-prompts.md](references/full-prompts.md). This is not module splitting or pack parsing.
- Parse a random photography pack or execute a random reshoot: follow [photography-packs.md](references/photography-packs.md).
- Execute a multi-person reshoot (`mode: multi_person`): follow [multi-person.md](references/multi-person.md). This uses the existing reshoot run and archive commands, not a baseline or single-person edit.
- Parse a series-plan pack, deconstruct a photography reference set, execute a series reshoot, or review it: follow [series-photography.md](references/series-photography.md).

## Non-negotiable rules

1. This Skill executes Studio background tasks only. Claimed baseline, adjustment, and reshoot tasks always use the built-in `imagegen` tool. Never request or store an API key, access ChatGPT browser state, or claim a hidden model version. `chatgpt-web-manual` handoffs are prepared and completed by Studio and the user, not by this Skill.
2. Treat each image only according to the `role` and `purpose` returned by `claim --json`.
3. The character card and main reference override photography templates. A style cannot change character colors, outfit structure, hair accessories, pose, framing, visible background, or face identity in a baseline.
4. A face profile fixes facial identity only. Body shape comes from the confirmed character card.
5. A baseline task requires exactly one imagegen call producing one image. Archive it as `baseline`; do not create candidates or a grid.
6. An adjustment task changes exactly one requested category. Inspect inputs in `execution.orderedInputFiles` order: clean source, optional annotation, optional category-scoped adjustment reference, then necessary character references. Restate every preserve constraint, call imagegen once, and archive as `adjustment`.
7. Do not auto-score, auto-select, silently retry, or overwrite outputs. A new attempt requires an explicit new or retried Studio run.
8. A `pack_parse` task only extracts explicit source material into a pending draft. Exclude fixed subject identity, ethnicity or skin tone, body defaults, and face defaults. Never invent missing pools or directly publish a pack.
9. A reshoot task calls imagegen once per variant, in order. Archive each success immediately. Record a single-variant failure and continue the remaining variants; never retry one silently or reuse an output for another variant.
10. A `series_deconstruct` task analyzes only the saved photography references and writes an editable plan. Reference people never provide identity, face, body, skin tone, or character design. Main and auxiliary references assigned to one shot must share one lighting setup.
11. A series redo starts from its clean COS source, original photography references, and feedback. A prior generated image is diagnostic only and must never enter imagegen unless the user explicitly starts a separate single-category adjustment from it.
12. Do not create sexualized content involving minors or age-ambiguous characters. Never use an unauthorized uploaded face profile, regardless of its preset/private label. Outfit changes require the saved adult confirmation.
    A creative run's `creativePolicy` controls wardrobe independently of pack defaults. `original` keeps COS clothing; `character` preserves face/body identity, hair color/style, head accessories, iris and signature makeup while allowing the explicitly authorized wardrobe. `propPolicy: free` does not require original handheld props. These choices never change baseline fidelity.
13. On job failure, run `ai-cosctl fail --job <id> --type <type> --message <message>`. On series deconstruction failure, use `fail-series-plan`. On Prompt splitting failure, run `ai-cosctl fail-prompt-import --inbox <id> --type <type> --message <message>`. On pack parsing failure, run `ai-cosctl fail-pack-import --import <id> --type <type> --message <message>`. Record the real cause and do not fabricate success.

## Image handling

For Prompt review, library parsing, or generation preparation, read [image-prompting.md](references/image-prompting.md). It defines concrete photographic descriptions and the maximum-native-resolution request policy. This never authorizes rewriting an already claimed Prompt or adding unsupported imagegen parameters.

For an authorized library-wide review, read active materials with `ai-cosctl list-materials --json`. Use `revise-materials --file <plan.json> --json` for validation, then `--apply` for a versioned revision. Preserve original source text, prior versions and existing job snapshots.

Use absolute paths from the `execution` object. Baselines may use the main character image, character details, and up to three complementary face angles. Treat the requested baseline aspect ratio as a composition target only; never crop, pad, or stretch after generation. Adjustments follow `orderedInputFiles`; an `adjustment_reference` controls only the selected category and never replaces face identity or other preserved design.

After imagegen succeeds, immediately archive the returned local PNG path with `ai-cosctl attach-output`. Keep all private data under ignored `local-data/`.

For reshoots, use `execution.activeReshootBatch.variants` and each variant's own `orderedInputFiles`. Archive with `ai-cosctl attach-reshoot-output --job <id> --variant <variantId> --path <png>`. If one variant fails, use `ai-cosctl fail-reshoot-variant` and continue. The clean source fixes identity and all locked character information; partial crops and foreground occlusion are allowed only as stated in each compiled Prompt. After a successful series variant, write the seven-axis test review with `apply-reshoot-quality`; only the Studio user can mark a version final.
