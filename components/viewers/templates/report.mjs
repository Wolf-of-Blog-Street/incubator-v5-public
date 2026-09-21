/*
 * report.mjs — the generic sectioned report template, on the incubator's
 * report skeleton: sticky numbered TOC (rendered by the page shell from
 * this template's toc labels), kicker, numbered section labels, and the
 * house component vocabulary.
 *
 * Input shape (all fields optional; unknown shapes render as inert text):
 * {
 *   "title": "string",
 *   "subtitle": "string",
 *   "kicker": "string",                              // mono eyebrow over the title
 *   "sections": [
 *     {
 *       "title": "string",
 *       "status": "ok" | "warn" | "bad" | "neutral",   // colors the badge
 *       "badge": "string",                             // badge text; defaults to status
 *       "lede": "string",                              // the headline takeaway, accent-barred
 *       "note": "string",                              // prose paragraph
 *       "cards": [ { "tag": "...", "big": "...", "text": "..." }, ... ],   // grid of 3
 *       "stats": [ { "n": "...", "label": "..." }, ... ],                  // grid of 4
 *       "kv": { "key": value, ... } | [ [key, value], ... ],
 *       "table": { "columns": [...], "rows": [ [cell, ...] | {col: cell}, ... ] },
 *       "list": [ item, ... ],
 *       "quote": "string",                             // pulled verbatim, amber bar
 *       "code": "preformatted text",
 *       "callout": { "title": "...", "text": "..." } | "string"   // the boxed takeaway
 *     }
 *   ]
 * }
 *
 * Cell / item / value grammar (renderValue): scalars render as text;
 * { "code": "..." } renders monospace; { "badge": "ok|warn|bad|neutral",
 * "text": "..." } renders a status badge; anything else renders as its
 * JSON. Data can never become markup, links, or scripts. Section anchor
 * ids are code-minted (s-00, s-01, ...) — data never enters an id.
 */

import {
  asArray, asObject, badge, dataTable, h, kvList, mutedNote,
  renderValue, str,
} from "../lib/render.mjs";

export const name = "report";
export const summary = "sectioned report on the house skeleton: TOC, numbered sections, cards/stats/tables/callouts";

const STATUS_KINDS = { ok: "ok", good: "ok", warn: "warn", warning: "warn", bad: "bad", fail: "bad", error: "bad", neutral: "neutral", info: "neutral" };

function sectionBadge(section) {
  if (section.status === null || section.status === undefined) return null;
  const status = str(section.status);
  const kind = STATUS_KINDS[status] ?? "neutral";
  const text = typeof section.badge === "string" && section.badge !== "" ? section.badge : status;
  return badge(kind, text);
}

function renderKv(kv) {
  const pairs = Array.isArray(kv)
    ? kv.filter((pair) => Array.isArray(pair) && pair.length >= 2).map((pair) => [str(pair[0]), renderValue(pair[1])])
    : Object.entries(asObject(kv)).map(([key, value]) => [key, renderValue(value)]);
  if (pairs.length === 0) return null;
  return kvList(pairs);
}

function renderTable(spec) {
  const table = asObject(spec);
  const columns = asArray(table.columns).map((column) => str(column));
  const rows = asArray(table.rows);
  if (columns.length === 0 && rows.length === 0) return null;
  const rowNodes = rows.map((row) => {
    const cells = Array.isArray(row)
      ? row.map((cell) => h("td", null, renderValue(cell)))
      : columns.map((column) => h("td", null, renderValue(asObject(row)[column])));
    return h("tr", null, cells);
  });
  return dataTable(null, columns, rowNodes);
}

function renderList(items) {
  const list = asArray(items);
  if (list.length === 0) return null;
  return h("ul", { class: "plain" }, list.map((item) => h("li", null, renderValue(item))));
}

function renderCards(items) {
  const cards = asArray(items).map(asObject);
  if (cards.length === 0) return null;
  return h("div", { class: "grid3" }, cards.map((card) => h("div", { class: "card" },
    card.tag === undefined ? null : h("div", { class: "tag" }, str(card.tag)),
    card.big === undefined ? null : h("div", { class: "big" }, str(card.big)),
    card.text === undefined ? null : h("p", { class: "card-line" }, str(card.text)),
  )));
}

function renderStats(items) {
  const stats = asArray(items).map(asObject);
  if (stats.length === 0) return null;
  return h("div", { class: "grid4" }, stats.map((stat) => h("div", { class: "stat" },
    h("div", { class: "n" }, str(stat.n ?? "—")),
    stat.label === undefined ? null : h("div", { class: "l" }, str(stat.label)),
  )));
}

function renderCallout(spec) {
  if (typeof spec === "string") return h("div", { class: "callout" }, spec);
  const callout = asObject(spec);
  return h("div", { class: "callout" },
    typeof callout.title === "string" && callout.title !== "" ? h("h4", null, callout.title) : null,
    callout.text === undefined ? null : str(callout.text),
  );
}

export function sectionTitle(raw) {
  const section = asObject(raw);
  return typeof section.title === "string" && section.title !== "" ? section.title : "(untitled section)";
}

function renderSection(raw, index) {
  const section = asObject(raw);
  const num = String(index).padStart(2, "0");
  const blocks = [
    typeof section.lede === "string" && section.lede !== "" ? h("div", { class: "lede" }, section.lede) : null,
    typeof section.note === "string" && section.note !== "" ? h("p", { class: "note prose" }, section.note) : null,
    section.cards === undefined ? null : renderCards(section.cards),
    section.stats === undefined ? null : renderStats(section.stats),
    section.kv === undefined ? null : renderKv(section.kv),
    section.table === undefined ? null : renderTable(section.table),
    section.list === undefined ? null : renderList(section.list),
    typeof section.quote === "string" && section.quote !== "" ? h("div", { class: "quote" }, section.quote) : null,
    typeof section.code === "string" ? h("pre", { class: "code-block" }, section.code) : null,
    section.callout === undefined ? null : renderCallout(section.callout),
  ].filter((block) => block !== null);
  return h("section", { id: `s-${num}`, class: "rsec" },
    h("h2", { class: "sec-label" },
      h("span", { class: "num" }, num),
      sectionTitle(raw),
      sectionBadge(section),
    ),
    blocks.length === 0 ? mutedNote("Nothing in this section.") : blocks,
  );
}

export function render(data) {
  const doc = asObject(data);
  const sections = asArray(doc.sections);
  const body = sections.length === 0
    ? mutedNote("No sections in the data file.")
    : sections.map((section, index) => renderSection(section, index));
  return {
    title: typeof doc.title === "string" && doc.title !== "" ? doc.title : "report",
    subtitle: typeof doc.subtitle === "string" ? doc.subtitle : null,
    kicker: typeof doc.kicker === "string" && doc.kicker !== "" ? doc.kicker : null,
    // No sidebar by default: the page is full width. Opt in with "toc": true in the data.
    toc: doc.toc === true ? sections.map((section) => sectionTitle(section)) : null,
    body,
  };
}
