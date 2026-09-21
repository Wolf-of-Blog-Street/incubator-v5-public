# viewers

Templates that turn a JSON data file into ONE self-contained HTML report. A rendered report
opens from a `file://` URL on a laptop with no internet: one inline stylesheet, no executable
scripts, no fonts, no CDN, no network calls. The look is the incubator's `dark1` viewer
family — dark ground, swappable accent palette (`--theme dark1-blue|green|red|amber|violet|teal`,
blue default; palette source `lib/themes/dark1.css`, carried from the incubator viewer system).
Print stays readable on paper. Wide content (tables, code) scrolls inside its own container —
the page never scrolls sideways.

Carried from incubator-v2: the hardened render core of the observe dashboard client
(`src/dashboard/public/app.js` layer 1 and `style.css`). The v2 client polled a server API;
here the data is a file and the output is a file. The v2 contract renderers and the polling
layer stayed behind. The XSS-refusing element builder, the never-crash shape guards, and the
design tokens carried over.

## Usage

```
node render.mjs <template> <data.json> [-o <out.html>] [--title "..."] [--theme dark1-<color>]
node render.mjs --list
```

With no `-o`, the report is written next to the input (`runs.json` → `runs.html`) and its
absolute path is printed. `-o -` writes the HTML to stdout. Exit codes: 0 ok, 1 bad data,
2 usage.

Worked example, from the incubator-v4 source repo:

```
node base/tools/viewers/render.mjs bakeoff base/tests/viewers/fixtures/bakeoff.json -o /tmp/bakeoff.html
open /tmp/bakeoff.html
```

On an installed seat, the same tool is `~/<agent-home>/harness/tools/viewers/render.mjs`.

The fixture is a real-shaped bake-off: 4 models × 3 passes. The report shows glm and kimi
REGRESSION, fable and kimi CONSISTENT, glm and ds4 MIXED (with the reasons named), and the
one DNF run — all in the first table.

## Templates

| Template | For | Input |
|---|---|---|
| `bakeoff` | model bake-off runs: who regressed, who was consistent, who did not finish | one row per run |
| `report` | anything sectioned: notes, key/values, tables, lists, code blocks | titled sections |
| `sidebyside` | document review: a rewrite against its source, old left, new right | two documents plus optional highlight terms |

### bakeoff

One row per run:

```json
{
  "title": "coding bake-off — 2026-08-07",
  "runs": [
    {
      "wave": 1,
      "model": "fable",
      "pass": 1,
      "run_id": "bo-fable-p1-4e1a",
      "status": "ok",
      "duration_s": 754,
      "files_changed": 9,
      "tests": { "passed": 42, "failed": 0, "total": 42 },
      "probes": { "relay-echo": "pass", "accounts-auth": "pass" }
    }
  ]
}
```

Field notes: `wave` is optional. `run_id` also accepted as `id` or `run`. Any `status` other
than `"ok"` counts as did-not-finish; `"dnf"` renders as DNF, anything else renders verbatim.
Duration: `duration_s` (seconds), `duration_ms`, numeric `duration` (seconds), or a string
`duration` shown verbatim. A probe verdict other than `"pass"`/`"fail"` renders verbatim and
does not fail the run. A top-level array is taken as the runs list. Missing fields degrade to
explicit placeholders; nothing crashes the render.

Derived semantics:

- **Run verdict** — CLEAN: status ok, no probe fail, no failed tests. FAIL: status ok but a
  probe failed or `tests.failed > 0`. DNF: status not ok.
- **Model verdict** — REGRESSION: any finished run is FAIL. CLEAN: every finished run is
  CLEAN. NO FINISH: no run finished.
- **Consistency** — CONSISTENT: all runs share one status, finished runs have identical probe
  verdicts and identical `tests.failed`. Otherwise MIXED, with the reasons named in the cell.
  Consistency and regression are independent: a model that fails the same probe every pass is
  CONSISTENT and REGRESSION.

The report: summary tiles, then the model × pass matrix (rows sorted regressed first, then
DNF-affected, then clean; hover a cell for run detail), then per-model probe-by-pass tables,
then the full runs table.

### report

No sidebar by default; the page is full width. `"toc": true` at the top level of the data turns
the sticky numbered TOC on.

The house report skeleton: a sticky numbered TOC (built from the section
titles; anchors are code-minted `#s-NN`, so data never reaches an href), an
optional `kicker` eyebrow over the title, and numbered mono section labels.
Each section holds whichever blocks the data provides — rendered in this
order: `lede`, `note`, `cards`, `stats`, `kv`, `table`, `list`, `quote`,
`code`, `callout`.

```json
{
  "title": "relay smoke report",
  "subtitle": "optional line under the title",
  "sections": [
    {
      "title": "Deliveries",
      "status": "warn",
      "badge": "1 retry",
      "note": "One delivery retried once and then landed.",
      "kv": { "fronts checked": 4, "roster path": { "code": "~/roster.json" } },
      "table": {
        "columns": ["agent", "state"],
        "rows": [ ["agent-c", { "badge": "ok", "text": "delivered" }] ]
      },
      "list": [ "an item", { "badge": "bad", "text": "a problem" } ],
      "code": "raw preformatted text\nline two"
    }
  ]
}
```

`status` is `ok | warn | bad | neutral` and colors the section badge; `badge` overrides the
badge text. Table rows are arrays, or objects keyed by column name. Every value — kv values,
table cells, list items — uses one grammar: scalars render as text; `{ "code": "..." }`
renders monospace; `{ "badge": "ok|warn|bad|neutral", "text": "..." }` renders a status
badge; anything else renders as its JSON.

### sidebyside

Two markdown documents in two panes, each scrolling on its own — the reader
compares section against section, not line against line. The markdown
renders FORMATTED (`lib/md.mjs`: headings, paragraphs re-flowed, lists with
nesting and continuation lines, pipe tables, fenced code, blockquotes,
`code` and **bold**), all through the hardened element builder — links stay
text. `highlight` terms are literal and case-insensitive; every match is
marked in both panes, and each pane head counts its hits — the count is the
point when the rewrite's job was to remove the marked language.

```json
{
  "title": "chits.md — old vs new",
  "highlight": ["ruling", "on record"],
  "left":  { "title": "old", "meta": "1197 lines", "text": "..." },
  "right": { "title": "new", "meta": "1256 lines", "text": "..." }
}
```

Build the JSON with a script (read the two files, `JSON.stringify`); do not
hand-write large data files.

## Hardening

Data can never become markup. The element builder (`lib/render.mjs`, carried from v2) refuses
at construction time every tag that loads, navigates, embeds, or executes (`script`, `style`,
`link`, `a`, `img`, `iframe`, `svg`, forms, media, ...) and every attribute that carries URLs,
code, or presentation (`href`, `src`, `style`, `on*`, ...). Data strings become text nodes or
inert attribute values, escaped. Status colors never ride alone — a text label always carries
the verdict. The input JSON is embedded in the page in an inert
`<script type="application/json" id="report-data">` block (with `<` escaped, so data cannot
close the block): the report carries its own source data for provenance and re-extraction.

## Tests

```
node base/tests/viewers/viewers.test.mjs
```

Run this command from the incubator-v4 source repo. The fixtures live in
`base/tests/viewers/fixtures/`. The 18 tests are offline, with zero dependencies and no
tokens. They cover the refusal lists, escaping,
both templates against fixtures, hostile data (XSS attempts render inert), malformed data
(degrades, never throws), the self-containment invariants (no src/href, no loading tags, no
network calls, one inline stylesheet, every script block inert JSON, dark theme present,
every table in a scroll wrapper), embedded-data round-trip, and the CLI end to end.

## Adding a template

One file in `templates/`, exporting `name`, `summary`, and
`render(data) -> { title, subtitle, body }` where `body` is vnodes built with
`lib/render.mjs`. Register it in the `TEMPLATES` map in `render.mjs`. Never crash on data:
guard every shape (`asObject` / `asArray`), render unknown values verbatim as text, and add
a fixture plus assertions in `base/tests/viewers/`.
