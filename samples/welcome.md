---
title: Welcome to Pager
author: Pager
date: 2026
---

# Welcome to Pager

Pager shows a file the way its author shaped it: chapters, headings, lists, quotes, tables, footnotes
and pictures stay where they were put, read page by page.[^shape] Everything you do with it stays on
this computer.

## Your library is a folder

This file lives in `reads/`, and so does everything else you read here. Folders are folders.

- **Add a book:** right-click in the library and choose *Add a book…*, drop a file onto the page, or
  run `pager ~/Books/persuasion.epub` in a terminal. The file is copied into the folder you are in.
- **Start writing:** right-click and choose *New file…*. A Markdown file is made and opened; write in it
  with any editor.
- **Keep things tidy:** right-click a book or folder to rename, move or delete it. Deleted files wait in
  `reads/.trash`.
- **Search** the bar at the top looks through every file, down to the sentence.
- **Formats:** EPUB, Markdown, plain text, HTML and Word (`.docx`).

A file you are still writing, like this one, is watched. Change it in your editor and the page you are
reading updates where you are, with your highlights still attached to their words.

## What it remembers

1. Where you stopped, as a place in the text rather than a scroll position, so a bigger font or an
   edited file doesn't lose it.
2. Highlights and notes. Each one remembers its words and the words around them, so it can find its
   way back after the text moves.
3. Your reading settings: for every document at once, or for just this one.

> A highlight that can no longer find its words is never thrown away. It waits, with the words you
> marked, until you put it somewhere new.

> [!tip] Try it
> Select a sentence here, highlight it, then add a paragraph above it in your editor. The highlight
> moves with its sentence.

## Small things that are kept

| Kept | Example |
|:-----|:-------:|
| Emphasis | *italic*, **bold**, ~~struck~~, `code` |
| Links | [Project Gutenberg](https://www.gutenberg.org) |
| Footnotes | like this one[^kept] |
| Task lists | see below |

- [x] Read the welcome page
- [ ] Open a book of your own

```text
Code keeps its spacing,
    exactly as written.
```

---

Your files are never changed. Pager keeps its own records in its data folder, and can write your
highlights out as Markdown whenever you like.

[^shape]: Pager rebuilds each file from its structure rather than copying its styling, so your own
    reading settings apply evenly everywhere.

[^kept]: Footnotes open next to the text and are listed at the end of each section.
