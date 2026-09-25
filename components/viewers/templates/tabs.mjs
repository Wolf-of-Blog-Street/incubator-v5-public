/*
 * tabs.mjs — several markdown documents, one shown at a time. The TOC
 * is the tab bar: each label links to its tab (code-minted #s-NN), and
 * CSS :target shows that tab alone; with no target the first tab shows.
 * No scripts. Built for comparing model outputs on the same input.
 *
 * Input shape (all fields optional; unknown shapes render as inert text):
 * {
 *   "title": "string",
 *   "subtitle": "string",
 *   "tabs": [ { "title": "opus55", "meta": "$1.20 · 239k in", "text": "markdown...",
 *              "index": { "columns": ["Run", ...], "rows": [ { "tab": 1, "cells": ["120", ...] } ] } }, ... ]
 * }
 * `index` (optional) is a table shown below the tab's text; each row opens
 * the tab it names (`tab`: its position in `tabs`), so an overview can list
 * the other tabs.
 */

import { asArray, asObject, h, mutedNote, str, tabLink } from "../lib/render.mjs";
import { mdToVnodes } from "../lib/md.mjs";

export const name = "tabs";
export const summary = "markdown documents as tabs, one shown at a time (TOC is the tab bar)";

const tabTitle = (raw, index) => {
  const tab = asObject(raw);
  return typeof tab.title === "string" && tab.title !== "" ? tab.title : `tab ${index + 1}`;
};

function indexTable(raw, count) {
  const index = asObject(raw);
  const columns = asArray(index.columns).map(str);
  const rows = asArray(index.rows).map(asObject);
  if (columns.length === 0 || rows.length === 0) return null;
  const rowNodes = rows.map((row) => {
    const cells = asArray(row.cells).map(str);
    const target = Number.isInteger(row.tab) && row.tab > 0 && row.tab < count ? row.tab : null;
    return h("tr", { class: target === null ? null : "row-link" },
      cells.map((cell, i) => h("td", null, i === 0 && target !== null ? tabLink(target, cell) : cell)));
  });
  return h("div", { class: "table-wrap" }, h("table", null,
    h("thead", null, h("tr", null, columns.map((c) => h("th", null, c)))),
    h("tbody", null, rowNodes)));
}

export function render(data) {
  const doc = asObject(data);
  const tabs = asArray(doc.tabs);
  const body = tabs.length === 0 ? mutedNote("No tabs in the data file.") : h("div", { class: "tabs" },
    tabs.map((raw, index) => {
      const tab = asObject(raw);
      const text = str(tab.text ?? "");
      return h("section", { id: `s-${String(index).padStart(2, "0")}`, class: "tab" },
        h("h2", { class: "sec-label" }, tabTitle(raw, index),
          typeof tab.meta === "string" && tab.meta !== "" ? h("span", { class: "sbs-pane-meta" }, tab.meta) : null),
        text === "" ? (tab.index ? null : mutedNote("(empty document)")) : h("div", { class: "tab-doc" }, mdToVnodes(text, null, { hits: 0 })),
        indexTable(tab.index, tabs.length),
      );
    }));
  return {
    title: str(doc.title ?? "tabs"),
    subtitle: typeof doc.subtitle === "string" && doc.subtitle !== "" ? doc.subtitle : null,
    toc: tabs.map(tabTitle),
    body,
  };
}
