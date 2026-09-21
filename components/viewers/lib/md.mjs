/*
 * md.mjs — markdown to vnodes, through the hardened h().
 *
 * Renders the markdown subset the project's docs actually use: ATX
 * headings, paragraphs (hard-wrapped lines re-flowed), fenced code
 * blocks, pipe tables, ordered/unordered lists with one nesting level
 * and indented continuation lines, blockquotes, horizontal rules, and
 * the inline forms `code` and **bold**. Everything data-driven becomes
 * text nodes; links stay text (h() refuses <a> by design — a viewer
 * never navigates).
 *
 * An optional matcher (a /(term|term)/gi RegExp with ONE capture group)
 * marks every match with <span class="md-mark"> and counts hits into
 * the passed counter — built for review pages where the marked language
 * is the finding.
 */

import { h } from "./render.mjs";

const ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?[\s|:-]+$/;

function marked(text, matcher, counter) {
  if (matcher === null || text === "") return [text];
  const parts = text.split(matcher);
  if (parts.length === 1) return [text];
  return parts.map((part, index) => {
    if (index % 2 === 0) return part;
    counter.hits += 1;
    return h("span", { class: "md-mark" }, part);
  });
}

function bold(text, matcher, counter) {
  const nodes = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(...marked(text.slice(last, m.index), matcher, counter));
    nodes.push(h("strong", null, ...marked(m[1], matcher, counter)));
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(...marked(text.slice(last), matcher, counter));
  return nodes;
}

/** Inline forms: `code` first (its content is literal), then **bold**. */
export function inline(text, matcher = null, counter = { hits: 0 }) {
  const nodes = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(...bold(text.slice(last, m.index), matcher, counter));
    nodes.push(h("code", null, ...marked(m[1], matcher, counter)));
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(...bold(text.slice(last), matcher, counter));
  return nodes;
}

function splitRow(line) {
  let cells = line.trim();
  if (cells.startsWith("|")) cells = cells.slice(1);
  if (cells.endsWith("|")) cells = cells.slice(0, -1);
  return cells.split("|").map((cell) => cell.trim());
}

function parseTable(lines, start, matcher, counter) {
  const header = splitRow(lines[start]);
  let i = start + 2;
  const rows = [];
  while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
    rows.push(splitRow(lines[i]));
    i += 1;
  }
  const node = h("div", { class: "table-wrap" }, h("table", null,
    h("thead", null, h("tr", null, header.map((cell) => h("th", null, ...inline(cell, matcher, counter))))),
    h("tbody", null, rows.map((row) => h("tr", null,
      row.map((cell) => h("td", null, ...inline(cell, matcher, counter)))))),
  ));
  return [node, i];
}

function parseList(lines, start, matcher, counter) {
  const first = lines[start].match(ITEM_RE);
  const ordered = /^\d/.test(first[2]);
  const baseIndent = first[1].length;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") break;
    const m = line.match(ITEM_RE);
    if (m) {
      if (m[1].length <= baseIndent) {
        items.push({ text: m[3], sub: [] });
      } else if (items.length > 0) {
        items[items.length - 1].sub.push({ text: m[3] });
      } else {
        break;
      }
      i += 1;
      continue;
    }
    if (/^\s+\S/.test(line) && items.length > 0) {
      const parent = items[items.length - 1];
      const target = parent.sub.length > 0 ? parent.sub[parent.sub.length - 1] : parent;
      target.text += ` ${line.trim()}`;
      i += 1;
      continue;
    }
    break;
  }
  const renderItem = (item) => h("li", null,
    ...inline(item.text, matcher, counter),
    item.sub && item.sub.length > 0
      ? h("ul", { class: "md-list" }, item.sub.map(renderItem))
      : null,
  );
  const node = h(ordered ? "ol" : "ul", { class: "md-list" }, items.map(renderItem));
  return [node, i];
}

function parseFence(lines, start, matcher, counter) {
  let i = start + 1;
  const body = [];
  while (i < lines.length && !lines[i].startsWith("```")) {
    body.push(lines[i]);
    i += 1;
  }
  const children = [];
  body.forEach((line, index) => {
    if (index > 0) children.push("\n");
    children.push(...marked(line, matcher, counter));
  });
  return [h("div", { class: "code-block" }, children), i < lines.length ? i + 1 : i];
}

function parseQuote(lines, start, matcher, counter) {
  let i = start;
  const body = [];
  while (i < lines.length && lines[i].startsWith(">")) {
    body.push(lines[i].replace(/^>\s?/, ""));
    i += 1;
  }
  return [h("div", { class: "md-quote" }, ...inline(body.join(" "), matcher, counter)), i];
}

/**
 * Render a markdown document to an array of vnodes.
 * matcher: optional /(term|...)/gi RegExp with one capture group.
 * counter: { hits } — incremented per matched term.
 */
export function mdToVnodes(text, matcher = null, counter = { hits: 0 }) {
  const lines = String(text).split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i += 1; continue; }
    if (line.startsWith("```")) {
      const [node, next] = parseFence(lines, i, matcher, counter);
      out.push(node); i = next; continue;
    }
    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      const tag = ["h2", "h3", "h4", "h5"][level - 1];
      out.push(h(tag, { class: `md-h${level}` }, ...inline(heading[2], matcher, counter)));
      i += 1; continue;
    }
    if (/^-{3,}\s*$/.test(line)) { out.push(h("hr")); i += 1; continue; }
    if (line.startsWith(">")) {
      const [node, next] = parseQuote(lines, i, matcher, counter);
      out.push(node); i = next; continue;
    }
    if (line.includes("|") && i + 1 < lines.length &&
        lines[i + 1].includes("-") && TABLE_SEP_RE.test(lines[i + 1])) {
      const [node, next] = parseTable(lines, i, matcher, counter);
      out.push(node); i = next; continue;
    }
    if (ITEM_RE.test(line)) {
      const [node, next] = parseList(lines, i, matcher, counter);
      out.push(node); i = next; continue;
    }
    const para = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "" &&
           !lines[i].startsWith("```") && !lines[i].startsWith(">") &&
           !HEADING_RE.test(lines[i]) && !ITEM_RE.test(lines[i]) &&
           !(lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes("-"))) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(h("p", { class: "md-p" }, ...inline(para.join(" "), matcher, counter)));
  }
  return out;
}
