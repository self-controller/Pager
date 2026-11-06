# Sample briefings (agent runs, 2026-11-05)

Real Context briefings for UI work and tests, made without the API: Sonnet agents followed the
pipeline's prompt (`context-live --prompt-dir`) with stand-in tools, and their drafts went through
the real verifier with live lookups (`context-live --draft`). See prompts/book-context.md,
"Testing with Claude Code agents".

- `<name>.draft.json`: what the agent handed in (submit_briefing's input).
- `<name>.briefing.json`: the verified briefing (schema version 2; the `-v3` ones version 3, whose
  entities carry a `role`, made on 2026-11-06 for Phase 6). `docId` and `contentHash` belong
  to a throwaway library: replace them when storing one for a document.

| Name | Book, level | Section claims | Map |
|---|---|---|---|
| darwin-general | Origin of Species, General | 22 | 10 nodes, 7 links |
| darwin-scholar | Origin of Species, Scholar | 19 (2 disagreements) | 9 nodes, 7 links |
| austen-general | Pride and Prejudice, General | 21 | 10 nodes (2 places), 10 links |
| nietzsche-general | Thus Spoke Zarathustra, General | 16 | 10 nodes, 8 links |
| darwin-malthus-general | Origin of Species, General, focus “Malthus” | 9 | 6 nodes, 6 links |
| austen-burney-general | Pride and Prejudice, General, focus “Fanny Burney” | 7 | 7 nodes, 7 links |
| nietzsche-wagner-general | Thus Spoke Zarathustra, General, focus “Wagner” | 7 | 6 nodes, 7 links |
| darwin-general-v3 | Origin of Species, General (version 3: roles) | 18 | 12 nodes, 12 links |
| nietzsche-general-v3 | Thus Spoke Zarathustra, General (version 3: roles) | 21 | 13 nodes, 12 links |

The last three are focused briefings ("Context for this", Phase 3): `focus` is set, the map is centred
on the entity `focus`, and there is no pre-reading. Made with `context-live --focus TEXT`.
