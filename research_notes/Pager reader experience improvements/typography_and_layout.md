# Typography and text layout for long-form on-screen reading (Pager, October 2026)

Tag legend used in Inferences: **[evidence]** = backed by a study; **[vendor]** = a default that a shipping reader uses; **[expert]** = typographer or spec-author opinion; **[inference]** = my synthesis for Pager.

Pager baseline (read from the repo on 2026-10-29, for context only): `.markup` uses Spectral at 19px desktop / 17px phone (min 16px) plus a user offset; `p { line-height: 1.6em; margin: 0 0 20px }`; `hanging-punctuation: allow-end`; `-webkit-font-smoothing: antialiased`; `text-rendering: optimizeLegibility`; no `hyphens`; ragged-right text; reader column `--size-reader: 728px`; Pages mode uses `column-fill: auto` with inline `column-width`/`column-gap`, `img { max-height: calc(var(--page-h, 100vh) - 2em) }`, `break-inside: avoid` on figure/pre/table/tr/notes, `break-after: avoid` on h1–h6, `orphans: 2; widows: 2` on p/li (source: /home/david/Desktop/projects/Pager/src/styles/prose.css, /home/david/Desktop/projects/Pager/src/styles/tokens.css). Light theme #111 on #FFF = 18.9:1 contrast; dark #E5E5E5 on #121212 = 14.9:1 (computed with the WCAG relative-luminance formula).

## 1. What does reading research say (line length, spacing, size, font choice, letter/word spacing, polarity, paging vs scrolling, Bionic Reading, dyslexia fonts)?

### Takeaway
The robust findings are few: text must be above a "critical print size" (bigger helps up to about 18pt on screens), the best font differs per person (35% speed gap between a reader's fastest and slowest font, and preference does not predict which is fastest), dark text on light backgrounds is slightly more legible in most lighting, and paging tends to equal or slightly beat scrolling for comprehension. Line length and line spacing have weak, inconsistent effects within normal ranges. Bionic Reading does not work. OpenDyslexic shows no reliable benefit; extra letter spacing reduces errors for dyslexic children.

### Cited Findings
**Font choice and personalisation**
- Wallace et al. 2022 (ACM TOCHI 29(4), art. 38): 352 crowd participants aged 18–71 read on their own devices; 16 fonts; font sizes normalised to Times at 16px by matching x-height, average character height or width. Participants read 35% faster in their fastest font than their slowest (314 vs 232 WPM averages) with no loss of comprehension, and 14% faster in their fastest font than in their most preferred font (314 vs 275 WPM). — [Wallace et al. PDF](https://jeffhuang.com/papers/Readability_TOCHI22.pdf); [Adobe Research listing](https://research.adobe.com/publication/towards-individuated-reading-experiences-different-fonts-increase-reading-speed-for-different-individuals)
- Same paper: participants read fastest in their most-preferred font only 20% of the time and slowest in it 20% of the time (chance level, 5 fonts each); "neither preference nor familiarity with a font can predict reading speed"; "there was not a single font that increased reading speed for everyone." — [Wallace et al. PDF](https://jeffhuang.com/papers/Readability_TOCHI22.pdf)
- Same paper: for readers aged 35+ (N=118), EB Garamond and Montserrat were faster on average and Avant Garde and Open Sans were slow; Noto Sans was the most preferred font (and among the least familiar); Noto Sans, Times and Calibri did well on both preference and effectiveness. EB Garamond's 312 WPM overall average is confounded because faster readers happened to get it. — [Wallace et al. PDF](https://jeffhuang.com/papers/Readability_TOCHI22.pdf)
- Same paper: preference is driven by perceived size (x-height), so studies that do not normalise size confound font with size; Georgia's large x-height gives it a larger perceived size. — [Wallace et al. PDF](https://jeffhuang.com/papers/Readability_TOCHI22.pdf)
- Beymer, Russell & Orton 2008 (BCS HCI; eye tracking, Georgia vs Helvetica at 10/12/14pt): no significant serif vs sans difference (serif slightly faster); 10pt produced longer fixations; above 14pt return sweeps grew longer. — [Beymer et al. PDF](https://www.scienceopen.com/document_file/671b2d53-73ce-4a91-946d-fde0b7db381a/ScienceOpen/015_Beymer.pdf); [BYU Editing Research summary](https://editingresearch.byu.edu/?p=10451)

**Font size**
- Rello, Pielot & Marcos 2016 (CHI, "Make It Big!"; 104 participants, eye tracking, 6 sizes 10–26pt, 4 line spacings 0.8–1.4×): readability and comprehension improved with size up to 18pt; 10–12pt impaired comprehension; line spacing did not significantly change reading time, and only extreme spacings hurt comprehension. — [researchr record](https://researchr.org/publication/RelloPM16); [BYU summary](https://editingresearch.byu.edu/?p=10398)
- Legge & Bigelow 2011 (J. Vision review): reading speed rises with print size up to a "critical print size" then plateaus; the "fluent range" spans x-heights of about 0.2° to 2° of visual angle (1.4mm to 14mm x-height at 40cm). — [Legge & Bigelow, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264)

**Line length**
- Dyson & Kipping: lines of 100 characters were read faster than 25-character lines, while moderate lengths (55 cpl) were rated easiest to read. — [Dyson & Kipping, Visible Language](https://journals.uc.edu/index.php/vl/article/view/5671); [Dyson 2004 review PDF](https://stu.westga.edu/~ssynan1/literacy/Dyson.pdf)
- Dyson 2004 (Behaviour & IT review) names characters per line as the critical variable for line length; Dyson & Haselgrove 2001 found recall rose when reading speed fell from about 300 to 150 WPM. Print convention is 45–75 cpl with 66 as ideal. — [Dyson 2004 PDF](https://stu.westga.edu/~ssynan1/literacy/Dyson.pdf); [Wikipedia: Line length](https://en.wikipedia.org/wiki/Line_length)
- Butterick (expert): "average line length of 45–90 characters, including spaces"; 2–3 alphabets per line; set it with page margins. — [Practical Typography: line length](https://practicaltypography.com/line-length.html)

**Line spacing**
- Butterick (expert): line spacing "between 120% and 145% of the point size"; use unitless `line-height`. — [Practical Typography: line spacing](https://practicaltypography.com/line-spacing.html)
- Rello 2016: line spacing between 0.8× and 1.4× of default had no significant effect on reading time (see above). — [BYU summary](https://editingresearch.byu.edu/?p=10398)

**Letter and word spacing, dyslexia**
- Zorzi et al. 2012 (PNAS; 74 French and Italian dyslexic children aged 8–14): letter spacing widened by 2.5pt on 14pt Times New Roman (about +0.18em) doubled reading accuracy; press reports give a >20% speed gain; the most impaired readers gained most. — [PubMed 22665803](https://pubmed.ncbi.nlm.nih.gov/22665803/); [Medical Xpress / AFP](https://m.medicalxpress.com/news/2012-06-wider-letter-spacing-dyslexics.html)
- Wery & Diliberto (Annals of Dyslexia): OpenDyslexic gave no gain in reading rate or accuracy versus Arial and Times for elementary students with dyslexia, and no participant preferred it. — [PMC5629233](https://pmc.ncbi.nlm.nih.gov/articles/PMC5629233/)
- A conference abstract (Franzen, Stark & Johnson) reported OpenDyslexic improved comprehension for dyslexic and non-dyslexic adults with no speed effect; the authors call the evidence contradictory. — [AES abstract](https://aes.amegroups.org/article/view/5209/html)
- Readium's a11y baseline: offer dyslexia fonts but also familiar sans fonts, "some people don't like Open Dyslexic"; dyslexia tools add word/letter spacing, font change, larger size and line height. — [Readium CSS a11y baseline](https://github.com/readium/readium-css/blob/develop/docs/CSS13-a11y_settings_baseline.md)

**Bionic Reading**
- Snell 2024, "No, Bionic Reading does not work" (Acta Psychologica 247): participants read 100 paragraphs in Bionic or normal text; no significant difference in reading times. — [PubMed 38723450](https://pubmed.ncbi.nlm.nih.gov/38723450/); [VU Amsterdam record](https://research.vu.nl/en/publications/no-bionic-reading-does-not-work/)
- Readwise 2022 web experiment (2,074 readers): Bionic Reading was 2.6 WPM slower on average (<1%, negligible). Run by an app vendor, not peer reviewed. — [Readwise](https://blog.readwise.io/bionic-reading-results/)

**Polarity (light vs dark mode)**
- Piepenbrock et al. 2013 (Ergonomics) "Positive display polarity is advantageous for both younger and older adults" (seen via secondary citation only). — [Bustle citing the study](https://www.bustle.com/p/what-happens-to-your-body-when-you-use-dark-mode-on-your-phone-according-to-experts-23619973)
- A 2014 Ergonomics paper found smaller pupils and better proofreading with positive polarity, consistent with the advantage being an effect of display luminance. — [Ergonomics 2014 abstract](https://informahealthcare.com/doi/abs/10.1080/00140139.2014.948496)
- Dobres, Chahine & Reimer 2017 (Applied Ergonomics 60): under glance-like reading, white-on-black in dark ambient light needed the longest exposure; positive polarity in the dark, and all conditions in bright light, were more legible; attributed to pupil size and optical aberration. — [PubMed 28166901](https://pubmed.ncbi.nlm.nih.gov/28166901/)
- A 2022 arXiv analysis reads the Dobres result as a small negative-polarity disadvantage rather than a large positive-polarity benefit. — [arXiv 2203.16546](https://arxiv.org/pdf/2203.16546)
- Contrary small study (30 young adults on a laptop): negative polarity read faster (136 vs 128 WPM) with no difference in errors. — [JHSMR 2024 PDF](https://jhsmr.org/index.php/jhsmr/article/download/1095/1228)
- Astigmatism/halation (light text "bleeding" into dark backgrounds) is claimed by popular health sources citing ~30% astigmatism prevalence; I found no peer-reviewed test on astigmatic readers. — [People's Pharmacy](https://library.peoplespharmacy.com/white-letters-black-background)

**Paging vs scrolling**
- A 2022 Norwegian university study (Springer, Reading and Writing): students tended to get better integrated understanding when paging than scrolling and backtracked more strategically when paging; scrolling on a tablet gave a more positive experience. — [Springer DOI](https://link.springer.com/doi/10.1007/s11145-022-10328-9); [UiO record](https://duo.uio.no/handle/10852/98003)
- Older work: Piolat et al. found equal reading time but better whole-text mental representations with paging; Dyson & Kipping found paged documents read faster with no comprehension difference; a 1992 review and usability guidance found no reliable difference. A 2024 Dutch thesis found no difference. — [Human Factors International summary](https://www.humanfactors.com/newsletters/paging_vs_scrolling.asp); [Radboud thesis](https://theses.ubn.ru.nl/items/0a743d50-456a-4f69-b95f-4ee85d8bbe3c)

### Inferences
- [evidence] Font choice is the single largest lever measured (35%), and the best font is individual. Pager should ship 4–6 good, size-normalised faces (serif, sans, slab, a hyperlegible face, a dyslexia option) rather than a single "best" font, and normalise x-height when the user switches (see Q4, `font-size-adjust`).
- [evidence] Default body size: on a phone at ~30–35cm, 17px Spectral is near the low end; Rello's 18pt+ result was on desktop monitors, so do not port the number literally, but keep the default ≥17–18 CSS px on phones and ~19–21px on desktop, and keep a wide range (Readium allows 75–250%).
- [evidence + expert] Line length: target ~60–75 characters per line in Pages and Scroll on desktop; ~35–45 cpl is what a phone gives at 17–18px and is fine. Measure it rather than assume: `max-width: 34em` gives roughly 65–75 cpl for a book serif (inference; depends on the font's average glyph width). Pager's 728px at 19px is likely ~75–80 cpl for Spectral (unmeasured estimate).
- [expert] Line spacing: 1.45–1.6 unitless for body; Pager's `1.6em` should become unitless `1.6` (or 1.5) so that smaller text (footnotes, captions) and larger text (headings) do not inherit a fixed pixel leading. Offer a 1.2–2.0 range.
- [evidence] Letter spacing: keep 0 by default; offer +0.05em to +0.2em as an accessibility setting (Zorzi's effective value ≈ +0.18em). Word spacing 0 to +0.16em (WCAG 1.4.12 test value, see Q4).
- [evidence] Do not build Bionic Reading. Offer OpenDyslexic only as an opt-in choice, never as a recommended default.
- [evidence] Light (positive polarity) is the better default in lit rooms; dark mode is a comfort choice for dark rooms. Keep dark text slightly below maximum brightness (see Q7).
- [evidence] Pages layout is a defensible default for comprehension-heavy reading; Scroll suits casual reading. Keep both.

### Gaps
- The Readability Consortium/Adobe follow-ups (e.g., line-spacing and size personalisation on phones) and the Microsoft/Google font studies named in the brief: I did not locate primary results within budget.
- Hakvoort et al. 2017 replication of Zorzi (fewer errors, no speed gain) was reported in a search summary only; primary source not checked.
- Rello & Baeza-Yates 2013 "Good fonts for dyslexia" (sans, monospaced, roman better than italic) was seen only via a secondary bookmark site.
- No peer-reviewed study found on dark mode for astigmatic readers, or on night-time warmth (blue light) of e-reader screens; the Chang et al. 2015 PNAS e-reader sleep study was not verified here.
- Atkinson Hyperlegible's evidence base (Braille Institute) was not researched.

## 2. What typography controls and defaults do leading readers ship?

### Takeaway
Every mainstream reader exposes font, size, line spacing, margins, justification and theme; the more typographic ones add word spacing, hyphenation, kerning/weight and "use publisher font" toggles. Open-source defaults cluster around line-height 1.4–1.5, justification + hyphenation on, a ~720px maximum line box, two columns on wide screens, and publisher fonts kept unless the user overrides.

### Cited Findings
**Apple Books**
- Six themes: Original, Quiet, Paper, Bold, Calm, Focus; Paper, Bold and Focus were added in iOS 16; Dark makes all six themes dark. — [Gadget Hacks](https://ios.gadgethacks.com/how-to/apple-books-just-got-its-biggest-iphone-update-years-0385075/)
- Customize (enable under Accessibility & Layout Options): sliders for line spacing, character spacing, word spacing and margins; Justify Text; Bold Text; Reset Theme. — [Apple Support: Read books](https://support.apple.com/en-asia/guide/iphone/iphc1af7c57/ios); [Gadget Hacks](https://ios.gadgethacks.com/how-to/apple-books-just-got-its-biggest-iphone-update-years-0385075/)
- Font list (older source): Original, Athelas, Avenir Next, Charter, Georgia, Iowan, Palatino, San Francisco, New York, Seravek, Times New Roman; Athelas, Charter, Iowan and Seravek arrived in iBooks 1.5 (Dec 2011). — [AppleToolbox](https://appletoolbox.com/2012/10/how-to-change-appearance-of-books-in-ibooks-app/); [MacTech 2011](https://www.mactech.com/2011/12/07/apple-updates-ibooks-cards)
- After iOS 16.2 some themes (Calm, Focus, Quiet) reportedly did not offer the book's "Original" font (user report). — [Apple Community](https://discussions.apple.com/thread/254489426)

**Kindle**
- 2015: Bookerly (Dalton Maag) plus a new typesetting engine with hyphenation, improved word spacing, kerning and ligatures (e.g., "fi"); required the KFX format and only some languages. — [Wikipedia: Bookerly](https://en.wikipedia.org/wiki/Bookerly); [Infodocket quoting Amazon](https://www.infodocket.com/2015/06/17/e-readers-amazon-releases-new-kindle-paperwhite-with-300ppi-resolution-and-new-typesetting-engine/); [The eBook Reader blog](https://blog.the-ebook-reader.com/2015/08/11/kindle-ebooks-with-enhanced-typesetting-use-new-kfx-kindle-format)
- Kindle apps: fonts include Bookerly, Amazon Ember and OpenDyslexic; Layout tab has Page Color, Margins, Text Alignment; iOS page colours white, sepia, light green, black; saved themes store face, line height, spacing and margins. — [Amazon: Accessible Reading Options](https://digprjsurvey.amazon.com/csad/help/node/TABlJ4ot69emTO8jJG); [Ebook Friendly](https://ebookfriendly.com/kindle-app-ipad-custom-themes/)

**Kobo**
- Settings include font face, size, line spacing, margins, justification (off/left/full) and turning off publisher styling; TypeGenius "Advanced" exposes Weight and Sharpness sliders (config ranges reported by users: weight −0.2 to 0.8, sharpness −0.4 to 0.2). — [The eBook Reader blog 2011](https://blog.the-ebook-reader.com/2011/07/01/kobo-touch-firmware-update-adds-more-fonts-and-layout-settings); [MobileRead forum](https://www.mobileread.com/forums/showthread.php?p=2958366)

**KOReader (crengine)** — source defaults
- Default font size 22 (presets 12–44); line spacing 100% of the font's natural line height (presets 70–130%, custom 50–200%); word spacing {95, 75} = spaces at 95% of the font's width, condensable to 75% (Small {75,50}, Large {100,90}); word expansion (letter-spacing used for justification) default 0, presets 5% and 15%, max 20%. — [KOReader defaults.lua](https://github.com/koreader/koreader/blob/master/defaults.lua)
- Kerning default 3 = "best" (HarfBuzz); hinting default auto; font gamma 1.0; base weight 0 (range −3 to +5.5); h margins Medium 10, top/bottom Large 15; render DPI 96; block rendering "book"; embedded CSS on; embedded fonts on. — [KOReader creoptions.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/data/creoptions.lua)
- Hyphenation on by default (per-language dictionaries, adjustable left/right minimum hyphen sizes, soft-hyphens-only mode); hanging ("floating") punctuation off by default; two pages in landscape above a minimum screen height of 7. — [KOReader readertypography.lua](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readertypography.lua); [KOReader defaults.lua](https://github.com/koreader/koreader/blob/master/defaults.lua)

**Foliate (GNOME)** — gschema defaults
- line-height 1.5; justify true; hyphenate true; gap 0.06 (6% page margin); max-inline-size 720px; max-block-size 1440px; max-column-count 2; scrolled false; override-font false. — [Foliate gschema](https://github.com/johnfactotum/foliate/blob/gtk4/data/com.github.johnfactotum.Foliate.gschema.xml)

**Readest** — source defaults
- Serif font Bitter, sans Roboto, default "Serif", size 16, weight 400; line height 1.4; paragraph margin 0.6; word/letter spacing 0; indent 0; full justification on; hyphenation on; margins 44px top/bottom, 16px sides; gap 5%; max 2 columns; overrideFont/overrideLayout off. Mobile overrides: justification off, default font Sans-serif, no spreads. CJK: line height 1.6, indent 2, paragraph margin 1. — [Readest constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts)

**Readium CSS (used by Readium-based reading systems)**
- User setting ranges: font size 75–250%; line height 1–2; paragraph spacing 0–2rem; paragraph indent 0–3rem; word spacing 0–1rem; letter spacing 0–0.5rem; ligatures on/off; hyphens auto/none; text-align start/justify; variable-font weight, width and optical sizing (default auto). — [Readium CSS user prefs](https://github.com/readium/readium-css/blob/develop/docs/CSS12-user_prefs.md)
- Defaults: base line-height 1.5 × language compensation (fallback 1.6, "fits a little bit better for all languages than 1.5"), headings `line-height: normal`, type scale 1.125 (choices 1.067–1.618), paragraph indent 1em, paragraph spacing 0, flow spacing 1.5rem, `text-rendering: optimizeLegibility`. — [ReadiumCSS-base.css](https://github.com/readium/readium-css/blob/develop/css/src/modules/ReadiumCSS-base.css); [ReadiumCSS-default.css](https://github.com/readium/readium-css/blob/develop/css/src/ReadiumCSS-default.css)
- Survey: fewer than 15% of users keep the publisher's typeface; most users prefer basic settings (theme, typeface, size) over many options. — [Readium user pref insights](https://github.com/readium/readium-css/blob/develop/docs/CSS15-user_pref_insights.md)

### Inferences
- [vendor] A "core + advanced" split matches what users say they want: core = theme, font, size, layout (Pages/Scroll); advanced = line spacing, margins/line length, justification + hyphenation, paragraph style (indent vs spacing), letter/word spacing, weight (bold), publisher-styles toggle.
- [vendor] Reasonable Pager defaults drawn from this set: line-height 1.5; ragged-right on phone (Readest disables justification on mobile) and either ragged or justified+hyphenated on desktop; max line box ~720px (Foliate/Readest) or ~34em; two-column spread only when the page is wide and tall enough.
- [vendor] Add a "Bold text" / weight setting. KOReader, Kobo TypeGenius, Apple Books and Kindle all offer one; with a variable font this is just `font-weight: 400–500`.

### Gaps
- Moon+ Reader, ReadEra and Thorium defaults were not retrieved. Thorium is believed to use Readium CSS, so its controls should mirror the Readium list above (not verified here).
- Exact current Apple Books font list on iOS 26 and the hex values of its six themes were not found in an official source.
- Kindle's current default margins, line spacing steps and its 2024–2026 engine changes were not found.

## 3. How to get good pagination with CSS multi-column (headings, figures, widows/orphans, images, drop caps, spreads)?

### Takeaway
On WebKit (the iPhone), `break-after: avoid` and `break-before: avoid` do nothing, so a heading stranded at the bottom of a page needs a structural or JavaScript fix. `break-inside: avoid` works in WebKit columns. `widows`/`orphans` work in WebKit and Blink but WebKit's default is `auto` (no protection), so they must be set explicitly, and Firefox ignores them. Images need a max-height tied to the measured column height.

### Cited Findings
- `break-after: avoid` / `break-before: avoid`: Chrome 50+ only; Safari: "The value is recognized, but has no effect" (WebKit bug 294559); Firefox likewise (bug 1972340). `break-after/before: column` in Safari 10+, but the multicol-context sub-entry is listed as unsupported in Safari, so test on device. — [MDN BCD break-after](https://github.com/mdn/browser-compat-data/blob/main/css/properties/break-after.json); [MDN BCD break-before](https://github.com/mdn/browser-compat-data/blob/main/css/properties/break-before.json)
- `break-inside: avoid` and `avoid-column`: Safari 10+, Chrome 50+, Firefox 65+/92+, including the multicol context. — [MDN BCD break-inside](https://github.com/mdn/browser-compat-data/blob/main/css/properties/break-inside.json)
- `widows` / `orphans`: Chrome 25+, Safari 1.3+, Firefox not supported. — [MDN BCD widows](https://github.com/mdn/browser-compat-data/blob/main/css/properties/widows.json); [MDN BCD orphans](https://github.com/mdn/browser-compat-data/blob/main/css/properties/orphans.json)
- WebKit computes the initial `widows`/`orphans` as `auto` ("will not cause any page/column breaks"), not the spec's 2; bug 219882 open; setting `widows: 2; orphans: 2` explicitly made Safari's multicol match Chrome. — [WebKit commit](https://webkit.googlesource.com/WebKit/+/fde5fdff14172235df40afcc08efec060e77eccb); [WebKit bug 219882](https://bugs.webkit.org/show_bug.cgi?id=219882); [WebKit bug 242380](https://bugs.webkit.org/show_bug.cgi?id=242380)
- Readium's pagination safeguards: `img, svg, video { width:auto; height:auto; max-width:100%; max-height:95vh !important; object-fit:contain; -webkit-column-break-inside:avoid; page-break-inside:avoid; break-inside:avoid }` ("figures might have a figcaption, which is why 95vh"); `table { box-sizing:border-box; max-width:100% }`; long strings in links and headings get `word-wrap: break-word`. — [ReadiumCSS-safeguards.css](https://github.com/readium/readium-css/blob/develop/css/src/modules/ReadiumCSS-safeguards.css)
- Readium paging uses `column-fill: auto` with `column-count`/`column-width`/`column-gap` variables and `max-width: var(--RS__defaultLineLength)` so margins shrink as font size grows; two-page spreads switch to single page depending on font size. — [ReadiumCSS-pagination.css](https://github.com/readium/readium-css/blob/develop/css/src/modules/ReadiumCSS-pagination.css)
- Readium multicol notes: margins at a break are dropped (authors resort to `padding-top` after forced breaks); avoiding `break-inside` for elements in 2–3 columns can misalign; fragmentation logic varies by engine and sometimes needs a forced reflow. — [Readium multicol doc](https://github.com/readium/readium-css/blob/develop/docs/CSS04-multicolumn_layout.md)
- Drop caps: `initial-letter` Chrome 110+, Safari 9+ as `-webkit-initial-letter` (iOS: no decimal values), Firefox none. — [MDN BCD initial-letter](https://github.com/mdn/browser-compat-data/blob/main/css/properties/initial-letter.json)
- `text-box-trim` / `text-box-edge` (trim half-leading above the first line): Safari 18.2+, Chrome 133+, Firefox 154+. — [MDN BCD text-box-trim](https://github.com/mdn/browser-compat-data/blob/main/css/properties/text-box-trim.json)
- Two-page spreads: Foliate and Readest default to max 2 columns; KOReader enables 2 pages in landscape above a screen-height threshold. — [Foliate gschema](https://github.com/johnfactotum/foliate/blob/gtk4/data/com.github.johnfactotum.Foliate.gschema.xml); [Readest constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts); [KOReader defaults.lua](https://github.com/koreader/koreader/blob/master/defaults.lua)

### Inferences
- [inference] Pager's current `break-after: avoid` on h1–h6 is a no-op on iPhone and in Firefox. Fixes, in order of robustness:
  1. Post-layout JS pass (works everywhere): after pagination, for each heading compute its column from `getBoundingClientRect().left / pageWidth`; if the next block's first line (`getClientRects()[0]`) is in a later column, or the heading's bottom is within ~2 line-heights of the column bottom, give the heading `break-before: column` (plus `-webkit-column-break-before: always` for WebKit) or insert a spacer. Re-run on resize/font change.
  2. Structural: wrap heading + the first ~2 lines' worth of the next element in a `break-inside: avoid` box. Wrapping a long paragraph whole would leave large gaps, so only wrap short followers (subtitle, epigraph, first short paragraph).
- [inference] Keep `orphans: 2; widows: 2` (Pager already sets them; WebKit needs them explicit). Do not raise to 3: in short columns on a phone it causes visibly ragged page bottoms.
- [inference] Images and figures: tie max height to the measured column, e.g. `img, svg, video { max-height: calc(var(--page-h) - 2lh); object-fit: contain; break-inside: avoid }` and `figure:has(figcaption) img { max-height: calc(var(--page-h) - 4lh) }` (`lh` unit: Safari 16.4+, Chrome 109+; fall back to em). Pager already uses `--page-h - 2em`.
- [inference] Tables: `break-inside: avoid` on `tr` (Pager does) but not on the whole table; a tall table must be allowed to split. Wrap wide tables in `overflow-x: auto` so they scroll inside the column.
- [expert/inference] Chapter openings: `h1 { break-before: column }` for chapter starts in Pages mode; optional drop cap via `@supports (initial-letter: 3) or (-webkit-initial-letter: 3) { .chapter-start > p:first-of-type::first-letter { -webkit-initial-letter: 3; initial-letter: 3; margin-right: .08em } }` and `::first-line { font-variant-caps: all-small-caps; letter-spacing: .04em }`. Make it a setting; Readium's a11y baseline lists "removing drop caps" as a user need.
- [inference] Keep the last line from being clipped: make the column height an exact multiple of the line height (`height = floor(available / lineHeightPx) * lineHeightPx`) and set `text-box-trim: trim-start` on the first block of a column or zero its top margin so line boxes land on a consistent grid.
- [vendor/inference] Spreads: show 2 columns only when each column can hold ≥ ~45–50 characters and the window is landscape and wide (e.g., ≥ 1000px wide); gutter = 2× side margin (Foliate's 6% margin is a reasonable start).

### Gaps
- No primary source confirming how `text-wrap: pretty` interacts with column fragmentation in WebKit.
- Whether `-webkit-column-break-before: always` still behaves differently from `break-before: column` in current WebKit multicol was not verified.

## 4. Which modern CSS text features help, and what is their 2026 support (especially Safari/WKWebView on iOS 17–26)?

### Takeaway
Safe to use now on iPhone: `text-wrap: pretty` (Safari 26+, whole-paragraph), `text-wrap: balance` for headings (17.5+), `hyphens: auto` with a `lang` attribute (unprefixed 17+), `hanging-punctuation` (Safari only), `font-optical-sizing`, `font-variant-numeric`, `font-size-adjust` (17+), `text-box-trim` (18.2+). Not on Safari: `hyphenate-limit-chars` (Technology Preview only), `text-spacing-trim`. `-webkit-font-smoothing` and `text-rendering` do little on iOS.

### Cited Findings
Support data below is from MDN browser-compat-data fetched 2026-10-29 (Safari iOS mirrors Safari unless noted). Versions before October 2026 may since have changed.
- `text-wrap: pretty`: Chrome 117+, Safari 26+, Firefox not supported. `text-wrap: balance`: Chrome 114+, Firefox 121+, Safari 17.5+. — [MDN BCD text-wrap](https://github.com/mdn/browser-compat-data/blob/main/css/properties/text-wrap.json)
- WebKit's `pretty` evaluates and adjusts every line of the paragraph (rag, short last lines, fewer hyphens; not yet rivers); Chromium adjusts only the last four lines. Performance depends on lines per paragraph, with slowdowns likely only for "many hundreds or thousands of lines". `balance` should not be used on long passages. — [WebKit blog: Better typography with text-wrap pretty](https://webkit.org/blog/16547/better-typography-with-text-wrap-pretty/)
- `hyphens: auto`: Safari 17 unprefixed (`-webkit-hyphens` since 5.1; iOS since 4.2), Chrome 88+ on all platforms, Firefox 6+; dictionaries vary by language and engine (Safari has separate en-GB and en-US). — [MDN BCD hyphens](https://github.com/mdn/browser-compat-data/blob/main/css/properties/hyphens.json)
- `hyphenate-limit-chars`: Chrome 109+, Firefox 137+, Safari "preview" only. `hyphenate-character`: Safari 17+, Chrome 106+, Firefox 98+. — [MDN BCD hyphenate-limit-chars](https://github.com/mdn/browser-compat-data/blob/main/css/properties/hyphenate-limit-chars.json); [MDN BCD hyphenate-character](https://github.com/mdn/browser-compat-data/blob/main/css/properties/hyphenate-character.json)
- `hanging-punctuation`: Safari only (`first`, `last`, `allow-end` since 10; `force-end` 16.4); before Safari 26.5, straight quotes U+0027/U+0022 did not hang with `first`/`last`. Chrome and Firefox: none. — [MDN BCD hanging-punctuation](https://github.com/mdn/browser-compat-data/blob/main/css/properties/hanging-punctuation.json)
- `text-spacing-trim` (CJK punctuation): Chrome 123+ only. `text-autospace` (CJK/Latin spacing): Chrome 140+, Firefox 145+, Safari 18.4+ (initial value currently `no-autospace`). — [MDN BCD text-spacing-trim](https://github.com/mdn/browser-compat-data/blob/main/css/properties/text-spacing-trim.json); [MDN BCD text-autospace](https://github.com/mdn/browser-compat-data/blob/main/css/properties/text-autospace.json)
- `font-optical-sizing`: Chrome 79+, Firefox 62+, Safari 13.1+. `font-variant-numeric` (oldstyle-nums etc.): Chrome 52+, Firefox 34+, Safari 9.1+. `font-kerning`: Chrome 33+, Firefox 32+, Safari 9+. — [MDN BCD font-optical-sizing](https://github.com/mdn/browser-compat-data/blob/main/css/properties/font-optical-sizing.json); [MDN BCD font-variant-numeric](https://github.com/mdn/browser-compat-data/blob/main/css/properties/font-variant-numeric.json); [MDN BCD font-kerning](https://github.com/mdn/browser-compat-data/blob/main/css/properties/font-kerning.json)
- `font-size-adjust`: Safari 16.4+ (`from-font` and two-value syntax 17+), Chrome 127+, Firefox (from-font 118+). — [MDN BCD font-size-adjust](https://github.com/mdn/browser-compat-data/blob/main/css/properties/font-size-adjust.json)
- `-webkit-font-smoothing` / `-moz-osx-font-smoothing`: the Firefox variant "only works on macOS". — [MDN BCD font-smooth](https://github.com/mdn/browser-compat-data/blob/main/css/properties/font-smooth.json)
- `text-rendering`: in Chrome "only supported on Windows and Linux"; "Safari treats `auto` as `optimizeSpeed`"; Firefox treats `auto` as `optimizeLegibility` at ≥20px. — [MDN BCD text-rendering](https://github.com/mdn/browser-compat-data/blob/main/css/properties/text-rendering.json)
- `-webkit-text-size-adjust`: Safari iOS (prefixed) only; Chrome 54+ unprefixed. — [MDN BCD text-size-adjust](https://github.com/mdn/browser-compat-data/blob/main/css/properties/text-size-adjust.json)
- `ui-serif` / `ui-sans-serif` / `ui-rounded` / `ui-monospace`: Safari 13.1+ only (Chrome, Firefox: no). — [MDN BCD font-family](https://github.com/mdn/browser-compat-data/blob/main/css/properties/font-family.json)
- Readium: hyphenation is "OK" with left-aligned text and "critical" with justified text; headings, tables and pre must not be justified. — [Readium user settings recs](https://github.com/readium/readium-css/blob/develop/docs/CSS14-user_settings_recs.md)
- WCAG 2.2 SC 1.4.12 Text Spacing: content must survive line-height 1.5×, paragraph spacing 2×, letter-spacing 0.12×, word-spacing 0.16× font size; SC 1.4.8 (AAA) asks for ≤80 characters per line, line spacing ≥1.5, no full justification. — [W3C Understanding 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html); [W3C Understanding 1.4.8](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html)

### Inferences
- [inference] Recommended body block for Pager (all values tagged in comments):
```css
.markup {
  font-size: var(--font-size-body);           /* [evidence] ≥17px phone, ~19–21px desktop */
  line-height: var(--reader-leading, 1.5);    /* [expert] unitless, 1.45–1.6 */
  -webkit-text-size-adjust: 100%;             /* iOS: stop font boosting on rotate */
  text-size-adjust: 100%;
  font-kerning: normal;                       /* explicit; replaces optimizeLegibility */
  font-variant-ligatures: common-ligatures;   /* user toggle "ligatures off" for a11y */
  font-optical-sizing: auto;                  /* opsz fonts: Literata, Source Serif 4, Newsreader */
  hanging-punctuation: first allow-end last;  /* Safari only; harmless elsewhere */
  overflow-wrap: break-word;
}
.markup p, .markup li, .markup blockquote, .markup dd {
  text-wrap: pretty;                          /* Safari 26+, Chrome 117+; ignored elsewhere */
  hyphens: var(--reader-hyphens, auto);       /* needs lang on <html> or the section */
  -webkit-hyphens: var(--reader-hyphens, auto);
  hyphenate-limit-chars: 6 3 3;               /* Chrome/Firefox; Safari ignores */
}
.markup :is(h1,h2,h3,h4,h5,h6) { text-wrap: balance; hyphens: manual; line-height: 1.2; }
.markup :is(pre, code, table, h1, h2, h3, h4, h5, h6, a[href^="http"]) { hyphens: manual; }
.markup[data-justify] p { text-align: justify; hyphens: auto; } /* justify only with hyphenation */
.markup table, .markup .numbers { font-variant-numeric: lining-nums tabular-nums; }
.markup { font-variant-numeric: var(--reader-numerals, normal); } /* oldstyle-nums if the font has onum */
```
- [inference] `hyphens: auto` silently does nothing without a language. Pager must set `lang` from the EPUB's `dc:language` (or the HTML's own `lang`) on the reading root, defaulting to the app locale for Markdown/TXT/Word imports.
- [inference] Drop `text-rendering: optimizeLegibility` (no effect in Chrome on macOS/Android and historically slow on long documents) in favour of explicit `font-kerning`/`font-variant-ligatures`. Keep `-webkit-font-smoothing: antialiased` only in the dark theme on macOS if desired; it has no effect on iOS.
- [inference] Use `font-size-adjust: ex-height 0.5` (or `from-font` against a reference) when the user switches fonts so that switching from Spectral to a sans does not change apparent size; this matches how Wallace et al. normalised size and Readium's note that iBooks normalises size on typeface change.
- [inference] `text-wrap: pretty` is ideal for Pages mode on iPhone; in very long single-paragraph documents (plain-text imports with no paragraph breaks) consider turning it off for paragraphs over ~300 lines.
- [inference] `text-spacing-trim` and `text-autospace` only matter for CJK books; apply `text-autospace: normal` under `:lang(zh, ja)`.

### Gaps
- Safari's legacy `-webkit-hyphenate-limit-before/after/lines` properties: current support not verified.
- `font-optical-sizing` mapping differences between engines (opsz in points vs CSS px) not verified.
- Whether WKWebView in a third-party app has exactly the same feature set as Safari for each of these is assumed (same WebKit), not verified per feature.

## 5. When should a reader override publisher CSS, and which publisher styles commonly break reading?

### Takeaway
Users are the top priority (user > author > reading system), but publisher intent counts for structure: override body font, size, line height, spacing, alignment and colours on body text; keep per-element fonts, centered/right alignment, and math/SVG. Most users change the publisher typeface, so make "override" easy and global.

### Cited Findings
- Readium's priority of constituencies: "Users' styles > Authors' styles > Implementers' styles"; since injected sheets are all author-level, readers emulate this by layering ReadiumCSS-before (normalise), the publisher CSS, then ReadiumCSS-after (user settings) with targeted `!important`. — [Readium user settings recs](https://github.com/readium/readium-css/blob/develop/docs/CSS14-user_settings_recs.md); [Readium stylesheet list](https://github.com/readium/readium-css/tree/develop/css/src)
- `font-family` on `body`, `p` and `p.class` is so common it "should not be considered an intent"; a different font on headings, blockquote, i, span is a proper intent; dyslexia fonts should override everything; math and SVG must never be overridden. — [Readium user settings recs](https://github.com/readium/readium-css/blob/develop/docs/CSS14-user_settings_recs.md)
- Text-align: explicit `right`/`center` on paragraphs (and `left` on headings) is a clear intent; never force justify on headings, tables, pre. Line height: override body copy elements. Letter/word spacing: implementers should force the user setting on body copy. Ligatures off must be enforced (a11y). — [Readium user settings recs](https://github.com/readium/readium-css/blob/develop/docs/CSS14-user_settings_recs.md)
- Readium's default stylesheet should only be applied to unstyled books; it is based on HTML5 suggested rendering. — [Readium defaults](https://github.com/readium/readium-css/blob/develop/docs/CSS08-defaults.md)
- Fewer than 15% of surveyed users keep the publisher's typeface; implementers "could adjust the UX accordingly (global setting applying the typeface in all books)"; respondents criticise publishers' poor typeface choices. — [Readium user pref insights](https://github.com/readium/readium-css/blob/develop/docs/CSS15-user_pref_insights.md)
- Themes: implementers should handle contrast and luminosity, possibly removing dark backgrounds; Readium offers opt-in darken (80%) and invert (100%) image filters, ideally per book. — [Readium user settings recs](https://github.com/readium/readium-css/blob/develop/docs/CSS14-user_settings_recs.md); [Readium user prefs](https://github.com/readium/readium-css/blob/develop/docs/CSS12-user_prefs.md)
- Readium a11y normalise flag removes italics, sub/superscripts and drop caps when a dyslexia face is chosen. — [Readium a11y baseline](https://github.com/readium/readium-css/blob/develop/docs/CSS13-a11y_settings_baseline.md)
- Apple Books has an "Original" font choice (publisher font); Foliate, Readest and KOReader default to keeping publisher fonts (override-font false / embedded fonts on). — [AppleToolbox](https://appletoolbox.com/2012/10/how-to-change-appearance-of-books-in-ibooks-app/); [Foliate gschema](https://github.com/johnfactotum/foliate/blob/gtk4/data/com.github.johnfactotum.Foliate.gschema.xml); [Readest constants.ts](https://github.com/readest/readest/blob/main/apps/readest-app/src/services/constants.ts); [KOReader creoptions.lua](https://github.com/koreader/koreader/blob/master/frontend/ui/data/creoptions.lua)
- Kobo exposes a switch to turn off publisher ("Kobo") styling. — [The eBook Reader blog 2011](https://blog.the-ebook-reader.com/2011/07/01/kobo-touch-firmware-update-adds-more-fonts-and-layout-settings)

### Inferences
- [inference] Pager model: (1) "before" layer that neutralises hostile publisher CSS always: absolute font sizes on body/p (convert `px`/`pt` to `em` or override with `font-size: 1em !important` on `body, p, li`), fixed widths/heights on containers, `max-width` hacks, `position: fixed`, body backgrounds and text colours (drop when the theme is dark or sepia), `text-align: justify` without hyphenation (add `hyphens: auto`), tiny margins/padding on `body`. (2) Publisher CSS. (3) "after" layer with user settings using `!important` on body-copy selectors only: `body, p, li, blockquote, dd, div:not([class*=title])`.
- [inference] Default "Use publisher fonts" to on for EPUBs that embed fonts, but expose a single global "Always use my font" switch since most readers override; never override `font-family` on `code, pre, kbd, samp, math, svg, [lang|=ja] …` or elements with an explicit non-body font (detect by comparing computed `font-family` with the body's).
- [inference] Colour safety: strip `background-color`/`color` from body copy in non-light themes; for images, offer per-book "dim images in dark mode" (`filter: brightness(.85)`) rather than inversion.

### Gaps
- The exact Readium "before" normalisation rules (ReadiumCSS-before.css) were downloaded but not analysed line by line; no data found on how often specific publisher CSS patterns appear in real EPUBs.

## 6. Which fonts are good for long reading, and which iOS system fonts can Pager reach from CSS?

### Takeaway
Good free choices include Literata (variable weight + optical size 7–72, designed for Google Play Books), Source Serif 4, Newsreader, Charter, Crimson Pro, EB Garamond, Bitter (slab), and Atkinson Hyperlegible / iA Writer Quattro for sans. On iOS, `ui-serif` reaches New York (Safari only); Georgia, Palatino and Iowan Old Style are installed system fonts; Athelas, Charter and Seravek are Apple Books choices but their availability inside WKWebView was not confirmed.

### Cited Findings
- Literata: redesigned by TypeTogether as a variable font (Oct 2020) from the custom face commissioned for Google Play Books in 2014; two axes (optical size, weight). — [TypeTogether: Literata variable](https://type-together.com/literata-variable-release)
- Literata opsz axis 7–72 (default 14), weights 200–900 (Fontsource metadata). — [Fontsource Literata metadata](https://cdn.jsdelivr.net/npm/@fontsource/literata@5.2.8/metadata.json)
- Bookerly (Kindle) and Literata (Play Books) "have become pretty popular" defaults; reading-app users also ask for Merriweather, Bitter, Vollkorn, Gentium, Lato, Caecilia (slab) and OpenDyslexic; old print faces like Times can render poorly on screen. — [Readium user pref insights](https://github.com/readium/readium-css/blob/develop/docs/CSS15-user_pref_insights.md)
- Readium's system-font stacks: old-style `"Iowan Old Style", Sitka, "Sitka Text", Palatino, "Book Antiqua", "URW Palladio L", P052, serif`; modern `Athelas, Constantia, Charter, "Bitstream Charter", Cambria, "Georgia Pro", Georgia, serif`; humanist sans `Seravek, Calibri, "Gill Sans Nova", Roboto, Ubuntu, "DejaVu Sans", source-sans-pro, sans-serif`; neutral sans `-ui-sans-serif, -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Inter, Roboto, …`. — [Readium defaults](https://github.com/readium/readium-css/blob/develop/docs/CSS08-defaults.md)
- `ui-serif` and friends work only in Safari 13.1+. — [MDN BCD font-family](https://github.com/mdn/browser-compat-data/blob/main/css/properties/font-family.json)
- New York (2019) is licensed only for designing and developing apps for Apple platforms. — [Wikipedia: New York (2019 typeface)](https://en.wikipedia.org/wiki/New_York_(2019_typeface))
- Older per-device lists include Iowan Old Style and Palatino on iOS. — [MobileRead wiki: fonts per device](https://wiki.mobileread.com/wiki/List_of_fonts_included_with_each_device)
- Wallace et al.: EB Garamond (smallest x-height in the set) needed size normalisation; with normalisation it was among the faster fonts for readers 35+. — [Wallace et al. PDF](https://jeffhuang.com/papers/Readability_TOCHI22.pdf)

### Inferences
- [inference] Suggested Pager font menu (bundled as WOFF2 so desktop and phone match): Literata (default serif candidate; opsz gives sturdier text at 16–18px), Source Serif 4, Charter (Bitstream Charter is freely licensed), EB Garamond or Crimson Pro ("bookish"), Bitter (slab), Atkinson Hyperlegible Next or Inter (sans), OpenDyslexic (opt-in). Plus "System serif" = `ui-serif, "Iowan Old Style", Charter, Georgia, serif` and "Publisher" (original).
- [inference] Spectral (current default) has a small x-height and light strokes for body use at 17px; if kept, consider weight 400→450 on dark backgrounds or a bump to 18px on phones. (No study tested Spectral; this is typographic judgement.)
- [inference] Ship each font with a measured x-height ratio and apply `font-size-adjust` with that number so all choices appear the same size; this is the "size normalisation" that Wallace found necessary for fair comparison.

### Gaps
- An authoritative iOS 26 list of fonts installed system-wide (as opposed to downloadable in Books) was not found; whether Charter, Athelas and Seravek are reachable from WKWebView by name needs an on-device test (`document.fonts.check('16px Charter')`).
- Optical-size axis ranges for Source Serif 4 and Newsreader, and licence details for iA Writer Quattro, were not verified.

## 7. What theme colours should a reader ship, and what contrast is right for long reading?

### Takeaway
Ship Light, Sepia, Dark and optionally OLED Black, with text a little below maximum contrast in dark themes. Material's dark guidance (#121212 surface, ~87% white text, never pure white) and Pocket/Firefox's sepia (#F4ECD8 / #5B4636) are documented reference points. Pager's current palette is within these norms.

### Cited Findings
- Material Design dark theme: base surface #121212; high-emphasis text at 87% white, medium 60%, disabled 38%; pure #FFFFFF text "vibrates" and its light "appears to bleed or blur" against dark backgrounds; body text must still pass 4.5:1 on the lightest elevated surface. — [Material: dark theme](https://m2.material.io/design/color/dark-theme); [Material dark theme codelab](https://codelabs.developers.google.com/codelabs/design-material-darktheme)
- Firefox Reader View sepia matched Pocket's: background #F4ECD8, text #5B4636. — [Mozilla bug 1158281](https://bugzilla.mozilla.org/show_bug.cgi?id=1158281)
- Kindle iOS page colours: white, sepia, light green, black. — [Amazon: Accessible Reading Options](https://digprjsurvey.amazon.com/csad/help/node/TABlJ4ot69emTO8jJG)
- Apple Books: six themes, each with a dark variant since iOS 16. — [Gadget Hacks](https://ios.gadgethacks.com/how-to/apple-books-just-got-its-biggest-iphone-update-years-0385075/)
- Positive polarity is more legible in most lighting, and negative polarity is worst in dark surroundings under glance-like reading (pupil-size explanation). — [PubMed 28166901](https://pubmed.ncbi.nlm.nih.gov/28166901/); [Ergonomics 2014 abstract](https://informahealthcare.com/doi/abs/10.1080/00140139.2014.948496)
- Computed WCAG contrast (formula applied to these hex values): #111 on #FFF 18.9:1; #E5E5E5 on #121212 14.9:1; #E0E0E0 (≈87% white) on #121212 14.2:1; #FFF on #121212 18.7:1; #5B4636 on #F4ECD8 7.5:1; #BDBDBD on #121212 10.0:1; #FFF on #000 21:1. — [W3C contrast definition, Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- Readium: theme handling must consider contrast and luminosity, possibly removing dark-coloured backgrounds and offering darken/invert for images. — [Readium user settings recs](https://github.com/readium/readium-css/blob/develop/docs/CSS14-user_settings_recs.md)

### Inferences
- [inference] Pager's dark theme (#E5E5E5 on #121212, 14.9:1) is already in the Material band. Offer a lower-contrast "Dim/Night" variant around #BDBDBD–#CFCFCF on #121212 (10–12:1) for long night sessions, and an "OLED black" variant (#000 bg, text ~#C8C8C8–#D4D4D4, ≈13–14:1, not #FFF).
- [vendor] Add Sepia using the Pocket/Firefox pair (#F4ECD8 / #5B4636, 7.5:1); a "Paper" off-white (e.g., #F8F6F1 with #2B2B2B text, 13.1:1) is a gentler alternative to #FFF/#111 (18.9:1). Exact Paper values are taste, not evidence.
- [inference] Keep the ink-blue accent readable per theme (#1D4ED8 on #FFF 6.7:1; #60A5FA on #121212 7.4:1); for sepia use a darker, slightly warm blue, and verify ≥4.5:1 for links.
- [inference] In dark themes, consider `font-weight: 420–450` with a variable font (or `-webkit-font-smoothing: antialiased` on macOS) to offset the thinner look of light-on-dark text; dim images with `filter: brightness(.85) contrast(1.05)` as an opt-in per book.
- [evidence] Default to Light (or follow the system) rather than Dark: positive polarity has the better legibility evidence in lit rooms; dark is a comfort choice at night.

### Gaps
- Official hex values for Apple Books themes (Quiet, Paper, Calm, Focus, Bold) and Kindle sepia/green were not found in primary sources.
- No primary evidence gathered on "night warmth" (warm-tinted themes or blue-light reduction) and reading comfort or sleep; iOS Night Shift already applies system-wide.
