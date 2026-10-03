# Series photography planning

Follow [image-prompting.md](image-prompting.md) for concrete photographic descriptions, output target boundaries and exact text handling. Do not conflate imaging texture with output pixel dimensions.

Use this reference for `series_plan` pack parsing, `series_deconstruct`, series reshoot execution, original-input redo, and quality review.

## Parse a series-plan pack

1. Claim with `ai-cosctl claim-pack-import --import <id> --json` and verify `packKind === "series_plan"`.
2. Read only the returned `rawText`. The Studio has already limited the GitHub snapshot to the approved repository, revision, Markdown references, manifest, and license. Do not read or execute repository scripts, agents, tests, or evals.
3. Extract only source-grounded methods into this draft shape:

```json
{
  "kind": "series_plan",
  "name": "...",
  "description": "...",
  "globalStyle": "...",
  "seriesDNA": {
    "themeFramework": "...", "editorialTone": "...", "makeupSystem": "...",
    "hairSystem": "...", "outfitSystem": "...", "sceneSystem": "...", "propSystem": "..."
  },
  "imagingProfile": {
    "whiteBalance": "...", "colorCast": "...", "blackPoint": "...",
    "highlightRollOff": "...", "sharpness": "...", "microContrast": "...",
    "softening": "...", "noiseCompression": "...", "depthOfField": "..."
  },
  "visualHierarchy": {
    "subjectClarity": "...", "dominantShapes": "...",
    "secondaryDetails": "...", "lowDetailSpace": "..."
  },
  "workflowRules": {
    "referenceAssignment": "...", "lightingTopology": "...",
    "subjectEventCausality": "...", "storyboardDiversity": "...",
    "antiCommercialPolish": "...", "redoPolicy": "..."
  },
  "qualityGates": ["..."],
  "avoid": [], "tags": [], "excludedDefaults": []
}
```

4. Move any fixed reference-person identity, face, skin tone, ethnicity, or body preference to `excludedDefaults`. Outfit methods may remain descriptive, but outfit changes stay disabled by Studio rules.
5. Preserve method logic, not default subjects. Never invent an absent mechanism. Write only an editable draft with `apply-pack-draft`; do not publish it or call imagegen.

## Deconstruct a photography reference set

1. Claim with `ai-cosctl claim-series-plan --job <id> --json`.
2. Inspect only `execution.seriesReferenceFiles`. These images are photography evidence; their people never provide identity, face, body, skin tone, or character design.
   Read the batch's `creativePolicy` too. In `character` mode, wardrobe follows
   the selected template, user text, or the separately labeled `outfitReference`
   (which may be inspected for clothing only). Preserve character hair, head
   accessories, iris and signature makeup. Respect `propPolicy` when planning
   events; do not reintroduce original outfit locks through scene descriptions.
3. Return exactly `activeReshootBatch.quantity` new shots and this shape:

```json
{
  "commonPackage": {
    "theme": "...", "editorialTone": "...", "makeupHair": "...",
    "wardrobe": "...", "sceneProps": "..."
  },
  "imagingProfile": "...",
  "visualHierarchy": "...",
  "lightingSetups": [{
    "id": "light-01", "name": "...", "referenceIds": ["photo-ref-01"],
    "description": "...", "topology": "..."
  }],
  "excludedReferenceIds": [],
  "shots": [{
    "id": "shot-01", "title": "...", "mainReferenceId": "photo-ref-01",
    "auxiliaryReferenceIds": [], "lightingSetupId": "light-01",
    "shotScale": "...", "camera": "...", "composition": "...",
    "subjectEvent": "...", "expressionResponse": "...",
    "poseGazeProps": "...", "lightingPrediction": "...", "customPrompt": ""
  }]
}
```

4. Cluster by lighting topology, not merely visual similarity. Each shot needs one main reference and at most two auxiliary references, all listed in the same lighting setup. Put unsupported outliers in `excludedReferenceIds`.
5. Treat lights and occluders as world-space objects. A changed camera angle changes visible highlight, shadow, reflection, and exposure geometry; the light rig must not rotate with the camera.
6. Build each expression from a visible subject event. The event must plausibly cause gaze, hands, posture, and facial response. Keep shots distinct in event, scale, camera, or composition.
7. Write with `apply-series-plan-draft`. Do not compile final prompts or call imagegen.

## Execute and review

1. Claim `reshoot`, then process variants by ascending index. Use each variant's own `orderedInputFiles`: clean COS source, one main photography reference, up to two same-light auxiliary references, optional wardrobe-only reference, then necessary character details.
2. Use the approved `compiledPrompt` verbatim and call imagegen once per variant. Archive each success immediately. Record a failed variant and continue; do not retry.
3. A redo may carry `diagnosticOutputId`, but that image is metadata only. Never inspect or pass it to imagegen. The redo input remains the clean COS source plus original photography references.
4. After a successful series output, write a test review with `apply-reshoot-quality`. Cover exactly: `seriesPackage`, `lightingExposure`, `colorRelation`, `imagingTexture`, `subjectEventExpression`, `visualHierarchy`, and `absoluteFidelity`; record identity, anatomy, and character-design problems in `technicalIssues`.
5. A failed gate does not delete or retry an image. Codex may set only test/failed review state. The user alone can mark final adoption in Studio.
