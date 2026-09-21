/*
 * page.mjs — the self-contained page shell.
 *
 * Takes a rendered body (vnodes from lib/render.mjs) and wraps it in one
 * complete HTML document: inline stylesheet, no scripts that execute, no
 * external references of any kind. The result opens from a file:// URL on
 * a machine with no network.
 *
 * Trust boundary: this file writes the document skeleton (doctype, head,
 * style, header, footer, the inert embedded-data block) from CODE it owns.
 * Everything data-driven arrives as vnodes built by the hardened h() and
 * is serialized by renderToHtml, so data strings can only ever be text.
 */

import { readFileSync } from "node:fs";
import { escapeHtml, renderToHtml } from "./render.mjs";

// The dark1 theme family rides at the top of every page's <style> so the
// data-theme switch works offline; lib/themes/dark1.css is the palette
// source carried from the incubator's viewer system.
const THEME = readFileSync(new URL("./themes/dark1.css", import.meta.url), "utf8");
const STYLE = THEME + "\n" + readFileSync(new URL("./style.css", import.meta.url), "utf8");

export const THEMES = ["dark1-blue", "dark1-green", "dark1-red", "dark1-amber", "dark1-violet", "dark1-teal"];

/** JSON for an inline <script type="application/json"> block. Every "<" is
 *  written as the JSON escape backslash-u003c, so a closing script tag
 *  inside a data value cannot close the block; the JSON parses back
 *  byte-identical. */
export function embedJson(value) {
  let text;
  try {
    text = JSON.stringify(value, null, 1);
  } catch {
    return null;
  }
  if (typeof text !== "string") return null;
  return text.replace(/</g, "\\u003c");
}

/**
 * Render one complete self-contained HTML page.
 *   title     - page and report title (plain text)
 *   subtitle  - optional line under the title (plain text)
 *   body      - vnode | array of vnodes (from lib/render.mjs)
 *   source    - optional: the parsed input JSON, embedded inert for
 *               provenance (readable, never executed)
 *   template  - template name, named in the footer
 *   theme     - dark1 variant (THEMES); default dark1-blue
 *   kicker    - optional mono eyebrow line over the title
 *   toc       - optional array of section labels; when present the page
 *               renders the house layout: a sticky numbered TOC beside
 *               the content. Anchor hrefs are CODE-MINTED (#s-00, #s-01,
 *               ...) — matching the ids report.mjs mints — so data never
 *               reaches an href; labels render escaped.
 */
export function renderPage({ title, subtitle = null, body, source = undefined, template = null, theme = "dark1-blue", kicker = null, toc = null }) {
  const safeTheme = THEMES.includes(theme) ? theme : "dark1-blue";
  const safeTitle = escapeHtml(typeof title === "string" && title !== "" ? title : "report");
  const sub = typeof subtitle === "string" && subtitle !== ""
    ? `<p class="report-subtitle">${escapeHtml(subtitle)}</p>\n`
    : "";
  const eyebrow = typeof kicker === "string" && kicker !== ""
    ? `<p class="kicker">${escapeHtml(kicker)}</p>\n`
    : "";
  const generated = new Date().toISOString();
  const footBits = [
    template === null ? null : `template <code>${escapeHtml(template)}</code>`,
    `rendered ${escapeHtml(generated)}`,
    "self-contained: inline styles, no executable scripts, no network",
  ].filter((bit) => bit !== null).join(" · ");
  const data = source === undefined ? null : embedJson(source);
  const dataBlock = data === null ? "" :
    `<script type="application/json" id="report-data">\n${data}\n</script>\n`;
  const labels = Array.isArray(toc) ? toc.map((label) => escapeHtml(String(label))) : [];
  const nav = labels.length === 0 ? null :
    `<nav class="toc">\n<p class="brand">${safeTitle}</p>\n` +
    labels.map((label, index) => {
      const num = String(index).padStart(2, "0");
      return `<a href="#s-${num}"><span class="n">${num}</span>${label}</a>`;
    }).join("\n") +
    `\n</nav>`;
  const head = `<header class="report-head">
${eyebrow}<h1 class="report-title">${safeTitle}</h1>
${sub}</header>`;
  const foot = `<footer class="report-foot">
<p>viewers · ${footBits}</p>
</footer>`;
  const shell = nav === null
    ? `<div class="page">
${head}
<main>
${renderToHtml(body)}
</main>
${foot}
</div>`
    : `<div class="layout">
${nav}
<main>
${head}
${renderToHtml(body)}
${foot}
</main>
</div>`;
  return `<!doctype html>
<html lang="en" data-theme="${safeTheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${safeTitle}</title>
<style>
${STYLE}</style>
</head>
<body>
${shell}
${dataBlock}</body>
</html>
`;
}
