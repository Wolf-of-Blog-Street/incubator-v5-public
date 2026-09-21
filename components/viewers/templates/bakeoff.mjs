/*
 * bakeoff.mjs — the bake-off report template.
 *
 * Input: one row per run. The report answers three questions at a glance:
 *   1. which models introduced a regression (any failed probe or failed
 *      tests in a finished run);
 *   2. whether each model was CONSISTENT across its passes (same status,
 *      same probe verdicts, same test failures every pass);
 *   3. which runs failed to finish (status "dnf", or any status other
 *      than "ok", shown verbatim).
 *
 * Input shape (be liberal: extra fields are ignored, missing fields
 * degrade to explicit placeholders, a top-level array is taken as runs):
 * {
 *   "title": "string (optional)",
 *   "runs": [
 *     {
 *       "wave": "1",                      // optional; string or number
 *       "model": "fable",                 // the model under test
 *       "pass": 1,                        // 1-based pass number
 *       "run_id": "r-abc123",             // aliases accepted: id, run
 *       "status": "ok" | "dnf",           // anything not "ok" = did not finish
 *       "duration_s": 754,                // aliases: duration_ms, duration
 *                                         // (number = seconds; string = shown verbatim)
 *       "files_changed": 12,
 *       "tests": { "passed": 40, "failed": 0, "total": 40 },
 *       "probes": { "probe-name": "pass" | "fail" }   // other verdicts show verbatim
 *     }
 *   ]
 * }
 *
 * Derived semantics:
 *   run verdict   CLEAN = status ok, no probe "fail", tests.failed not > 0
 *                 FAIL  = status ok but a probe failed or tests failed
 *                 DNF   = status is not "ok" (non-"dnf" statuses verbatim)
 *   model verdict REGRESSION if any finished run is FAIL; CLEAN if every
 *                 finished run is CLEAN; NO FINISH if no run finished
 *   consistency   CONSISTENT when all runs share one status, all finished
 *                 runs have identical probe verdicts, and identical
 *                 tests.failed; otherwise MIXED with the reasons named.
 *                 A consistently failing model is CONSISTENT and
 *                 REGRESSION — the two axes are independent.
 */

import {
  asArray, asObject, badge, code, dataTable, formatDuration, h, isObj,
  mutedNote, str, textValue, tile,
} from "../lib/render.mjs";

export const name = "bakeoff";
export const summary = "bake-off runs: model-by-pass verdict matrix, consistency, DNF, probe drill-down, full runs table";

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function normalizeTests(raw) {
  if (!isObj(raw)) return null;
  const pick = (...keys) => {
    for (const key of keys) if (Number.isFinite(raw[key])) return raw[key];
    return null;
  };
  const passed = pick("passed", "pass");
  const failed = pick("failed", "fail");
  let total = pick("total");
  if (total === null && passed !== null && failed !== null) total = passed + failed;
  if (passed === null && failed === null && total === null) return null;
  return { passed, failed, total };
}

function normalizeRun(raw, index) {
  const r = asObject(raw);
  const passRaw = Number(r.pass);
  let durationS = null;
  let durationText = null;
  if (Number.isFinite(r.duration_s)) durationS = r.duration_s;
  else if (Number.isFinite(r.duration_ms)) durationS = r.duration_ms / 1000;
  else if (Number.isFinite(r.duration)) durationS = r.duration;
  else if (typeof r.duration === "string" && r.duration !== "") durationText = r.duration;
  const probes = {};
  for (const [probe, verdict] of Object.entries(asObject(r.probes))) {
    probes[probe] = typeof verdict === "string" ? verdict.toLowerCase() : str(verdict);
  }
  return {
    index,
    wave: r.wave === null || r.wave === undefined ? "" : str(r.wave),
    model: r.model === null || r.model === undefined ? "(no model)" : str(r.model),
    pass: Number.isInteger(passRaw) && passRaw >= 1 ? passRaw : null,
    runId: firstString(r.run_id, r.id, r.run),
    status: r.status === null || r.status === undefined ? "(no status)" : str(r.status),
    durationS,
    durationText,
    filesChanged: Number.isFinite(r.files_changed) ? r.files_changed : null,
    tests: normalizeTests(r.tests),
    probes,
  };
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

function runVerdict(run) {
  if (run.status !== "ok") {
    return { kind: "dnf", finished: false, failedProbes: [], testsFailed: false };
  }
  const failedProbes = Object.entries(run.probes)
    .filter(([, verdict]) => verdict === "fail")
    .map(([probe]) => probe);
  const testsFailed = run.tests !== null && Number.isFinite(run.tests.failed) && run.tests.failed > 0;
  if (failedProbes.length > 0 || testsFailed) {
    return { kind: "fail", finished: true, failedProbes, testsFailed };
  }
  return { kind: "clean", finished: true, failedProbes: [], testsFailed: false };
}

function durationLabel(run) {
  if (run.durationText !== null) return run.durationText;
  const formatted = formatDuration(run.durationS);
  return formatted === null ? null : formatted;
}

function runTitle(run, verdict) {
  const bits = [];
  if (run.runId !== null) bits.push(`run ${run.runId}`);
  const duration = durationLabel(run);
  if (duration !== null) bits.push(duration);
  if (run.filesChanged !== null) bits.push(`${run.filesChanged} files`);
  if (run.tests !== null) {
    const passed = Number.isFinite(run.tests.passed) ? run.tests.passed : "?";
    const total = Number.isFinite(run.tests.total) ? run.tests.total : "?";
    bits.push(`tests ${passed}/${total}`);
  }
  if (verdict.failedProbes.length > 0) bits.push(`failed: ${verdict.failedProbes.join(", ")}`);
  if (verdict.testsFailed) bits.push("tests failed");
  return bits.length === 0 ? null : bits.join(" · ");
}

/** The badge for one run inside the matrix. Text carries the verdict; color
 *  reinforces it; the title attribute carries the run detail. */
function verdictBadge(run) {
  const verdict = runVerdict(run);
  const title = runTitle(run, verdict);
  if (verdict.kind === "clean") return badge("ok", "clean", title);
  if (verdict.kind === "fail") {
    const label = verdict.failedProbes.length > 0
      ? `FAIL (${verdict.failedProbes.length})`
      : "FAIL (tests)";
    return badge("bad", label, title);
  }
  return badge("warn", run.status === "dnf" ? "DNF" : run.status, title);
}

// ---------------------------------------------------------------------------
// Grouping and consistency
// ---------------------------------------------------------------------------

const GROUP_SEP = "\u0000";

function groupRuns(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = run.wave + GROUP_SEP + run.model;
    if (!groups.has(key)) groups.set(key, { wave: run.wave, model: run.model, runs: [] });
    groups.get(key).runs.push(run);
  }
  for (const group of groups.values()) {
    group.runs.sort((a, b) => (a.pass ?? 1e9) - (b.pass ?? 1e9) || a.index - b.index);
    group.verdicts = group.runs.map((run) => runVerdict(run));
    group.hasRegression = group.verdicts.some((verdict) => verdict.kind === "fail");
    group.hasDnf = group.verdicts.some((verdict) => !verdict.finished);
    group.finishedCount = group.verdicts.filter((verdict) => verdict.finished).length;
    group.consistency = consistency(group);
  }
  const list = [...groups.values()];
  list.sort((a, b) =>
    (b.hasRegression - a.hasRegression) ||
    (b.hasDnf - a.hasDnf) ||
    a.wave.localeCompare(b.wave) ||
    a.model.localeCompare(b.model));
  return list;
}

function passLabel(run) {
  return run.pass === null ? "p?" : `p${run.pass}`;
}

/** MIXED with named reasons, or CONSISTENT. Compares status across all
 *  runs, probe verdicts and tests.failed across finished runs. */
function consistency(group) {
  if (group.runs.length <= 1) {
    return { consistent: true, single: true, reasons: [] };
  }
  const reasons = [];
  const statuses = new Set(group.runs.map((run) => run.status));
  if (statuses.size > 1) {
    reasons.push(`status differs (${group.runs.map((run) => `${passLabel(run)} ${run.status}`).join(", ")})`);
  }
  const finished = group.runs.filter((run) => run.status === "ok");
  if (finished.length > 1) {
    const first = finished[0];
    const probeNames = new Set();
    for (const run of finished) for (const probe of Object.keys(run.probes)) probeNames.add(probe);
    const differing = [];
    for (const probe of [...probeNames].sort()) {
      const verdicts = new Set(finished.map((run) => run.probes[probe] ?? "(absent)"));
      if (verdicts.size > 1) differing.push(probe);
    }
    if (differing.length > 0) reasons.push(`probes differ: ${differing.join(", ")}`);
    const firstFailed = first.tests === null ? null : first.tests.failed;
    const testsDiffer = finished.some((run) => {
      const failed = run.tests === null ? null : run.tests.failed;
      return failed !== firstFailed;
    });
    if (testsDiffer) reasons.push("test failures differ");
  }
  return { consistent: reasons.length === 0, single: false, reasons };
}

function consistencyBadge(group) {
  const c = group.consistency;
  if (c.single) return badge("muted", "1 run", "one run only — nothing to compare");
  if (c.consistent) return badge("ok", "CONSISTENT");
  return badge("warn", "MIXED", c.reasons.join(" · "));
}

function modelVerdictBadge(group) {
  if (group.hasRegression) return badge("bad", "REGRESSION");
  if (group.finishedCount === 0) return badge("warn", "NO FINISH");
  return badge("ok", "CLEAN");
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** The distinct pass numbers present in the data, sorted; a trailing "p?"
 *  column when any run has no usable pass number. Distinct-only keeps a
 *  bogus pass value (say 1e9) from fabricating a million columns. */
function passColumns(groups) {
  const passes = new Set();
  let unknown = false;
  for (const group of groups) {
    for (const run of group.runs) {
      if (run.pass === null) unknown = true;
      else passes.add(run.pass);
    }
  }
  const columns = [...passes].sort((a, b) => a - b);
  if (unknown) columns.push(null);
  return columns;
}

function matrixCell(group, pass) {
  const runs = group.runs.filter((run) => run.pass === pass);
  if (runs.length === 0) return h("td", { class: "ctr" }, h("span", { class: "null-value" }, "—"));
  const badges = [];
  runs.forEach((run, index) => {
    if (index > 0) badges.push(" ");
    badges.push(verdictBadge(run));
  });
  return h("td", { class: "ctr" }, badges);
}

function matrixSection(groups, columns) {
  if (groups.length === 0) return null;
  const anyWave = groups.some((group) => group.wave !== "");
  const headers = [
    ...(anyWave ? ["wave"] : []),
    "model",
    ...columns.map((pass) => ({ text: pass === null ? "p?" : `p${pass}`, class: "ctr" })),
    { text: "consistency", class: "ctr" },
    { text: "verdict", class: "ctr" },
  ];
  const rows = groups.map((group) => {
    const c = group.consistency;
    return h("tr", null,
      anyWave ? h("td", { class: "cell-id" }, textValue(group.wave === "" ? null : group.wave)) : null,
      h("td", { class: "cell-id" }, code(group.model)),
      columns.map((pass) => matrixCell(group, pass)),
      h("td", { class: "ctr" },
        consistencyBadge(group),
        c.reasons.length > 0 ? h("p", { class: "muted" }, c.reasons.join("; ")) : null),
      h("td", { class: "ctr" }, modelVerdictBadge(group)));
  });
  return h("section", { class: "card" },
    h("header", { class: "card-head" }, h("h2", { class: "card-title" }, "Model × pass matrix")),
    dataTable("matrix-table", headers, rows));
}

function probeSection(groups, columns) {
  const withProbes = groups.filter((group) =>
    group.runs.some((run) => Object.keys(run.probes).length > 0));
  if (withProbes.length === 0) return null;
  const blocks = withProbes.map((group) => {
    const probeNames = new Set();
    for (const run of group.runs) for (const probe of Object.keys(run.probes)) probeNames.add(probe);
    const headers = ["probe", ...columns.map((pass) => ({ text: pass === null ? "p?" : `p${pass}`, class: "ctr" }))];
    const rows = [...probeNames].sort().map((probe) => h("tr", null,
      h("td", { class: "cell-id" }, code(probe)),
      columns.map((pass) => {
        const runs = group.runs.filter((run) => run.pass === pass);
        if (runs.length === 0) return h("td", { class: "ctr" }, h("span", { class: "null-value" }, "—"));
        const cells = [];
        runs.forEach((run, index) => {
          if (index > 0) cells.push(" ");
          if (run.status !== "ok") { cells.push(badge("warn", "DNF")); return; }
          const verdict = run.probes[probe];
          if (verdict === undefined) cells.push(h("span", { class: "null-value" }, "—"));
          else if (verdict === "pass") cells.push(badge("ok", "pass"));
          else if (verdict === "fail") cells.push(badge("bad", "fail"));
          else cells.push(badge("neutral", verdict, "unrecognized verdict — shown verbatim"));
        });
        return h("td", { class: "ctr" }, cells);
      })));
    return [
      h("h3", { class: "sub" }, group.wave === "" ? group.model : `wave ${group.wave} · ${group.model}`),
      dataTable("probe-table", headers, rows),
    ];
  });
  return h("section", { class: "card" },
    h("header", { class: "card-head" }, h("h2", { class: "card-title" }, "Probe verdicts by pass")),
    blocks);
}

function testsCell(run) {
  if (run.tests === null) return h("td", { class: "ctr" }, h("span", { class: "null-value" }, "—"));
  const passed = Number.isFinite(run.tests.passed) ? String(run.tests.passed) : "?";
  const total = Number.isFinite(run.tests.total) ? String(run.tests.total) : "?";
  const failed = Number.isFinite(run.tests.failed) ? run.tests.failed : null;
  return h("td", { class: "ctr" },
    `${passed} / ${total}`,
    failed !== null && failed > 0 ? [" ", badge("bad", `${failed} failed`)] : null);
}

function probesCell(run) {
  const entries = Object.entries(run.probes);
  if (entries.length === 0) return h("td", null, h("span", { class: "null-value" }, "—"));
  const failed = entries.filter(([, verdict]) => verdict === "fail").map(([probe]) => probe);
  const passCount = entries.filter(([, verdict]) => verdict === "pass").length;
  const parts = [`${passCount} pass`];
  if (failed.length > 0) parts.push(`${failed.length} fail: ${failed.join(", ")}`);
  const other = entries.length - passCount - failed.length;
  if (other > 0) parts.push(`${other} other`);
  return h("td", null,
    failed.length > 0 ? h("span", { class: "prose" }, parts.join(" · ")) : parts.join(" · "));
}

function runsSection(runs) {
  if (runs.length === 0) return null;
  const anyWave = runs.some((run) => run.wave !== "");
  const headers = [
    ...(anyWave ? ["wave"] : []),
    "model", { text: "pass", class: "ctr" }, "run id", { text: "status", class: "ctr" },
    { text: "duration", class: "num" }, { text: "files", class: "num" },
    { text: "tests", class: "ctr" }, "probes",
  ];
  const rows = runs.map((run) => {
    const statusBadgeNode = run.status === "ok"
      ? badge("ok", "ok")
      : badge("warn", run.status === "dnf" ? "DNF" : run.status);
    return h("tr", null,
      anyWave ? h("td", { class: "cell-id" }, textValue(run.wave === "" ? null : run.wave)) : null,
      h("td", { class: "cell-id" }, code(run.model)),
      h("td", { class: "ctr" }, textValue(run.pass)),
      h("td", { class: "cell-id" }, run.runId === null ? h("span", { class: "null-value" }, "null") : code(run.runId)),
      h("td", { class: "ctr" }, statusBadgeNode),
      h("td", { class: "num" }, textValue(durationLabel(run))),
      h("td", { class: "num" }, textValue(run.filesChanged)),
      testsCell(run),
      probesCell(run));
  });
  return h("section", { class: "card" },
    h("header", { class: "card-head" }, h("h2", { class: "card-title" }, "All runs")),
    dataTable("runs-table", headers, rows));
}

function summaryTiles(runs, groups) {
  const verdicts = runs.map((run) => runVerdict(run));
  const cleanRuns = verdicts.filter((verdict) => verdict.kind === "clean").length;
  const failRuns = verdicts.filter((verdict) => verdict.kind === "fail").length;
  const dnfRuns = verdicts.filter((verdict) => !verdict.finished).length;
  const regressed = groups.filter((group) => group.hasRegression).length;
  const consistent = groups.filter((group) => group.consistency.consistent).length;
  return h("div", { class: "tiles" },
    tile("models", groups.length, "models"),
    tile("runs", runs.length, "runs"),
    tile("clean-runs", cleanRuns, "clean runs", cleanRuns === runs.length && runs.length > 0 ? "ok" : null),
    tile("regression-models", regressed, "models with regression", regressed > 0 ? "bad" : "ok"),
    tile("dnf-runs", dnfRuns, "runs DNF", dnfRuns > 0 ? "warn" : "ok"),
    tile("consistent-models", `${consistent}/${groups.length}`, "models consistent", consistent === groups.length && groups.length > 0 ? "ok" : "warn"),
    failRuns > 0 ? tile("fail-runs", failRuns, "runs with failures", "bad") : null);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export function render(data) {
  const doc = Array.isArray(data) ? { runs: data } : asObject(data);
  const runs = asArray(doc.runs).map((raw, index) => normalizeRun(raw, index));
  const groups = groupRuns(runs);
  const columns = passColumns(groups);
  const waves = [...new Set(runs.map((run) => run.wave).filter((wave) => wave !== ""))];
  const subtitleBits = [
    `${groups.length} model${groups.length === 1 ? "" : "s"}`,
    `${runs.length} run${runs.length === 1 ? "" : "s"}`,
  ];
  if (waves.length > 0) subtitleBits.push(`wave${waves.length === 1 ? "" : "s"} ${waves.join(", ")}`);
  const body = runs.length === 0
    ? mutedNote("No runs in the data file.")
    : [
        summaryTiles(runs, groups),
        h("div", { class: "cards" },
          matrixSection(groups, columns),
          probeSection(groups, columns),
          runsSection(runs)),
      ];
  return {
    title: typeof doc.title === "string" && doc.title !== "" ? doc.title : "bake-off report",
    subtitle: runs.length === 0 ? null : subtitleBits.join(" · "),
    body,
  };
}
