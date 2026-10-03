# Multi-person COS photograph

Read this only for `execution.activeReshootBatch.mode === "multi_person"`.
Studio has frozen 2–4 independently confirmed adult participants, each with a
single-person COS source, character card, face snapshot and source versions.

1. Claim `reshoot` using the supplied job and run IDs. There is exactly one variant.
2. Read that variant's `orderedInputFiles`. The first N images are separate people
   A/B/C/D, **not complementary angles of one face**. Read every selected image
   before generation. Each identity source must show the intended single person;
   if it contains multiple subjects and the intended person is not unambiguous,
   stop for a corrected source instead of guessing. Each later reference is scoped to one person or to the shared
   scene. Scene-reference people never provide identity or add to the headcount.
3. Inspect `multiPerson.participants` and the exact compiled Prompt. Adult and
   individual wardrobe permissions must be present; if the actual references are
   minor, age-ambiguous or unauthorized, record the real failure and stop. Never
   automatically age up a character to make a swimsuit request permissible.
4. Keep each person's source identity, body, makeup, hair/accessories and iris
   separate. Wardrobe defaults to `locked`; only a person's `swimwear` plus saved
   adult and outfit confirmations unlocks that person's clothing/materials/
   accessories/footwear. Another participant's permission has no effect on them.
5. Call built-in imagegen once with the exact compiled Prompt and ordered refs.
   Produce one photograph of N people sharing one event, not N images or a grid.
   Apply the saved maximum-native request without inventing tool size parameters.
6. Immediately archive with `attach-reshoot-output --job ... --run ... --variant ...
   --path ...`. On failure use `fail-reshoot-variant`, with the same run and variant.
   No automatic reroll, retry, replacement, or final adoption.

Manual ChatGPT handoffs stay user-operated. Do not claim them. Group outputs are
not compatible with the single-person adjustment/series/random paths. Preparing a
new group photo uses the original independent participants and a new confirmed
draft; never treat the group result as one person's identity source.
