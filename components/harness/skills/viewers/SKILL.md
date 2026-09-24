---
name: viewers
description: Build human-facing HTML pages with the viewers component — JSON data in, one self-contained hardened HTML file out, themed dark1, opened as file://. ALWAYS use this before writing viewer HTML: viewers come from the shipped templates, never freestyled. Operator-facing pages are never published as web artifacts.
---

# viewers — build a human-facing page the standard way

**The rule: never freestyle a viewer.** Render it from a shipped template
with the house theme. One request = one file = one look.

The tool ships on every v4 seat under the seat's harness:

    node harness/tools/viewers/render.mjs <template> <data.json> -o <out.html> [--theme dark1-<color>]
    node harness/tools/viewers/render.mjs --list

## Pick the template

| ask sounds like | template |
|---|---|
| report, review, findings, sections of notes/tables/lists | `report` |
| model bake-off runs: regressions, consistency, DNFs | `bakeoff` |
| compare two documents: a rewrite against its source | `sidebyside` — markdown rendered formatted, old left, new right, highlight terms with per-pane hit counts |
| several documents, one at a time: model outputs on the same input | `tabs` — markdown rendered formatted, the TOC is the tab bar |

Pages are full width with no sidebar. A report gets the sticky numbered TOC only with
`"toc": true` at the top level of its data; leave it off on a laptop.

Neither fits? Add a template to the component (`components/viewers/README.md`
in the incubator-v5 repo, "Adding a template" — one file, registered, with a
fixture and tests). A new template is a change to the component, landed
through the board — never a one-off page.

## The theme

The look is the incubator's `dark1` family, switched with `--theme`:
`dark1-blue` (default) · `dark1-green` · `dark1-red` · `dark1-amber` ·
`dark1-violet` · `dark1-teal`. All variants ride embedded in every page;
the palette source is `harness/tools/viewers/lib/themes/dark1.css`, carried
from the incubator viewer system. Do not invent palettes.

## The output

One self-contained file: inline styles, no scripts that execute, no
network. It opens from a `file://` URL with no internet — which is why it
beats a web artifact: nothing leaves the machine, and the page embeds its
own input JSON for provenance. Hostile data renders inert; the element
builder refuses every tag and attribute that loads, navigates, or
executes.

## Practice

- Build the data JSON with a script that reads the sources; never
  hand-write a large data file.
- A viewer worth keeping lands in the project docs repo's `viewers/`
  directory with one INDEX line (`viewers/INDEX.md`). Throwaway session evidence goes to the
  scratchpad; hand the operator the `file://` path either way.
- Content that must not enter a repo (secrets, text the operator asked to
  delete) never lands in a committed viewer — scratchpad only.
- After editing a page that is already open, tell the operator to
  force-reload — browsers cache `file://`.
