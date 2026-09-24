#!/usr/bin/env node
/*
 * render.mjs — agent-kit/viewers CLI.
 *
 * Render a JSON data file to one self-contained HTML report:
 *
 *   node render.mjs <template> <data.json> [-o <out.html>] [--title "..."]
 *   node render.mjs --list
 *
 * Output: with no -o, writes next to the input (data.json -> data.html)
 * and prints the absolute path of the file written. `-o -` writes the
 * HTML to stdout. Exit codes: 0 ok, 1 data/template failure, 2 usage.
 *
 * The rendered page is self-contained by construction: inline styles, no
 * executable scripts, no external references. It opens from file:// with
 * no network. Templates live in ./templates/, one file each, exporting
 * { name, summary, render(data) -> { title, subtitle, body } }.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { renderPage, THEMES } from "./lib/page.mjs";
import * as bakeoff from "./templates/bakeoff.mjs";
import * as report from "./templates/report.mjs";
import * as sidebyside from "./templates/sidebyside.mjs";
import * as tabs from "./templates/tabs.mjs";

const TEMPLATES = new Map([bakeoff, report, sidebyside, tabs].map((template) => [template.name, template]));

function usage(out) {
  const lines = [
    "usage: render.mjs <template> <data.json> [-o <out.html>] [--title \"...\"] [--theme dark1-<color>]",
    "       render.mjs --list",
    "",
    "templates:",
    ...[...TEMPLATES.values()].map((template) => `  ${template.name.padEnd(10)} ${template.summary}`),
    "",
    "With no -o the report is written next to the input (data.json -> data.html)",
    "and its absolute path is printed. `-o -` writes the HTML to stdout.",
  ];
  out.write(lines.join("\n") + "\n");
}

function fail(message, exitCode) {
  process.stderr.write(`render.mjs: ${message}\n`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { template: null, input: null, out: null, title: null, theme: null, list: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list") args.list = true;
    else if (arg === "-h" || arg === "--help") { usage(process.stdout); process.exit(0); }
    else if (arg === "-o" || arg === "--out") { args.out = argv[i + 1] ?? null; i += 1; }
    else if (arg === "--title") { args.title = argv[i + 1] ?? null; i += 1; }
    else if (arg === "--theme") { args.theme = argv[i + 1] ?? null; i += 1; }
    else if (arg.startsWith("-") && arg !== "-") fail(`unknown option: ${arg}`, 2);
    else positional.push(arg);
  }
  args.template = positional[0] ?? null;
  args.input = positional[1] ?? null;
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const template of TEMPLATES.values()) {
      process.stdout.write(`${template.name.padEnd(10)} ${template.summary}\n`);
    }
    return;
  }
  if (args.template === null || args.input === null) {
    usage(process.stderr);
    process.exit(2);
  }
  const template = TEMPLATES.get(args.template);
  if (template === undefined) {
    fail(`unknown template "${args.template}" — try --list`, 2);
  }

  const inputPath = resolve(args.input);
  let text;
  try {
    text = readFileSync(inputPath, "utf8");
  } catch (error) {
    fail(`cannot read ${inputPath}: ${error.message}`, 1);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    fail(`${inputPath} is not valid JSON: ${error.message}`, 1);
  }

  let rendered;
  try {
    rendered = template.render(data);
  } catch (error) {
    fail(`template "${template.name}" failed on this data: ${error.message}`, 1);
  }

  if (args.theme !== null && !THEMES.includes(args.theme)) {
    fail(`unknown theme "${args.theme}" — themes: ${THEMES.join(", ")}`, 2);
  }

  const html = renderPage({
    title: typeof args.title === "string" && args.title !== "" ? args.title : rendered.title,
    subtitle: rendered.subtitle ?? null,
    kicker: rendered.kicker ?? null,
    toc: rendered.toc ?? null,
    body: rendered.body,
    source: data,
    template: template.name,
    theme: args.theme ?? "dark1-blue",
  });

  if (args.out === "-") {
    process.stdout.write(html);
    return;
  }
  const outPath = args.out !== null
    ? resolve(args.out)
    : inputPath.replace(/\.json$/i, "") + ".html";
  if (outPath === inputPath) {
    fail(`refusing to overwrite the input file: ${inputPath}`, 2);
  }
  try {
    writeFileSync(outPath, html);
  } catch (error) {
    fail(`cannot write ${outPath}: ${error.message}`, 1);
  }
  process.stdout.write(outPath + "\n");
}

main();
