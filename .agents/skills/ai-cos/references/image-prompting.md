# Prompt review and native-resolution requests

Studio adaptation of the [official image-prompting guide](https://developers.openai.com/api/docs/guides/image-prompting), reviewed 2026-09-10. These are prompt-writing rules, not a claim about the hidden model used by either backend.

## Preparing modules and packs

- Keep the visible scene concise: connect the subject, action, gaze, clothing and
  interaction first, then framing/viewpoint, light and imaging texture. For an
  environment-led wide shot, foreground the environment and the small subject
  scale; detailed identity constraints must not imply a closer crop.
- Omit empty sections and repeated generic rules. Keep genuine scene-specific
  conditions and negations. Camera names/numbers are optional shorthand, not a
  substitute for the visible result; do not invent light or lens effects merely
  to fill a template. Never inject Midjourney CLI parameters into GPT prompts.
- New compiled prompts use `concise-photo-v1`, one scoped realism section and
  one output-size section. Full-Prompt originals and approved adaptation text
  remain verbatim; archived prompts, waiting handoffs and retry snapshots do not
  get this rewrite. Do not simplify again during claimed generation.
- Use short sections for the visible result, its photographic mechanism, and its scope. Keep source language and source meaning; omit unsupported variables rather than inventing missing lighting or people.
- Describe framing, subject placement, gaze target, hand/object contact, focus plane and the direction of visible illumination. A camera name or “8K, masterpiece, cinematic” does not define these relationships.
- Keep incompatible alternatives in separate pool entries. Do not demand all alternatives in one image or mix several unrelated light setups.
- Separate sensor/film appearance from file dimensions. CCD grain, compressed-looking detail and soft highlights are visual treatments on the requested canvas, not instructions to export a tiny file.
- Do not let templates override output aspect, pixel targets, face identity, body identity or locked wardrobe. Move default identity and out-of-category styling into exclusions. Outfit permission never unlocks hair accessories.
- Only explicitly requested visible text may appear; state exact spelling, placement and lettering. Do not copy reference signatures. Studio's web-reshoot signature remains “阿茶”, handwritten cursive, lower right, as specified by the compiled watermark section.
- For local edits, name the single change and preserve all unrelated geometry, exposure, color, focus and detail. Include only unavoidable contact shadows/reflections necessary to integrate that change. Do not promise pixel-identical preservation.

## Execution and resolution

Use each saved compiled Prompt and its numbered reference roles verbatim. Never rewrite it during an imagegen run. Optimizations apply when preparing a new run, not to a user's already confirmed handoff.

All new generation kinds save `outputResolution` with `control: prompt_only`. The documented API envelope is a reference for targets: 16-pixel increments, at most 3,840 pixels per side and 8,294,400 total pixels, aspect at most 3:1. Sizes above 3,686,400 pixels are experimental. Studio chooses the largest exact preset ratio fitting those limits, or a source-ratio approximation within 0.5%.

The built-in tool and manual ChatGPT web workflow do not expose API `size` or `quality` controls. Request native target dimensions in Prompt, but do not invent a tool parameter, infer a model version, switch to a paid API, or promise the target was achieved. Resolution is not quality level.

Archive the actual returned file once. Studio reads its pixel dimensions and saves `resolutionCheck`; undersized or mismatched output remains a valid archived result with a visible warning. Never upscale, pad, crop, relabel, discard, or regenerate it automatically to satisfy the target. Historical outputs without a target stay unlabelled as such.
