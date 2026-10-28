# Sample texts: sources and licence

All three samples are in the **public domain** in the United States (published before 1930) and in
most other countries (authors died more than 70 years ago). The texts come from Project Gutenberg
and were downloaded on 2026-10-24. As Project Gutenberg's licence allows for public-domain works,
the Project Gutenberg header, footer, licence text and trademark have been removed, so these files
are plain public-domain texts, not "Project Gutenberg eBooks". Cleaning steps: `[Illustration]`
markers removed, `_underscore_` italics markup removed, runs of blank lines collapsed. The words
themselves are unchanged.

| File                         | Work                                                                    | Author                                      | First published | Source                                                       |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------- | --------------- | ------------------------------------------------------------ |
| `jane-eyre-chapters-1-3.txt` | _Jane Eyre: An Autobiography_, chapters I–III                           | Charlotte Brontë (1816–1855)                | 1847            | Project Gutenberg eBook #1260 (1897 Service & Paton edition) |
| `the-gift-of-the-magi.txt`   | "The Gift of the Magi"                                                  | O. Henry (William Sydney Porter, 1862–1910) | 1905            | Project Gutenberg eBook #7256                                |
| `bacon-two-essays.md`        | "Of Truth" and "Of Studies", from _Essays or Counsels, Civil and Moral_ | Francis Bacon (1561–1626)                   | 1625            | Project Gutenberg eBook #575                                 |

How Pager uses them: copied unchanged from `reader-apps/cadence/samples/` on 2026-10-24 to seed
the mock adapter (`src/api/seed.ts`). Bacon's two essays become two articles, the O. Henry story
one article, and the _Jane Eyre_ chapters a three-section book.
