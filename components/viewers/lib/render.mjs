/*
 * render.mjs — the hardened JSON-to-HTML render core of agent-kit/viewers.
 *
 * Carried from incubator-v2: src/dashboard/public/app.js, layer 1 (the
 * fe-dashboard-ui pure render core). The observe:1 contract renderers and
 * the polling/DOM bootstrap stayed behind; the safe element builder, the
 * escaping, the shape guards, and the shared render pieces moved here.
 *
 * The contract of this file: every function takes plain data and returns
 * vnodes or strings. No DOM, no fetch, no globals touched at import time.
 * Data can only become text nodes or inert attribute values — tags that
 * load, navigate, embed, or execute are refused at construction time, so
 * a hostile string in a data file cannot script, restyle, or link out of
 * the report.
 */

// ---------------------------------------------------------------------------
// Escaping and vnodes
// ---------------------------------------------------------------------------

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

const TAG_RE = /^[a-z][a-z0-9-]*$/;
const ATTR_RE = /^[a-z][a-z0-9-]*$/;
const VOID_TAGS = new Set(["br", "hr", "wbr"]);
// Reports render data as text only. Tags that load, navigate, embed, or
// execute are refused at construction time.
const FORBIDDEN_TAGS = new Set([
  "script", "style", "link", "a", "img", "iframe", "frame", "frameset",
  "object", "embed", "base", "meta", "form", "input", "select", "textarea",
  "audio", "video", "source", "track", "svg", "math", "template", "slot",
  "button",
]);
// Attributes that carry URLs, code, or presentation are refused; data may
// only land in inert attribute values (class, data-*, title, ...).
const FORBIDDEN_ATTRS = new Set(["style", "href", "src", "srcdoc", "srcset", "action", "formaction", "background", "ping"]);

export function h(tag, attrs = null, ...children) {
  if (typeof tag !== "string" || !TAG_RE.test(tag) || FORBIDDEN_TAGS.has(tag)) {
    throw new Error(`refusing to build element: ${String(tag)}`);
  }
  const safeAttrs = {};
  if (attrs !== null && typeof attrs === "object") {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (!ATTR_RE.test(name) || /^on/.test(name) || FORBIDDEN_ATTRS.has(name)) {
        throw new Error(`refusing attribute: ${String(name)}`);
      }
      safeAttrs[name] = value === true ? "" : String(value);
    }
  }
  return { tag, attrs: safeAttrs, children: flattenChildren(children, []) };
}

function isVnode(value) {
  return value !== null && typeof value === "object" && typeof value.tag === "string" &&
    value.attrs !== null && typeof value.attrs === "object" && Array.isArray(value.children);
}

function flattenChildren(list, out) {
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === "") continue;
    if (Array.isArray(child)) flattenChildren(child, out);
    else if (isVnode(child)) out.push(child);
    else out.push(String(child));
  }
  return out;
}

// A link to one of the page's own tabs or sections: the target is code-minted
// (#s-00, #s-01, ...) from a number, so data never reaches an href.
export function tabLink(index, ...children) {
  const n = Number.isInteger(index) && index >= 0 && index < 100 ? index : 0;
  return { tag: "a", attrs: { href: `#s-${String(n).padStart(2, "0")}`, class: "tab-link" }, children: flattenChildren(children, []) };
}

export function renderToHtml(node) {
  if (node === null || node === undefined || node === false || node === "") return "";
  if (Array.isArray(node)) return node.map(renderToHtml).join("");
  if (!isVnode(node)) return escapeHtml(node);
  let attrs = "";
  for (const [name, value] of Object.entries(node.attrs)) {
    attrs += value === "" ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;
  }
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  const inner = node.children.map(renderToHtml).join("");
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

// ---------------------------------------------------------------------------
// Shape guards — the data file is data from elsewhere; never crash on it
// ---------------------------------------------------------------------------

export function isObj(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asObject(value) {
  return isObj(value) ? value : {};
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function str(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Seconds to a short human duration: "42s", "3m 12s", "1h 04m". */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

// ---------------------------------------------------------------------------
// Shared render pieces
// ---------------------------------------------------------------------------

export const BADGE_KINDS = new Set(["ok", "warn", "bad", "neutral", "muted"]);

/** A status word with its color. Color never rides alone: the text IS the
 *  signal, the color reinforces it. Unknown kinds fall back to neutral. */
export function badge(kind, text, title = null) {
  const k = BADGE_KINDS.has(kind) ? kind : "neutral";
  return h("span", { class: `badge badge-${k}`, title }, str(text));
}

export function code(text) {
  return h("code", null, str(text));
}

export function mutedNote(text) {
  return h("p", { class: "muted" }, str(text));
}

export function nullBadge() {
  return h("span", { class: "null-value" }, "null");
}

/** Scalar-or-null as a text node; null gets the explicit null treatment. */
export function textValue(value) {
  return value === null || value === undefined ? nullBadge() : h("span", null, str(value));
}

/** A dl of term/value rows. pairs: [[term, node], ...]; null rows skipped. */
export function kvList(pairs) {
  return h("dl", { class: "kv-list" },
    asArray(pairs).map((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      return h("div", { class: "kv" }, h("dt", null, str(pair[0])), h("dd", null, pair[1]));
    }));
}

/** A table inside its own horizontal-scroll container, so wide content never
 *  makes the page scroll sideways. headers: strings or { text, class }. */
export function dataTable(className, headers, rowNodes) {
  return h("div", { class: "table-wrap" },
    h("table", { class: className || null },
      h("thead", null, h("tr", null, asArray(headers).map((head) => {
        if (isObj(head)) return h("th", { scope: "col", class: head.class || null }, str(head.text));
        return h("th", { scope: "col" }, str(head));
      }))),
      h("tbody", null, rowNodes)));
}

/** One section card: a titled panel with an optional status badge. */
export function sectionCard(title, badgeNode, ...body) {
  return h("section", { class: "card" },
    h("header", { class: "card-head" },
      h("h2", { class: "card-title" }, str(title)),
      badgeNode),
    body);
}

/** One stat tile for the summary strip. kind colors the number (with the
 *  label naming the stat, so color is never the only signal). */
export function tile(stat, value, label, kind = null) {
  const k = kind !== null && BADGE_KINDS.has(kind) ? ` k-${kind}` : "";
  return h("div", { class: "tile", "data-stat": stat },
    h("p", { class: `tile-num${k}` }, str(value)),
    h("p", { class: "tile-label" }, str(label)));
}

/** Generic value renderer for template data cells:
 *    scalar                     -> text
 *    null/undefined             -> the null treatment
 *    { "code": "..." }          -> monospace
 *    { "badge": kind, "text" }  -> status badge
 *    anything else              -> its JSON, as code
 */
export function renderValue(value) {
  if (value === null || value === undefined) return nullBadge();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return h("span", null, String(value));
  }
  if (isObj(value)) {
    if (typeof value.code === "string") return code(value.code);
    if (typeof value.badge === "string") return badge(value.badge, value.text ?? value.badge, typeof value.title === "string" ? value.title : null);
  }
  return code(str(value));
}
