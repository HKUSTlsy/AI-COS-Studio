# VSC Prompt creation

This independent Studio workspace accepts a brief without images, authorized
face profiles, accepted single-person COS outputs, or 2–4 mixed-source people.
It is not Prompt splitting or a photography-pack import.

## Text stage: prompt_compose

1. Use `claim-creation --creation <id> --run <runId> --json`. Respect the frozen
   participants, scope, positions, brief, quantity, capabilities and reference roles.
   Inspect attached images using the returned absolute paths before describing them.
2. If `skill: vsc`, route using the installed VSC entrypoint; otherwise read the
   explicitly selected skill directly. Read its required references. Only the
   saved capabilities are allowed; `shan-ze-school` is explicit-only. Never use
   travel video or Eagle as a side effect. Changed/missing skills are errors, not
   authority to install or substitute an unrelated workflow.
3. The deliverable is complete natural-language Prompts, even if a downstream
   skill normally generates images. Do not invoke imagegen, image APIs, browser
   automation, archive external assets, or mutate application source. Use only
   local CLI writeback. Skill defaults never override the actual user's people,
   ethnicity/skin/body, adult status or authorized creative scope.
4. A text person has an original face; a character name is enough to begin, but
   unknown designs must be flagged honestly rather than invented as observed.
   Face-profile photos fix facial identity only, never body or styling. Output
   sources retain their branch's character card. Keep each person's mapping
   separate; multiple angles of A are not B or C. No new unrequested people.
5. `original` preserves original COS design; `character` permits new wardrobe
   but locks identity/body/makeup/hair/head accessories/iris; `free` releases
   explicitly authorized styling but keeps face/body identity. Permissions are
   per person. Do not age up minor or ambiguous characters to allow sexualization.
6. First run: write exactly `quantity` complete drafts. Revision: return exactly
   `execution.run.request.requestedIds`, incorporate `feedback`, keep all other
   drafts unchanged. Do not split, summarize or inject repeated studio boilerplate.
7. Write a JSON file with `{ "selectedSkill": "<actual child skill>", "drafts":
   [{ "id": "<requested ID for revision>", "title": "中文名称", "prompt":
   "完整提示词" }] }`. Use `apply-creation-drafts --creation <id> --run <runId>
   --file <json> --json`. Then stop. Never confirm generation or save to the
   formal library on behalf of the user. On failure use `fail-creation` with
   `--type` and `--message`; no silent retry.

## Image stage: prompt_render

Only the user can create this stage by confirming selected drafts and backend.
Claim with the same `claim-creation` command and inspect every ordered reference.
Read the imagegen Skill before generation. For each pending variant, use its
`compiledPrompt` verbatim, exactly once, with one image output. When there are no
references, omit reference parameters. Do not invoke VSC or rewrite the prompt.

Immediately use `attach-creation-output --creation <id> --run <runId> --variant
<variantId> --path <png>`. On one failure use `fail-creation-variant` with the same
IDs and actual `--message`, then proceed to the next distinct pending variant.
Do not retry, duplicate a result across slots, or fabricate a successful image.
Maximum resolution is prompt-only; archive actual pixels without resampling.
Manual web handoffs are not claimable and remain user-operated.
