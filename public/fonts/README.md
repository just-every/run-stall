# Fonts

Self-hosted variable fonts, each under the SIL Open Font License 1.1 (licence text beside each file). Source: Google Fonts, via Fontsource 5.3. No page requests a font from a third party.

| Face | Use | Files | Licence |
| --- | --- | --- | --- |
| Inter Tight 100–900 | Headings and the Stall wordmark | `inter-tight/` (Latin, Latin Extended) | `inter-tight/LICENSE.txt` |
| Inter 100–900 | Body text | `inter/` (Latin, Latin Extended) | `inter/LICENSE.txt` |
| JetBrains Mono 100–800 | Commands and code | `jetbrains-mono/` (Latin) | `jetbrains-mono/LICENSE.txt` |

`/rer-theme.css` declares the faces, so the installer serves them too. `fonts.css` carries the rest of Stall's look,
which the theme grammar keeps out of `/rer-theme.css`: the form controls' font, Stall's own tokens and the rules that
dress Base's pages. Every page of the app and the run site that links the theme links `fonts.css` too (before the
theme; the sign-in pages after their own style), and the hosted demo's gate inlines both files. The installer reads
only the theme.
