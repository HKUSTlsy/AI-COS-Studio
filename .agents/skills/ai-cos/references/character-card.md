# Character restoration card

Return one JSON object with exactly these fields:

- `hairstyle`: length, parting, bangs, color blocks, texture, silhouette.
- `hairAccessories`: type, count, placement, color, material.
- `iris`: iris color, pupil detail, catchlight constraints, heterochromia.
- `makeup`: eye, lip, skin accents, face markings.
- `bodySilhouette`: credible human translation of tall, petite, slender, athletic, muscular, or other core traits.
- `outfitLayers`: garments from inner to outer, silhouette, closures, overlap.
- `colors`: exact dominant, secondary, accent colors and their locations.
- `materials`: fabric, leather, metal, translucent parts, finish and reflectivity.
- `accessories`: jewelry, belt, gloves, props, weapons and attachment points.
- `footwear`: socks/stockings, shoes/boots, sole, finish and color.

Each field has this structure:

```json
{
  "value": "specific visual description",
  "certainty": "observed",
  "strongLock": false
}
```

Use `strongLock: true` for identity-defining details that photography templates must not alter, especially signature hairstyle, iris color, role colors, outfit structure, and distinctive accessories. Do not invent hidden back details as facts; mark them `inferred` and describe the conservative assumption.
