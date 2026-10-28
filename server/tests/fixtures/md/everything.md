---
title: "Everything: a test"
authors:
  - Ada Lovelace
  - Charles Babbage
lang: en-GB
date: 1843-10-01
---

Setext Title
============

Intro with *emphasis*, **strong**, ***both***, ~~gone~~, `code`, a [link](https://example.com "Example"),
a [reference link][ref], an <https://auto.example.org> autolink, a <sup>superscript</sup> and H<sub>2</sub>O.

Line one with a hard break  
line two after it.

[ref]: https://example.org/ref

Sub heading
-----------

1. First
2. Second
   - nested *one*
   - nested two

     with a second paragraph
3. Third

Between the lists.

5. Starts at five
6. Six

- [ ] todo
- [x] done

> Quoted text
>
> > Nested quote

> [!WARNING] Careful now
> Callout body.

| Left | Centre | Right |
|:-----|:------:|------:|
| a    | b      | c     |
| `x`  | **y**  | [z](#sub-heading) |

```js
function hi() {
  return  "spaced";
}
```

    indented code

***

A paragraph with a footnote[^one] and another[^two], and the first again[^one].
Jump to [the sub heading](#sub-heading) or [nowhere](#missing) or [a file](other.md).

<div align="center">
<p>Raw <b>HTML</b> block, centred.</p>
</div>

<!-- a comment that must vanish -->

![A pixel](pixel.png "Pixel title")

Inline image ![remote](https://example.com/x.png) in text.

[^one]: The first note, with *emphasis*.
[^two]: The second note.

    With an indented second paragraph.
