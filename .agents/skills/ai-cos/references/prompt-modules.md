# Prompt module workflow

This workflow only runs after the user explicitly requests module splitting.
Complete-Prompt collection and role adaptation use [full-prompts.md](full-prompts.md)
instead; do not apply normalization rules to their unchanged source passages.

Before writing normalized fragments, follow [image-prompting.md](image-prompting.md). Keep size/quality/model requests out of photography modules; the Studio owns output targets.

1. Run `ai-cosctl claim-prompt-import --inbox <id> --json` and read only the returned import item.
2. Split the raw material into independently reusable modules. Allowed `category` values are `style`, `camera_angle`, `scene_lighting`, `pose`, `outfit`, `body_proportion`, `makeup`, and `hair_accessory`.
3. Create at most one draft for each category that is explicitly present in the source, omit absent categories, and return no more than eight drafts.
3. Preserve the source in `rawText`. Put only the clean composable fragment in `normalizedText`.
4. Move conflicts, common failures, and role-changing instructions into `avoid`. Add short retrieval `tags`.
6. Save a JSON array and run `ai-cosctl apply-prompt-drafts --inbox <id> --file <drafts.json> --json`. This writes editable drafts only; the Studio user must confirm before any module becomes available.

Each module must contain:

```json
{
  "draftId": "draft-01",
  "name": "short Chinese display name",
  "category": "style",
  "rawText": "original source text",
  "normalizedText": "clean composable prompt fragment",
  "avoid": ["one concrete unwanted outcome"],
  "tags": ["short-tag"],
  "included": true
}
```

Do not combine categories merely because they appeared in the same pasted prompt. Preserve the source language and semantics in `normalizedText`; use Chinese display names and tags. Do not invent a missing category and never create final Prompt modules directly.
