# Context fixtures

Hand-built from the response shapes in Anthropic's, Open Library's, Crossref's and Wikidata's
documentation (2026-11-05), since real responses can't be recorded without spending money.
`cargo run --example context-live -- <book> --record DIR` saves real ones to replace these.

- `api-1-research.json`: a search, a fetch, a search citation and a `find_book` call (`stop_reason: tool_use`).
- `api-2-pause.json`: another fetch, then `stop_reason: pause_turn`.
- `api-3-submit.json`: the `submit_briefing` call. Its draft mixes items that must survive with items
  the verifier must drop: a made-up DOI, a bad ISBN check digit, a real ISBN for another book, a
  quote that isn't on its page, a Wikipedia-only claim and a one-sided disagreement.
- `ol-*.json`, `wikidata-*.json`: catalogue answers. Crossref has no fixture: it answers 404.
- `page-*.html`: pages the verifier fetches itself.
