/*
 * sidebyside.mjs — two documents side by side: old on the left, new on
 * the right. Built for document review: a rewrite against its source, a
 * config against its predecessor. Each pane scrolls on its own, so the
 * reader compares section against section, not line against line.
 *
 * The documents are markdown and render FORMATTED (lib/md.mjs): real
 * headings, paragraphs, lists, tables, code — through the hardened h(),
 * so data can never become markup. Optional highlight terms mark every
 * case-insensitive match in both panes, and the pane head counts them —
 * the count is the point when the rewrite's job was to remove the
 * marked language.
 *
 * Input shape (all fields optional; unknown shapes render as inert text):
 * {
 *   "title": "string",
 *   "subtitle": "string",
 *   "highlight": ["term", ...],                    // literal, case-insensitive
 *   "left":  { "title": "old", "meta": "1197 lines", "text": "..." },
 *   "right": { "title": "new", "meta": "1256 lines", "text": "..." }
 * }
 */

import { asArray, asObject, badge, h, str } from "../lib/render.mjs";
import { mdToVnodes } from "../lib/md.mjs";

export const name = "sidebyside";
export const summary = "two markdown documents side by side: old left, new right, optional highlight terms";

const escapeRegex = (term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildMatcher(terms) {
  const literals = asArray(terms).map(str).filter((term) => term !== "");
  if (literals.length === 0) return null;
  return new RegExp(`(${literals.map(escapeRegex).join("|")})`, "gi");
}

function pane(side, fallbackTitle, matcher) {
  const doc = asObject(side);
  const text = str(doc.text ?? "");
  const counter = { hits: 0 };
  const body = text === ""
    ? [h("p", { class: "muted" }, "(empty document)")]
    : mdToVnodes(text, matcher, counter);
  const meta = typeof doc.meta === "string" && doc.meta !== "" ? doc.meta : null;
  return h("section", { class: "sbs-pane" },
    h("div", { class: "sbs-pane-head" },
      h("span", { class: "sbs-pane-title" }, str(doc.title ?? fallbackTitle)),
      meta === null ? null : h("span", { class: "sbs-pane-meta" }, meta),
      matcher === null ? null : badge(
        counter.hits > 0 ? "warn" : "ok",
        `${counter.hits} ${counter.hits === 1 ? "hit" : "hits"}`,
      ),
    ),
    h("div", { class: "sbs-doc" }, body),
  );
}

export function render(data) {
  const doc = asObject(data);
  const matcher = buildMatcher(doc.highlight);
  return {
    title: str(doc.title ?? "side by side"),
    subtitle: typeof doc.subtitle === "string" && doc.subtitle !== "" ? doc.subtitle : null,
    body: h("div", { class: "sbs" },
      pane(doc.left, "old", matcher),
      pane(doc.right, "new", matcher),
    ),
  };
}
