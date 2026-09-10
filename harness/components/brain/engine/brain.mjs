#!/usr/bin/env node
// brain — the PA's memory CLI. Walking skeleton per docs/design/brain-spec-v4.md.
// ZERO dependencies: node:fs, node:path, node:sqlite. Node >= 22.5.
//
// Class derivation: explicit `class:` wins (required for multi-tense entities like
// event); else `occurred:` present => record; else registry default.
// Index: <root>/.brain/index.sqlite — disposable; `brain reindex` rebuilds.

// @ts-ignore no root @types/node in this workspace; runtime is Node >= 22.5.
import { DatabaseSync } from 'node:sqlite';
// @ts-ignore no root @types/node in this workspace; runtime is Node >= 22.5.
import fs from 'node:fs';
// @ts-ignore no root @types/node in this workspace; runtime is Node >= 22.5.
import path from 'node:path';
// @ts-ignore no root @types/node in this workspace; runtime is Node >= 22.5.
import crypto from 'node:crypto';
// @ts-ignore no root @types/node in this workspace; runtime is Node >= 22.5.
import { fileURLToPath } from 'node:url';

// node:sqlite is a deliberate, pinned dependency — its ExperimentalWarning informs no one
// and pushes consumers toward output filtering (the example-pa gate caught a PA piping every
// read through `grep -v ExperimentalWarning`, 2026-08-05). Node prints warnings on nextTick
// through the bootstrap 'warning' listener, so replacing it here (same tick as the import)
// suppresses exactly this one warning; every other warning still reaches Node's own printer.
{
  const prior = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w && w.name === 'ExperimentalWarning' && /SQLite/i.test(String(w.message))) return;
    for (const l of prior) l(w);
  });
}

// ===== SECTION: SEED =====

// ---------- registry seed (v2: embedded; graduates to .brain/registry.md) ----------
// 'ref' (entity-ref-fields epic): a plain-string profile field whose value NAMES a card.
// No value/format change — the type only drives the entity-echo checks (write-time guard +
// doctor audit). An optional `entities=` restriction narrows which card entities satisfy it.
const PROFILE_TYPES = new Set(['text', 'select', 'multi', 'list', 'date', 'number', 'bool', 'ref']);

const PROFILE_TYPE_LIST = [...PROFILE_TYPES].join(', ');

const ENTITY_TENSES = new Set(['card', 'future', 'record']);

const REGISTRY_TITLE_COMMENT = '# brain registry — AUTHORED TRUTH (not gitignored). Edit via `brain register`.';
const REGISTRY_SCHEMA_COMMENT = '# [entities] name = tenses · [verbs] name = past|drop [; inverse=v] [; eg=..] · [aliases] name = target ; kind=slug|verb · [profiles] entity.field = type [; required] [; enum=a|b] [; currency=CODE] [; query=..] [; lint=..] [; budget=N] · [weak] name';
const LEGACY_REGISTRY_SCHEMA_COMMENT_V2 = '# [entities] name = tenses · [verbs] name = past|drop [; inverse=v] [; eg=..] · [aliases] name = target ; kind=slug|verb · [profiles] entity.field = type [; required] [; enum=a|b] [; currency=CODE] [; query=..] [; lint=..] · [weak] name';
const LEGACY_REGISTRY_HEADER_V2 = `${REGISTRY_TITLE_COMMENT}\n${LEGACY_REGISTRY_SCHEMA_COMMENT_V2}\n# format: 2\n\n`;

// Registry slug aliases are parsed before the general guard section, so keep the pure
// filename grammar here with the seed schema. The public slugLint below supplies the
// user-facing wording; this predicate lets registry load fail closed on the same domain.
function registrySlugProblem(slug) {
  if (typeof slug !== 'string') return 'must be a string';
  if (slug !== slug.normalize('NFC')) return 'is not NFC-normalized';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return 'must use lowercase letters, digits, and hyphens and start alphanumeric';
  if (slug.length > 80) return `is ${slug.length} chars (>80)`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug)) return 'is a reserved filename';
  return null;
}

const PROFILE_STALE_MONTHS = 6;

// working-memory §4: the brief's own horizons — days not months (it rots in days), and a
// re-read-every-session size ceiling far under the generic 64KB body warn. ⚑ overridable.
const WORKING_MEMORY_STALE_DAYS = 7;
const WORKING_MEMORY_SIZE_BYTES = 8192;

const profile = (rows) => Object.fromEntries(rows.map(([name, type, extra = {}]) => [name, { type, ...extra }]));

const PERSON_PROFILE = profile([
  ['name', 'text'],
  ['aka', 'list'],
  ['relationship', 'multi', { enum: ['client', 'staff', 'partner', 'family', 'contact', 'provider', 'self'] }],
  ['tier', 'select', { enum: ['T0', 'T1', 'T2'] }],
  ['email', 'list'],
  ['phone', 'list'],
  ['city', 'text'],
  ['country', 'text'],
  ['role', 'text'],
  ['birthday', 'date'],
]);

const REGISTRY = {
  entities: {
    person:       { tenses: ['card'], profile: PERSON_PROFILE },
    // brain-convergence §3: the SUBJECT is the me card — one dedicated entity, one card
    // per store, human or agent alike; the engine finds it by entity (no config pointer;
    // user_card died unreplaced, and `user`/`agent` died with it). Schema on me is
    // NORMAL: all is free except types. The seed ships the useful starter schema — the
    // four budgeted lists inherited from `user`.
    me:           { tenses: ['card'], profile: profile([
      ['important_to',  'list', { budget: 8,  query: 'what is important to the owner?' }],
      ['likes',         'list', { budget: 12, query: 'what does the owner like?' }],
      ['dislikes',      'list', { budget: 12, query: 'what does the owner dislike?' }],
      ['working_style', 'list', { budget: 10, query: 'how does the owner like to work?' }],
    ]) },
    // brain-convergence §2: the variant register blocks died — their ontology lives in
    // the seed now, byte-exact to the rows the shipped blocks authored (authored-wins
    // makes the merge a no-op for healthy stores; doctor's seed-shadow advisory catches
    // divergence). `charter` failed the minting test and is REMOVED, never absorbed.
    'standing-order': { tenses: ['card'], profile: {} },
    attempt:      { tenses: ['record'], profile: {} },
    preference:   { tenses: ['card'], profile: {} },
    'working-memory': { tenses: ['card'], profile: {} },
    company:      { tenses: ['card'], profile: profile([
      ['name', 'text'],
      ['aka', 'list'],
      ['relationship', 'multi', { enum: ['own', 'client', 'partner', 'provider', 'authority'] }],
      ['legal_name', 'text'],
      ['jurisdiction', 'text'],
      ['tax_id', 'text'],
      ['formed', 'date'],
      ['registered_agent', 'ref', { entities: ['person', 'company'] }], // R1: names an entity → ref (guard covers it)
    ]) },
    place:        { tenses: ['card'], profile: profile([
      ['name', 'text'],
      ['address', 'text'],
      ['city', 'text'],
      ['country', 'text'],
      ['category', 'select', { enum: ['restaurant', 'office', 'home', 'school', 'venue'] }],
    ]) },
    asset:        { tenses: ['card'], profile: profile([
      ['name', 'text'],
      // ontology-cleanup §4: website folded in — an owned digital property IS an asset
      ['category', 'select', { enum: ['domain', 'equipment', 'vehicle', 'ip', 'account', 'property', 'website'] }],
      ['acquired', 'date'],
      ['cost', 'number'],
      ['currency', 'text'],
      ['registrar', 'ref', { entities: ['company'] }], // R1
      ['expires', 'date'],
      ['renews', 'bool'],
      ['url', 'text'],      // §4: moved verbatim from website — identical names keep converted values byte-for-byte
      ['platform', 'text'],
      ['hosting', 'ref', { entities: ['company', 'system'] }], // R1
    ]) },
    system:       { tenses: ['card'], profile: profile([
      ['name', 'text'],
      ['url', 'text'],
      ['category', 'select', { enum: ['platform', 'service'] }],
    ]) },
    project:      { tenses: ['card'], profile: profile([
      ['name', 'text'],
      ['started', 'date'],
    ]) },
    skill:        { tenses: ['card'], profile: profile([
      ['name', 'text'],
      ['cadence', 'text'],
      ['last_verified', 'date'],
      ['system', 'ref', { entities: ['system'] }], // R1
    ]) },
    context:      { tenses: ['card'], profile: profile([
      ['name', 'text'],      // "Wolf Network", "Project Brain"
      ['mission', 'text'],   // one line: what this world is — the roster line `brain contexts` prints
    ]) },
    reference:    { tenses: ['card'], profile: profile([
      ['name', 'text'],
      ['source', 'text'],
      ['bookmarks', 'list'],
      ['file', 'text'], // bug #22: the files verb reads profile.file/url and its hint prescribes exactly this wiring — the seed must register what the engine recommends
      ['url', 'text'],  // bug #22
    ]) },
    tool:         { tenses: ['card'], profile: profile([
      ['name', 'text'],
      ['command', 'text'],
      ['path', 'text'],
      ['data', 'text'],
      ['url', 'text'],
    ]) },
    note:         { tenses: ['card'], profile: {} },
    // brain-profiles §3: the daily log — today is a card (body --append as the day
    // unfolds); a passed day FREEZES card→record (occurred = the day it covers). One per
    // day by convention, slug memory-YYYY-MM-DD.
    memory:       { tenses: ['card', 'record'], profile: {} },
    // brain-profiles §4: one project-specific lesson — sparse by doctrine, not machinery
    // (docs/support/agent-memory-discipline.md draws the line).
    lesson:       { tenses: ['card'], profile: {} },
    conversation: { tenses: ['record'], profile: profile([
      ['channel', 'select', { enum: ['call', 'email', 'chat', 'in-person'] }],
    ]) },
    filing:       { tenses: ['record'], profile: profile([
      ['period', 'text'],
      ['cycle', 'date'], // fork-doctrine §3.1: the obligation cycle (anchor due date) this filing settled — roll's provenance stamp
    ]) },
    action:       { tenses: ['future', 'record'], profile: {} },
    decision:     { tenses: ['future', 'record'], profile: profile([
      ['outcome', 'text'],
    ]) },
    obligation:   { tenses: ['future', 'record'], profile: profile([
      ['cadence', 'text'], // §0: roll reads profile.cadence FIRST (then period) — register it so correct authoring stops tripping the unregistered-field warn; period kept for back-compat
      ['period', 'text'],
      ['payee', 'ref', { entities: ['person', 'company'] }], // R1 (new field)
      ['amount', 'number'], // M2: the money pair — a recurring duty's sum, so natural money writes stop spraying unregistered-field warns
      ['currency', 'text'], // M2: its denomination (a 3-letter ISO 4217 code, e.g. EUR/USD/GBP — V3 validates the value)
      ['expires', 'date'],  // ontology-cleanup §3: agreement folded in — the contract-term questions
      ['renews', 'bool'],   //   ("when does this lapse, does it auto-renew") ride the commitment itself
    ]) },
    event:        { tenses: ['future', 'card', 'record'], profile: profile([
      ['name', 'text'],
      ['recurs', 'bool'],
      ['location', 'ref', { entities: ['place'], required: true }], // R1: event location names a place (required)
      ['url', 'text'],
      ['duration', 'text'],
    ]) },
  },
  weakVerbs: ['about', 'mentions'],
  // future -> past conjugation (applied by `freeze`); null = dropped on freeze
  conjugate: {
    with: 'was_with', attends: 'was_there', happening_at: 'happened_at',
    discusses: 'discussed', needs: 'used', delegated: 'was_delegated',
    advances: 'advanced', contains: 'contained', waiting_on: null,
    depends_on: null, do_before: null,
    filed_by: 'filed_by', // roll's provenance edge is already past tense — kept unchanged on freeze (kills the auto-register no-past-tense warning; rider c)
    serves: 'served',
    served_by: null,
    part_of: null,
    has_part: null,
    // context-entity §3: a record's membership is history worth keeping ("this decision was
    // made in the wolf-network context"), so in_context FREEZES (unlike depends_on).
    in_context: 'was_in_context',
    includes: null,
  },
  inverses: { depends_on: 'do_before', do_before: 'depends_on', contains: 'advances', advances: 'contains', serves: 'served_by', served_by: 'serves', part_of: 'has_part', has_part: 'part_of', in_context: 'includes', includes: 'in_context' },
  // brain-convergence §2: the absorbed variant verbs are BARE verbs-map entries
  // (serialized `X = ` — no conjugation, no inverse, no eg=): that is the byte shape
  // `register --verb` authored in every existing store; any richer seed row would
  // silently diverge from it (authored-wins has NO collision machinery).
  verbs: { in_context: { example: 'wolf-tracker → in_context → wolf-network' },
    stated_by: {}, issued_by: {}, reports_to: {}, bound_by: {} }, aliases: {},
};

function cloneSeed() {
  const cloneProfile = (prof = {}) => Object.fromEntries(Object.entries(prof).map(([k, spec]) => [k, { ...spec, ...(spec.enum ? { enum: [...spec.enum] } : {}) }]));
  const cloneEntities = (entities = {}) => Object.fromEntries(Object.entries(entities).map(([k, e]) => [k, { ...e, tenses: [...(e.tenses || [])], profile: cloneProfile(e.profile) }]));
  return {
    entities: cloneEntities(REGISTRY.entities), // A9: fallback registry is process-local; seed profiles stay cloned.
    weakVerbs: [...(REGISTRY.weakVerbs || [])],
    conjugate: { ...(REGISTRY.conjugate || {}) },
    inverses: { ...(REGISTRY.inverses || {}) },
    verbs: Object.fromEntries(Object.entries(REGISTRY.verbs || {}).map(([k, v]) => [k, { ...(v || {}) }])),
    aliases: Object.fromEntries(Object.entries(REGISTRY.aliases || {}).map(([k, v]) => [k, { ...(v || {}) }])),
    _unparseable: [], _integrity: [],
  };
}

const SERIALIZE_REGISTRY_DEPS = { checkReg: (_reg) => {} };

// Numeric scalars use a marker because the Markdown subset otherwise has no typed-number
// syntax. The marker is decoded ONLY when this file-level stamp is present: pre-codec
// hand-authored text such as `@brain-number(123)` must remain literal forever.
const SCALAR_CODEC_FIELD = '_brain_scalar_codec';
const SCALAR_CODEC_VERSION = 'number-v1';


// spec §2 legal top-level frontmatter fields (scalars + the four block fields). Any key
// outside this set is ALIEN: `check` SIGNALS it (never blocks, bug #27), `lint` FAILS on
// it (import-readiness gate). The block fields carry their own structured shapes.
const KNOWN_FM_FIELDS = new Set(['entity', 'class', 'description', 'date_created', 'date_updated',
  'status', 'due', 'occurred', 'expires', 'renews', 'important', 'visibility', 'superseded_by',
  'votes', 'created_by', SCALAR_CODEC_FIELD, 'profile', 'relations', 'updated', 'focus']);

const FM_KEY_RE = /^[\w.-]+$/;

// record-status-revert amendment (operator ruling, 2026-07-25): archived is the ONLY status hidden
// from the default search/list/count cohort — the single deliberate hiding mechanism, a
// door not a wall (--all opens the archive; mirrors the repo-level archive/ doctrine).
// done/dropped/superseded/dissolved/winding-down are visible history that says so on the
// row. `terminal` marks the freeze outcomes + the freeze-bypass warns only.
const STATUS = { open: {}, waiting: {}, done: { terminal: true },
  dropped: { terminal: true }, superseded: { terminal: true },
  archived: { excluded: true }, 'winding-down': {}, dissolved: {} };

const DOCUMENTED_STATUS = new Set(Object.keys(STATUS));

const DOCUMENTED_STATUS_LIST = Object.keys(STATUS).join(', ');

const TERMINAL_STATUSES = new Set(Object.entries(STATUS).filter(([, spec]) => spec.terminal).map(([name]) => name));

const TERMINAL_STATUS_SQL = [...TERMINAL_STATUSES].map(s => `'${s}'`).join(',');

const EXCLUDED_SET = new Set(Object.entries(STATUS).filter(([, spec]) => spec.excluded).map(([name]) => name));

const EXCLUDED = [...EXCLUDED_SET].sort().map(s => `'${s}'`).join(',');

const defaultCohortSQL = (a = 'n') => `(${a}.status IS NULL OR ${a}.status NOT IN (${EXCLUDED}))`;

// availability reads (skills --for / tools --for) hide the archive AND superseded — an
// attached-but-retired card is not a live option. Stricter than defaultCohortSQL, which
// is the door-not-a-wall list default (archive only).
const AVAILABILITY_COHORT_SQL = (a = 'n') => `(${a}.status IS NULL OR ${a}.status NOT IN ('archived','superseded'))`;

// wave-2 F7: THE one live-context predicate. Loading (context), active-set validation
// and pruning (activeContexts, implicit focus included), and the contexts roster must
// agree on what a live context is: entity 'context', neither archived nor superseded.
const LIVE_CONTEXT_SQL = (a = 'n') => `${a}.entity='context' AND ${AVAILABILITY_COHORT_SQL(a)}`;

// The to-do surfaces (futures cockpit, outbox) and every open-future consumer (blocker
// walk, duplicate/obligation detectors, workability) are OPEN-ONLY BY DEFINITION — a
// terminal or shelved future is not to-do. That is scope, not hiding; deliberately NOT
// the default read cohort above.
const OPEN_ONLY_HIDDEN = new Set(['done', 'dropped', 'superseded', 'archived', 'dissolved']);

for (const s of OPEN_ONLY_HIDDEN) if (!DOCUMENTED_STATUS.has(s)) throw new Error(`OPEN_ONLY_HIDDEN names '${s}' which is not a STATUS`);

const openFutureSQL = (a = 'n') => `(${a}.status IS NULL OR ${a}.status NOT IN (${[...OPEN_ONLY_HIDDEN].map(s => `'${s}'`).join(',')}))`;

const LOCKS = [
  { rel: '.brain/reindex.lock', staleMs: 1800000 },
  { rel: '.brain/index.swap', staleMs: 1800000 },
  { rel: '.brain/index.lock', staleMs: 30000 },
  { rel: '.brain/registry.lock', staleMs: 30000 },
  { rel: '.brain/dirty.lock', staleMs: 30000 },
  { relGlob: '.brain/readers/*.lock', staleMs: 1800000 },
  { relGlob: '.brain/locks/*.lock', staleMs: 30000 },
];

const lockSpec = (rel) => LOCKS.find(l => l.rel === rel);
const lockSpecForPath = (p) => LOCKS.find(l => (l.rel && p.endsWith(l.rel)) ||
  (l.relGlob && p.includes(`${path.sep}${path.dirname(l.relGlob).split('/').join(path.sep)}${path.sep}`) && p.endsWith(path.basename(l.relGlob).slice(1))));

const FIELD_TYPES = {
  due: 'datetime-or-date',
  occurred: 'date',
  date_created: 'date',
  date_updated: 'date',
  expires: 'date',
  renews: 'bool',
  superseded_by: 'slug-ref',
  important: 'bool',
  description: 'text',
  status: 'status',
  visibility: 'text',
  entity: 'entity',
  class: 'tense',
};

const FIELD_ORDER = ['entity', 'class', 'description', 'date_created', 'date_updated', 'status',
  'due', 'occurred', 'expires', 'renews', 'important', 'visibility', 'superseded_by', 'votes', 'created_by', SCALAR_CODEC_FIELD];

const COHORT_FILTER_FLAGS = ['entity', 'class', 'status', 'important', 'profile', 'edge',
  'occurred-from', 'occurred-to', 'due-from', 'due-to', 'created-from', 'created-to'];

// the §2 top-level fields that are SCALARS (never lists) — a list value where a scalar is
// expected is a type mismatch `lint` rejects (bug #27). important is bool (checked apart).
const SCALAR_FM_FIELDS = new Set(['entity', 'class', 'description', 'date_created', 'date_updated',
  'status', 'due', 'occurred', 'expires', 'renews', 'visibility', 'superseded_by', 'votes', 'created_by', SCALAR_CODEC_FIELD]);

const TEXT_FM_FIELDS = new Set([...SCALAR_FM_FIELDS].filter(f => f !== 'renews'));


// strict relations-item shape (bug #5a): each item is {"<verb>": "<target>", "why"?}.
// The VERB IS THE KEY — a {"verb":"x","to":"y"} shape stores an edge whose verb is
// literally 'to' (edgesOf takes the last non-why key). Reject that at intake with a
// teaching error, not silently. Only untrusted intake (apply/new inline relations)
// reaches here; applyOp's own link builds a well-formed item.
const RESERVED_REL_KEYS = new Set(['verb', 'to', 'target', 'from']);
const RESERVED_REL_VERBS = new Set([...RESERVED_REL_KEYS, 'why']);

const APPLY_OP_ENVELOPE_KEYS = new Set(['op', 'id', 'slug', 'force', 'base_hash']);

const APPLY_OP_ALLOWED_KEYS = {
  set: new Set(['field', 'to', 'del']),
  link: new Set(['verb', 'to', 'why']),
  unlink: new Set(['verb', 'to', 'rawTo']),
  push: new Set(['x', 'y', 'from', 'why', 'record']),
  body: new Set(['body', 'append', 'clear']),
  vote: new Set(['up', 'down', 'why']),
  freeze: new Set(['occurred', 'outcome']),
  forget: new Set(),
};

// Keep write-op classification available to intake code before the generated VERBS
// table is declared. Section ordering forbids the WRITE implementation from reaching
// down into that later generated table, and this closed set is also the strict apply
// protocol surface (not every future top-level write automatically becomes embeddable).
const APPLY_WRITE_OPS = new Set(['new', ...Object.keys(APPLY_OP_ALLOWED_KEYS)]);

const NEW_OP_KEYS = new Set(['op', 'id', 'slug', 'entity', 'description', 'class', 'due', 'occurred', 'status', 'profile', 'relations', 'updated', 'body', 'date_created', 'date_updated', 'superseded_by', 'force']);

const NEW_OP_INLINE_HELP = (() => {
  const req = ['entity', 'description'].filter(k => NEW_OP_KEYS.has(k));
  const opt = ['class', 'due', 'profile', 'relations', 'body', 'date_created', 'date_updated']
    .filter(k => NEW_OP_KEYS.has(k))
    .map(k => k === 'date_updated' ? 'updated' : k);
  return `${req.join('/')}${opt.length ? `[/${opt.join('/')}]` : ''}`.replace('/relations/', '/\n  relations/');
})();

const OP_BOOL_KEYS = { set: ['del'], body: ['append', 'clear'], vote: ['up', 'down'] }; // A3 (the focus op is retired — context-retrieval §4)


// Only root/help are truly universal. `--force` and `--base-hash` may appear before the
// verb for shell ergonomics, but are valid only for commands that actually consume them
// (plus `new --base-hash`, which deliberately reaches the tailored no-prior-version
// refusal, and register, whose mode validator teaches irrelevant modifiers).
const UNIVERSAL_FLAGS = { root: 'str', help: 'bool' };
const DEFERRED_CONTROL_FLAGS = { force: 'bool', 'base-hash': 'str' };
const PRE_VERB_FLAGS = { ...UNIVERSAL_FLAGS, ...DEFERRED_CONTROL_FLAGS };
const COMMAND_CONTROL_FLAGS = Object.freeze({
  focus: DEFERRED_CONTROL_FLAGS,
  vote: DEFERRED_CONTROL_FLAGS,
  freeze: DEFERRED_CONTROL_FLAGS,
  new: DEFERRED_CONTROL_FLAGS,
  set: DEFERRED_CONTROL_FLAGS,
  link: DEFERRED_CONTROL_FLAGS,
  unlink: DEFERRED_CONTROL_FLAGS,
  push: DEFERRED_CONTROL_FLAGS,
  body: DEFERRED_CONTROL_FLAGS,
  apply: { force: 'bool' },
  register: DEFERRED_CONTROL_FLAGS,
});
const commandControlFlags = (cmd) => Object.prototype.hasOwnProperty.call(COMMAND_CONTROL_FLAGS, cmd)
  ? COMMAND_CONTROL_FLAGS[cmd]
  : {};
const COHORT_FILTER_FLAG_TYPES = Object.fromEntries(COHORT_FILTER_FLAGS.map(f => [f, f === 'important' ? 'bool' : 'str']));
const COHORT_VERB_FLAGS = { ...COHORT_FILTER_FLAG_TYPES, fields: 'str', count: 'bool', limit: 'int', all: 'bool' };

// C-12: count takes the cohort FILTERS plus --all only — it prints numbers, so the
// list-shaped --fields/--count/--limit have no count semantics and are REJECTED (silent
// acceptance made typos and imagined behavior look successful).
const COUNT_VERB_FLAGS = { ...COHORT_FILTER_FLAG_TYPES, all: 'bool' };

// bug #5d/#72: every verb rejects unknown flags. list/count keep the richer cohort
// teaching message, backed by the same typed map used by VERBS.
const COHORT_FLAGS = new Set([...Object.keys(COHORT_VERB_FLAGS), ...Object.keys(UNIVERSAL_FLAGS)]);


const NODES_DDL = `CREATE TABLE nodes(slug TEXT PRIMARY KEY, entity TEXT, class TEXT, description TEXT,
  status TEXT, due TEXT, occurred TEXT, created TEXT, important INTEGER, votes INTEGER,
  profile_json TEXT, path TEXT, content_hash TEXT, mtime REAL, size INTEGER)`;

// bump whenever the index schema changes; a mismatch auto-rebuilds (swap-safe).
// 3→5: updates."from" column (T4, decision #66) + idx_focus partial index (focus-show fix).
// (v4 was a transient mid-wave step that already carried both; v5 forces every pen —
// whether left at v3 or v4 — to rebuild with both present.)
// 6→8: fts gains PER-SURFACE search-normalization shadow columns (nslug/ndesc/nwhys/nprof)
// — the C-3 international equivalence + CJK bigrams + number folding, one norm column per
// raw surface so a user-quoted phrase can't falsely match ACROSS surface boundaries (a
// single combined norm column made the last token of one surface phrase-adjacent to the
// first of the next). Rebuilds from Markdown, no data change.
// 8→9: same tables, new DERIVED FTS payload — authored why/profile values and the raw/body
// normalization shadow now carry position boundaries, and body normalization uses the
// international/conservative-number transform. Existing v8 indexes must rebuild or they
// retain false phrases and wrong/missing --deep hits (FB-4/5/6).
// 9→10: same tables, new typed-number profile/index semantics. A file-level number codec
// stamp makes @brain-number(...) values real JSON numbers (including -0) in profile_json;
// rebuilding prevents a v9 string-typed row from serving the wrong profile cohort.
// 10→11: same tables, corrected VCS-conflict semantics. Rebuild so a jj diff/snapshot
// whole-file conflict indexed by an older engine cannot remain a live body-only row.
// 11→12: the focus_why/focus_since columns and idx_focus are GONE (context-retrieval §4 —
// the focus: block model retired; focus is membership: in_context → focus). Rebuilds from
// Markdown; legacy focus: blocks stay byte-faithful in source and rank nothing.
// 12→13: nodes gains the votes INTEGER column (brain-profiles §5 — the string-canonical
// frontmatter scalar casts ONCE at index time, never per query; COALESCE(votes,0) orders).
const SCHEMA_VERSION = '13';

// Authored card history is deliberately bounded rather than auto-archived. The near-cap
// threshold is the Example PA contract's 90% advisory point; neither advisory blocks a
// write, while a push beyond the hard cap evicts exactly the oldest FILO entry.
const UPDATED_CAP = 200;
const UPDATED_NEAR_CAP = Math.ceil(UPDATED_CAP * 0.9);

// registry file format (H4): bump when a shipped seed FIX must reconcile into existing
// installs. A file stamped older than this reconciles on load (seed wins for prebuilt
// rows), then re-saves at the current format. REG_PARSE_ERROR latches a corrupt
// registry so reindex/autoRebuild REFUSE (else the seed-fallback bakes corpus-wide).
// v3: reference gains file/url seed fields (bug #22 — the files verb's prescribed wiring).
const REG_FORMAT = 3;

// ===== SECTION: CTX =====
// ---------- errors + output plumbing ----------
// die() THROWS (never process.exit) so batch can catch per-op and keep streaming;
// the top-level dispatcher catches BrainError and exits(1) with the message.
class BrainError extends Error {}

function die(msg) { throw new BrainError(msg); }

// OWNER calendar date (NOT UTC, NOT the process TZ) — an evening event must not roll
// to tomorrow (UTC+1 vs UTC-5), and a migration run on a US server must
// stamp the owner's local date, not the box's. The owner timezone (IANA) comes from
// brain/__meta/config.json, loaded once (H17); absent ⇒ process TZ. Records are
// write-frozen, so a wrong `occurred` is permanent — this is load-bearing.
function localDate(tz, d = new Date()) { return d.toLocaleDateString('en-CA', tz ? { timeZone: tz } : undefined); }

function localTime(tz, d = new Date()) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...(tz ? { timeZone: tz } : {}) });
}

// Weekday derives from the ctx.today() DATE STRING (not the wall clock), so a stubbed or
// owner-zone date always agrees with its own weekday. Calendar weekday is TZ-independent
// once the date is fixed — noon UTC dodges every DST edge. Agents must never do weekday
// arithmetic in their heads (a PA labeled a Saturday "Friday" — the example-pa gate, 2026-08-05).
function weekdayOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

function todayStamp(ctx) { const t = ctx.today(); return `today: ${t} ${weekdayOf(t)} (${ctx.tz ? ctx.tz : 'process tz — no OWNER_TZ configured'}, ${localTime(ctx.tz)})`; }

function metaConfigPath(root) { return path.join(root, 'brain', '__meta', 'config.json'); }

// Raw config probe for keys the ctx no longer carries (context-entity §6 case 2: role_card
// left openBrain, so the stale-key check cannot ride ctx). Malformed/absent config = no key.
function rawConfigHasKey(root, key) {
  try { const c = JSON.parse(fs.readFileSync(metaConfigPath(root), 'utf8')); return !!c && Object.prototype.hasOwnProperty.call(c, key); }
  catch { return false; }
}

function childCtx(ctx, io) {
  const c = { ...ctx, io };
  Object.defineProperty(c, 'db', { get: () => ctx.db, set: (v) => { ctx.db = v; } }); // bug #88
  Object.defineProperty(c, 'readerLease', { get: () => ctx.readerLease, set: (v) => { ctx.readerLease = v; } });
  Object.defineProperty(c, 'dirtyChecked', { get: () => ctx.dirtyChecked, set: (v) => { ctx.dirtyChecked = v; } }); // bug #88
  return c;
}

// ---------- root + db ----------
function findRoot() {
  if (process.env.BRAIN_ROOT) return path.resolve(process.env.BRAIN_ROOT);
  let d = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(d, 'brain'))) return d;
    const up = path.dirname(d);
    if (up === d) die(`no brain/ found from ${process.cwd()} (set BRAIN_ROOT or --root)`);
    d = up;
  }
}

// ===== SECTION: FS-PRIMITIVES =====
// bug #25: genuinely unparseable registry lines, captured verbatim at parse time and
// re-emitted under a fix-by-hand marker on save (never silently dropped — the registry is
// authored truth). Refreshed by loadRegistry/saveRegistry; doctor reports it (signal-only).
function schemaVersion(db) {
  try { return db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get()?.value ?? null; }
  catch { return null; } // no meta table = a pre-wave-3 index
}

function openDb(ctx) {
  if (ctx.db) return ctx.db;
  const { root } = ctx;
  const dir = path.join(root, '.brain');
  fs.mkdirSync(dir, { recursive: true });
  const acquiredHere = !ctx.readerLease;
  acquireIndexReader(ctx);
  let db = null;
  try {
    db = new DatabaseSync(path.join(dir, 'index.sqlite'));
    // busy_timeout FIRST — a WAL-mode conversion (or a concurrent writer) needs an
    // exclusive moment; without the timeout set, that first statement fails instantly
    // instead of waiting for the other session (operator + sweep + gardener are concurrent).
    // busy_timeout raised 5s→10s (bug #10-lite): full sweeps ran 12–54s under 10 concurrent
    // agents and blew the old 5s wait → uncaught 'database is locked'. The sweep also
    // self-retries (withBusyRetry); deep concurrency hardening is stress round 2.
    db.exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;`);
    ctx.db = db;
    return db;
  } catch (e) {
    try { db?.close(); } catch { /* malformed/unopened handle */ }
    if (acquiredHere) releaseIndexReader(ctx);
    throw e;
  }
}

// Closing a cached handle while retaining the context lease is deliberate. Several write
// paths reopen by pathname while holding index.lock; keeping the lease lets that command
// finish on the old generation while a swap gate drains it, without a gate↔index deadlock.
function closeDb(ctx) {
  if (!ctx?.db) return;
  try { ctx.db.close(); } catch { /* malformed/already-closed handle */ }
  ctx.db = null;
}

// bug #10-lite: a SQLite busy/locked error (a concurrent writer holding the lock past the
// timeout) — recognized so the sweep can retry and main() can teach instead of stack-trace.
function isBusyErr(e) { return e && e.code === 'ERR_SQLITE_ERROR' && /lock|busy/i.test(String(e.message || '')); }

function withBusyRetry(db, fn, tries = 5) {
  for (let i = 0; ; i++) {
    try { return fn(); }
    catch (e) {
      if (!isBusyErr(e) || i >= tries) throw e;
      try { db.exec('ROLLBACK'); } catch { /* no open txn */ }
      console.error(`⚠ index busy (another session is writing) — retry ${i + 1}/${tries} in ${(i + 1) * 200}ms…`);
      sleepMs((i + 1) * 200);
    }
  }
}

function hasIndex(db) { return !!db.prepare(`SELECT name FROM sqlite_master WHERE name='nodes'`).get(); }

// read verbs REQUIRE a built index — and must never leave a misleading empty
// index.sqlite behind when there is none (don't create the file just to fail).
// blocking sleep (zero-dep) — losers polling for the winner's rebuild.
function sleepMs(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const t = Date.now(); while (Date.now() - t < ms) { /* spin */ } } }

// Locks carry a per-acquisition token as well as the holder PID. The inode captured from
// the atomically-created lock directory closes the release race: a delayed prior holder
// can never unlink a successor that now occupies the same pathname. A live holder is never stolen merely
// because its critical section exceeded staleMs; age is only a fallback for malformed
// legacy/hand-authored lockfiles whose holder cannot be identified.
const HELD_LOCKS = new Map();

function parseLockOwner(text) {
  const raw = String(text || '').trim();
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && Number.isSafeInteger(v.pid) && v.pid > 0)
      return { pid: v.pid, token: typeof v.token === 'string' ? v.token : null };
  } catch { /* legacy format below */ }
  const pid = +raw.split(/\s+/)[0];
  return { pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null, token: null };
}

function inspectLock(p) {
  const stat = fs.lstatSync(p);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(p);
    // Token-scoped names make the destructive claim itself ownership-specific. A
    // delayed releaser looking for owner.<old-token> cannot rename a successor's owner.
    // `owner` and its claim suffix retain compatibility with the first tokenized build.
    const ownerNames = entries.filter(name => name === 'owner' ||
      /^owner\.\d+\.[a-f0-9]{32}$/.test(name) ||
      /^owner\.[a-f0-9]{32}$/.test(name));
    const ownerPaths = ownerNames.map(name => path.join(p, name));
    const ownerPath = ownerPaths.length === 1 ? ownerPaths[0] : null;
    let owner = { pid: null, token: null };
    let ownerExists = false;
    const ownerRecords = [];
    for (const candidate of ownerPaths) {
      try { ownerRecords.push({ ...parseLockOwner(fs.readFileSync(candidate, 'utf8')), path: candidate }); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (ownerPath && ownerRecords.length === 1) { owner = ownerRecords[0]; ownerExists = true; }
    // A stalled initializer can briefly leave two token-specific children in a replaced
    // directory. Never collapse that ambiguity to "no pid" when either named holder is
    // confirmed live; age alone must not authorize removal of its lock.
    const hasLiveOwner = ownerRecords.some(record => record.pid && pidAlive(record.pid));
    return { ...owner, kind: 'dir', dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs,
      ownerPath, ownerPaths: ownerRecords.map(record => record.path), ownerRecords, ownerExists, hasLiveOwner };
  }
  const fd = fs.openSync(p, 'r');
  try {
    const current = fs.fstatSync(fd);
    const owner = parseLockOwner(fs.readFileSync(fd, 'utf8'));
    return { ...owner, kind: 'legacy-file', dev: current.dev, ino: current.ino, mtimeMs: current.mtimeMs };
  } finally { fs.closeSync(fd); }
}

function sameLockFile(a, b) { return !!a && !!b && a.dev === b.dev && a.ino === b.ino; }

function removeOwnedLockDirectory(p, current) {
  if (current.ownerPaths?.length > 1) {
    // Multiple dead token-specific children are a recoverable interrupted-init residue.
    // Exact-name unlinking retains the same arbitration as the normal one-owner path: if
    // any contender already removed one, this actor stops and never rmdirs by pathname.
    for (const ownerPath of current.ownerPaths) {
      try { fs.unlinkSync(ownerPath); }
      catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    }
    try { fs.rmdirSync(p); }
    catch (e) {
      if (e.code === 'ENOENT') return true;
      if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') return false;
      throw e;
    }
    return true;
  }
  if (!current.ownerExists || !current.ownerPath) {
    // A process can die after the atomic mkdir but before publishing its unique owner.
    // Reclaim only a genuinely empty stale directory. rmdir is itself the atomic test:
    // a published successor is nonempty, while an initializer whose still-empty directory
    // is removed detects the missing/replaced inode and retries without entering.
    let entries;
    try { entries = fs.readdirSync(p); }
    catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    if (entries.length) return false; // malformed/ambiguous nonempty locks fail closed
    try { fs.rmdirSync(p); }
    catch (e) {
      if (e.code === 'ENOENT') return true;
      if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') return false;
      throw e;
    }
    return true;
  }
  // The unique child name IS the atomic ownership claim. Two delayed actors may both
  // inspect the old directory, but exactly one can unlink owner.<pid>.<token>; a loser
  // sees ENOENT and stops before rmdir. If p is now a successor directory, the old
  // token-scoped child name is absent, so the delayed actor cannot touch the successor.
  try { fs.unlinkSync(current.ownerPath); }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  try { fs.rmdirSync(p); }
  catch (e) { if (e.code === 'ENOENT') return true; throw e; }
  return true;
}

function releaseOwnedLock(p, ownership) {
  let current;
  try { current = inspectLock(p); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  if (!sameLockFile(current, ownership) || current.token !== ownership.token) return false;
  if (current.kind === 'dir') return removeOwnedLockDirectory(p, current);
  fs.unlinkSync(p); // compatibility for pre-token legacy files; new successors are dirs
  return true;
}

function lockSnapshotIsStale(snapshot, spec, now = Date.now()) {
  if (snapshot.hasLiveOwner) return false;
  if (snapshot.ownerRecords?.length > 1 && snapshot.ownerRecords.every(record => record.pid))
    return snapshot.ownerRecords.every(record => !pidAlive(record.pid));
  if (snapshot.pid) return !pidAlive(snapshot.pid);
  return now - snapshot.mtimeMs > spec.staleMs;
}

function reapLockIfStale(p, spec) {
  const snapshot = inspectLock(p);
  if (!lockSnapshotIsStale(snapshot, spec)) return false;
  let current;
  try { current = inspectLock(p); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  if (!sameLockFile(current, snapshot) || current.token !== snapshot.token) return false;
  if (!lockSnapshotIsStale(current, spec)) return false;
  if (current.kind === 'dir') return removeOwnedLockDirectory(p, current);
  fs.unlinkSync(p); // one-release migration path for old engine lockfiles
  return true;
}

function acquireLockDirectory(lockPath) {
  fs.mkdirSync(lockPath); // atomic winner: EEXIST for both legacy files and lock dirs
  let created;
  try { created = fs.lstatSync(lockPath); } // capture ownership before the init-empty gap
  catch (e) {
    // A stale-empty reaper may remove this unpublished directory. It owns no critical
    // section yet, so retrying is safe and prevents an ENOENT from escaping as a crash.
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  let fd;
  let ownerPath = null;
  try {
    const token = crypto.randomBytes(16).toString('hex');
    ownerPath = path.join(lockPath, `owner.${process.pid}.${token}`);
    fd = fs.openSync(ownerPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, created: new Date().toISOString() }));
    const stat = fs.lstatSync(lockPath);
    if (!sameLockFile(stat, created)) {
      // The init-empty directory was removed/replaced while this process stalled. We may
      // have created our unique child inside a successor; retract only that child and
      // retry. Never rmdir a pathname whose captured inode no longer owns it.
      fs.closeSync(fd); fd = undefined;
      try { fs.unlinkSync(ownerPath); } catch { /* disappeared with replaced directory */ }
      return null;
    }
    return { fd, ownership: { pid: process.pid, token, kind: 'dir', dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, ownerPath } };
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ok */ } }
    if (ownerPath) { try { fs.unlinkSync(ownerPath); } catch { /* absent */ } }
    // Initialization never path-cleans the directory: after an ENOENT/replacement race,
    // that pathname may already belong to a successor. An ownerless partial init fails
    // closed for hand repair rather than risking a second writer.
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// generic short-lived advisory lock: atomic mkdir, reclaim a dead/malformed-stale
// holder, run fn, then release only the acquisition this call actually owns.
// Used for the registry merge-on-save (H5) so two concurrent registrations can't
// last-wins each other. Small critical section (parse + write a tiny file).
function withLock(lockPath, fn, timeoutMs = 5000, staleMs = 30000) {
  if (HELD_LOCKS.has(lockPath)) return fn(); // synchronous same-process nesting
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const spec = lockSpecForPath(lockPath) || { staleMs };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let acquired;
    try { acquired = acquireLockDirectory(lockPath); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (reapLockIfStale(lockPath, spec)) continue; } catch { /* disappeared/unreadable: wait boundedly */ }
      if (Date.now() > deadline) die(`lock ${path.basename(lockPath)} busy — retry shortly`);
      sleepMs(40); continue;
    }
    if (!acquired) continue; // init-empty directory was replaced; retry from mkdir
    const { fd, ownership } = acquired;
    HELD_LOCKS.set(lockPath, ownership);
    try { return fn(); }
    finally {
      HELD_LOCKS.delete(lockPath);
      fs.closeSync(fd);
      try { releaseOwnedLock(lockPath, ownership); } catch { /* ownership changed/disappeared */ }
    }
  }
}

// SINGLE-FLIGHT auto-rebuild: exactly ONE process rebuilds (lockfile); every other
// process WAITS (polls meta) instead of each re-building 500k. A losing rename can't
// crash — reindex builds a pid-unique temp and renames only ITS own file.
function pidAlive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// SINGLE-FLIGHT full-rebuild lock (H19): EVERY full rebuild — explicit `reindex`,
// schema auto-rebuild, fresh bootstrap — runs its fn under this one lock, so two never
// build at once. A rebuild can take minutes, so the steal threshold is >> build time
// AND the holder PID is checked: a dead builder's lock is reclaimed immediately, a
// live one is never stolen. Losers wait and re-poll.
function withReindexLock(root, fn) {
  const lockPath = path.join(root, '.brain', 'reindex.lock');
  if (HELD_LOCKS.has(lockPath)) return fn();
  const spec = lockSpec('.brain/reindex.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 1800000; // 30-min ceiling for a waiter
  let waited = false;
  for (;;) {
    let acquired;
    try { acquired = acquireLockDirectory(lockPath); } // atomic create — winner iff this succeeds
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (reapLockIfStale(lockPath, spec || { staleMs: 1800000 })) continue; } catch { /* disappeared/unreadable: wait */ }
      if (Date.now() > deadline) die('reindex lock held too long — retry shortly');
      if (!waited) { console.error(`note: a rebuild is in progress — waiting…`); waited = true; }
      sleepMs(400); continue;
    }
    if (!acquired) continue; // init-empty directory was replaced; retry from mkdir
    const { fd, ownership } = acquired;
    HELD_LOCKS.set(lockPath, ownership);
    try { return fn(); }
    finally {
      HELD_LOCKS.delete(lockPath);
      fs.closeSync(fd);
      try { releaseOwnedLock(lockPath, ownership); } catch { /* ownership changed/disappeared */ }
    }
  }
}

function lockIsStale(p, spec) {
  return lockSnapshotIsStale(inspectLock(p), spec);
}

function indexLockPath(root) { return path.join(root, '.brain', 'index.lock'); }

function withIndexLock(root, fn, timeoutMs = 10000) {
  return withLock(indexLockPath(root), fn, timeoutMs, 30000);
}

function indexSwapPath(root) { return path.join(root, '.brain', 'index.swap'); }
function indexReadersDir(root) { return path.join(root, '.brain', 'readers'); }

function releaseReaderLeaseRecord(lease) {
  if (!lease) return;
  try { fs.closeSync(lease.fd); } catch { /* process cleanup / already closed */ }
  try { releaseOwnedLock(lease.path, lease.ownership); } catch { /* disappeared/replaced */ }
}

// A reader publishes its lease before opening SQLite, then rechecks the exclusive gate.
// If a swap won that race, the reader retracts the lease and waits. Therefore a swap sees
// every old-generation opener it must drain, while every post-gate opener waits for new.
function acquireIndexReader(ctx) {
  if (ctx.readerLease) return ctx.readerLease;
  const { root } = ctx;
  const gate = indexSwapPath(root);
  const gateSpec = lockSpec('.brain/index.swap') || { staleMs: 1800000 };
  const readers = indexReadersDir(root);
  const deadline = Date.now() + 1800000;
  fs.mkdirSync(readers, { recursive: true });
  for (;;) {
    if (fs.existsSync(gate)) {
      try { if (reapLockIfStale(gate, gateSpec)) continue; } catch { /* raced release/init */ }
      if (Date.now() > deadline) die('index swap held too long — retry shortly');
      sleepMs(40); continue;
    }
    // The shared readers directory is stable during ordinary cleanup: a departing reader
    // removes only its owned lease. Keep mkdir here as idempotent bootstrap/recovery so a
    // fresh pen or deliberate external cleanup cannot prevent atomic lease publication.
    fs.mkdirSync(readers, { recursive: true });
    const leasePath = path.join(readers, `reader.${process.pid}.${crypto.randomBytes(16).toString('hex')}.lock`);
    let acquired;
    try { acquired = acquireLockDirectory(leasePath); }
    catch (e) { if (e.code === 'EEXIST') continue; throw e; }
    if (!acquired) continue;
    const lease = { path: leasePath, ...acquired };
    if (fs.existsSync(gate)) {
      releaseReaderLeaseRecord(lease);
      try { if (reapLockIfStale(gate, gateSpec)) continue; } catch { /* raced release/init */ }
      if (Date.now() > deadline) die('index swap held too long — retry shortly');
      sleepMs(40); continue;
    }
    ctx.readerLease = lease;
    return lease;
  }
}

function releaseIndexReader(ctx) {
  if (!ctx?.readerLease) return;
  const lease = ctx.readerLease;
  ctx.readerLease = null;
  releaseReaderLeaseRecord(lease);
}

function closeBrain(ctx) {
  if (!ctx) return;
  closeDb(ctx);
  releaseIndexReader(ctx);
}

function readerLeasePaths(root) {
  const dir = indexReadersDir(root);
  if (!fs.existsSync(dir)) return [];
  try { return fs.readdirSync(dir).filter(name => name.endsWith('.lock')).map(name => path.join(dir, name)); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

function drainIndexReaders(root) {
  const spec = LOCKS.find(l => l.relGlob === '.brain/readers/*.lock') || { staleMs: 1800000 };
  const deadline = Date.now() + 1800000;
  for (;;) {
    let live = 0;
    for (const leasePath of readerLeasePaths(root)) {
      try {
        if (reapLockIfStale(leasePath, spec)) continue;
        live++;
      } catch (e) { if (e.code !== 'ENOENT') live++; }
    }
    if (!live) return;
    if (Date.now() > deadline) die('index readers did not drain before swap — retry shortly');
    sleepMs(40);
  }
}

// Gate first, readers second, index.lock last. The global order is: a rebuild enters
// reindex.lock with no cached DB/reader lease, may take and release a short schema-probe
// lease, then takes the swap gate, drains readers, and finally takes index.lock. Normal
// consumers may hold reader lease -> index.lock, but never wait for reindex.lock while
// leased. A pre-gate writer can therefore finish and release without forming a cycle.
function withIndexSwap(root, fn) {
  return withLock(indexSwapPath(root), () => {
    drainIndexReaders(root);
    return withIndexLock(root, fn, 1800000);
  }, 1800000, 1800000);
}


// ---------- indexing ----------
function hasTable(db, name) { return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?`).get(name); }


// ---------- the write side (§9.3–9.5): parse → mutate → serialize → atomic write ----------
function contentHash(text) { return crypto.createHash('sha1').update(text).digest('hex'); }

function nodePath(root, slug) { return path.join(root, 'brain', '__source', slug + '.md'); }

function forgottenDir(root) { return path.join(root, 'brain', '__forgotten'); }

// durability (H16, §9 write side): write the temp, fsync its bytes to the platter,
// rename, then fsync the containing directory so the rename itself survives a power
// cut (verified zero fsyncs before this). A dir fsync is best-effort — some FS/OS
// reject it; that's fine, the file fsync is the load-bearing one.
function fsyncDir(dir) { let fd; try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); } catch { /* dir fsync unsupported */ } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ok */ } } } }

function writeTempFsynced(dir, name, text) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, name);
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return tmp;
}

// atomic write for meta files (registry, config): same-dir temp + fsync + rename.
function atomicWrite(dest, text) {
  const tmp = writeTempFsynced(path.dirname(dest), `${path.basename(dest)}.${process.pid}.${Date.now()}.tmp`, text);
  fs.renameSync(tmp, dest);
  fsyncDir(path.dirname(dest));
  return text;
}


// crash-window self-healing (H3): file-first-index-second leaves a silent divergence
// if the process dies between the two phases. Before Phase A we drop `.brain/dirty`
// listing the touched slugs; after the index commits we remove it. On the next CLI
// open, a lingering sentinel triggers a per-slug sync (ms, not the full sweep).
function dirtyPath(root) { return path.join(root, '.brain', 'dirty'); }

function dirtyLockPath(root) { return path.join(root, '.brain', 'dirty.lock'); }

function readDirtySet(root) {
  try {
    const slugs = new Set(), invalid = [];
    for (const entry of fs.readFileSync(dirtyPath(root), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
      // The ledger is derived/recoverable state and may be hand-corrupted. Validate at
      // its one read boundary so no consumer can ever turn `../` into an out-of-source
      // stat/read/error-row path before noticing that it is not a canonical slug.
      const problem = registrySlugProblem(entry);
      if (problem) invalid.push({ entry, problem });
      else slugs.add(entry);
    }
    return { slugs, invalid, error: null };
  } catch (e) {
    if (e.code === 'ENOENT') return { slugs: new Set(), invalid: [], error: null };
    return { slugs: null, invalid: [], error: e };
  }
}

function sanitizeDirtyLedger(root) {
  withLock(dirtyLockPath(root), () => {
    const { slugs, invalid, error } = readDirtySet(root);
    if (slugs == null) throw error || new Error('could not read .brain/dirty');
    if (!invalid.length) return;
    if (slugs.size) atomicWrite(dirtyPath(root), [...slugs].join('\n') + '\n');
    else { try { fs.unlinkSync(dirtyPath(root)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  });
}

// bug #14: the dirty sentinel is a SHARED ledger of file-written-but-index-pending slugs.
// Concurrent writers MERGE their slugs in (locked read-modify-write) and remove ONLY
// their own on success — so one writer's clear can't wipe another's still-pending slug.
// (The S1 race: the winning apply's unlink erased the loser's un-indexed slug, so
// "self-heal on next open" found nothing to heal.)
function writeDirty(root, slugs) {
  if (!slugs || !slugs.length) return [];
  let added = [];
  try {
    withLock(dirtyLockPath(root), () => {
      const { slugs: s, error } = readDirtySet(root);
      if (s == null) throw error || new Error('could not read .brain/dirty');
      const addedNow = slugs.filter(x => !s.has(x)); // bug #66
      for (const x of slugs) s.add(x);
      atomicWrite(dirtyPath(root), [...s].join('\n') + '\n');
      added = addedNow;
    });
  } catch (e) {
    console.error('⚠ could not establish the crash sentinel (' + e.message + ') — if this write is interrupted before indexing, run: brain sync');
    return [];
  }
  return added;
}

// clearDirty(root, slugs) removes just those slugs; clearDirty(root) with no list clears
// the WHOLE ledger — only for full-reconcile paths (reindex, sync full sweep) that have
// already made every slug consistent.
function clearDirty(root, slugs) {
  try {
    if (slugs === undefined) {
      withLock(dirtyLockPath(root), () => { try { fs.unlinkSync(dirtyPath(root)); } catch (e) { if (e.code !== 'ENOENT') throw e; } });
      return;
    }
    if (!slugs.length) return;
    withLock(dirtyLockPath(root), () => {
      const { slugs: s } = readDirtySet(root);
      if (s == null) return;
      for (const x of slugs) s.delete(x);
      if (s.size) atomicWrite(dirtyPath(root), [...s].join('\n') + '\n');
      else { try { fs.unlinkSync(dirtyPath(root)); } catch { /* absent */ } }
    });
  } catch { /* best-effort */ }
}

// atomic: temp in .brain/tmp/ then rename (file first, index second — §9.2). CAS
// write-time re-hash (H2): if expectHash is given and the on-disk file changed since
// the caller read it, that's a concurrent write — refuse (or --force = archive the
// loser to __forgotten/ as a conflict copy, then proceed). expectHash===null means
// the caller vouched no prior version (fresh `new` uses writeNodeExclusive instead).
function nodeLockPath(root, slug) { return path.join(root, '.brain', 'locks', slug + '.lock'); }

// ===== SECTION: PARSE/SERIALIZE =====

// ---------- frontmatter: strict hand-parseable YAML subset ----------
// JavaScript's legacy `__proto__` setter is not an ordinary object property. Authored
// frontmatter/registry keys still have to parse without disappearing, so every dynamic
// key is installed as an OWN data property (never by `obj[key] = value`). Write intake
// rejects the three prototype-sensitive names below; the safe parser remains necessary
// for hand-authored/pre-fix files so an unrelated rewrite cannot erase their bytes.
const PROTOTYPE_SENSITIVE_KEYS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  return value;
}
const hasOwnKey = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);
const ownValue = (obj, key) => hasOwnKey(obj, key) ? obj[key] : undefined;

// list values are comma-separated inside [ ]; an ELEMENT that itself contains a comma
// (or a quote) is double-quoted with "" escaping, so `[a, "b,c"]` round-trips instead
// of splitting into three (H14/V6). splitList honors those quotes; quoteElem is its
// exact inverse — bare when safe (byte-identical to the pre-quote corpus), quoted only
// when the element would otherwise be mis-split.
// Numbers need an explicit representation. Historically a bare numeric token was a
// STRING (and existing authored files depend on that), while write intake also accepted
// real JSON numbers and serialized them to the same bytes. That made the two values
// indistinguishable and changed every accepted number back into a string on read. The
// private marker preserves the old bare-string meaning. A string equal to the marker is
// quoted by the string codec, so new writes remain unambiguous.
function encodeNumberScalar(n) {
  const raw = Object.is(n, -0) ? '-0' : String(n);
  return '@brain-number(' + raw + ')';
}

function decodeNumberScalar(s) {
  const m = /^@brain-number\(([^()\s]+)\)$/.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)) || encodeNumberScalar(value) !== s) return null;
  return { value };
}

function splitList(inner, typedNumbers = false) {
  const out = [];
  let cur = '', q = false, quoted = false, seen = false;
  const push = () => {
    const v = quoted ? cur : cur.trim();
    if (quoted || v !== '') {
      const number = quoted || !typedNumbers ? null : decodeNumberScalar(v);
      out.push(quoted ? v : v === 'true' ? true : v === 'false' ? false : number ? number.value : v);
    }
    cur = ''; q = false; quoted = false; seen = false;
  };
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { if (c === '"') { if (inner[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === ',') push();
    else if (c === '"' && !seen) { q = true; quoted = true; seen = true; }
    else if (c === ' ' && !seen) { /* skip the separator space before an element */ }
    else { cur += c; seen = true; }
  }
  push();
  return out;
}

// F-2: quoting also distinguishes string lookalikes from real booleans/numbers.
// Quoted list elements always decode as strings; typed values use their bare codec.
function quoteElem(e, typedNumbers = false) {
  if (typeof e === 'boolean') return String(e);
  if (typeof e === 'number' && Number.isFinite(e)) return encodeNumberScalar(e);
  const s = String(e);
  return /[,"]/.test(s) || /^\s|\s$/.test(s) || s === '' || s === 'true' || s === 'false' || (typedNumbers && decodeNumberScalar(s))
    ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// C-1/F-1: the SCALAR codec — the string half of scalar()/scalarStr must be an exact
// inverse pair. The emitter quotes any string a bare emission would mis-read on parse:
// edge whitespace (the line parser trims it), bool/list look-alikes ('true', '[a, b]'),
// and strings that are themselves a decodable quoted form. Escaping matches quoteElem
// ("" = a literal "). decode strips a quote layer ONLY when re-encoding the decoded
// value reproduces the input byte-for-byte — so a hand-authored value that merely wears
// quotes ("scare quotes" — bare emission round-trips it) stays literal, and pre-codec
// corpus bytes never silently change meaning.
function quoteScalar(s) { return '"' + s.replace(/"/g, '""') + '"'; }

function decodeQuotedScalar(v, typedNumbers = false) {
  if (v.length < 2 || v[0] !== '"' || v[v.length - 1] !== '"') return v;
  const parts = v.slice(1, -1).split('""');
  if (parts.some(p => p.includes('"'))) return v; // stray inner quote — not a codec form
  const decoded = parts.join('"');
  // strip ONLY a layer the emitter itself would have added for `decoded`: it must both
  // NEED quoting AND re-encode to exactly `v`. A pre-codec / scare-quoted corpus value
  // like `"I'll be back"` (which the emitter would leave BARE) therefore stays literal —
  // reading it must not silently drop its quotes and rewrite the stored bytes.
  return (scalarStringNeedsQuote(decoded, typedNumbers) && quoteScalar(decoded) === v) ? decoded : v;
}

function scalarStringNeedsQuote(s, typedNumbers = false) {
  if (s === '') return false; // 'key: ' round-trips to '' bare
  if (s !== s.trim()) return true; // edge whitespace incl. tab/NBSP (C-1)
  if (s === 'true' || s === 'false') return true; // would re-parse as bool (F-1)
  if (typedNumbers && decodeNumberScalar(s)) return true; // would re-parse as a typed number in a stamped file
  if (s.startsWith('[') && s.endsWith(']')) return true; // would re-parse as list (F-1)
  return decodeQuotedScalar(s, typedNumbers) !== s; // would lose a quote layer on read
}

// parse → { fm, body, bodyStart, errors }. errors[] carries out-of-subset lines, inline block
// headers, and malformed block items so indexing surfaces them (never a silent drop,
// §4). Returns null only when there is no frontmatter fence at all.
function parseFrontmatter(text) {
  if (!hasFrontmatterFence(text)) return null;
  const end = frontmatterFenceEnd(text);
  if (end === -1) return null;
  const bodyStart = end + 4;
  const openEnd = text.startsWith('---\r\n') ? 5 : 4;
  const lines = text.slice(openEnd, end).split(/\r?\n/);
  // The stamp governs the whole file even if a hand author placed it after a profile or
  // updated block, so detect it before parsing any scalar. Absent/exotic stamps leave
  // every marker-looking value as historical literal text.
  const typedNumbers = lines.some(raw => new RegExp(`^${SCALAR_CODEC_FIELD}:\\s*${SCALAR_CODEC_VERSION}\\s*$`).test(raw));
  const fm = { relations: [], updated: [], profile: {}, focus: null };
  const errors = [], _unparseable = [];
  const BLOCKS = ['profile', 'relations', 'updated', 'focus'];
  const keyLineRe = new RegExp('^(' + FM_KEY_RE.source.slice(1, -1) + '):\\s*(.*)$'); // bug #86
  let block = null, item = null, ln = 1;
  let seenBlockKeys = null, seenItemKeys = null;
  const seenTopLevel = new Set();
  const scalar = (v) => {
    v = v.trim();
    if (v.startsWith('[') && v.endsWith(']')) return splitList(v.slice(1, -1), typedNumbers);
    if (v === 'true') return true; if (v === 'false') return false;
    const number = typedNumbers ? decodeNumberScalar(v) : null; if (number) return number.value;
    return decodeQuotedScalar(v, typedNumbers); // C-1: symmetric with scalarStr's quoting
  };
  for (const raw of lines) {
    ln++;
    if (!raw.trim()) continue;
    // §9.3: frontmatter is comment-free so round-trips are exact — a '#' line can't be
    // preserved by the serializer, so surface it as a lint signal (doctor shows it)
    // instead of silently dropping it (reconcile item 8).
    if (raw.trim().startsWith('#')) { errors.push(`line ${ln}: comment '${raw.trim().slice(0, 40)}' — frontmatter is comment-free (§9.3); a serializer round-trip would drop it`); continue; }
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();
    if (indent === 0) {
      item = null;
      seenBlockKeys = null;
      seenItemKeys = null;
      const m = line.match(keyLineRe);
      if (!m) { errors.push(`line ${ln}: out-of-subset '${line.slice(0, 48)}' (expected 'key: value')`); _unparseable.push(raw); block = null; continue; }
      const [, key, val] = m;
      // A repeated scalar/block header is lossy under the object model: last-value-wins
      // parsing followed by any serializer write used to erase the first authored line.
      // Keep the first semantic value, preserve the repeated raw line, and surface a
      // lint/check error so a hand-authored ambiguity is never silently normalized away.
      if (seenTopLevel.has(key)) {
        errors.push(`line ${ln}: duplicate top-level key '${key}' — a serializer round-trip would lose one authored value`);
        _unparseable.push(raw);
        block = null;
        continue;
      }
      seenTopLevel.add(key);
      if (BLOCKS.includes(key)) {
        // `relations: []` / `updated: []` / `profile: {}` — an EMPTY block written
        // inline (the corpus does this). Keep the init default (serializer omits it);
        // only a NON-empty inline value is the real malformation.
        if (val === '[]' || val === '{}') { block = null; continue; }
        if (val) { errors.push(`line ${ln}: block header '${key}:' has an inline value — items must be indented below`); _unparseable.push(raw); block = null; continue; }
        block = key; seenBlockKeys = new Set(); if (key === 'focus') fm.focus = {};
        continue;
      }
      block = null;
      setOwn(fm, key, scalar(val));
    } else if (block === 'profile' || block === 'focus') {
      const m = line.match(keyLineRe);
      if (m && seenBlockKeys?.has(m[1])) {
        errors.push(`line ${ln}: duplicate ${block} key '${m[1]}' — a serializer round-trip would lose one authored value`);
        _unparseable.push(raw);
      }
      else if (m) {
        seenBlockKeys?.add(m[1]);
        setOwn(block === 'profile' ? fm.profile : fm.focus, m[1], scalar(m[2]));
      }
      else { errors.push(`line ${ln}: malformed ${block} entry '${line.slice(0, 48)}'`); _unparseable.push(raw); }
    } else if (block === 'relations' || block === 'updated') {
      if (line.startsWith('- ')) {
        item = {};
        seenItemKeys = new Set();
        fm[block].push(item);
        const m = line.slice(2).match(keyLineRe);
        if (m) { seenItemKeys.add(m[1]); setOwn(item, m[1], scalar(m[2])); }
        else { errors.push(`line ${ln}: malformed ${block} item '${line.slice(0, 48)}'`); _unparseable.push(raw); }
      } else if (item) {
        const m = line.match(keyLineRe);
        if (m && seenItemKeys?.has(m[1])) {
          errors.push(`line ${ln}: duplicate key '${m[1]}' in one ${block} item — a serializer round-trip would lose one authored value`);
          _unparseable.push(raw);
        }
        else if (m) { seenItemKeys?.add(m[1]); setOwn(item, m[1], scalar(m[2])); }
        else { errors.push(`line ${ln}: malformed ${block} continuation '${line.slice(0, 48)}'`); _unparseable.push(raw); }
      } else { errors.push(`line ${ln}: '${line.slice(0, 48)}' under ${block} without a leading '- '`); _unparseable.push(raw); }
    } else {
      errors.push(`line ${ln}: unexpected indented line '${line.slice(0, 48)}'`);
      _unparseable.push(raw);
    }
  }
  // C-2: `body` is the EXACT authored payload — everything past the closing fence minus
  // the ONE structural newline that separates the fence line from the payload. Never
  // trimmed: authored leading blank lines and trailing newlines are content, not noise.
  const bodyRegion = text.slice(bodyStart);
  const body = bodyRegion.startsWith('\r\n') ? bodyRegion.slice(2) : bodyRegion.startsWith('\n') ? bodyRegion.slice(1) : bodyRegion;
  return { fm, body, bodyStart, errors, _unparseable };
}


function deriveClass(reg, fm) {
  const ent = ownValue(reg.entities, fm.entity);
  if (fm.class) return fm.class;
  if (!ent) return fm.occurred ? 'record' : 'card'; // unregistered: best effort
  if (ent.tenses.length === 1) return ent.tenses[0];
  if (fm.occurred) return 'record';
  if (ent.tenses.includes('future')) return 'future';
  return 'card';
}

// relations items -> [{verb, to, why}] (skip non-verb keys)
function edgesOf(fm) {
  const out = [];
  for (const item of fm.relations || []) {
    const why = item.why || null;
    for (const [k, v] of Object.entries(item)) {
      if (k === 'why') continue;
      if (v != null) out.push({ verb: k, to: String(v), why });
    }
  }
  return out;
}

function fmHasTypedNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.some(fmHasTypedNumber);
  if (v && typeof v === 'object') return Object.values(v).some(fmHasTypedNumber);
  return false;
}

// JSON.stringify canonicalizes -0 to 0, which loses authored typed content in profile
// arrays and updated.from projections. The frontmatter codec deliberately preserves -0,
// so every derived JSON channel must do the same. This serializer handles the JSON-safe
// scalar/array/plain-object shapes admitted by the engine.
function stringifyJsonExactNumbers(v) {
  if (v === null) return 'null';
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : JSON.stringify(v);
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stringifyJsonExactNumbers).join(',') + ']';
  if (v && typeof v === 'object')
    return '{' + Object.entries(v).map(([k, value]) => JSON.stringify(k) + ':' + stringifyJsonExactNumbers(value)).join(',') + '}';
  return JSON.stringify(v);
}

function canonicalDecimalLexeme(source) {
  let s = String(source), negative = false;
  if (s[0] === '-') { negative = true; s = s.slice(1); }
  const [mantissa, exponentText] = s.toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  let digits = (whole + fraction).replace(/^0+/, '');
  let exponent = (exponentText == null ? 0 : Number(exponentText)) - fraction.length;
  if (!digits) return { zero: true, negative };
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); exponent++; }
  return { zero: false, negative, digits, exponent };
}

function analyzeJsonNumberLexeme(source) {
  const value = Number(source);
  if (!Number.isFinite(value)) return { ok: false, value, error: `JSON number literal '${source}' is not finite — use a finite number or an explicitly quoted string` };
  const rawCanonical = canonicalDecimalLexeme(source);
  if (value === 0 && !rawCanonical.zero)
    return { ok: false, value, error: `JSON number literal '${source}' underflows to zero and would lose authored magnitude — quote it as text or use a representable number; nothing written` };
  if (Number.isInteger(value) && !Number.isSafeInteger(value))
    return { ok: false, value, error: `JSON number literal '${source}' is outside JavaScript's exact safe-integer range (${Number.MIN_SAFE_INTEGER}..${Number.MAX_SAFE_INTEGER}) — quote it as text or use an exactly representable smaller number; nothing written` };
  if (!rawCanonical.zero) {
    const roundTrip = canonicalDecimalLexeme(String(value));
    if (rawCanonical.negative !== roundTrip.negative || rawCanonical.digits !== roundTrip.digits || rawCanonical.exponent !== roundTrip.exponent)
      return { ok: false, value, error: `JSON number literal '${source}' cannot round-trip exactly through the supported number codec (it would become '${String(value)}') — quote it as text or use a stable decimal; nothing written` };
  }
  return { ok: true, value };
}

function parseJsonExactNumbers(text) {
  // Node 22.5 is supported and does not consistently expose reviver context.source.
  // Scan raw number tokens outside JSON strings first, then let JSON.parse own syntax.
  // This preserves the authored lexeme needed to detect rounding/underflow on every
  // supported runtime (including nested arrays/objects).
  const numbers = [];
  let quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c !== '-' && (c < '0' || c > '9')) continue;
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m || !/^[\s,\]}]?$/.test(text[i + m[0].length] || '')) continue;
    numbers.push(m[0]);
    i += m[0].length - 1;
  }
  for (const source of numbers) {
    const analysis = analyzeJsonNumberLexeme(source);
    if (!analysis.ok) die(analysis.error);
  }
  return JSON.parse(text);
}

const scalarStr = (v, typedNumbers = false) => Array.isArray(v) ? `[${v.map(e => quoteElem(e, typedNumbers)).join(', ')}]`
  : typeof v === 'number' && Number.isFinite(v) ? encodeNumberScalar(v)
  : typeof v === 'string' && scalarStringNeedsQuote(v, typedNumbers) ? quoteScalar(v)
  : String(v); // real booleans/numbers emit bare; strings quote only when bare would mis-read (C-1/F-1)


// serializeFrontmatter — the exact inverse of parseFrontmatter, canonical field
// order, comment-free (§9.3). Emits only the inner frontmatter text (trailing \n);
// body bytes are re-attached by writeNode, never touched here.
function serializeFrontmatter(fm) {
  const lines = [];
  const ORDER = FIELD_ORDER;
  const BLOCK = new Set(['profile', 'relations', 'updated', 'focus']);
  const typedNumbers = fm[SCALAR_CODEC_FIELD] === SCALAR_CODEC_VERSION || fmHasTypedNumber(fm);
  const emit = (k, v) => { if (v != null) lines.push(`${k}: ${scalarStr(v, typedNumbers)}`); };
  for (const k of ORDER) if (!BLOCK.has(k)) {
    if (k === SCALAR_CODEC_FIELD) {
      if (typedNumbers) emit(k, SCALAR_CODEC_VERSION);
      else if (k in fm) emit(k, fm[k]);
    } else if (k in fm) emit(k, fm[k]);
  }
  for (const k of Object.keys(fm)) if (!ORDER.includes(k) && !BLOCK.has(k) && k !== '_unparseable') emit(k, fm[k]); // other scalars
  if (fm._unparseable?.length) fm._unparseable.forEach(raw => lines.push(raw));
  // block headers emitted ONLY when non-empty — the corpus omits empty blocks, and
  // parse() maps an absent block to the same {}/[] a present-but-empty one gives, so
  // omitting is the exact inverse (an empty header would grow the file on every write).
  if (fm.profile && Object.keys(fm.profile).length) {
    lines.push('profile:');
    for (const [k, v] of Object.entries(fm.profile)) lines.push(`  ${k}: ${scalarStr(v, typedNumbers)}`);
  }
  if (fm.relations?.length) {
    lines.push('relations:');
    for (const item of fm.relations)
      Object.entries(item).forEach(([k, v], i) => lines.push(`${i === 0 ? '  - ' : '    '}${k}: ${scalarStr(v, typedNumbers)}`));
  }
  if (fm.updated?.length) {
    lines.push('updated:');
    for (const item of fm.updated)
      Object.entries(item).forEach(([k, v], i) => lines.push(`${i === 0 ? '  - ' : '    '}${k}: ${scalarStr(v, typedNumbers)}`));
  }
  if (fm.focus) { lines.push('focus:'); for (const [k, v] of Object.entries(fm.focus)) lines.push(`  ${k}: ${scalarStr(v, typedNumbers)}`); }
  return lines.join('\n') + '\n';
}

function parseRegistry(text) {
  if (!text || !text.trim()) throw new Error('empty registry file');
  // Example PA stores written by the immediately previous format-2 serializer have one
  // finite, known header: the current title followed by the pre-budget schema comment.
  // Gate the legacy comment on the complete byte-exact header prefix so a copied comment,
  // reordered line, CRLF variant, or near miss remains authored truth needing repair.
  const hasExactLegacyHeaderV2 = text.startsWith(LEGACY_REGISTRY_HEADER_V2)
    && text[LEGACY_REGISTRY_HEADER_V2.length] === '[';
  const reg = { entities: {}, conjugate: {}, inverses: {}, weakVerbs: [], verbs: {}, aliases: {}, _format: 0, _unparseable: [], _integrity: [] };
  const ROW_SECS = new Set(['entities', 'verbs', 'aliases', 'profiles']);
  const seenRows = Object.fromEntries([...ROW_SECS].map(s => [s, new Map()]));
  const seenWeak = new Map();
  const seenCanonicalComments = new Map();
  let sec = null;
  let formatLine = null;
  // bug #25: a line that yields NO row is genuinely unparseable — capture it verbatim so
  // doctor can identify it. Registry serialization is blocked while any such line exists:
  // moving it into a canonical section is not byte- or meaning-preserving, especially for
  // syntax introduced by a newer engine. Unknown sections include their header here too.
  const bad = (section, line) => reg._unparseable.push({ section: ROW_SECS.has(section) ? section : '', line });
  const integrity = (ln, message) => reg._integrity.push(`line ${ln}: ${message}`);
  const markRow = (section, name, ln) => {
    const prior = seenRows[section].get(name);
    if (prior != null) integrity(ln, `duplicate [${section}] row '${name}' (first at line ${prior})`);
    else seenRows[section].set(name, ln);
  };
  const markAttr = (seen, section, name, key, seg, ln, allowed) => {
    if (!allowed.has(key)) { integrity(ln, `[${section}] row '${name}' has unknown inline attribute '${seg}'`); return false; }
    if (seen.has(key)) integrity(ln, `[${section}] row '${name}' repeats inline attribute '${key}'`);
    else seen.add(key);
    return true;
  };
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const ln = i + 1;
    const line = raw.trim();
    if (line.startsWith('#')) {
      // Every format-like declaration is security-relevant. Taking the first numeric
      // stamp allowed a later `# format: 99` to be erased by an old engine. The maximum
      // numeric stamp makes ANY future declaration fail closed; duplicates/malformed
      // declarations are rewrite blockers because their intent is ambiguous.
      if (/^#\s*format\b/i.test(line)) {
        if (formatLine != null) integrity(ln, `duplicate format declaration (first at line ${formatLine})`);
        else formatLine = ln;
        const fm = line.match(/^#\s*format\s*:\s*(\d+)\s*$/i);
        if (!fm) integrity(ln, `malformed format declaration '${line}' (expected '# format: <integer>')`);
        else reg._format = Math.max(reg._format, Number(fm[1]));
      }
      else {
        const commentIdentity = line === '# brain registry' || line === REGISTRY_TITLE_COMMENT
          ? 'registry title'
          : line === REGISTRY_SCHEMA_COMMENT || (hasExactLegacyHeaderV2 && line === LEGACY_REGISTRY_SCHEMA_COMMENT_V2)
            ? 'registry schema'
            : null;
        if (line === '# UNPARSEABLE — fix by hand:')
          integrity(ln, `legacy unparseable marker requires hand repair (the current engine never relocates unknown syntax)`);
        else if (!commentIdentity) integrity(ln, `authored comment '${line}' has no lossless position in the canonical registry format`);
        else {
          const prior = seenCanonicalComments.get(commentIdentity);
          if (prior != null) integrity(ln, `duplicate canonical ${commentIdentity} comment (first at line ${prior})`);
          else seenCanonicalComments.set(commentIdentity, ln);
        }
      }
      continue;
    }
    if (!line) continue;
    const s = line.match(/^\[(\w+)\]$/);
    if (s) {
      sec = s[1];
      if (!ROW_SECS.has(sec) && sec !== 'weak') bad('', raw);
      continue;
    }
    if (sec === 'weak') {
      const prior = seenWeak.get(line);
      if (prior != null) integrity(ln, `duplicate [weak] row '${line}' (first at line ${prior})`);
      else seenWeak.set(line, ln);
      reg.weakVerbs.push(line);
      continue;
    }
    if (!ROW_SECS.has(sec)) { bad(sec, line); continue; }       // no known row-section context
    const eq = line.indexOf('='); if (eq < 0) { bad(sec, line); continue; } // no name=value shape
    const name = line.slice(0, eq).trim();
    if (!name) { bad(sec, line); continue; }                    // empty name — garbage
    const segs = line.slice(eq + 1).split(';').map(x => x.trim());
    if (sec !== 'profiles') markRow(sec, name, ln);
    if (sec === 'entities') {
      const prior = ownValue(reg.entities, name) || {};
      setOwn(reg.entities, name, { ...prior, tenses: segs[0].split(',').map(x => x.trim()), profile: prior.profile || {} });
      for (const seg of segs.slice(1)) integrity(ln, `[entities] row '${name}' has unknown inline attribute '${seg}'`);
    }
    else if (sec === 'verbs') {
      setOwn(reg.verbs, name, {});
      // Empty is an authored tombstone: it clears a prior/shipped conjugation and must
      // survive the seed merge on the next process open. Absence cannot express that.
      setOwn(reg.conjugate, name, segs[0] === 'drop' ? null : segs[0]);
      const seen = new Set();
      for (const seg of segs.slice(1)) {
        const am = /^([^=]+)=(.*)$/.exec(seg);
        if (!am) { integrity(ln, `[verbs] row '${name}' has unknown inline attribute '${seg}'`); continue; }
        const key = am[1].trim();
        if (!markAttr(seen, 'verbs', name, key, seg, ln, new Set(['inverse', 'eg']))) continue;
        // Same tombstone rule for inverse=: retain the own empty property so union/save
        // and the shipped seed cannot resurrect the cleared mapping.
        if (key === 'inverse') setOwn(reg.inverses, name, am[2].trim());
        else setOwn(reg.verbs[name], 'example', am[2].trim());
      }
    } else if (sec === 'aliases') {
      let kind = 'slug'; const seen = new Set();
      for (const seg of segs.slice(1)) {
        const am = /^([^=]+)=(.*)$/.exec(seg);
        if (!am) { integrity(ln, `[aliases] row '${name}' has unknown inline attribute '${seg}'`); continue; }
        const key = am[1].trim();
        if (!markAttr(seen, 'aliases', name, key, seg, ln, new Set(['kind']))) continue;
        kind = am[2].trim();
      }
      setOwn(reg.aliases, name, { to: segs[0], kind });
    } else if (sec === 'profiles') {
      const dot = name.indexOf('.');
      const type = segs[0];
      if (dot <= 0 || dot === name.length - 1 || !PROFILE_TYPES.has(type)) { bad('profiles', line); continue; }
      const entity = name.slice(0, dot).trim();
      const field = name.slice(dot + 1).trim();
      if (!entity || !field) { bad('profiles', line); continue; }
      const canonicalName = `${entity}.${field}`;
      markRow('profiles', canonicalName, ln);
      if (name !== canonicalName)
        integrity(ln, `[profiles] row identity '${name}' is noncanonical spacing for '${canonicalName}'`);
      const spec = { type };
      const seen = new Set();
      for (const seg of segs.slice(1)) {
        const am = /^([^=]+)=(.*)$/.exec(seg);
        if (seg !== 'required' && !am) { integrity(ln, `[profiles] row '${name}' has unknown inline attribute '${seg}'`); continue; }
        const key = seg === 'required' ? 'required' : am[1].trim();
        if (!markAttr(seen, 'profiles', name, key, seg, ln, new Set(['required', 'enum', 'currency', 'query', 'lint', 'budget', 'entities']))) continue;
        if (key === 'required') {
          if (seg !== 'required') { integrity(ln, `[profiles] row '${name}' attribute 'required' must be the bare word 'required'`); continue; }
          spec.required = true;
        }
        else if (key === 'enum') {
          const values = am[2].split('|').map(x => x.trim());
          if (values.some(v => v === '')) integrity(ln, `[profiles] row '${name}' attribute 'enum' contains an empty member`);
          const duplicate = values.find((v, i) => values.indexOf(v) !== i);
          if (duplicate != null) integrity(ln, `[profiles] row '${name}' attribute 'enum' repeats member '${duplicate}'`);
          spec.enum = values;
        }
        else if (key === 'entities') { // entity-ref-fields: the restriction set on a 'ref' field
          const values = am[2].split('|').map(x => x.trim());
          if (values.some(v => v === '')) integrity(ln, `[profiles] row '${name}' attribute 'entities' contains an empty member`);
          const duplicate = values.find((v, i) => values.indexOf(v) !== i);
          if (duplicate != null) integrity(ln, `[profiles] row '${name}' attribute 'entities' repeats member '${duplicate}'`);
          spec.entities = values;
        }
        else if (key === 'currency') {
          spec.currency = am[2].trim();
          if (!spec.currency) integrity(ln, `[profiles] row '${name}' attribute 'currency' needs a nonempty value`);
        }
        else if (key === 'query') {
          spec.query = am[2].trim();
          if (!spec.query) integrity(ln, `[profiles] row '${name}' attribute 'query' needs a nonempty value`);
        }
        else if (key === 'lint') {
          spec.lint = am[2].trim();
          if (!spec.lint) integrity(ln, `[profiles] row '${name}' attribute 'lint' needs a nonempty value`);
        }
        else if (key === 'budget') {
          const v = am[2].trim();
          const canonical = /^[1-9]\d*$/.test(v);
          const n = canonical ? Number(v) : NaN;
          if (!canonical || !Number.isSafeInteger(n))
            integrity(ln, `[profiles] row '${name}' attribute 'budget=${v}' must be a canonical positive safe integer (no leading zero, decimal, exponent, or rounding)`);
          spec.budget = canonical && Number.isSafeInteger(n) ? n : v;
        }
      }
      let entitySpec = ownValue(reg.entities, entity);
      if (!entitySpec) { entitySpec = { tenses: [], profile: {} }; setOwn(reg.entities, entity, entitySpec); }
      entitySpec.profile = entitySpec.profile || {};
      setOwn(entitySpec.profile, field, spec);
    }
  }
  // a well-formed registry always carries the prebuilt [entities] rows; zero entities
  // means the file is corrupt/garbage, not merely custom-free — treat as unparseable.
  if (Object.keys(reg.entities).length === 0) throw new Error('no [entities] rows parsed — malformed');
  return reg;
}

function registryCellProblem(value, opts = {}) {
  const s = String(value);
  if (/[\0\n\r\u2028\u2029]/.test(s)) return 'contains a control/line separator and cannot occupy one registry line';
  if (opts.isName && PROTOTYPE_SENSITIVE_KEYS.has(s)) return 'is a reserved JavaScript object-prototype name';
  if (s.includes(';')) return "contains the registry ';' attribute separator";
  if (opts.isName && s.includes('=')) return "contains the registry '=' name/value separator";
  return null;
}

function registryKeyGrammarProblem(value) {
  const key = String(value);
  if (!FM_KEY_RE.test(key)) return 'cannot round-trip as a frontmatter key ([A-Za-z0-9_.-]+)';
  if (PROTOTYPE_SENSITIVE_KEYS.has(key)) return 'is a reserved JavaScript object-prototype key';
  return null;
}

function registryRelationGrammarProblem(value) {
  if (typeof value !== 'string') return 'must be a string';
  const shape = registryKeyGrammarProblem(value);
  if (shape) return shape;
  if (RESERVED_REL_VERBS.has(value)) return 'is reserved frontmatter relation syntax, not an edge verb';
  return null;
}

function registryKnownVerb(reg, value) {
  return hasOwnKey(reg.conjugate || {}, value) || hasOwnKey(reg.inverses || {}, value)
    || hasOwnKey(reg.verbs || {}, value) || (reg.weakVerbs || []).includes(value)
    || Object.values(reg.conjugate || {}).includes(value);
}

function registryConjugationConflicts(reg) {
  const groups = new Map();
  for (const [base, past] of Object.entries(reg.conjugate || {})) {
    if (past == null || past === '') continue;
    if (!groups.has(past)) groups.set(past, []);
    const inverse = hasOwnKey(reg.inverses || {}, base) && reg.inverses[base] ? reg.inverses[base] : null;
    groups.get(past).push({ base, inverse });
  }
  const probs = [];
  for (const [past, rows] of groups) {
    if (hasOwnKey(reg.inverses || {}, past)) continue;
    if (new Set(rows.map(r => r.inverse ?? '\0none')).size < 2) continue;
    probs.push(`conjugation target '${past}' is shared by bases with incompatible inverse semantics: ${rows.map(r => `'${r.base}' → ${r.inverse ? `'${r.inverse}'` : '(none)'}`).join(', ')}`);
  }
  return probs;
}

function registrySchemaProblems(reg, opts = {}) {
  const crossReferences = opts.crossReferences !== false;
  const probs = [];
  for (const [name, entity] of Object.entries(reg.entities || {})) {
    const nameProblem = registryCellProblem(name, { isName: true });
    if (nameProblem) probs.push(`entity '${name}' ${nameProblem}`);
    if (name.includes('.')) probs.push(`entity '${name}' contains '.' (profile rows split on the first dot; dotted entity names are ambiguous)`);
    const tenses = entity?.tenses;
    if (!Array.isArray(tenses) || tenses.length === 0) {
      probs.push(`entity '${name}' has no tense (expected a nonempty subset of card, future, record)`);
      continue;
    }
    const seen = new Set();
    for (const tense of tenses) {
      if (!ENTITY_TENSES.has(tense)) probs.push(`entity '${name}' has invalid tense '${String(tense)}' (allowed: card, future, record)`);
      if (seen.has(tense)) probs.push(`entity '${name}' repeats tense '${String(tense)}'`);
      seen.add(tense);
    }
    for (const [field, spec] of Object.entries(entity.profile || {})) {
      const where = `profile ${name}.${field}`;
      const fieldProblem = registryKeyGrammarProblem(field);
      if (fieldProblem) probs.push(`${where} field '${field}' ${fieldProblem}`);
      for (const [attr, value] of [['currency', spec?.currency], ['query', spec?.query], ['lint', spec?.lint]]) {
        if (value == null) continue;
        const cellProblem = registryCellProblem(value);
        if (cellProblem) probs.push(`${where} ${attr} ${cellProblem}`);
      }
      for (const value of spec?.enum || []) {
        const cellProblem = registryCellProblem(value);
        if (cellProblem) probs.push(`${where} enum member ${cellProblem}`);
      }
      if (hasOwnKey(spec || {}, 'entities')) { // entity-ref-fields: restriction set on a 'ref' field
        if (spec?.type !== 'ref') probs.push(`${where} has entities= but is a '${String(spec?.type)}' field (entities is ref-only)`);
        const members = spec.entities;
        if (!Array.isArray(members) || members.length === 0 || members.some(v => String(v) === ''))
          probs.push(`${where} entities= needs a nonempty entity set`);
        else {
          const duplicate = members.find((v, i) => members.indexOf(v) !== i);
          if (duplicate != null) probs.push(`${where} entities repeats member '${String(duplicate)}'`);
          for (const m of members) {
            const cellProblem = registryCellProblem(m);
            if (cellProblem) probs.push(`${where} entities member ${cellProblem}`);
            else if (!hasOwnKey(reg.entities || {}, m)) probs.push(`${where} entities member '${m}' is not a registered entity`);
          }
        }
      }
      const hasEnum = hasOwnKey(spec || {}, 'enum');
      const enumValues = spec?.enum;
      if (spec?.type === 'select' || spec?.type === 'multi') {
        if (!Array.isArray(enumValues) || enumValues.length === 0 || enumValues.some(v => String(v) === ''))
          probs.push(`${where} type '${spec.type}' needs a nonempty enum`);
        else {
          const duplicate = enumValues.find((v, i) => enumValues.indexOf(v) !== i);
          if (duplicate != null) probs.push(`${where} enum repeats member '${String(duplicate)}'`);
        }
      } else if (hasEnum) probs.push(`${where} has enum= but is a '${String(spec?.type)}' field (enum is select/multi-only)`);
      if (hasOwnKey(spec || {}, 'currency') && spec?.type !== 'number')
        probs.push(`${where} has currency= but is a '${String(spec?.type)}' field (currency is number-only)`);
      if (hasOwnKey(spec || {}, 'budget')) {
        if (typeof spec.budget !== 'number' || !Number.isInteger(spec.budget) || spec.budget <= 0)
          probs.push(`${where} budget '${String(spec.budget)}' is not a positive integer`);
        else if (spec?.type !== 'list') probs.push(`${where} has budget= but is a '${String(spec?.type)}' field (budget is list-only)`);
      }
    }
  }
  for (const [name, alias] of Object.entries(reg.aliases || {}))
    if (alias?.kind !== 'slug' && alias?.kind !== 'verb')
      probs.push(`alias '${name}' has invalid kind '${String(alias?.kind)}' (allowed: slug, verb)`);
    else if (alias.kind === 'slug') {
      const nameProblem = registrySlugProblem(name);
      const targetProblem = registrySlugProblem(alias.to);
      if (nameProblem) probs.push(`slug alias name '${name}' ${nameProblem}`);
      if (targetProblem) probs.push(`slug alias '${name}' target '${String(alias.to)}' ${targetProblem}`);
    }
    else {
      // A verb-alias SOURCE is query vocabulary (friendly phrases such as "is about" are
      // intentional); only its target becomes an authored relation key.
      const nameProblem = registryCellProblem(name, { isName: true });
      const targetProblem = registryRelationGrammarProblem(alias.to);
      if (nameProblem) probs.push(`verb alias name '${name}' ${nameProblem}`);
      if (targetProblem) probs.push(`verb alias '${name}' target '${String(alias.to)}' ${targetProblem}`);
      if (crossReferences && registryKnownVerb(reg, name)) probs.push(`verb alias source '${name}' shadows a real/known verb of the same name (real verb identity is ambiguous)`);
    }
  for (const name of Object.keys(reg.verbs || {})) {
    const problem = registryRelationGrammarProblem(name);
    if (problem) probs.push(`registry verb '${name}' ${problem}`);
    const example = ownValue(reg.verbs, name)?.example;
    const exampleProblem = example == null ? null : registryCellProblem(example);
    if (exampleProblem) probs.push(`registry verb '${name}' example ${exampleProblem}`);
  }
  for (const [name, past] of Object.entries(reg.conjugate || {})) {
    const sourceProblem = registryRelationGrammarProblem(name);
    if (sourceProblem) probs.push(`conjugation verb '${name}' ${sourceProblem}`);
    if (past !== null && past !== '') {
      const targetProblem = registryRelationGrammarProblem(past);
      if (targetProblem) probs.push(`conjugation '${name}' target '${String(past)}' ${targetProblem}`);
      else if (crossReferences && ownValue(reg.aliases || {}, past)?.kind === 'verb')
        probs.push(`conjugation '${name}' target '${past}' is a verb-alias source for '${reg.aliases[past].to}' — use the canonical verb '${reg.aliases[past].to}'`);
    }
  }
  for (const [name, inverse] of Object.entries(reg.inverses || {})) {
    const sourceProblem = registryRelationGrammarProblem(name);
    if (sourceProblem) probs.push(`inverse verb '${name}' ${sourceProblem}`);
    if (inverse !== '') {
      const targetProblem = registryRelationGrammarProblem(inverse);
      if (targetProblem) probs.push(`inverse '${name}' target '${String(inverse)}' ${targetProblem}`);
      else if (crossReferences && ownValue(reg.aliases || {}, inverse)?.kind === 'verb')
        probs.push(`inverse '${name}' target '${inverse}' is a verb-alias source for '${reg.aliases[inverse].to}' — use the canonical verb '${reg.aliases[inverse].to}'`);
      else if (crossReferences && !registryKnownVerb(reg, inverse)) probs.push(`inverse '${name}' target '${inverse}' is not a known canonical verb`);
    }
  }
  for (const name of reg.weakVerbs || []) {
    const problem = registryRelationGrammarProblem(name);
    if (problem) probs.push(`weak verb '${name}' ${problem}`);
  }
  if (crossReferences) probs.push(...registryConjugationConflicts(reg));
  return probs;
}

// Registry files are an authored overlay on a mandatory shipped seed. Validate each
// authored row's syntax in the raw layer, but resolve inverse/conjugation/alias
// cross-references against the same effective seed+file view that commands use. Without
// this split, deleting a prebuilt row (which is documented to re-seed on next load) made
// an otherwise-valid seed inverse look unknown and could brick every later registry save.
function registryEffectiveSchema(reg) {
  const seed = cloneSeed();
  const stale = reg._format != null && reg._format < REG_FORMAT;
  const entities = {};
  if (stale) {
    // A stale file is a migration input: shipped fixes win only for prebuilt entity
    // fields, while custom entities/profile fields survive. This mirrors loadRegistry's
    // historical threeWayRegistryEntities(file, seed) call without depending upward on
    // the merge helpers declared after the serializer.
    for (const name of new Set([...Object.keys(reg.entities || {}), ...Object.keys(seed.entities)])) {
      const authored = ownValue(reg.entities || {}, name) || {};
      const shipped = ownValue(seed.entities, name) || {};
      setOwn(entities, name, {
        ...authored,
        ...shipped,
        tenses: shipped.tenses || authored.tenses || [],
        profile: { ...(authored.profile || {}), ...(shipped.profile || {}) },
      });
    }
  } else Object.assign(entities, seed.entities, reg.entities || {});
  return {
    entities,
    conjugate: stale ? { ...(reg.conjugate || {}), ...seed.conjugate } : { ...seed.conjugate, ...(reg.conjugate || {}) },
    inverses: stale ? { ...(reg.inverses || {}), ...seed.inverses } : { ...seed.inverses, ...(reg.inverses || {}) },
    weakVerbs: stale
      ? [...new Set([...(reg.weakVerbs || []), ...(seed.weakVerbs || [])])]
      : [...new Set([...(seed.weakVerbs || []), ...(reg.weakVerbs || [])])],
    verbs: { ...seed.verbs, ...(reg.verbs || {}) },
    aliases: { ...seed.aliases, ...(reg.aliases || {}) },
    _unparseable: reg._unparseable || [],
    _integrity: reg._integrity || [],
    _format: REG_FORMAT,
  };
}

function registryRewriteProblems(reg) {
  return [...new Set([
    ...(reg._integrity || []),
    ...(reg._unparseable || []).map(u => `unparseable [${u.section || '?'}] line '${u.line}'`),
    // Authored rows must remain locally representable even when a stale prebuilt value
    // will be replaced during migration. Only cross-map meaning is deferred to the
    // effective view below; bad cells/grammar/schema shapes stay hand-repair blockers.
    ...registrySchemaProblems(reg, { crossReferences: false }),
    ...registrySchemaProblems(registryEffectiveSchema(reg)),
  ])];
}

// serialize/parse follow the write discipline (parse → mutate object → serialize →
// atomic write); dedicated line format (the node frontmatter parser is node-shaped).
function serializeRegistry(reg) {
  const blockers = registryRewriteProblems(reg);
  if (blockers.length)
    die(`refusing to serialize registry — authored truth needs hand repair (${blockers[0]}); source left byte-identical`);
  // The blocker pass above checked authored cells in the raw layer. The guard-layer
  // serializer choke must use the same mandatory seed overlay for cross-map lookups;
  // otherwise it reintroduces the raw `advances → contains` false positive after the
  // schema pass correctly accepted an authored omission of prebuilt `contains`.
  SERIALIZE_REGISTRY_DEPS.checkReg(registryEffectiveSchema(reg)); // bug #19: a newline in any registry cell would break registry.md's line format
  // Serializing a parsed stale snapshot upgrades its stamp, so emit the reconciled view;
  // never bless obsolete prebuilt rows as current-format authored truth.
  if (reg._format != null && reg._format < REG_FORMAT) reg = registryEffectiveSchema(reg);
  const L = [REGISTRY_TITLE_COMMENT,
    REGISTRY_SCHEMA_COMMENT,
    `# format: ${REG_FORMAT}`, ''];
  L.push('[entities]');
  for (const k of Object.keys(reg.entities)) L.push(`${k} = ${(reg.entities[k].tenses || []).join(', ')}`);
  L.push('', '[verbs]');
  const verbNames = [...new Set([...Object.keys(reg.conjugate || {}), ...Object.keys(reg.inverses || {}), ...Object.keys(reg.verbs || {})])];
  for (const name of verbNames) {
    const past = hasOwnKey(reg.conjugate, name) ? (reg.conjugate[name] === null ? 'drop' : reg.conjugate[name]) : '';
    const parts = [`${name} = ${past}`];
    if (hasOwnKey(reg.inverses, name)) parts.push(`inverse=${reg.inverses[name]}`);
    if (ownValue(reg.verbs, name)?.example) parts.push(`eg=${reg.verbs[name].example}`);
    L.push(parts.join(' ; '));
  }
  L.push('', '[aliases]');
  for (const k of Object.keys(reg.aliases || {})) L.push(`${k} = ${reg.aliases[k].to} ; kind=${reg.aliases[k].kind}`);
  L.push('', '[profiles]');
  for (const ent of Object.keys(reg.entities || {})) {
    const prof = reg.entities[ent].profile || {};
    for (const [field, spec] of Object.entries(prof)) {
      const parts = [`${ent}.${field} = ${spec.type}`];
      if (spec.required) parts.push('required');
      if (spec.enum?.length) parts.push(`enum=${spec.enum.join('|')}`);
      if (spec.entities?.length) parts.push(`entities=${spec.entities.join('|')}`);
      if (spec.currency != null) parts.push(`currency=${spec.currency}`);
      if (spec.query != null) parts.push(`query=${spec.query}`);
      if (spec.lint != null) parts.push(`lint=${spec.lint}`);
      if (spec.budget != null) parts.push(`budget=${spec.budget}`);
      L.push(parts.join(' ; '));
    }
  }
  L.push('', '[weak]');
  for (const w of reg.weakVerbs || []) L.push(w);
  return L.join('\n') + '\n';
}

// Merge two parsed registries. With no baselines this retains the original union contract:
// `mem` wins a genuine conflict and `disk` fills absent keys. A save supplies BOTH the
// effective in-memory snapshot and parsed-disk snapshot from process open. That makes the
// merge key-dirty-aware: an unchanged stale memory key cannot overwrite a concurrent disk
// clear (`inverse=` / empty conjugation / empty example), while this process's deliberate
// edit still wins. Prebuilt seed-only keys survive because unchanged disk is distinguished
// from a concurrent disk change.
// dedup preserved unparseable lines by section+text (idempotent across save cycles —
// disk and mem carry the same lines once they've been round-tripped once).
function dedupUnp(list) {
  const seen = new Set(), out = [];
  for (const u of list || []) { const k = (u.section || '') + '\t' + u.line; if (!seen.has(k)) { seen.add(k); out.push(u); } }
  return out;
}

function registryValueEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function threeWayRegistryChoice(disk, mem, baseMem, baseDisk, k) {
  const memHad = hasOwnKey(mem, k), baseMemHad = hasOwnKey(baseMem, k);
  const diskHad = hasOwnKey(disk, k), baseDiskHad = hasOwnKey(baseDisk, k);
  const memChanged = memHad !== baseMemHad || (memHad && !registryValueEqual(mem[k], baseMem[k]));
  const diskChanged = diskHad !== baseDiskHad || (diskHad && !registryValueEqual(disk[k], baseDisk[k]));
  const source = memChanged ? mem : diskChanged ? disk : mem;
  return { has: hasOwnKey(source, k), value: ownValue(source, k) };
}

function threeWayRegistryMap(disk = {}, mem = {}, baseMem = null, baseDisk = null) {
  if (!baseMem || !baseDisk) return { ...disk, ...mem };
  const out = {};
  const keys = new Set([...Object.keys(disk), ...Object.keys(mem), ...Object.keys(baseMem), ...Object.keys(baseDisk)]);
  for (const k of keys) {
    const chosen = threeWayRegistryChoice(disk, mem, baseMem, baseDisk, k);
    if (chosen.has) setOwn(out, k, chosen.value);
  }
  return out;
}

function threeWayRegistrySet(disk = [], mem = [], baseMem = null, baseDisk = null) {
  if (!baseMem || !baseDisk) return [...new Set([...disk, ...mem])];
  const ds = new Set(disk), ms = new Set(mem), bms = new Set(baseMem), bds = new Set(baseDisk);
  const all = [...new Set([...disk, ...mem, ...baseMem, ...baseDisk])];
  return all.filter(k => {
    const memChanged = ms.has(k) !== bms.has(k);
    const diskChanged = ds.has(k) !== bds.has(k);
    return memChanged ? ms.has(k) : diskChanged ? ds.has(k) : ms.has(k);
  });
}

function threeWayUnparseable(disk = [], mem = [], baseMem = null, baseDisk = null) {
  if (!baseMem || !baseDisk) return dedupUnp([...disk, ...mem]);
  const key = u => `${u.section || ''}\t${u.line}`;
  const toMap = list => new Map((list || []).map(u => [key(u), u]));
  const dm = toMap(disk), mm = toMap(mem), bmm = toMap(baseMem), bdm = toMap(baseDisk);
  const all = [...new Set([...dm.keys(), ...mm.keys(), ...bmm.keys(), ...bdm.keys()])];
  return all.flatMap(k => {
    const memChanged = mm.has(k) !== bmm.has(k);
    const diskChanged = dm.has(k) !== bdm.has(k);
    const source = memChanged ? mm : diskChanged ? dm : mm;
    return source.has(k) ? [source.get(k)] : [];
  });
}

function threeWayRegistryEntities(disk = {}, mem = {}, baseMem = null, baseDisk = null) {
  if (!baseMem || !baseDisk) {
    const entities = {};
    for (const k of new Set([...Object.keys(disk), ...Object.keys(mem)])) {
      const d = ownValue(disk, k) || {}, m = ownValue(mem, k) || {};
      setOwn(entities, k, { ...d, ...m, tenses: m.tenses || d.tenses || [], profile: { ...(d.profile || {}), ...(m.profile || {}) } });
    }
    return entities;
  }
  const entities = {};
  const keys = new Set([...Object.keys(disk), ...Object.keys(mem), ...Object.keys(baseMem), ...Object.keys(baseDisk)]);
  for (const k of keys) {
    const outer = threeWayRegistryChoice(disk, mem, baseMem, baseDisk, k);
    if (!outer.has) continue; // a deliberate/concurrent entity deletion wins unchanged stale state
    const d = ownValue(disk, k) || {}, m = ownValue(mem, k) || {};
    const bm = ownValue(baseMem, k) || {}, bd = ownValue(baseDisk, k) || {};
    const tenses = threeWayRegistryChoice(d, m, bm, bd, 'tenses');
    setOwn(entities, k, {
      ...(outer.value || {}),
      tenses: tenses.has ? tenses.value : [],
      profile: threeWayRegistryMap(d.profile || {}, m.profile || {}, bm.profile || {}, bd.profile || {}),
    });
  }
  return entities;
}

function unionReg(disk, mem, baseMem = null, baseDisk = null) {
  return {
    entities: threeWayRegistryEntities(disk.entities, mem.entities, baseMem?.entities, baseDisk?.entities),
    conjugate: threeWayRegistryMap(disk.conjugate, mem.conjugate, baseMem?.conjugate, baseDisk?.conjugate),
    inverses: threeWayRegistryMap(disk.inverses, mem.inverses, baseMem?.inverses, baseDisk?.inverses),
    weakVerbs: threeWayRegistrySet(disk.weakVerbs, mem.weakVerbs, baseMem?.weakVerbs, baseDisk?.weakVerbs),
    verbs: threeWayRegistryMap(disk.verbs, mem.verbs, baseMem?.verbs, baseDisk?.verbs),
    aliases: threeWayRegistryMap(disk.aliases, mem.aliases, baseMem?.aliases, baseDisk?.aliases),
    // Authored garbage is preserved, but it is not immortal: a human fixing/removing a
    // line on disk must beat an unchanged stale process just like any other registry row.
    _unparseable: threeWayUnparseable(disk._unparseable, mem._unparseable, baseMem?._unparseable, baseDisk?._unparseable),
    _integrity: threeWayRegistrySet(disk._integrity, mem._integrity, baseMem?._integrity, baseDisk?._integrity),
  };
}

function applyRemovals(reg, rm) {
  // Registry saves union disk+memory; a plain delete-then-save would be undone by
  // unionReg, so unregister removals travel only through opts.remove tombstones.
  for (const e of rm.entities || []) delete reg.entities[e];
  for (const v of rm.verbs || []) { delete reg.verbs[v]; delete reg.conjugate[v]; delete reg.inverses[v]; }
  if (rm.weak?.length) reg.weakVerbs = (reg.weakVerbs || []).filter(v => !rm.weak.includes(v)); // bug #80: weak verbs live outside reg.verbs but unregister still tombstones them.
  for (const a of rm.aliases || []) delete reg.aliases[a];
}

// distilled-tier index text: body + the SAME normalization shadow used by the four
// frontmatter surfaces. Keeping one transform here matters: deep search must neither
// fold an enumeration like 4,5 into 45 nor lose the accent/letter equivalences normal
// search promises (Søren/Soren, Łukasz/Lukasz, Straße/Strasse). Empty body → no row.
function bodyIndexText(body) {
  if (!body || !body.trim()) return null;
  const norm = searchNormalize(body);
  // Raw and normalized copies are alternative spellings of ONE authored body, not
  // adjacent prose. Consume an FTS position between them so a quoted phrase cannot
  // fabricate adjacency from the raw tail to the normalized head.
  return norm === body ? body : body + `\n${SEARCH_SEGMENT_BOUNDARY}\n` + norm;
}

// C-3: the search-normalization shadow. Authored bytes stay untouched for display; a
// NORMALIZED copy of every searchable surface (slug, description, edge whys, profile
// values) indexes into fts's `norm` column, and query terms normalize the same way — so
// Søren/Soren, Łukasz/Lukasz, Straße/Strasse, Ελένη/Ελενη, and $13,377/13377 all meet in
// the middle. NFKD + combining-mark removal covers decomposable accents (incl. Greek,
// which the default tokenizer's remove_diacritics misses outside Latin); the deliberate
// map covers the common non-decomposing letters; number folding mirrors bodyIndexText;
// CJK runs emit BIGRAMS (only bigrams — mixing unigrams in would break bigram phrase
// adjacency) so a substring query like 東京 hits 東京オフィス… without a corpus LIKE scan.
const CJK_RUN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

const SEARCH_FOLD = { 'ø': 'o', 'ł': 'l', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ħ': 'h' };

const GROUPED_THOUSANDS_RE = /(?<![\d,])\$?\d{1,3}(?:,\d{3})+(?!\d|,\d)/g;

function foldGroupedThousands(s) {
  return String(s).replace(GROUPED_THOUSANDS_RE, (m) => m.replace(/[$,]/g, ''));
}

// FTS phrase positions are continuous across punctuation and whitespace. A private-use
// token between separately-authored values consumes one position under unicode61, so a
// phrase cannot be fabricated by joining why/profile value A to value B. It never leaks
// into literal search: literal predicates inspect the authored edge/profile rows, not this
// derived join. Bare AND terms remain free to occur in different authored values.
const SEARCH_SEGMENT_BOUNDARY = '\uE000';

function cjkBigrams(run) {
  const chars = [...run];
  if (chars.length < 2) return run;
  const out = [];
  for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
  return out.join(' ');
}

function searchNormalize(s) {
  return String(s).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[øłßæœđðþħ]/g, (ch) => SEARCH_FOLD[ch])
    // fold ONLY thousands-grouped numbers ($13,377 → 13377); an enumeration like '4,5'
    // is NOT a grouped number, so it stays split (query '45' must not match '4,5').
    // Numeric lookarounds, rather than a word boundary, let an authored unit/currency
    // code stay attached ($13,377USD → 13377usd) without matching the tail of a larger
    // malformed grouping.
    .replace(GROUPED_THOUSANDS_RE, (m) => m.replace(/[$,]/g, ''))
    .replace(CJK_RUN_RE, (run) => cjkBigrams(run));
}

function hasFrontmatterFence(text) {
  return text.startsWith('---\n') || text.startsWith('---\r\n');
}

// Return the LF immediately before the first exact closing `---` line. Prefix matches
// such as `----` are Markdown horizontal rules, not YAML fences (FB-25).
function frontmatterFenceEnd(text) {
  if (!hasFrontmatterFence(text)) return -1;
  const close = /\n---(?=\r?\n|$)/g;
  close.lastIndex = 3;
  return close.exec(text)?.index ?? -1;
}

// ===== SECTION: GUARDS =====
function jsonType(v) {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
}

function keyShapeProblem(k) {
  const key = String(k);
  if (!FM_KEY_RE.test(key))
    return `cannot round-trip — frontmatter keys are [A-Za-z0-9_.-]+ one-per-line (§2); a key with spaces/punctuation serializes into a line the parser rejects`;
  if (PROTOTYPE_SENSITIVE_KEYS.has(key))
    return `is reserved — JavaScript object-prototype names are not safe authored map keys; choose a descriptive field/verb name`;
  return null;
}

function assertKeyShape(where, k) {
  const problem = keyShapeProblem(k);
  if (problem) die(`${where} '${String(k)}' ${problem}; nothing written`); // bug #86
}

// A relation verb becomes a frontmatter KEY, regardless of which door supplied it:
// link/unlink, inline apply, registry conjugation/inverse, or a verb-alias target. Keep
// one grammar/reservation gate so a registry row cannot mint syntax that direct link
// refuses (and so freeze never computes { why: target } or a prototype property).
function relationVerbProblem(value) {
  if (typeof value !== 'string') return `must be a string (got ${jsonType(value)})`;
  const shape = keyShapeProblem(value);
  if (shape) return shape;
  if (RESERVED_REL_VERBS.has(value))
    return `is reserved frontmatter syntax (verb/to/target/from/why), not an edge verb`;
  return null;
}

function assertRelationVerb(where, value) {
  const problem = relationVerbProblem(value);
  if (problem) die(`${where} '${String(value)}' ${problem}; nothing written`);
  return value;
}

// A verb-alias SOURCE is query vocabulary, not an authored frontmatter key, so it may
// be a friendly phrase ("is about"). Validate the canonical target when the registry is
// available. The first, root-independent CLI preflight may defer only a shape that could
// be such an alias; main immediately repeats preflight with the loaded registry before
// any DB/recovery work. Stored relation keys never use this helper: they must be canonical.
function assertRelationVerbInput(reg, where, value, opts = {}) {
  if (reg && !isRegistryVerb(reg, value)) {
    const alias = ownValue(reg.aliases, value);
    if (alias?.kind === 'verb') {
      assertRelationVerb(`${where} alias target`, alias.to);
      return value;
    }
  }
  const problem = relationVerbProblem(value);
  if (problem && !reg && opts.deferAlias) return value;
  return assertRelationVerb(where, value);
}

// Registry-known verbs are identities, so they win over a conflicting hand-authored
// verb-alias source just as real node slugs win over slug aliases. Keep this predicate in
// guards because registry serialization must enforce it before any disk write.
function isRegistryVerb(reg, value) {
  return hasOwnKey(reg.conjugate, value) || hasOwnKey(reg.inverses, value) || hasOwnKey(reg.verbs, value)
    || (reg.weakVerbs || []).includes(value) || Object.values(reg.conjugate || {}).includes(value);
}

function relationVerbTargetProblem(reg, value, opts = {}) {
  if (opts.allowEmpty && value === '') return null; // explicit registry tombstone: clear mapping
  const problem = relationVerbProblem(value);
  if (problem) return problem;
  const alias = ownValue(reg.aliases, value);
  if (alias?.kind === 'verb')
    return `is a verb-alias source for '${alias.to}' — store the canonical verb '${alias.to}' instead`;
  return null;
}

function assertRelationVerbTarget(reg, where, value, opts = {}) {
  const problem = relationVerbTargetProblem(reg, value, opts);
  if (problem) die(`${where} '${String(value)}' ${problem}; nothing written`);
  return value;
}

function inverseTargetProblem(reg, value, opts = {}) {
  const problem = relationVerbTargetProblem(reg, value, opts);
  if (problem || (opts.allowEmpty && value === '')) return problem;
  if (!isRegistryVerb(reg, value))
    return `is not a known canonical verb — register '${value}' first, then point the inverse at it`;
  return null;
}

function assertInverseTarget(reg, where, value, opts = {}) {
  const problem = inverseTargetProblem(reg, value, opts);
  if (problem) die(`${where} '${String(value)}' ${problem}; nothing written`);
  return value;
}

// Once an edge is frozen its base verb is replaced by the conjugated spelling. Inbound
// display can therefore recover only ONE inverse meaning from that past spelling. Sharing
// a past target is safe when every base has the same inverse semantics (including all
// having none); different meanings would make reads depend on registry iteration order.
const baseInverse = (reg, verb) => hasOwnKey(reg.inverses, verb) && reg.inverses[verb] ? reg.inverses[verb] : null;

function conjugationInverseConflicts(reg) {
  const groups = new Map();
  for (const [base, past] of Object.entries(reg.conjugate || {})) {
    if (past == null || past === '') continue;
    if (!groups.has(past)) groups.set(past, []);
    groups.get(past).push({ base, inverse: baseInverse(reg, base) });
  }
  const probs = [];
  for (const [past, rows] of groups) {
    // An explicit inverse row on the shared past spelling is the canonical meaning (or
    // empty suppression) and inverseOf() gives it precedence, so base differences are
    // harmless and intentional in that case.
    if (hasOwnKey(reg.inverses, past)) continue;
    const meanings = new Set(rows.map(r => r.inverse ?? '\0none'));
    if (meanings.size < 2) continue;
    probs.push(`conjugation target '${past}' is shared by bases with incompatible inverse semantics: ${rows.map(r => `'${r.base}' → ${r.inverse ? `'${r.inverse}'` : '(none)'}`).join(', ')}. A frozen '${past}' edge no longer carries which base produced it, so its inbound inverse would be ambiguous; use distinct past verbs or one shared inverse`);
  }
  return probs;
}

function conjugationInverseConflict(reg, base, past) {
  if (past == null || past === '') return null;
  return conjugationInverseConflicts(reg).find(p => p.startsWith(`conjugation target '${past}' `) && p.includes(`'${base}' →`)) || null;
}

function assertRelationTarget(where, value) {
  if (typeof value !== 'string')
    die(`${where} must be a slug string — got ${jsonType(value)}; nothing written`);
  const lint = slugLint(value);
  if (lint) die(`${where}: ${lint}`);
  return value;
}

function assertApplyWriteOpKeys(op) {
  const dataKeys = ownValue(APPLY_OP_ALLOWED_KEYS, op.op);
  if (!dataKeys) return;
  const extraKeys = Object.keys(op).filter(k => !APPLY_OP_ENVELOPE_KEYS.has(k) && !dataKeys.has(k));
  if (extraKeys.length)
    die(`${op.op} op has unknown key(s): ${extraKeys.join(', ')} (allowed: ${[...APPLY_OP_ENVELOPE_KEYS, ...dataKeys].join(', ')})`); // strict before any fold can remove the source op
}

function embeddedArgsFlags(op, mode) {
  const identity = mode === 'batch' ? 'verb' : 'op';
  const allowed = new Set(['id', identity, 'args', 'flags']);
  const unknown = Object.keys(op).filter(k => !allowed.has(k));
  if (unknown.length)
    die(`${mode} embedded read has unknown top-level key(s): ${unknown.join(', ')} (allowed: ${[...allowed].join(', ')})`);
  let args = [], flags = {};
  if (hasOwnKey(op, 'args')) {
    if (!Array.isArray(op.args)) die(`embedded ${op.op || op.verb || 'read'} args must be a JSON array when provided — got ${jsonType(op.args)}`);
    args = op.args;
  }
  if (hasOwnKey(op, 'flags')) {
    if (!op.flags || typeof op.flags !== 'object' || Array.isArray(op.flags))
      die(`embedded ${op.op || op.verb || 'read'} flags must be a JSON object when provided — got ${jsonType(op.flags)}`);
    flags = op.flags;
  }
  return { args, flags };
}

function validateRelations(rels, where = 'relations', inputRegistry = null, opts = {}) {
  if (rels == null) return [];
  if (!Array.isArray(rels)) die(`${where} must be an array of {"<verb>": "<target-slug>", "why": "..."} items — got ${typeof rels}`);
  for (const item of rels) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      die(`${where} item must be an object {"<verb>": "<target-slug>", "why": "..."} — got ${JSON.stringify(item)}`);
    const keys = Object.keys(item).filter(k => k !== 'why');
    if (keys.length !== 1)
      die(`${where} item needs EXACTLY one verb key (plus optional "why") — got ${keys.length ? `[${keys.join(', ')}]` : 'no verb key'}. Shape: {"works_at": "acme-inc", "why": "..."}`);
    if (inputRegistry) assertRelationVerbInput(inputRegistry, `${where} verb`, keys[0]);
    else assertRelationVerb(`${where} verb`, keys[0]); // stored keys are canonical; bug #86
    if (item[keys[0]] == null || String(item[keys[0]]).trim() === '')
      die(`${where} item verb '${keys[0]}' has an empty target — {"${keys[0]}": "<target-slug>"}`);
    assertRelationTarget(`${where} item verb '${keys[0]}' target`, item[keys[0]]);
    if (item.why != null) {
      if (typeof item.why !== 'string' || item.why.trim() === '') die(`${where} why must be non-empty text — nothing written`);
      assertScalarValue(`${where} why`, item.why); assertScalarSize(`${where} why`, item.why, opts);
    } // F-6
  }
  return rels;
}

// serves/part_of/in_context are the machine-backed harness edges: a self-pointing one adds
// no information (a context cannot be in itself — context-entity §3).
const HARNESS_REFLEXIVE_VERBS = new Set(['serves', 'part_of', 'in_context']);
const assertNoReflexiveHarnessEdge = (slug, verb, to) => {
  if (HARNESS_REFLEXIVE_VERBS.has(verb) && to === slug)
    die(`${slug} → ${verb} → ${to}: a ${verb} edge cannot point to itself — it adds no information; nothing written`);
};

// Work-system display-only inverse spellings (spec: served_by is display-only; has_part is
// never authored). The registry pairs are symmetric (serves↔served_by, part_of↔has_part —
// every verb is a VALUE somewhere), so the machine rule keys off the SHIPPED spelling, and
// only while the registry still pairs them the shipped way — authored-wins lets an install
// re-point or drop the inverse row and own its semantics.
const DISPLAY_ONLY_INVERSE_SPELLINGS = { served_by: 'serves', has_part: 'part_of', includes: 'in_context' };
function displayOnlyInverseBase(reg, verb) {
  const base = ownValue(DISPLAY_ONLY_INVERSE_SPELLINGS, verb);
  if (!base) return null;
  return ownValue(reg?.inverses || {}, base) === verb ? base : null;
}
const assertAuthorableWorkVerb = (reg, verb, where, slug = null, to = null) => {
  const base = displayOnlyInverseBase(reg, verb);
  if (!base) return;
  const swap = slug && to
    ? ` — author the canonical direction instead: brain link ${to} --verb ${base} --to ${slug}`
    : ` — author the canonical '${base}' edge from the ${base === 'part_of' ? 'child' : base === 'in_context' ? 'member' : 'served'} side instead`;
  die(`${where}: '${verb}' is the display-only inverse of '${base}' — reads render it on inbound edges; it is never authored (an authored one is invisible to the topology guards)${swap}; nothing written`);
};

// bug #19: frontmatter is a strict LINE-based subset (§2) — every scalar value and every
// block key occupies ONE line. A raw \n/\r would serialize into orphan bare lines: malformed
// YAML, and on read-back the line parser silently drops everything past the newline (lost
// text). There is no codec layer (PM ruling), so REJECT such values at intake — buildNewFm and
// applyOp for nodes, serializeRegistry for the registry — with a teaching error that NAMES the
// field. Multi-line content belongs in the node body (`brain body`), never a scalar field.
function assertScalarClean(field, s) {
  if (typeof s === 'string' && s.includes('\0')) {
    const where = String(field).replace(/\0/g, '␀');
    die(`${where} contains a U+0000 NUL control — frontmatter scalars are text and node:sqlite truncates at NUL. Remove it or put binary/raw content in files/; nothing written.`);
  }
  // reject every JS line terminator, not just \n\r: U+2028/U+2029 are line terminators to
  // the parser's regex (`.` and `$` won't cross them) so a quoted emission of them is itself
  // unreadable on parse — the field would silently vanish from get/search/index (the codec's
  // quote defense cannot save these). Reject at intake instead, symmetric with \n/\r.
  if (typeof s === 'string' && /[\n\r\u2028\u2029]/.test(s)) {
    const where = String(field).replace(/[\r\n\u2028\u2029]+/g, '⏎'); // don't smuggle the terminator into the error line
    die(`${where} contains a newline / line separator — frontmatter scalars are single-line (§2). Multi-line content belongs in the node body (brain body), not a scalar field.`);
  }
}

function assertScalarValue(field, v) {
  if (Array.isArray(v))
    die(`${field} must be one scalar value, not a list — nothing written`);
  if (!['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v)))
    die(`${field} must be a string, finite number, or boolean — got ${jsonType(v)}; nothing written`);
  assertScalarClean(field, v);
}

function assertCleanValue(field, v) { // a scalar or a flat list of scalars
  if (Array.isArray(v)) {
    v.forEach((e, i) => {
      if (Array.isArray(e)) die(`${field}[${i}] is a nested list — frontmatter accepts only scalars or a flat list of string/number/boolean values; nothing written`);
      assertCleanValue(`${field}[${i}]`, e);
    });
    return;
  }
  assertScalarValue(field, v);
}

// F-6: frontmatter scalars get the body guard's tiers at INTAKE (whys/descriptions arrive
// from ingested content — the body guard's exact rationale, previously forgotten here).
// Warn at 8KB, refuse at 64KB: one frontmatter LINE carrying megabytes taxes every later
// read/mutate/FTS pass. Guards the INCOMING value only — an existing stored value never
// retro-blocks an unrelated write.
function assertScalarSize(field, v, opts = {}) {
  if (typeof v !== 'string') { if (Array.isArray(v)) v.forEach((e, i) => assertScalarSize(`${field}[${i}]`, e, opts)); return v; }
  // @ts-ignore runtime Buffer is available (Node >= 22.5)
  const bytes = Buffer.byteLength(v, 'utf8');
  if (bytes > 65_536) die(`${field} is ${(bytes / 1024).toFixed(0)}KB — frontmatter scalars cap at 64KB (the body guard's mirror). Distilled prose belongs in the node body (brain body); raw content in files/ (§9.1). Nothing written.`);
  if (bytes > 8192 && !opts.quiet) console.error(`⚠ ${field} is ${(bytes / 1024).toFixed(1)}KB — frontmatter scalars are meant to be short (a description/why); prose belongs in the body tier (§9.1)`);
  return v;
}

function assertRegCell(where, v, opts = {}) {
  if (v == null) return;
  const s = String(v);
  assertScalarClean(where, s);
  if (opts.isName && PROTOTYPE_SENSITIVE_KEYS.has(s))
    die(`${where} '${s}' is reserved — JavaScript object-prototype names are not safe registry names; choose a descriptive name; nothing written`);
  if (s.includes(';')) die(`${where} contains ';' — the registry row format uses ';' as its field separator and cannot round-trip it; rephrase without ';'`);
  if (opts.isName && s.includes('=')) die(`${where} contains '=' — the registry row format uses '=' between the name and value and cannot round-trip it; rephrase without '='`);
  if (opts.isEnum && s.includes('|')) die(`${where} contains '|' — registry enum members use '|' as their separator and cannot round-trip it; rephrase without '|'`);
}

// walk every scalar an fm will serialize — top-level values plus each block's KEYS and VALUES
// (a verb/profile key with a newline breaks its line the same way a value does).
function assertFmClean(fm) {
  if (!fm.profile || typeof fm.profile !== 'object' || Array.isArray(fm.profile))
    die(`profile must be an object whose values are scalars or flat scalar lists — got ${jsonType(fm.profile)}; nothing written`);
  if (!Array.isArray(fm.relations)) die(`relations must be an array — got ${jsonType(fm.relations)}; nothing written`);
  if (!Array.isArray(fm.updated)) die(`updated must be an array — got ${jsonType(fm.updated)}; nothing written`);
  if (fm.focus != null && (typeof fm.focus !== 'object' || Array.isArray(fm.focus)))
    die(`focus must be an object or null — got ${jsonType(fm.focus)}; nothing written`);
  for (const [k, v] of Object.entries(fm)) {
    if (k === 'profile' || k === 'relations' || k === 'updated' || k === 'focus' || k === '_unparseable') continue;
    assertScalarValue(`field '${k}'`, v);
  }
  for (const [k, v] of Object.entries(fm.profile || {})) { assertScalarClean(`profile key '${k}'`, k); assertCleanValue(`profile.${k}`, v); }
  for (const it of fm.relations || []) for (const [k, v] of Object.entries(it)) { assertScalarClean(`relations verb '${k}'`, k); assertScalarValue(k === 'why' ? 'relations why' : `relations '${k}' target`, v); }
  for (const u of fm.updated || []) for (const [k, v] of Object.entries(u)) { assertScalarClean(`updated key '${k}'`, k); (k === 'from' ? assertCleanValue : assertScalarValue)(`updated '${k}'`, v); }
  for (const [k, v] of Object.entries(fm.focus || {})) { assertScalarClean(`focus key '${k}'`, k); assertScalarValue(`focus '${k}'`, v); }
}

// registry rows are line-shaped too (`name = value ; ...`) — a newline in any cell breaks
// registry.md. Same reject, at the registry serialize choke point (register/link/apply-auto-reg).
function assertRegClean(reg) {
  for (const [name, e] of Object.entries(reg.entities || {})) {
    assertRegCell(`registry entity '${name}'`, name, { isName: true });
    (e.tenses || []).forEach(t => assertRegCell(`registry entity '${name}' tense`, t));
    for (const [field, spec] of Object.entries(e.profile || {})) {
      assertKeyShape(`registry profile '${name}' field`, field);
      assertRegCell(`registry profile '${name}.${field}' name`, `${name}.${field}`, { isName: true });
      assertRegCell(`registry profile '${name}.${field}' entity`, name, { isName: true });
      assertRegCell(`registry profile '${name}.${field}' field`, field, { isName: true });
      assertRegCell(`registry profile '${name}.${field}' type`, spec.type);
      if (spec.required != null) assertRegCell(`registry profile '${name}.${field}' required`, String(spec.required));
      (spec.enum || []).forEach(v => assertRegCell(`registry profile '${name}.${field}' enum`, v, { isEnum: true }));
      (spec.entities || []).forEach(v => assertRegCell(`registry profile '${name}.${field}' entities`, v, { isEnum: true }));
      if (spec.currency != null) assertRegCell(`registry profile '${name}.${field}' currency`, spec.currency);
      if (spec.query != null) assertRegCell(`registry profile '${name}.${field}' query`, spec.query);
      if (spec.lint != null) assertRegCell(`registry profile '${name}.${field}' lint`, spec.lint);
    }
  }
  for (const [name, v] of Object.entries(reg.verbs || {})) { assertRelationVerb('registry verb', name); assertRegCell(`registry verb '${name}'`, name, { isName: true }); if (v && v.example != null) assertRegCell(`registry verb '${name}' example`, String(v.example)); }
  for (const [name, past] of Object.entries(reg.conjugate || {})) {
    assertRelationVerb('registry conjugation verb', name);
    assertRegCell(`registry conjugation '${name}'`, name, { isName: true });
    if (past != null) { assertRelationVerbTarget(reg, `registry conjugation '${name}' target`, past, { allowEmpty: true }); assertRegCell(`registry conjugation '${name}' past`, String(past)); }
  }
  for (const [name, inv] of Object.entries(reg.inverses || {})) {
    assertRelationVerb('registry inverse verb', name);
    assertInverseTarget(reg, `registry inverse '${name}' target`, inv, { allowEmpty: true });
    assertRegCell(`registry inverse '${name}'`, name, { isName: true });
    assertRegCell(`registry inverse '${name}' target`, String(inv));
  }
  for (const [name, a] of Object.entries(reg.aliases || {})) {
    assertRegCell(`registry alias '${name}'`, name, { isName: true });
    if (a && a.to != null) {
      if (a.kind === 'verb') {
        assertRelationVerb(`registry verb-alias '${name}' target`, a.to);
        if (isRegistryVerb(reg, name))
          die(`registry verb-alias source '${name}' shadows a real/known verb of the same name — real verbs win; unregister or rename the alias; nothing written`);
      }
      assertRegCell(`registry alias '${name}' target`, String(a.to));
    }
  }
  (reg.weakVerbs || []).forEach(w => { assertRelationVerb('registry weak verb', w); assertRegCell('registry weak verb', w, { isName: true }); });
  const inverseConflict = conjugationInverseConflicts(reg)[0];
  if (inverseConflict) die(`registry ${inverseConflict}; nothing written`);
}
SERIALIZE_REGISTRY_DEPS.checkReg = assertRegClean;


// bug #23: ISO-date validation at EVERY write path (set/new/apply/freeze --occurred).
// due/occurred are compared LEXICALLY by outbox/futures (§9.5), so a malformed date
// (month 13, non-ISO 07/06/2026) silently mis-sorts an obligation out of the cockpit.
// Reject the garbage at intake with a teaching error naming the expected format; stored
// data is untouched (no migration — this guards the write, not the read/index path).
function isoDateProblem(v, kind = 'date') {
  if (v == null || v === '') return;
  const s = String(v);
  // bug #34: due may carry an owner-local HH:MM wall clock, but every other
  // date-bearing field stays date-only.
  const m = (kind === 'datetime-or-date'
    ? /^(\d{4})-(\d{2})-(\d{2})(T([01]\d|2[0-3]):[0-5]\d)?$/
    : /^(\d{4})-(\d{2})-(\d{2})$/).exec(s);
  if (!m) return 'format';
  const y = +m[1], mo = +m[2], d = +m[3];
  // F-16: setUTCFullYear, not Date.UTC — Date.UTC maps years 00–99 to 19xx, which made
  // legal historical dates like 0044-03-15 die "not a real calendar date".
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return 'calendar';
  return null;
}

const isIsoDate = (v, kind = 'date') => isoDateProblem(v, kind) == null;

function assertIsoDate(field, v, kind = FIELD_TYPES[field] || 'date') {
  const bad = isoDateProblem(v, kind);
  if (!bad) return;
  const s = String(v);
  const expected = kind === 'datetime-or-date' ? 'YYYY-MM-DD or YYYY-MM-DDTHH:MM' : 'YYYY-MM-DD';
  const example = kind === 'datetime-or-date' ? '2026-08-05T14:30' : '2026-08-05';
  if (bad === 'format') die(`${field} '${s}' is not an ISO date — expected ${expected} (e.g. ${example}).`);
  if (bad === 'calendar')
    die(`${field} '${s}' is not a real calendar date (${expected}, month 01–12, a day that exists). e.g. ${example}.`);
}

// bug #73: status is a fixed write-intake vocabulary. Stored data remains signal-only;
// this guards new/set/apply intake so typos do not mint invisible cohort states.
function assertStatus(field, v) {
  if (v == null || v === '') return;
  if (!DOCUMENTED_STATUS.has(String(v)))
    die(`${field} '${String(v)}' is not a documented status (${DOCUMENTED_STATUS_LIST}) — statuses are a fixed vocabulary (freeze sets the terminal ones); nothing written.`);
}

// F-16: READ-side date filters bind into lexical comparisons — a malformed bound
// ('2026-7-1') silently produced an empty/garbage cohort, and a bad --due-to routed
// through addDaysISO minting '0NaN-NaN-NaN' (always 0 rows). Mirror the write-side gate
// (bugs #23/#26): reject at intake with the teaching error. due bounds may carry the
// owner-local HH:MM wall clock like due itself.
function assertReadDateFlags(flags) {
  for (const f of ['occurred-from', 'occurred-to', 'due-from', 'due-to', 'created-from', 'created-to', 'from', 'to'])
    if (flags[f] != null) assertIsoDate(`--${f}`, flags[f], f.startsWith('due') ? 'datetime-or-date' : 'date');
  // Validate PAIRS after validating each endpoint's shape. Without this, an inverted
  // timed due range could still return a date-only row because date-only dues overlap
  // their whole day — a nonsensical query looked successful. Date-only lower/upper due
  // bounds mean start/end of that day respectively; occurred/created/search are dates.
  for (const [fromKey, toKey, label, due] of [
    ['occurred-from', 'occurred-to', 'occurred', false],
    ['due-from', 'due-to', 'due', true],
    ['created-from', 'created-to', 'created', false],
    ['from', 'to', 'search date', false],
  ]) {
    if (flags[fromKey] == null || flags[toKey] == null) continue;
    const from = String(flags[fromKey]), to = String(flags[toKey]);
    const fromPoint = due && !from.includes('T') ? from + 'T00:00' : from;
    const toPoint = due && !to.includes('T') ? to + 'T23:59' : to;
    if (fromPoint > toPoint)
      die(`--${fromKey} '${from}' is after --${toKey} '${to}' — inverted ${label} range; the lower bound must be earlier than or equal to the upper bound${due ? ' (a date-only due bound covers its whole day)' : ''}.`);
  }
}

function validateUpdatedItems(items, opts = {}) {
  if (items == null) return [];
  if (!Array.isArray(items)) die(`updated must be an array of {"x":"<what>","y":"YYYY-MM-DD"} items — got ${typeof items}`);
  const allowed = new Set(['x', 'y', 'from', 'why', 'record']);
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      die(`updated item must be an object {"x":"<what>","y":"YYYY-MM-DD"} — got ${JSON.stringify(item)}`);
    const unknown = Object.keys(item).filter(k => !allowed.has(k));
    if (unknown.length) die(`updated item has unknown key(s): ${unknown.join(', ')} (allowed: x, y, from, why, record)`);
    if (typeof item.x !== 'string' || item.x.trim() === '' || item.y == null || item.y === '')
      die(`updated item needs 'x' (a non-empty string naming what changed) and 'y' (date) — e.g. {"x":"profile.city","y":"2026-03-14"}`);
    assertScalarSize('updated[].x', item.x, opts);
    assertIsoDate('updated[].y', item.y);
    if (item.why != null && (typeof item.why !== 'string' || item.why.trim() === ''))
      die(`updated[].why must be non-empty text when present — nothing written`);
    if (item.why != null) assertScalarSize('updated[].why', item.why, opts);
    if (item.from !== undefined) assertScalarSize('updated[].from', item.from, opts);
    if (item.record != null) assertRelationTarget('updated[].record', item.record);
  }
  return items;
}

function profileSignals(reg, entity, prof, opts = {}) {
  const out = [];
  const profileObj = prof && typeof prof === 'object' && !Array.isArray(prof) ? prof : {};
  const schema = ownValue(reg.entities, entity)?.profile;
  if (!schema) return out;
  const checkEnum = (key, field, v) => {
    if (!field.enum?.includes(String(v)))
      out.push(`profile.${key} '${String(v)}' not in the ${entity}.${key} value set (${(field.enum || []).join('|')})`);
  };
  // V2 (deterministic-checks): a currency SIBLING field on this entity's schema — a number value with
  // no denomination (node currency empty, field carries no currency= code) leaves the amount ambiguous.
  const hasCurrencySibling = hasOwnKey(schema, 'currency');
  const nodeCurrencyEmpty = !hasOwnKey(profileObj, 'currency') || String(ownValue(profileObj, 'currency') ?? '').trim() === '';
  const schemaFieldNames = Object.keys(schema);
  for (const [key, value] of Object.entries(profileObj)) {
    const field = ownValue(schema, key);
    if (!field) {
      const near = nearestRegisteredField(key, schemaFieldNames); // scn56: name the nearest field so the model corrects instead of deleting
      out.push(`profile key '${key}' is not a registered field for '${entity}'${near ? ` — did you mean \`${near}\`?` : ' (unregistered field — register it or fix the typo)'}`);
      continue;
    }
    if (field.type === 'select') {
      if (Array.isArray(value)) {
        // bug RF-1: a list on a select field is a shape signal, then each element is enum-checked.
        out.push(`profile.${key} is a list but '${key}' is a select field (single value)`);
        value.forEach(v => checkEnum(key, field, v));
      }
      else checkEnum(key, field, value);
    } else if (field.type === 'multi') {
      if (!Array.isArray(value)) {
        out.push(`profile.${key} is a single value but '${key}' is a multi field (expects a list)`);
        checkEnum(key, field, value);
      }
      else value.forEach(v => checkEnum(key, field, v));
    } else if (field.type === 'list') {
      if (!Array.isArray(value)) out.push(`profile.${key} is a single value but '${key}' is a list field (expects a list)`);
      else if (opts.checkBudget && Number.isInteger(field.budget) && field.budget > 0 && value.length > field.budget)
        out.push(`profile.${key} over budget (${value.length} > ${field.budget})`);
    } else if (field.type === 'date') {
      const vals = Array.isArray(value) ? value : [value];
      vals.forEach(v => { if (!isIsoDate(v)) out.push(`profile.${key} '${String(v)}' is not an ISO date (YYYY-MM-DD)`); });
    } else if (field.type === 'number') {
      if (!(typeof value === 'number' ? Number.isFinite(value) : Number.isFinite(Number(value))))
        out.push(`profile.${key} '${String(value)}' is not a number`);
      // V2 (deterministic-checks): a number with no denomination on a currency-sibling entity (no node currency, no currency= on the field).
      else if (hasCurrencySibling && nodeCurrencyEmpty && field.currency == null && key !== 'currency')
        out.push(`profile.${key} is a number with no currency — '${entity}' has a currency field but this node leaves it empty and ${key} carries no fixed code; set profile.currency (a 3-letter code) or register ${entity}.${key} with currency=CODE`);
    } else if (field.type === 'bool') {
      if (typeof value !== 'boolean') out.push(`profile.${key} '${String(value)}' is not a boolean (true/false)`);
    } else if (field.type === 'text') {
      // V3 (deterministic-checks): a currency code that is not ^[A-Z]{3}$ won't match/query cleanly.
      if (key === 'currency' && typeof value === 'string' && value.trim() !== '' && !/^[A-Z]{3}$/.test(value)) {
        const upper = value.trim().toUpperCase();
        out.push(/^[A-Z]{3}$/.test(upper)
          ? `profile.currency '${value}' is not a 3-letter code — did you mean ${upper}? (ISO 4217, e.g. EUR/USD/GBP)`
          : `profile.currency '${value}' is not a 3-letter ISO 4217 code (e.g. EUR/USD/GBP) — put a nuance like "EUR, sometimes USD" in the body/why`);
      }
    }
  }
  if (opts.checkRequired) {
    for (const [key, field] of Object.entries(schema)) {
      const value = ownValue(profileObj, key);
      if (field.required === true && (!hasOwnKey(profileObj, key) || value === '' || (Array.isArray(value) && value.length === 0)))
        out.push(`profile.${key} is required for '${entity}' but missing`);
    }
  }
  return out;
}

// asks-contract — the ONE uniform surface for every deterministic ambiguity (asks-contract.md).
// Every detector (entity-match, entity-new, roll-cycle, …) emits ask entries through buildAsk,
// so the shape is identical everywhere and the PA needs one standing rule. An ask states the
// fork, its options, and what each option does; the engine only detects/describes, never resolves.
// deterministic-checks §2.2: the ask-kind roster. Shipped: entity-match/entity-new/roll-cycle;
// added by the checks waves (all non-blocking, all via buildAsk with the fork-doctrine evidence shape).
const ASK_KINDS = new Set(['entity-match', 'entity-new', 'roll-cycle',
  'completion-target', 'duplicate-future', 'due-jump', 'filing-unanchored', 'place-role', 'possible-duplicate', 'enum-variant', 'field-variant']);
// fork-doctrine §2: the "keep/deliberate" escape option ids — the always-present outs that do NOT
// map onto an enumerated candidate. EVERY other option must correspond 1:1 to a surviving candidate,
// so the engine can never invent an option that is not an enumerated outcome.
const ASK_ESCAPE_OPTION_IDS = new Set(['keep-text', 'create-and-link']);
// The evidence clause every warning/refusal appends so the PA can relay the engine's homework verbatim.
const askEvidenceClause = (evidence) => ` I checked ${evidence.checked.join('; ')}: ${evidence.found.join('; ')}.`;
// M1 (operator-phrasable contract): an ask's `question` is spoken to a business owner, not an engineer —
// it must never carry the MACHINE's internal vocabulary. Per the vocabulary flip (example-pa decision #162)
// the domain nouns — the four states (action/event/obligation/decision) and the artifact nouns (project/
// person/company/place/card/bill/…) — are now TAUGHT operator vocabulary and are allowed; only words that
// name the engine's internals stay forbidden. This deterministic wordlist lint at buildAsk makes it
// impossible for a future detector to ship those internals to the operator channel. Interpolated operator
// values and slugs are ALWAYS single-quoted, so quoted spans are exempt (a value literally naming 'the
// record store' must not trip it); the check bites only the engine's own template prose. Option EFFECTS
// keep exact CLI syntax (the agent tail).
const OPERATOR_FORBIDDEN_WORDS = new Set([
  'slug', 'apply', 'field', 'node', 'nodes', 'entity', 'entities', 'profile', 'ref', 'registry', 'frontmatter', // the machine's internals only
]);
const QUOTED_SPAN_RE = new RegExp("'[^']*'", 'g'); // single-quoted spans = interpolated operator values/slugs (constructed, not a /literal/, so tooling that can't parse regex literals stays in sync)
const operatorJargon = (text) => {
  const template = String(text).replace(QUOTED_SPAN_RE, "''"); // exempt the interpolated operator content
  return (template.toLowerCase().match(/[a-z]+/g) || []).find(w => OPERATOR_FORBIDDEN_WORDS.has(w)) || null;
};
function buildAsk(kind, { slug = null, field = null, value = null, question, options, context = {} }) {
  if (!ASK_KINDS.has(kind)) die(`internal: unknown ask kind '${kind}' (bug in the caller, not your input)`);
  if (typeof question !== 'string' || question.trim() === '') die(`internal: ask '${kind}' needs a non-empty question`);
  { const jarg = operatorJargon(question); if (jarg) die(`internal: ask '${kind}' question ships operator-jargon '${jarg}' — the question is spoken to the operator; phrase it in their register (put CLI/field-path detail in an option effect or the agent tail). Got: ${question}`); } // M1
  if (!Array.isArray(options) || options.length === 0) die(`internal: ask '${kind}' needs at least one option`);
  for (const o of options)
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || o.id === '' || typeof o.label !== 'string' || typeof o.effect !== 'string')
      die(`internal: ask '${kind}' option needs non-empty string id + string label/effect`);
  if (!context || typeof context !== 'object' || Array.isArray(context)) die(`internal: ask '${kind}' context must be an object`);
  // fork-doctrine §2: every ask carries the evidence it FILTERED on (checked/found) + the surviving
  // enumerated candidates, and the non-escape options map 1:1 onto those candidates.
  const ev = context.evidence;
  if (!ev || typeof ev !== 'object' || Array.isArray(ev) || !Array.isArray(ev.checked) || ev.checked.length === 0 || !ev.checked.every(s => typeof s === 'string' && s !== ''))
    die(`internal: ask '${kind}' context.evidence.checked must be a non-empty list of what the detector queried`);
  if (!Array.isArray(ev.found) || !ev.found.every(s => typeof s === 'string'))
    die(`internal: ask '${kind}' context.evidence.found must be a string list of what it showed (["nothing"] is valid — stating absence is the point)`);
  if (!Array.isArray(context.candidates))
    die(`internal: ask '${kind}' context.candidates must be an array (the surviving enumerated outcomes)`);
  const candidateOptions = options.filter(o => !ASK_ESCAPE_OPTION_IDS.has(o.id)).length;
  if (candidateOptions !== context.candidates.length)
    die(`internal: ask '${kind}' has ${candidateOptions} candidate option(s) for ${context.candidates.length} candidate(s) — options map 1:1 onto candidates plus keep/deliberate escapes`);
  return { kind, slug, field, value, question, options, context };
}

// Blocking-ask delivery: a verb that cannot half-act refuses, and the refusal carries the ask
// payload on the error surface. The refusal ALSO appends the ask to the durable ledger (ask-ledger
// §1.3) — the one side effect of a blocking refusal, mirroring how the outbox persists passed-dues.
// `buildMessage(id)` composes the human text AFTER the id is minted (idempotent by slug+kind), so the
// refusal names the id to cite (--ask <id>). e.asks carries the machine shape for apply frames.
// Non-blocking asks instead ride a successful result under `asks`.
function refuseWithAsk(ctx, ask, buildMessage) {
  const id = askLedgerRaise(ctx, ask); // idempotent open-row append; reuses an existing open row for this slug+kind
  ask.id = id;
  const e = new BrainError(buildMessage(id));
  e.asks = [ask];
  throw e;
}

// ---------- ask ledger (ask-ledger.md): blocking asks become durable, citable state ----------
// A registry-style human-readable Markdown table at brain/__meta/asks.md — NO second SQLite store.
// Lock-merged writes (re-read under the lock, mutate, atomic write), so concurrent appends never
// last-wins. Its own file, no REG_FORMAT tie: an older engine that never reads it is unaffected.
// Columns: id · kind · slug · status(open|answered|withdrawn) · raised_at · answered_at ·
// answered_with(chosen option id) · options(id=label :: …) · question · answer_ref(free text).
function asksLedgerPath(root) { return path.join(root, 'brain', '__meta', 'asks.md'); }
const ASKS_LEDGER_HEADER = [
  '# brain ask ledger — durable blocking asks (ask-ledger.md). Machine-authored; hand-edit only to withdraw a row.',
  '# format 1 · escaping: \\| = literal pipe, \\\\ = literal backslash · an empty cell is "-".',
  '',
  '| id | kind | slug | status | raised_at | answered_at | answered_with | options | question | answer_ref |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
const escLedgerCell = (v) => {
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').trim();
  return s === '' ? '-' : s;
};
// Split a "| a | b\|c | … |" table row into unescaped, trimmed cells (respecting \| and \\).
// Returns null for a line that is not a pipe-delimited row.
function splitLedgerCells(line) {
  const s = line.trim();
  if (!s.startsWith('|') || !s.endsWith('|')) return null;
  const inner = s.slice(1, -1);
  const cells = []; let cur = '', esc = false;
  for (const ch of inner) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === '\\') { esc = true; cur += ch; continue; } // keep the backslash; the unescape pass resolves it
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.map(c => {
    let out = '', e = false;
    for (const ch of c) {
      if (e) { out += ch; e = false; continue; }
      if (ch === '\\') { e = true; continue; }
      out += ch;
    }
    return out.trim();
  });
}
const parseLedgerOptions = (raw) => raw ? raw.split(' :: ').map(p => { const i = p.indexOf('='); return i < 0 ? { id: p, label: p } : { id: p.slice(0, i), label: p.slice(i + 1) }; }) : [];
function parseAsksLedger(text) {
  const rows = [], warnings = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const cells = splitLedgerCells(t);
    if (!cells) continue;
    if (cells[0] === 'id' || /^-{2,}$/.test(cells[0])) continue; // header / separator row
    if (cells.length !== 10) { warnings.push(`malformed ask row (${cells.length} cells, expected 10): ${t.slice(0, 80)}`); continue; }
    const [id, kind, slug, status, raised_at, answered_at, answered_with, opts, question, answer_ref] = cells.map(c => c === '-' ? '' : c);
    if (!id || !kind || !slug) { warnings.push(`ask row missing id/kind/slug: ${t.slice(0, 80)}`); continue; }
    rows.push({ id, kind, slug, status: status || 'open', raised_at, answered_at, answered_with, options: parseLedgerOptions(opts), question, answer_ref });
  }
  return { rows, warnings };
}
function serializeAskRow(r) {
  const opts = (r.options || []).map(o => `${o.id}=${String(o.label ?? '')}`).join(' :: ');
  return '| ' + [r.id, r.kind, r.slug, r.status, r.raised_at, r.answered_at, r.answered_with, opts, r.question, r.answer_ref].map(escLedgerCell).join(' | ') + ' |';
}
const serializeAsksLedger = (rows) => ASKS_LEDGER_HEADER.concat(rows.map(serializeAskRow)).join('\n') + '\n';
function readAsksLedger(root) {
  let text;
  try { text = fs.readFileSync(asksLedgerPath(root), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { rows: [], warnings: [] }; throw e; }
  return parseAsksLedger(text);
}
const askStamp = (ctx) => `${ctx.today()}T${localTime(ctx.tz)}`; // owner-clock stamp (day + HH:MM), the now machinery
const askIdN = (id) => { const m = /-(\d+)$/.exec(String(id)); return m ? +m[1] : 0; };
const nextAskId = (rows, slug) => `ask-${slug}-${Math.max(0, ...rows.filter(r => r.slug === slug).map(r => askIdN(r.id))) + 1}`;
// Lock-merge: re-read the ledger under the lock, let fn mutate `rows`, write atomically. Returns fn's value.
function withAsksLedger(ctx, fn) {
  const { root } = ctx;
  fs.mkdirSync(path.join(root, 'brain', '__meta'), { recursive: true });
  let result;
  withLock(path.join(root, '.brain', 'asks.lock'), () => {
    const { rows } = readAsksLedger(root);
    result = fn(rows);
    atomicWrite(asksLedgerPath(root), serializeAsksLedger(rows));
  });
  return result;
}
// Raise: idempotent open-row append (ask-ledger §1.1/1.3). An open row for the same slug+kind is
// reused (no duplicate) so a re-raised fork keeps one id; otherwise mint ask-<slug>-<n>.
function askLedgerRaise(ctx, ask) {
  return withAsksLedger(ctx, (rows) => {
    const open = rows.find(r => r.slug === ask.slug && r.kind === ask.kind && r.status === 'open');
    if (open) return open.id;
    const id = nextAskId(rows, ask.slug);
    rows.push({ id, kind: ask.kind, slug: ask.slug, status: 'open', raised_at: askStamp(ctx), answered_at: '', answered_with: '',
      options: (ask.options || []).map(o => ({ id: o.id, label: o.label })), question: ask.question, answer_ref: '' });
    return id;
  });
}
// Answer a CITED row (--ask <id>): validate exists/open/slug+kind/option, then flip to answered.
// Teaching refusals (die → BrainError) on every invalid citation.
function askLedgerAnswer(ctx, { id, slug, kind, optionId }) {
  return withAsksLedger(ctx, (rows) => {
    const hit = rows.find(r => r.id === id);
    if (!hit) die(`no ask '${id}' in the ledger — check the id (brain asks --open), or answer without --ask to record fresh.`);
    if (hit.status !== 'open') die(`ask '${id}' is already ${hit.status}${hit.answered_with ? ` (${hit.answered_with})` : ''} — a settled ask is not re-answered.`);
    if (hit.slug !== slug || hit.kind !== kind) die(`ask '${id}' is for '${hit.slug}' (${hit.kind}), not this ${kind} on '${slug}' — cite the ask that belongs to this fork.`);
    if (!hit.options.some(o => o.id === optionId)) die(`ask '${id}' offers no option '${optionId}' (offered: ${hit.options.map(o => o.id).join(', ') || 'none'}).`);
    hit.status = 'answered'; hit.answered_at = askStamp(ctx); hit.answered_with = optionId;
    return hit;
  });
}
// Same-invocation answer (ask-ledger §1.4): an override flag with NO open ask + NO cited id mints a
// row AND answers it in one call, answered_at == raised_at — the b15 audit signature the PA layer
// and graders key on (the engine permits it; it cannot know who is talking).
function askLedgerMintAnswered(ctx, ask, optionId) {
  return withAsksLedger(ctx, (rows) => {
    const id = nextAskId(rows, ask.slug);
    const stamp = askStamp(ctx);
    rows.push({ id, kind: ask.kind, slug: ask.slug, status: 'answered', raised_at: stamp, answered_at: stamp, answered_with: optionId,
      options: (ask.options || []).map(o => ({ id: o.id, label: o.label })), question: ask.question, answer_ref: '' });
    return id;
  });
}
// Withdraw (ask-ledger §1.5): evidence now resolves the fork, so the original verb auto-withdraws
// any open ask for this slug+kind (status withdrawn, answer_ref names the evidence). Returns the count.
function askLedgerWithdraw(ctx, slug, kind, answerRef) {
  return withAsksLedger(ctx, (rows) => {
    const open = rows.filter(r => r.slug === slug && r.kind === kind && r.status === 'open');
    for (const r of open) { r.status = 'withdrawn'; r.answered_at = askStamp(ctx); r.answer_ref = answerRef; }
    return open.length;
  });
}
const openAsksFor = (root, slug, kind = null) => readAsksLedger(root).rows.filter(r => r.status === 'open' && r.slug === slug && (kind == null || r.kind === kind));

// Entity-echo guard, filter half (§3 matching rules): from the named changed profile keys,
// keep only the values eligible for an entity lookup — scalar strings that are not empty,
// not > 80 chars, do not parse as a number, are not an ISO date/datetime, and are not a
// registered enum member (select/multi fields never entity-match). Unregistered fields ARE
// considered — that unregistered string is the exact defect this guard catches. Returns
// [{field, value, ref, restrict}] — ref/restrict drive the entity-ref-fields "should this be
// an entity?" ask (restrict = the entities= set, or null when unrestricted / non-ref).
function profileEntityCandidates(reg, entity, profile, keys) {
  const schema = ownValue(reg.entities, entity)?.profile || {};
  const out = [], seen = new Set();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (!hasOwnKey(profile, key)) continue;
    const value = profile[key];
    if (typeof value !== 'string') continue;                 // strings only (lists/numbers/bools skipped)
    const trimmed = value.trim();
    if (trimmed === '' || value.length > 80) continue;       // empty or > 80 chars
    if (Number.isFinite(Number(trimmed))) continue;          // parses as a number
    if (isIsoDate(value, 'datetime-or-date')) continue;      // ISO date or datetime
    const field = ownValue(schema, key);
    if (field && (field.type === 'select' || field.type === 'multi')) continue; // enum sets never entity-match
    const ref = field?.type === 'ref';
    out.push({ field: key, value, ref, restrict: ref && Array.isArray(field.entities) && field.entities.length ? field.entities : null });
  }
  return out;
}

// V4/V5 near-miss asks (deterministic-checks §8). Fold = casefold + strip non-alphanumerics (collapses
// case, hyphen/underscore, punctuation). ENUMERATE registered fields / enum members [closed set]; FILTER
// by the fold; COUNT exactly ONE survivor → ask (accept the registered spelling vs keep authored). x_ keys
// exempt (deliberate experiment). Multi-member folds stay the generic signal — never guessed.
const variantFold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
// scn56 fix: teach the unregistered-profile-field warn to name the field the operator most likely meant.
// LAW: closed comparison over the entity's OWN registered field names — folded equality (variantFold),
// a bounded edit-distance ≤2 on the folds, OR a shared stem (≥5-char common prefix, e.g. recurrence→recurs).
// Returns the field ONLY when EXACTLY ONE registered field matches (0 or ≥2 → null, no guess). No fuzz
// beyond these deterministic rules; teaching suffix only — never an auto-fix.
const commonPrefixLen = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
function boundedEditDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1; // length gap alone exceeds the budget
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function nearestRegisteredField(key, fieldNames) {
  const fk = variantFold(key);
  const hits = fieldNames.filter(f => { const ff = variantFold(f); return ff === fk || boundedEditDistance(fk, ff, 2) <= 2 || commonPrefixLen(fk, ff) >= 5; });
  return hits.length === 1 ? hits[0] : null;
}
function profileVariantAsks(reg, entity, profile, keys, writingSlug, signals) {
  const schema = ownValue(reg.entities, entity)?.profile || {};
  const fieldNames = Object.keys(schema);
  const asks = [];
  for (const key of keys) {
    if (!hasOwnKey(profile, key)) continue;
    const value = profile[key];
    const spec = ownValue(schema, key);
    if (!spec) { // V5: an unregistered key whose fold matches exactly one registered field
      if (key.startsWith('x_')) continue;
      const fk = variantFold(key);
      const matches = fieldNames.filter(f => variantFold(f) === fk && f !== key);
      if (matches.length === 1) {
        const field = matches[0];
        const evidence = { checked: [`registered ${entity} fields`], found: [`'${field}' folds to the same key`] };
        asks.push(buildAsk('field-variant', { slug: writingSlug, field: key, value: typeof value === 'string' ? value : null,
          question: `'${key}' isn't one of the details I usually keep — did you mean '${field}'?`,
          options: [{ id: `use-${field}`, label: `move to ${field}`, effect: `set profile.${field} instead of profile.${key}` },
            { id: 'keep-text', label: `register '${key}'`, effect: `register --entity ${entity} --field ${key} … (a deliberate new field)` }],
          context: { evidence, candidates: [{ field }] } }));
        signals.push(`profile.${key} is unregistered but folds to the field '${field}' — move the value to '${field}', or register '${key}' deliberately.${askEvidenceClause(evidence)}`);
      }
      continue;
    }
    if (spec.type === 'select' || spec.type === 'multi') { // V4: a failing enum value whose fold matches exactly one member
      const enumMembers = spec.enum || [];
      for (const v of (Array.isArray(value) ? value : [value])) {
        if (typeof v !== 'string' || enumMembers.includes(v)) continue;
        const fv = variantFold(v), matches = enumMembers.filter(m => variantFold(m) === fv);
        if (matches.length === 1) {
          const member = matches[0];
          const evidence = { checked: [`the ${entity}.${key} value set (${enumMembers.join('|')})`], found: [`'${member}' folds to the same value`] };
          asks.push(buildAsk('enum-variant', { slug: writingSlug, field: key, value: v,
            question: `'${v}' isn't one of the usual choices for '${key}' — did you mean '${member}'?`,
            options: [{ id: `use-${member}`, label: `accept ${member}`, effect: `set profile.${key} to the registered '${member}'` },
              { id: 'keep-text', label: 'keep as authored', effect: `leave '${v}' — it drops from the '${member}' cohort; tell the operator` }],
            context: { evidence, candidates: [{ member }] } }));
          signals.push(`profile.${key} '${v}' folds to the enum member '${member}' but isn't it exactly — accept '${member}', or keep '${v}' deliberately (it won't match the '${member}' cohort).${askEvidenceClause(evidence)}`);
        }
      }
    }
  }
  return asks;
}

const isOpen = (status) => status == null || !OPEN_ONLY_HIDDEN.has(status);

// slug-date coherence. Shipped: a record's YYYY-MM-DD- prefix must equal occurred/created. T5
// (deterministic-checks §1) extends it: a future's prefix must equal its due date-part, and a CARD
// must carry no full-date prefix at all (dated transient state on a no-time node). Bare years never fire.
function slugDateSignal(r) {
  const m = /^(\d{4}-\d{2}-\d{2})-/.exec(r.slug);
  if (!m) return null;
  const cls = r.class || (r.occurred ? 'record' : r.due ? 'future' : null);
  if (cls === 'card') // T5 card-half: a card must not carry a full date prefix
    return `slug '${r.slug}' carries a full date prefix ${m[1]} but is a card (cards have no time anchor) — date it as a future/record, drop the prefix, or keep it deliberately`;
  if (cls === 'future') { // T5 future-half: the prefix must match the due date-part
    const duePart = r.due ? String(r.due).slice(0, 10) : null;
    return duePart && m[1] !== duePart ? `slug '${r.slug}' leading date ${m[1]} ≠ due ${duePart} — the date prefix should equal the due date, or drop it` : null;
  }
  // record (or occurred-bearing): the prefix must match occurred/created
  const own = r.occurred || r.created;
  if (!own || m[1] === own) return null;
  return `slug '${r.slug}' leading date ${m[1]} ≠ ${r.occurred ? 'occurred' : 'date_created'} ${own}`;
}

const lintPrefix = (src) => src.slug ? `${src.slug}: ` : '';

// brain-profiles §5: votes is a plain string scalar holding a CANONICAL signed integer
// ("3", "-2" — no +, no leading zeros); the vote verb rewrites it canonically and the
// index column casts once here. Anything else → null (absent = 0 via COALESCE).
const VOTES_CANONICAL_RE = /^(0|-?[1-9]\d*)$/;
const canonicalVotesInt = (v) => typeof v === 'string' && VOTES_CANONICAL_RE.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null;

// context-retrieval §4/§5: the one lint/check/doctor signal for an unmigrated focus: block.
const LEGACY_FOCUS_BLOCK_SIGNAL = (src) => `${lintPrefix(src)}legacy focus: block — migrate to in_context → focus (INSTALL §Upgrading)`;

// context-entity §5: toolNoServes widened to toolUnwired — a tool is reachable by an
// engine-known edge, and in_context is now such an edge. Both attach shapes are named so
// the recipe is followable from either side; one literal, two emitters (check + doctor).
const toolUnwiredBody = (slug) => `tool '${slug}' has no serves or in_context edge — a tool serves something, or sits in a context; wire it (brain link ${slug} --verb serves --to <entity>) or (brain link ${slug} --verb in_context --to <context>), or keep it deliberately`;
const toolIsUnwired = (relations) => !(relations || []).some(item => hasOwnKey(item || {}, 'serves') || hasOwnKey(item || {}, 'in_context'));

const LINT_MSG = {
  noEntity: (src, opts) => opts.importReady ? `no entity (REQUIRED, §2)` : `${lintPrefix(src)}no entity`,
  unregisteredEntity: (src, opts) => opts.importReady
    ? `unregistered entity '${src.entity}' (register it or fix the typo)`
    : `${lintPrefix(src)}unregistered entity '${src.entity}' (register or typo?)`,
  noDescription: (src) => `${lintPrefix(src)}no description (THE search surface)`,
  badClass: (src, reg) => `class '${src.class}' not in entity '${src.entity}' tenses [${reg.entities[src.entity].tenses.join(', ')}]`,
  badStatus: (src, opts) => opts.importReady
    ? `status '${src.status}' not a documented status value (${DOCUMENTED_STATUS_LIST})`
    : `${lintPrefix(src)}status '${src.status}' not in the documented set (${DOCUMENTED_STATUS_LIST})`,
  dueClass: (src, cls) => `${lintPrefix(src)}due belongs only on a future (effective class is '${cls}') — remove due or make the node a future`,
  occurredClass: (src, cls) => `${lintPrefix(src)}occurred belongs only on a record (effective class is '${cls}') — freeze a future or remove occurred`,
  recordNoOccurred: (src) => `${lintPrefix(src)}record without occurred — a record is a time anchor; every window/timeline query misses it and it cannot anchor record-provenance links. Estimate the date (set occurred) or keep it dateless deliberately`, // T1
  recordLiveStatus: (src, status) => `${lintPrefix(src)}record with status '${status}' — the frozen past is never a live lifecycle state (records carry no completion status; freeze stamps only dropped/superseded). Remove the status, or leave it deliberately`, // T2
  recordValidity: (src, which) => `${lintPrefix(src)}record with ${which} — the frozen past has no live validity window; that fact belongs on the referenced card. Move it, or keep it deliberately`, // T3
  openObligationNoDue: (src) => `${lintPrefix(src)}open obligation with no due — invisible to outbox; add a due or make it someday/maybe deliberately`,
  terminalFutureNeverFrozen: (src) => `${lintPrefix(src)}future with a terminal status but never frozen (no occurred) — it never became a record and is absent from futures/outbox; freeze it or reset status`,
  shelvedFuture: (src) => `${lintPrefix(src)}future with status '${src.status}' — excluded from every default view but never frozen (no occurred); deliberate shelving, or should it be frozen/reset?`, // F-9
  toolUnwired: (src) => `${lintPrefix(src)}${toolUnwiredBody(src.slug)}`,
  harnessReflexive: (src, verb, target) => `${lintPrefix(src)}${verb} edge points to itself (${target}) — remove it or keep it deliberately`,
  descriptionWords: (src, wc) => `${lintPrefix(src)}description ${wc} words (aim 5–20)`,
  weakFuture: (src) => `${lintPrefix(src)}weak future statement?`,
  profileSignal: (src, p) => `${lintPrefix(src)}${p}`,
  malformedProfileJson: (src) => `${lintPrefix(src)}profile_json is malformed (${src.profileJsonError})`,
  badDate: (field, value) => `${field} '${value}' is not an ISO date (YYYY-MM-DD)`,
  badBool: (field, value) => `${field} '${value}' is not a boolean (true/false)`,
  unknownField: (src, k) => `${lintPrefix(src)}unknown frontmatter field '${k}' (not in the spec §2 field set — typo, or belongs in profile/body?)`,
  scalarList: (k) => `field '${k}' is a list but §2 expects a scalar`,
  importantBool: (value) => `important must be true or false (got '${value}')`,
};

function updatedCapacityAdvisory(src) {
  if (!Array.isArray(src.updated)) return null;
  const count = src.updated.length;
  if (count >= UPDATED_CAP) {
    const state = count === UPDATED_CAP ? 'at capacity' : 'over capacity';
    return `${lintPrefix(src)}updated[] ${state} (${count}/${UPDATED_CAP}) — the next push drops the oldest entry; history beyond ${UPDATED_CAP} belongs in records`;
  }
  if (count >= UPDATED_NEAR_CAP)
    return `${lintPrefix(src)}updated[] near capacity (${count}/${UPDATED_CAP}) — distill or move history to records before the oldest entry is evicted; history beyond ${UPDATED_CAP} belongs in records`;
  return null;
}

function lintSrcFromRow(r) {
  const src = { ...r, date_created: r.created, profile: {} };
  try { src.profile = JSON.parse(r.profile_json || '{}'); }
  catch (e) { src.profileJsonError = e.message; }
  return src;
}

function lintSrcFromFm(fm) {
  return { ...fm, created: fm.date_created, profile: fm.profile || {} };
}

function nodeLint(reg, src, opts = {}) {
  const probs = [];
  if (opts.unknownFieldsOnly) {
    const labelSrc = opts.prefixSlug ? { ...src, slug: opts.prefixSlug } : src;
    for (const k of Object.keys(src)) {
      if (!KNOWN_FM_FIELDS.has(k)) probs.push(LINT_MSG.unknownField(labelSrc, k));
    }
    return probs;
  }
  for (const [field, type] of Object.entries(FIELD_TYPES)) {
    if (!(field in src)) continue;
    if ((type === 'date' || type === 'datetime-or-date') && !isIsoDate(src[field], type))
      probs.push(LINT_MSG.badDate(field, src[field])); // bug #76
    if (type === 'bool' && field !== 'important' && typeof src[field] !== 'boolean')
      probs.push(LINT_MSG.badBool(field, src[field])); // bug #76
  }
  for (const field of TEXT_FM_FIELDS) {
    if (!hasOwnKey(src, field) || typeof src[field] === 'string') continue;
    probs.push(`${field} must be a scalar text value (got ${Array.isArray(src[field]) ? 'a list' : jsonType(src[field])})`);
  }
  if (hasOwnKey(src, 'important') && typeof src.important !== 'boolean')
    probs.push(LINT_MSG.importantBool(Array.isArray(src.important) ? JSON.stringify(src.important) : String(src.important)));
  if (opts.frontmatterFieldsOnly) {
    for (const k of Object.keys(src)) {
      if (k === 'slug') continue;
      if (!KNOWN_FM_FIELDS.has(k)) probs.push(LINT_MSG.unknownField(src, k));
    }
    return probs;
  }
  const entitySpec = ownValue(reg.entities, src.entity);
  if (!src.entity) probs.push(LINT_MSG.noEntity(src, opts));
  else if (!entitySpec) probs.push(LINT_MSG.unregisteredEntity(src, opts));
  if (!src.description) probs.push(LINT_MSG.noDescription(src));
  if (!src.date_created && !src.created) probs.push(`${lintPrefix(src)}date_created is required (when this node was first authored)`);
  if (src[SCALAR_CODEC_FIELD] != null && src[SCALAR_CODEC_FIELD] !== SCALAR_CODEC_VERSION)
    probs.push(`${lintPrefix(src)}${SCALAR_CODEC_FIELD} '${String(src[SCALAR_CODEC_FIELD])}' is unknown — expected '${SCALAR_CODEC_VERSION}' or remove the stamp`);
  if (src.class && entitySpec && !entitySpec.tenses.includes(src.class))
    probs.push(LINT_MSG.badClass(src, reg));
  const effectiveClass = deriveClass(reg, src);
  if (src.due && effectiveClass !== 'future') probs.push(LINT_MSG.dueClass(src, effectiveClass));
  if (src.occurred && effectiveClass !== 'record') probs.push(LINT_MSG.occurredClass(src, effectiveClass));
  // T1/T2/T3 (deterministic-checks §1) — the record class-domain family, beside due/occurred. warn-level:
  // check + doctor temporal-class-signals surface them; imports tolerate (advisory in cmdLint).
  if (effectiveClass === 'record') {
    if (!src.occurred) probs.push(LINT_MSG.recordNoOccurred(src)); // T1: a record needs its time anchor
    if (src.status === 'open' || src.status === 'waiting') probs.push(LINT_MSG.recordLiveStatus(src, src.status)); // T2
    const validity = src.expires != null ? 'expires' : src.renews === true ? 'renews' : null;
    if (validity) probs.push(LINT_MSG.recordValidity(src, validity)); // T3
  }
  if (src.relations != null) {
    if (!Array.isArray(src.relations)) probs.push(`${lintPrefix(src)}relations must be a list of one-verb items`);
    else src.relations.forEach((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        probs.push(`${lintPrefix(src)}relations[${i}] must be an object with EXACTLY one verb plus optional why`);
        return;
      }
      const verbs = Object.keys(item).filter(k => k !== 'why');
      // Display-only inverse spellings (served_by/has_part) are never authored — a
      // hand-authored one renders on reads but is invisible to the topology guards.
      for (const v of verbs) {
        const invBase = displayOnlyInverseBase(reg, v);
        if (invBase) probs.push(`${lintPrefix(src)}relations[${i}] verb '${v}' is the display-only inverse of '${invBase}' — reads render it on inbound edges; never author it (author '${invBase}' from the ${invBase === 'part_of' ? 'child' : 'served'} side)`);
      }
      if (verbs.length !== 1) {
        probs.push(`${lintPrefix(src)}relations[${i}] has ${verbs.length ? `${verbs.length} verb keys (${verbs.join(', ')})` : 'no verb key'} — each item needs EXACTLY one verb plus optional why`);
      } else {
        const verb = verbs[0], target = item[verb];
        const vp = relationVerbProblem(verb);
        if (vp) probs.push(`${lintPrefix(src)}relations[${i}] verb '${verb}' ${vp}`);
        if (typeof target !== 'string' || target.trim() === '')
          probs.push(`${lintPrefix(src)}relations[${i}] target for '${verb}' must be a non-empty slug string`);
        else {
          const targetProblem = slugLint(target);
          if (targetProblem) probs.push(`${lintPrefix(src)}relations[${i}] target for '${verb}': ${targetProblem}`);
          // Reflexivity is alias-semantic: an alias-spelled target names the same node
          // the graph reads resolve it to, so a hand-authored serves/part_of through a
          // slug alias is still a self-edge. A real node shadows its own name (alias or
          // not) — when a db is available, do not flag an edge that truly targets it;
          // callers that can see the source tree pass sourceExists so a not-yet-indexed
          // real node also shadows its alias name pre-sync (F7 — write planning already
          // treats an existing source file as the shadow).
          const alias = ownValue(reg.aliases, target);
          const aliasSelf = alias && alias.kind === 'slug' && alias.to === src.slug
            && !(opts.db && opts.db.prepare(`SELECT 1 FROM nodes WHERE slug=?`).get(target))
            && !(opts.sourceExists && opts.sourceExists(target));
          if (HARNESS_REFLEXIVE_VERBS.has(verb) && (target === src.slug || aliasSelf))
            probs.push(LINT_MSG.harnessReflexive(src, verb, target));
        }
      }
      if (hasOwnKey(item, 'why') && (typeof item.why !== 'string' || item.why.trim() === ''))
        probs.push(`${lintPrefix(src)}relations[${i}].why must be non-empty text when present`);
    });
  }
  if (src.updated != null) {
    if (!Array.isArray(src.updated)) probs.push(`${lintPrefix(src)}updated must be a list of mutation items`);
    else src.updated.forEach((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        probs.push(`${lintPrefix(src)}updated[${i}] must be an object with x + non-empty ISO-date y`);
        return;
      }
      if (typeof item.x !== 'string' || item.x.trim() === '') probs.push(`${lintPrefix(src)}updated[${i}].x must be non-empty text`);
      if (item.y == null || item.y === '') probs.push(`${lintPrefix(src)}updated[${i}].y is required and must be an ISO date (YYYY-MM-DD)`);
      else {
        const bad = isoDateProblem(item.y);
        if (bad) probs.push(`${lintPrefix(src)}updated[${i}].y '${String(item.y)}' is not an ISO date (YYYY-MM-DD)`);
      }
      const unknown = Object.keys(item).filter(k => !['x', 'y', 'from', 'why', 'record'].includes(k));
      if (unknown.length) probs.push(`${lintPrefix(src)}updated[${i}] has unknown key(s): ${unknown.join(', ')} (allowed: x, y, from, why, record)`);
      if (hasOwnKey(item, 'why') && (typeof item.why !== 'string' || item.why.trim() === ''))
        probs.push(`${lintPrefix(src)}updated[${i}].why must be non-empty text when present`);
      if (hasOwnKey(item, 'record')) {
        if (typeof item.record !== 'string' || item.record.trim() === '') probs.push(`${lintPrefix(src)}updated[${i}].record must be a non-empty slug string when present`);
        else {
          const recordProblem = slugLint(item.record);
          if (recordProblem) probs.push(`${lintPrefix(src)}updated[${i}].record: ${recordProblem}`);
        }
      }
    });
    if (opts.capacityAdvisories) {
      const capacity = updatedCapacityAdvisory(src);
      if (capacity) probs.push(capacity);
    }
  }
  // context-retrieval §4 transitional tolerance: a lingering focus: block is semantically
  // INERT (nothing indexes or ranks it) and round-trips byte-faithfully; the ONE signal is
  // the migration pointer — shape detail retired with the block model.
  if (src.focus != null) probs.push(LEGACY_FOCUS_BLOCK_SIGNAL(src));
  if (src.status && !DOCUMENTED_STATUS.has(src.status)) probs.push(LINT_MSG.badStatus(src, opts));
  if (!opts.importReady) {
    if (src.entity === 'obligation' && src.class === 'future' && isOpen(src.status) && !src.due)
      probs.push(LINT_MSG.openObligationNoDue(src));
    if (src.class === 'future' && TERMINAL_STATUSES.has(String(src.status ?? '')) && !src.occurred)
      probs.push(LINT_MSG.terminalFutureNeverFrozen(src));
    if (src.class === 'future' && src.status && EXCLUDED_SET.has(String(src.status)) && !TERMINAL_STATUSES.has(String(src.status)) && !src.occurred)
      probs.push(LINT_MSG.shelvedFuture(src)); // F-9
    if (src.entity === 'tool' && toolIsUnwired(src.relations))
      probs.push(LINT_MSG.toolUnwired(src));
    const wc = typeof src.description === 'string' ? (src.description || '').split(/\s+/).length : 0;
    if (wc > 25) probs.push(LINT_MSG.descriptionWords(src, wc));
    if (src.class === 'future' && typeof src.description === 'string' && !/\w+ /.test(src.description)) probs.push(LINT_MSG.weakFuture(src));
    const slugDateProb = slugDateSignal(src);
    if (slugDateProb) probs.push(slugDateProb);
  }
  if (!opts.importReady && src.profileJsonError) probs.push(LINT_MSG.malformedProfileJson(src));
  else if (!opts.importReady && src.entity) profileSignals(reg, src.entity, src.profile || {}, { checkRequired: !!opts.checkRequired, checkBudget: !!opts.checkBudget })
    .forEach(p => probs.push(LINT_MSG.profileSignal(src, p)));
  if (opts.importReady) {
    for (const [k, v] of Object.entries(src)) {
      if (k === 'created' || k === 'slug') continue;
      if (!KNOWN_FM_FIELDS.has(k)) probs.push(LINT_MSG.unknownField(src, k));
      else if (SCALAR_FM_FIELDS.has(k) && Array.isArray(v)) probs.push(LINT_MSG.scalarList(k));
    }
    if ('important' in src && typeof src.important !== 'boolean') probs.push(LINT_MSG.importantBool(src.important));
    if (src.entity) profileSignals(reg, src.entity, src.profile || {}, { checkRequired: !!opts.checkRequired, checkBudget: !!opts.checkBudget })
      .forEach(p => probs.push(LINT_MSG.profileSignal(src, p)));
  }
  return probs;
}

// bug #32: bitemporal signal only — learned-vs-happened can diverge, so warn but never block.
function lintFutureOccurred(env, occurred) {
  const today = env.today();
  if (occurred && String(occurred) > today && !env.quietValidation)
    console.error(`⚠ occurred ${occurred} is AFTER today (${today}) — recording something that has not happened yet? (signal only, not blocked)`);
}

// slug lint (§1) — one function for every entry path (H11/H18): NFC (macOS NFD would
// mint a visual twin on a case-insensitive FS), lowercase/digits/hyphens, ≤80 chars,
// no Windows reserved names. Returns an error string or null.
function slugLint(slug) {
  if (typeof slug !== 'string') return `slug must be a string (got ${jsonType(slug)})`;
  if (slug !== slug.normalize('NFC')) return `slug '${slug}' is not NFC-normalized (an NFD twin would collide on macOS)`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return `bad slug '${slug}' (lowercase letters, digits, hyphens; must start alphanumeric)`;
  if (slug.length > 80) return `slug '${slug}' is ${slug.length} chars (>80)`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug)) return `reserved filename '${slug}'`;
  return null;
}

// Deterministic text→slug fold used by the entity-echo guard (profileEntityGuard). The
// engine never auto-slugified before — slugs are authored — so this mints the canonical
// lowercase/hyphen form the slug grammar (slugLint) accepts, to compare a profile string
// against existing card slugs. Precision over recall: non-ASCII folds to a hyphen boundary
// rather than transliterating, so it under-matches rather than guessing.
function slugify(text) {
  return String(text).normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Cadence grammar (roll-verb §2): a bounded, case-insensitive set — NEVER guessed. Returns a
// {unit, n} step, or null. 'weekly'/'every N weeks' fold to 7-day steps so the weekday anchor is
// preserved; monthly/quarterly/yearly steps clamp month-end in add*ISO. In GUARDS (not WRITE VERBS)
// so both the roll verb and O1's write-time cadence-validation warn (prepareWrite) can reach it.
const ROLL_CADENCE_FIXED = new Map([
  ['monthly', { unit: 'months', n: 1 }], ['month', { unit: 'months', n: 1 }], ['every month', { unit: 'months', n: 1 }],
  ['weekly', { unit: 'days', n: 7 }], ['week', { unit: 'days', n: 7 }], ['every week', { unit: 'days', n: 7 }],
  ['quarterly', { unit: 'months', n: 3 }], ['quarter', { unit: 'months', n: 3 }],
  ['yearly', { unit: 'years', n: 1 }], ['annual', { unit: 'years', n: 1 }], ['annually', { unit: 'years', n: 1 }], ['year', { unit: 'years', n: 1 }],
]);
const ROLL_CADENCE_FORMS = 'monthly|month|every month, weekly|week|every week, quarterly|quarter, yearly|annual|annually|year, "every second|other <weekday>" (fortnightly, 14-day step), or "every N days|weeks|months" (N 1–365)';
const CADENCE_WEEKDAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
function parseRollCadence(raw) {
  const s = String(raw).trim().toLowerCase();
  if (ROLL_CADENCE_FIXED.has(s)) return ROLL_CADENCE_FIXED.get(s);
  // "every second|other <weekday>" = a fortnightly (14-day) step. rollStepDue anchors on the due
  // date, and 14 days preserves its weekday — so a due on that weekday keeps landing there.
  if (new RegExp(`^every\\s+(second|other)\\s+(${CADENCE_WEEKDAYS})$`).test(s)) return { unit: 'days', n: 14 };
  const m = /^every\s+([0-9]{1,3})\s+(day|days|week|weeks|month|months)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 365) return null;
  if (m[2].startsWith('day')) return { unit: 'days', n };
  if (m[2].startsWith('week')) return { unit: 'days', n: n * 7 };
  return { unit: 'months', n };
}
// O1 (deterministic-checks §1): an OPEN obligation's cadence — brain roll's input. Returns a warn
// string when the cadence is unparseable or absent (roll can't compute), else null. Shared by the
// write path (prepareWrite) and doctor, so the two surfaces never drift.
function obligationCadenceSignal(reg, fm) {
  if (fm.entity !== 'obligation' || deriveClass(reg, fm) !== 'future' || !isOpen(fm.status)) return null;
  const raw = fm.profile ? (fm.profile.cadence ?? fm.profile.period) : undefined;
  if (raw == null || String(raw).trim() === '')
    return `open obligation with no cadence — brain roll can't compute the next due; set profile.cadence (${ROLL_CADENCE_FORMS}), or leave it cadence-less deliberately (manual rolls)`;
  if (!parseRollCadence(raw))
    return `open obligation cadence '${String(raw)}' is not a recognized form — brain roll can't compute the next due; use ${ROLL_CADENCE_FORMS}, or leave it deliberately (manual rolls)`;
  return null;
}

function assertReadSlug(raw, where = 'slug') {
  const lint = slugLint(raw);
  if (lint) die(`${where}: ${lint}`);
  return raw;
}

function assertReadFilename(raw, where = 'slug') {
  if (typeof raw !== 'string') die(`${where}: slug must be a string (got ${jsonType(raw)})`);
  if (/[\\/]/.test(raw) || raw.includes('..'))
    die(`${where}: bad slug '${raw}' — read slugs are filenames, never paths`);
  return raw;
}

function assertFieldWrite(field, v) {
  if (v === '') die(`${field} cannot be empty — use --del to remove an optional field; nothing written`);
  const type = FIELD_TYPES[field];
  if (type === 'date' || type === 'datetime-or-date') { assertIsoDate(field, v, type); return v; } // bug #76
  if (type === 'bool') {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    die(`${field} must be true or false (got '${String(v)}') — nothing written`); // bug #76
  }
  if (type === 'status') { assertStatus(field, v); return v; } // bug #76
  if (type === 'text') {
    if (v != null && typeof v !== 'string') die(`${field} must be scalar text — got ${jsonType(v)}; nothing written`);
    return v;
  }
  if (type === 'slug-ref') {
    if (typeof v !== 'string') die(`${field} must be a slug string — got ${jsonType(v)}; nothing written`);
    const sl = slugLint(v);
    if (sl) die(sl);
    return v;
  }
  return v;
}

function assertShape(name, obj, required, allowed = required) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    die(`internal: ${name} shape violation — missing [object] / unknown [] (bug in the caller, not your input)`);
  const keys = new Set(Object.keys(obj));
  const missing = required.filter(k => !keys.has(k));
  const ok = new Set(allowed);
  const unknown = [...keys].filter(k => !ok.has(k));
  if (missing.length || unknown.length)
    die(`internal: ${name} shape violation — missing [${missing.join(', ')}] / unknown [${unknown.join(', ')}] (bug in the caller, not your input)`);
}


function assertBaseHash(value, where = 'base_hash') {
  if (typeof value !== 'string')
    die(`${where} must be a hexadecimal SHA-1 prefix string (8–40 hex characters) — got ${JSON.stringify(value)} (${jsonType(value)}); nothing executed`);
  if (!/^[0-9a-fA-F]{8,40}$/.test(value))
    die(`${where} '${value}' is not a valid SHA-1 prefix — use 8–40 hexadecimal characters from brain get's [hash: …] line; nothing executed`);
  return value.toLowerCase();
}

// CAS: the agent's prior read is asserted via --base-hash; if the file changed
// since, WARN + require --force (signal, not gate — §9.4). base may be a short (8+)
// or full sha1 — compare on the provided prefix length.
function casGuard(node, slug, flags) {
  const base = flags['base-hash'];
  if (base && !node?.hash)
    die(`internal: casGuard expected a read hash for '${slug}' (bug in the caller, not your input)`);
  if (base && !node.hash.startsWith(String(base)) && !flags.force)
    die(`'${slug}' changed since read (disk ${node.hash.slice(0, 8)} ≠ base ${String(base).slice(0, 8)}) — re-read or pass --force`);
  if (base && !node.hash.startsWith(String(base)) && flags.force)
    (flags.signals ? flags.signals.push(`⚠ --force: '${slug}' changed since read (disk ${node.hash.slice(0, 8)} ≠ stale base ${String(base).slice(0, 8)}) — overwriting anyway`) : console.error(`⚠ --force: '${slug}' changed since read (disk ${node.hash.slice(0, 8)} ≠ stale base ${String(base).slice(0, 8)}) — overwriting anyway`)); // bug #31
}

// record immutability (H13/V4): a record is the frozen past. Mutating its own
// fields/edges/body is non-additive → WARN + require --force (signal, not gate).
// `class`/`occurred` are the event's identity — refused outright, force or not.
// (Additive INBOUND edges live on the OTHER node, so they never reach this guard.)
function recordGuard(reg, node, slug, op, flags) {
  if (deriveClass(reg, node.fm) !== 'record') return;
  const signal = (s) => flags.signals ? flags.signals.push(s) : console.error(s);
  if (op.op === 'freeze')
    die(`cannot freeze '${slug}' — it is already a record (frozen past); --force cannot freeze it a second time`);
  if (op.op === 'set' && (op.field === 'class' || op.field === 'occurred'))
    die(`cannot set ${op.field} on a record — a frozen event's identity is immutable (§1)`);
  // bug #24: updated[] is CARDS-ONLY — a structural invariant (§2), not merely frozen-past
  // content. A record has no mutation history, so push is a HARD refusal: no --force unlock
  // (unlike set/body/unlink below, which stay warn+--force — editing existing frozen content
  // is a judgment call; adding a cards-only block to a record is a category error).
  if (op.op === 'push')
    die(`cannot push updated[] onto '${slug}' — updated[] is cards-only (§2); a record is the frozen past and carries no mutation history. This is a structural invariant, not a gate: --force cannot override it.`);
  // context-retrieval §4: records may enter and leave focus — link/unlink with
  // verb=in_context AND to=focus bypasses the record refusal (the exact successor of the
  // old `op === 'focus'` exemption). Everything else about record edges is unchanged: a
  // plain in_context edge to a NON-focus context on a record still warns + needs --force.
  if ((op.op === 'link' || op.op === 'unlink') && op.verb === 'in_context' && op.to === 'focus') return;
  // brain-profiles §5: ANY tense is votable — the OP-LEVEL freeze exemption (the
  // focus-op precedent slot). Score-only: nothing else about frozen records changes.
  if (op.op === 'vote') return;
  signal(`⚠ '${slug}' is a record (frozen past) — ${op.op} rewrites immutable history`);
  if (!flags.force && !flags.permits?.has('edit-record')) die(`refusing to ${op.op} a record without --force (signal, not gate — pass --force if you truly mean to edit the past)`);
}

function checkCohortFlags(cmd, flags) {
  const bad = Object.keys(flags).filter(f => !COHORT_FLAGS.has(f));
  if (bad.length) die(`unknown ${cmd} filter${bad.length > 1 ? 's' : ''}: ${bad.map(f => '--' + f).join(', ')} — filters: --entity/--class/--status/--important/--profile key=val/--edge verb[:target]/--occurred-from|-to · --due-from|-to · --created-from|-to (also --fields/--count/--limit/--all)`);
}

function assertCohortFilterShapes(flags, inputRegistry = null) {
  if (flags.edge != null) {
    const raw = String(flags.edge);
    const first = raw.indexOf(':');
    if (first !== raw.lastIndexOf(':'))
      die(`--edge '${raw}' has too many ':' separators — use verb or verb:target-slug`);
    const verb = first < 0 ? raw : raw.slice(0, first);
    const target = first < 0 ? null : raw.slice(first + 1);
    if (!verb) die(`--edge '${raw}' needs a non-empty relation verb before ':'`);
    assertRelationVerbInput(inputRegistry, '--edge verb', verb, { deferAlias: !inputRegistry });
    if (first >= 0) {
      if (!target) die(`--edge '${raw}' needs a non-empty target slug after ':' — drop ':' for a verb-only filter`);
      assertReadSlug(target, '--edge target');
    }
  }
  if (flags.profile != null) {
    const raw = String(flags.profile), i = raw.indexOf('=');
    if (i < 0) die('--profile expects key=value');
    const key = raw.slice(0, i);
    if (!key || !FM_KEY_RE.test(key))
      die(`--profile key '${key}' is invalid — use a non-empty frontmatter key ([A-Za-z0-9_.-]+), then '=' and the value (e.g. --profile tier=T1)`);
  }
}

function unknownFlagMessage(cmd, unknown, known, kind) {
  if (cmd === 'list')
    return `unknown ${cmd} filter${unknown.length > 1 ? 's' : ''}: ${unknown.map(f => '--' + f).join(', ')} — filters: --entity/--class/--status/--important/--profile key=val/--edge verb[:target]/--occurred-from|-to · --due-from|-to · --created-from|-to (also --fields/--count/--limit/--all)`;
  if (cmd === 'count') // C-12: count is numbers-only — no --fields/--count/--limit
    return `unknown count filter${unknown.length > 1 ? 's' : ''}: ${unknown.map(f => '--' + f).join(', ')} — count takes the cohort filters (--entity/--class/--status/--important/--profile key=val/--edge verb[:target]/--occurred-from|-to · --due-from|-to · --created-from|-to) plus --all; it prints numbers, so list's --fields/--count/--limit don't apply (use list for projection)`;
  if (kind === 'read') {
    const takes = known.length ? known.map(f => '--' + f).join('/') : '(no flags beyond --root/--help)';
    return `unknown ${cmd} flag${unknown.length > 1 ? 's' : ''}: ${unknown.map(f => '--' + f).join(', ')} — ${cmd} takes: ${takes}`;
  }
  const richer = cmd === 'new' && unknown.some(f => ['profile', 'relations', 'body', 'updated'].includes(f));
  const hint = richer
    ? ` — 'new' is a skeleton-writer; profile/relations/body/updated go through 'apply' (richer creation, one transaction)`
    : ` — known flags for '${cmd}': ${known.length ? known.map(f => '--' + f).join(', ') : '(none beyond --root/--help)'}`;
  // brain-teaching §1.2: the observed miss was `forget --why` — the refusal itself teaches
  // the reasoned removal paths instead of leaving the caller to guess another flag.
  const teach = cmd === 'forget' && unknown.includes('why')
    ? `\n  forget takes no reason — to record WHY something leaves, use status-drop (set --field status --to dropped) or supersede; forget is for things that should not exist at all.`
    : '';
  return `unknown flag${unknown.length > 1 ? 's' : ''} for '${cmd}': ${unknown.map(f => '--' + f).join(', ')}${hint}${teach}`;
}

function checkFlags(cmd, flags, verbFlags, kind = 'write') {
  const known = [...Object.keys(verbFlags || {}), ...Object.keys(commandControlFlags(cmd))];
  const allowed = new Set([...Object.keys(UNIVERSAL_FLAGS), ...known]);
  const unknown = Object.keys(flags).filter(f => !allowed.has(f));
  if (!unknown.length) return;
  die(unknownFlagMessage(cmd, unknown, known, kind));
}

function assertExclusiveModes(cmd, flags, names) {
  const active = names.filter(name => Object.prototype.hasOwnProperty.call(flags, name) && flags[name] !== false);
  if (active.length > 1)
    die(`${cmd} modes are mutually exclusive — choose one of ${names.map(n => '--' + n).join(', ')} (got ${active.map(n => '--' + n).join(' + ')})`);
}

// F-23/F-24: recognize complete VCS conflict blocks, including marker runs lengthened
// to avoid collisions with authored content. Git has an '=' side separator. jj's
// default `diff` style has one '+' snapshot plus one-or-more '%' diffs; its `snapshot`
// style has two-or-more '+' sides and may carry a '-' base. Merely seeing a marker-like
// line is not enough: transcripts routinely quote these strings in authored bodies.
function conflictMarkerLength(line, ch) {
  const end = line.endsWith('\r') ? line.length - 1 : line.length;
  let n = 0;
  while (n < end && line[n] === ch) n++;
  if (n < 7) return 0;
  return n === end || line[n] === ' ' || line[n] === '\t' ? n : 0;
}

function conflictMarkerKind(line, length) {
  for (const ch of ['=', '|', '%', '+', '-'])
    if (conflictMarkerLength(line, ch) === length) return ch;
  return null;
}

function vcsConflictBlocks(text) {
  const lines = String(text).split('\n');
  const blocks = [];
  for (let start = 0; start < lines.length; start++) {
    const length = conflictMarkerLength(lines[start], '<');
    if (!length) continue;
    const markers = [];
    let end = -1;
    for (let i = start + 1; i < lines.length; i++) {
      if (conflictMarkerLength(lines[i], '>') === length) { end = i; break; }
      const kind = conflictMarkerKind(lines[i], length);
      if (kind) markers.push({ index: i, kind });
    }
    if (end === -1) continue;
    const kinds = markers.map(m => m.kind);
    const pluses = kinds.filter(k => k === '+').length;
    const style = kinds.includes('=') ? 'git'
      : kinds.includes('%') && pluses ? 'jj-diff'
        : !kinds.includes('%') && pluses >= 2 ? 'jj-snapshot'
          : null;
    if (style) blocks.push({ start, end, length, style, markers, lines });
    start = end;
  }
  return blocks;
}

const completeNodeText = (lines) => {
  const text = lines.join('\n') + '\n';
  return hasFrontmatterFence(text) && frontmatterFenceEnd(text) !== -1;
};

// A byte-zero wrapper replaces the node's opening fence, so normal frontmatter scoping
// cannot identify it. Require structural conflict sections AND evidence that at least one
// represented version is a complete Markdown node. For jj diff sections, reconstruct
// both sides of the displayed patch just far enough to recognize an added/deleted node.
function conflictBlockContainsNode(block) {
  const { lines, start, end, style, markers } = block;
  if (style === 'git') {
    const eq = markers.find(m => m.kind === '=');
    if (!eq) return false;
    const base = markers.find(m => m.kind === '|' && m.index < eq.index);
    return completeNodeText(lines.slice(start + 1, (base || eq).index))
      || (base && completeNodeText(lines.slice(base.index + 1, eq.index)))
      || completeNodeText(lines.slice(eq.index + 1, end));
  }
  const sectionMarkers = markers.filter(m => style === 'jj-diff'
    ? m.kind === '+' || m.kind === '%'
    : m.kind === '+' || m.kind === '-');
  for (let i = 0; i < sectionMarkers.length; i++) {
    const marker = sectionMarkers[i];
    const sectionEnd = sectionMarkers[i + 1]?.index ?? end;
    const section = lines.slice(marker.index + 1, sectionEnd);
    if (marker.kind !== '%') {
      if (completeNodeText(section)) return true;
      continue;
    }
    const before = [], after = [];
    for (const line of section) {
      if (line.startsWith(' ')) { before.push(line.slice(1)); after.push(line.slice(1)); }
      else if (line.startsWith('-')) before.push(line.slice(1));
      else if (line.startsWith('+')) after.push(line.slice(1));
    }
    if (completeNodeText(before) || completeNodeText(after)) return true;
  }
  return false;
}

const stripJjPatchPrefix = line => /^[ +-](?:---|[A-Za-z0-9_.-]+:|\s*- )/.test(line) ? line.slice(1) : line;

function conflictBlockArmTexts(block) {
  const { lines, start, end, style, markers } = block;
  const sectionText = (from, to) => lines.slice(from, to).map(stripJjPatchPrefix).join('\n');
  if (style === 'git') {
    const cuts = [start, ...markers.map(m => m.index), end];
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const text = sectionText(cuts[i] + 1, cuts[i + 1]);
      if (text.trim()) out.push(text);
    }
    return out;
  }
  const out = [];
  const sectionMarkers = markers.filter(m => style === 'jj-diff'
    ? m.kind === '+' || m.kind === '%'
    : m.kind === '+');
  for (let i = 0; i < sectionMarkers.length; i++) {
    const marker = sectionMarkers[i];
    const sectionEnd = sectionMarkers[i + 1]?.index ?? end;
    const section = lines.slice(marker.index + 1, sectionEnd);
    if (marker.kind !== '%') {
      const text = section.map(stripJjPatchPrefix).join('\n');
      if (text.trim()) out.push(text);
      continue;
    }
    const before = [], after = [];
    for (const line of section) {
      if (line.startsWith(' ')) { before.push(line.slice(1)); after.push(line.slice(1)); }
      else if (line.startsWith('-')) before.push(line.slice(1));
      else if (line.startsWith('+')) after.push(line.slice(1));
    }
    if (before.join('').trim()) out.push(before.join('\n'));
    if (after.join('').trim()) out.push(after.join('\n'));
  }
  return out;
}

function frontmatterishHeadTexts(text) {
  const s = String(text);
  const heads = [];
  if (hasFrontmatterFence(s)) {
    const end = frontmatterFenceEnd(s);
    // an UNCLOSED fence means the frontmatter may extend arbitrarily far — a line cap here
    // let deep broken sources slip the unregister guard (F3); scan the whole file.
    heads.push(end === -1 ? s : s.slice(0, end + 4));
  } else {
    // no opening fence = a body-only node; only the head can plausibly be a broken-fence
    // frontmatter, and scanning the whole body would false-match transcript prose.
    heads.push(s.split('\n').slice(0, 80).join('\n'));
  }
  const blocks = vcsConflictBlocks(s);
  for (const block of blocks) {
    if (block.start === 0) heads.push(s.split('\n').slice(block.start, block.end + 1).join('\n'));
  }
  if (blocks.length) heads.push(...conflictVersionTexts(s));
  return heads;
}

function rawHeadFacts(head) {
  const entities = new Set(), relations = new Set();
  const lines = String(head).split(/\r?\n/).map(stripJjPatchPrefix);
  let inRelations = false;
  for (const line of lines) {
    // registry names forbid only ';'/'=' (assertRegCell) — match the value to end-of-line
    // rather than an identifier-shaped subset, so authored names with spaces or dotted
    // verbs (serves.v2) cannot slip the unregister guard (F3).
    const entity = line.match(/^\s*entity:\s*([^;=]+?)\s*$/);
    if (entity) entities.add(entity[1]);
    if (/^\s*relations:\s*$/.test(line)) { inRelations = true; continue; }
    if (inRelations && /^\S/.test(line) && !/^\s*-\s*/.test(line)) inRelations = false;
    if (!inRelations) continue;
    // EVERY verb key of a relation item counts — the dash line and any continuation keys
    // (`- serves: a` + `  part_of: b` is one lossy-foldable item carrying two edges).
    const rel = line.match(/^\s*(?:-\s*)?([^:=\s#][^:=]*?):\s*([^#\r\n]+?)\s*$/);
    if (rel && rel[1] !== 'why') relations.add(`${rel[1]}\0${rel[2].trim()}`);
  }
  return {
    entities: [...entities],
    relations: [...relations].map(r => {
      const [verb, to] = r.split('\0');
      return { verb, to };
    }),
  };
}

// Authored-VERSION reconstruction: a mid-file conflict hunk shares the text before AND
// after its markers with every arm, so prefix+arm composition dropped the shared suffix —
// where the relations: block usually lives — letting a conflicted attached provider read
// as a successful "0 linked — attach one" instead of refusing (sol rev 3). Compose each
// full version: shared segments + one arm choice per hunk, cartesian across hunks (an
// entity chosen in hunk 1 and a relation chosen in hunk 2 DO coexist in one authored
// version — unlike two arms of the SAME hunk, F4). Cartesian size is arms^hunks; real
// merges have 1-3 hunks, so past MAX_CONFLICT_VERSIONS degrade to one arm at a time with
// the full shared context (every arm still scanned with prefix+suffix; only cross-hunk
// compositions are dropped) rather than blow up combinatorially.
const MAX_CONFLICT_VERSIONS = 64;

function conflictVersionTexts(s) {
  const lines = String(s).split('\n');
  const blocks = vcsConflictBlocks(s);
  const segments = [];
  let prev = 0;
  for (const b of blocks) { segments.push(lines.slice(prev, b.start).join('\n')); prev = b.end + 1; }
  segments.push(lines.slice(prev).join('\n'));
  const armChoices = blocks.map(b => {
    const arms = conflictBlockArmTexts(b);
    return arms.length ? arms : [null]; // an all-empty hunk leaves the shared context as the only version
  });
  const compose = (choices) => {
    const parts = [];
    for (let i = 0; i <= blocks.length; i++) {
      if (segments[i] !== '') parts.push(segments[i]);
      if (i < choices.length && choices[i] != null && choices[i] !== '') parts.push(choices[i]);
    }
    return parts.join('\n');
  };
  if (armChoices.reduce((n, arms) => n * arms.length, 1) > MAX_CONFLICT_VERSIONS) {
    const out = [];
    for (let i = 0; i < blocks.length; i++)
      for (const arm of armChoices[i]) {
        const choices = new Array(blocks.length).fill(null);
        choices[i] = arm;
        out.push(compose(choices));
      }
    return out;
  }
  let combos = [[]];
  for (const arms of armChoices) {
    const next = [];
    for (const combo of combos) for (const arm of arms) next.push([...combo, arm]);
    combos = next;
  }
  return combos.map(compose);
}

// per-VERSION facts: an attachment claim must come from ONE authored version — an entity in
// arm A plus a relation in arm B of the SAME hunk describes no node at all (F4 cross-arm
// fix). Each version is the full shared context plus one arm choice per hunk; a hunk's two
// arms are never mixed with each other.
function rawSourceFactsPerHead(text) {
  const s = String(text);
  if (!vcsConflictBlocks(s).length) return frontmatterishHeadTexts(s).map(rawHeadFacts);
  return conflictVersionTexts(s).map(rawHeadFacts);
}

function rawSourceFacts(text) {
  const entities = new Set(), relations = new Set();
  for (const facts of frontmatterishHeadTexts(text).map(rawHeadFacts)) {
    facts.entities.forEach(e => entities.add(e));
    facts.relations.forEach(r => relations.add(`${r.verb}\0${r.to}`));
  }
  return {
    entities: [...entities],
    relations: [...relations].map(r => {
      const [verb, to] = r.split('\0');
      return { verb, to };
    }),
  };
}

const hasConflictBoundaryMarker = (text, ch) => String(text).split('\n').some(line => conflictMarkerLength(line, ch));
const hasConflictMarkers = (text) => vcsConflictBlocks(text).length > 0;

// a conflict is only DANGEROUS where it corrupts SERVED TRUTH — the frontmatter (last-value-
// wins folding). A node BODY may legitimately quote conflict markers (coding transcripts a
// memory engine ingests), so scan only up to the closing fence when there is a clean one; a
// file with a BROKEN opening fence (whole-file or frontmatter-spanning conflict) is scanned
// whole. With no opening fence there is no frontmatter at all: it is a body-only node, and
// conflict-looking transcript text is authored body rather than served scalar truth.
function conflictRegion(text) {
  // A conflict can wrap complete node versions, so the first byte is a conflict marker
  // rather than a trusted frontmatter fence. This includes modify/delete conflicts: one
  // arm is a complete `--- … ---` node and the other is empty. Requiring two node arms
  // let the surviving branch leak through rendered reads, while requiring at least one
  // keeps byte-zero prose transcripts (neither arm is a node) readable.
  const wrapper = vcsConflictBlocks(text).find(block => block.start === 0);
  if (wrapper && conflictBlockContainsNode(wrapper)) return text;
  if (!hasFrontmatterFence(text)) return '';
  const end = frontmatterFenceEnd(text);
  if (end === -1) return text;
  const nominal = text.slice(0, end + 4);
  // The first exact `---` after the opener is trustworthy only when no conflict arm has
  // already begun. In a real conflict, branch one can contain its own closing fence and
  // the matching ======= / >>>>>>> can fall later; slicing at that fence used to hide the
  // counterpart and serve one unresolved scalar as truth. If EITHER marker begins in the
  // nominal frontmatter, scan the whole file for its mate. Markers wholly after a clean
  // fence remain legitimate body transcript content.
  if (hasConflictBoundaryMarker(nominal, '<') || hasConflictBoundaryMarker(nominal, '>')) return text;
  return nominal;
}

// F-25: "get says no node / new says it exists" taught duplicate minting after a pull.
// When a not-found slug HAS a source file, say so and name the heal — or the quarantine.
function missingNodeMsg(ctx, db, slug) {
  const lint = slugLint(String(slug));
  if (lint) return lint; // never turn a path-shaped read argument into an fs.existsSync oracle
  try {
    const p = nodePath(ctx.root, slug);
    if (fs.existsSync(p)) {
      const errRow = db ? db.prepare(`SELECT problem FROM errors WHERE path=? LIMIT 1`).get(p) : null;
      return `no node '${slug}' — but its FILE exists${errRow ? ` (quarantined: ${errRow.problem})` : ` (not indexed — pulled/merged/hand-added recently?)`}; run: brain sync --slug ${slug}`;
    }
  } catch { /* stat failure = plain not-found */ }
  return `no node '${slug}'`;
}

// ===== SECTION: INDEX =====

// ---------- registry runtime (§9.7): authored truth at brain/__meta/registry.md ----------
function registryPath(root) { return path.join(root, 'brain', '__meta', 'registry.md'); }

function emptyRegistrySnapshot() {
  return { entities: {}, conjugate: {}, inverses: {}, weakVerbs: [], verbs: {}, aliases: {}, _unparseable: [], _integrity: [] };
}

// load once per process; merge file OVER the seed so prebuilt rows always survive.
// Resilience (H4): a missing file materializes the seed; an empty/unparseable file is
// MISSING → LOUD structured warning + seed only for diagnostic helpers; semantic commands
// fail closed. REG_PARSE_ERROR latches so reindex/autoRebuild REFUSE (a routine rebuild
// would otherwise bake seed-fallback classification corpus-wide). A stale format
// reconciles seed fixes.
function loadRegistry(root) {
  const regState = { parseError: null, futureFormat: null, unparseable: [], rewriteProblems: [], staleNeedsMigrate: false, staleFormat: null, base: null, diskBase: null };
  const p = registryPath(root);
  if (!fs.existsSync(p)) {
    regState.staleNeedsMigrate = true;
    regState.staleFormat = 0;
    const reg = cloneSeed();
    regState.base = structuredClone(reg);
    regState.diskBase = emptyRegistrySnapshot();
    return { reg, regState };
  } // materialize only on a write path; reads must not mutate authored truth
  let f;
  try { f = parseRegistry(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    regState.parseError = e.message;
    console.error(`⚠⚠ REGISTRY CORRUPT: brain/__meta/registry.md is unparseable (${e.message}).`);
    console.error(`   Registry-dependent semantic reads/writes are BLOCKED; only doctor/lint/canonical get --raw/forget/recover inspection remains available.`);
    console.error(`   Fix the file; reindex/sync REFUSE until it parses (would bake seed-fallback misclassification corpus-wide).`);
    const reg = cloneSeed();
    regState.base = structuredClone(reg);
    return { reg, regState };
  }
  regState.unparseable = f._unparseable || []; // bug #25: doctor detail + hard rewrite/semantic gate
  regState.rewriteProblems = registryRewriteProblems(f);
  if ((f._format || 0) > REG_FORMAT) {
    regState.futureFormat = f._format;
    console.error(`⚠⚠ REGISTRY FORMAT ${f._format} is newer than this engine supports (format ${REG_FORMAT}).`);
    console.error(`   Registry-dependent semantic reads/writes/reindex REFUSE so this engine cannot interpret or downgrade newer authored truth. Upgrade the engine first; doctor and canonical get --raw remain available.`);
  }
  const stale = (f._format || 0) < REG_FORMAT;
  // Cross-reference validation and runtime interpretation must use the identical,
  // format-aware overlay: current files win; stale files are migration inputs whose
  // obsolete prebuilt fields are replaced by shipped fixes while custom rows survive.
  const reg = registryEffectiveSchema(f);
  if (stale) { regState.staleNeedsMigrate = true; regState.staleFormat = f._format || 0; }
  regState.base = structuredClone(reg);
  regState.diskBase = structuredClone(f);
  return { reg, regState };
}

// merge-on-save under a lockfile (H5): re-read the file inside the lock and UNION the
// concurrent state in, so two processes registering different verbs can't last-wins
// each other. `remove` tombstones (unregister) are applied after the union because a
// plain delete-then-save would be reintroduced by unionReg.
function saveRegistry(ctx, opts = {}) {
  if (ctx.regState.futureFormat != null)
    die(`refusing to write brain/__meta/registry.md — format ${ctx.regState.futureFormat} is newer than this engine supports (format ${REG_FORMAT}). Upgrade the engine first; the authored registry was left byte-identical`);
  if (ctx.regState.parseError) {
    try { atomicWrite(registryPath(ctx.root) + '.rejected', serializeRegistry(ctx.reg)); } catch { /* best-effort */ }
    die("refusing to write brain/__meta/registry.md — it is unparseable (" + ctx.regState.parseError + "); fix it first (the attempted merge is saved beside it as registry.md.rejected). A save now would overwrite authored truth with seed+edits.");
  }
  if (ctx.regState.rewriteProblems?.length)
    die(`refusing to write brain/__meta/registry.md — authored truth needs hand repair (${ctx.regState.rewriteProblems[0]}); duplicate/unknown/newer syntax cannot be canonicalized safely, so the source was left byte-identical`);
  const { root } = ctx;
  const dir = path.join(root, 'brain', '__meta'); fs.mkdirSync(dir, { recursive: true });
  const p = registryPath(root);
  withLock(path.join(root, '.brain', 'registry.lock'), () => {
    let merged = ctx.reg;
    try {
      const diskText = fs.readFileSync(p, 'utf8');
      try {
        const disk = parseRegistry(diskText);
        if ((disk._format || 0) > REG_FORMAT)
          die(`refusing to write brain/__meta/registry.md — on-disk format changed to ${disk._format}, newer than this engine supports (format ${REG_FORMAT}), after this process loaded it. Upgrade the engine first; the authored registry was left byte-identical`);
        const diskProblems = registryRewriteProblems(disk);
        if (diskProblems.length)
          die(`refusing to write brain/__meta/registry.md — the on-disk copy acquired authored truth that needs hand repair (${diskProblems[0]}); source left byte-identical`);
        // The captured effective-memory + parsed-disk baselines preserve intentional seed
        // reconciliation while also accepting concurrent disk clears, including when this
        // process opened a missing/stale-format registry.
        merged = unionReg(disk, ctx.reg, ctx.regState.base, ctx.regState.diskBase);
      }
      catch (e) {
        if (e instanceof BrainError) throw e;
        try { atomicWrite(p + '.rejected', serializeRegistry(ctx.reg)); } catch { /* best-effort */ }
        die("refusing to write brain/__meta/registry.md — the on-disk copy stopped parsing since this process loaded it (" + e.message + "); fix it first (this process's merge is saved beside it as registry.md.rejected)");
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      // Treat a concurrently removed registry as an authored reset to the shipped seed,
      // not as permission for stale memory to resurrect every deleted custom row. Local
      // edits made by this process still merge on top and the resulting file remains a
      // valid, parseable registry (never an empty [entities] section).
      merged = unionReg(cloneSeed(), ctx.reg, ctx.regState.base, ctx.regState.diskBase);
    }
    if (opts.remove) applyRemovals(merged, opts.remove);
    atomicWrite(p, serializeRegistry(merged));
    ctx.reg = merged;
    ctx.regState.base = structuredClone(merged);
    ctx.regState.diskBase = structuredClone(merged);
    ctx.regState.unparseable = merged._unparseable || [];
    ctx.regState.rewriteProblems = registryRewriteProblems(merged);
    if (ctx.regState.staleNeedsMigrate) {
      console.error(`note: registry.md format ${ctx.regState.staleFormat ?? 0} < ${REG_FORMAT} — reconciled shipped fixes, re-saving`);
      ctx.regState.staleNeedsMigrate = false;
      ctx.regState.staleFormat = null;
    }
  });
}

// F2/unregister-race: a create planned under registry generation G must not commit after a
// concurrent unregister removed the entity G validated — the raced `new` would mint a source
// the non-force unregister's "ANY source" scan never saw. Re-check the CREATE's entity
// against a fresh read inside the publication critical section. Scoped deliberately:
// - creates only: existing nodes may legitimately carry unregistered entities/verbs
//   (grandfathered advisory state, INSTALL's resurrected-card contract), so re-checking
//   mutate/forget would false-refuse tolerated writes;
// - entity only: verbs are auto-registered by link/apply itself, and an unregistered verb on
//   an existing edge is the same tolerated advisory state;
// - parse failures fall through to the registry-health gates and the bug-#79 commit-and-warn
//   doctrine rather than blocking here.
function assertCreateEntityCurrent(ctx, plan) {
  if (plan.kind !== 'create') return;
  const entity = plan.state?.fm?.entity;
  if (!entity) return;
  let f;
  try { f = parseRegistry(fs.readFileSync(registryPath(ctx.root), 'utf8')); }
  catch { return; }
  if (!f || typeof f !== 'object') return;
  if (!hasOwnKey(registryEffectiveSchema(f).entities || {}, entity))
    die(`entity '${entity}' was unregistered by a concurrent registry write after this command validated — re-run the command against the fresh registry; nothing written`);
}

function migrateRegistryIfStale(ctx) {
  if (!ctx.regState.staleNeedsMigrate) return;
  saveRegistry(ctx);
}

// registry health (H4): alias targets resolve, conjugation/inverse pairs name known
// verbs. Returns a list of problem strings (doctor prints them; never throws).
function dbHasAuthoredVerb(db, verb) {
  if (!db) return false;
  try { return !!db.prepare(`SELECT 1 FROM edges WHERE verb=? AND brain_edge_source_live(from_slug)=1 LIMIT 1`).get(verb); }
  catch { return false; }
}

function validateRegistry(reg, db) {
  const probs = [...registrySchemaProblems(reg)];
  const known = (v) => isKnownVerb(reg, v);
  const verbProblem = (where, value) => {
    const problem = relationVerbProblem(value);
    if (problem) probs.push(`${where} '${String(value)}' ${problem}`);
  };
  for (const [name, a] of Object.entries(reg.aliases || {})) {
    if (a.kind === 'slug') { if (db && !db.prepare(`SELECT 1 FROM nodes WHERE slug=?`).get(a.to)) probs.push(`alias '${name}' → '${a.to}' (no such node)`); }
    else if (a.kind === 'verb') {
      verbProblem(`verb-alias '${name}' target`, a.to);
      if (known(name) || dbHasAuthoredVerb(db, name)) probs.push(`verb-alias '${name}' shadows a real/known verb of the same name (real verb wins; rename or remove the alias)`);
      if (!known(a.to)) probs.push(`verb-alias '${name}' → '${a.to}' (unknown verb)`);
    }
    if (ownValue(reg.aliases, a.to)) probs.push(`alias '${name}' → '${a.to}' which is itself an alias (chain — resolution is single-hop; point at the real target)`);
    if (db && db.prepare(`SELECT 1 FROM nodes WHERE slug=?`).get(name)) probs.push(`alias '${name}' shadows a real node slug (the node wins; rename the alias)`);
  }
  for (const v of Object.keys(reg.verbs || {})) verbProblem('registry verb', v);
  for (const [v, past] of Object.entries(reg.conjugate || {})) {
    verbProblem('conjugation verb', v);
    if (past !== null && past !== '') {
      const problem = relationVerbTargetProblem(reg, past);
      if (problem) probs.push(`conjugation '${v}' target '${String(past)}' ${problem}`);
    }
    if (past && !known(past)) probs.push(`conjugation ${v}→${past} (past form '${past}' is not a known verb)`);
  }
  for (const [v, inv] of Object.entries(reg.inverses || {})) {
    verbProblem('inverse verb', v);
    if (inv !== '') {
      const problem = relationVerbTargetProblem(reg, inv);
      if (problem) probs.push(`inverse '${v}' target '${String(inv)}' ${problem}`);
      if (!known(inv)) probs.push(`inverse ${v}↔${inv} ('${inv}' is not a known verb)`);
    }
  }
  for (const v of reg.weakVerbs || []) verbProblem('weak verb', v);
  probs.push(...conjugationInverseConflicts(reg));
  for (const [ent, e] of Object.entries(reg.entities || {})) {
    for (const [field, spec] of Object.entries(e.profile || {})) {
      const fieldProblem = keyShapeProblem(field);
      if (fieldProblem) probs.push(`profile ${ent}.${field} field '${field}' ${fieldProblem}`);
    }
  }
  return probs;
}

// brain-convergence §2: the seed-shadow scan — the overlay's true semantics are SILENT
// authored-wins (no collision machinery), so doctor detects an authored row that DIFFERS
// from the shipped seed row for the same identity. Advisory, never a gate — the
// migration's only safety net. Granularity: entity TENSES (profile fields grow freely by
// doctrine — never divergence) and verb conjugation/inverse/example values.
function seedShadowAdvisories(regState) {
  const disk = regState?.diskBase;
  if (!disk) return [];
  const seed = cloneSeed();
  const line = (x) => `authored registry row for '${x}' differs from the shipped seed — authored wins; reconcile deliberately (or keep it deliberately)`;
  const out = [];
  for (const [name, e] of Object.entries(disk.entities || {})) {
    const s = ownValue(seed.entities, name);
    if (s && JSON.stringify(e?.tenses || []) !== JSON.stringify(s.tenses)) out.push(line(name));
  }
  // A bare verb row parses back with conjugate '' (the file's spelling of "no mapping"),
  // while the seed simply omits the key — normalize both to '' so a round-tripped save
  // stays silent; null (drop) stays distinct.
  const norm = (src, map, name) => {
    const v = hasOwnKey(src[map] || {}, name) ? src[map][name] : undefined;
    return v === undefined || v === '' ? '' : v;
  };
  const verbIdentity = (src, name) => JSON.stringify({
    past: norm(src, 'conjugate', name),
    inverse: norm(src, 'inverses', name),
    example: ownValue(src.verbs || {}, name)?.example ?? '',
  });
  const seedVerbNames = new Set([...Object.keys(seed.verbs), ...Object.keys(seed.conjugate), ...Object.keys(seed.inverses)]);
  for (const name of seedVerbNames) {
    const authored = hasOwnKey(disk.verbs || {}, name) || hasOwnKey(disk.conjugate || {}, name) || hasOwnKey(disk.inverses || {}, name);
    if (authored && verbIdentity(disk, name) !== verbIdentity(seed, name)) out.push(line(name));
  }
  // wave-2 F3: identities that LEFT the seed (brain-convergence + ontology-cleanup) —
  // an authored row for one can only be a store mid-ritual (or one that never ran it).
  // Advisory, never a gate.
  for (const name of ['user', 'agent', 'charter', 'role', 'runbook'])
    if (hasOwnKey(disk.entities || {}, name))
      out.push(`retired identity '${name}' still authored — convert/remove per INSTALL §Upgrading`);
  return out;
}

function budgetedListProfileFields(reg, entity) {
  return Object.entries(ownValue(reg.entities, entity)?.profile || {})
    .filter(([, spec]) => spec.type === 'list' && Number.isInteger(spec.budget) && spec.budget > 0);
}

// query-time resolution — aliases NEVER rewrite files (§9.7 gardener doctrine).
// a REAL slug always shadows an alias (H6): resolve checks nodes first, so a node
// named like an alias is never hijacked (get and list agree). Single-hop only —
// a.to is returned as-is, never re-resolved (alias→alias chains refused at register).
function resolveSlug(reg, slug, db) {
  if (db && db.prepare(`SELECT 1 FROM nodes WHERE slug=?`).get(slug)) return slug;
  const a = ownValue(reg.aliases, slug); return a && a.kind === 'slug' ? a.to : slug;
}

// Write planning must not open/rebuild SQLite merely to resolve an alias. Authored
// Markdown is the identity truth anyway: an existing source filename shadows a slug
// alias, including while the derived index is absent or stale. This pure resolver lets
// every source/state validation finish before commitPlan crosses the derived-state
// boundary.
function resolveWriteSlug(ctx, slug) {
  try { if (fs.existsSync(nodePath(ctx.root, slug))) return slug; }
  catch { /* the caller's relation-target gate supplies the teaching error */ }
  const a = ownValue(ctx.reg.aliases, slug);
  return a && a.kind === 'slug' ? a.to : slug;
}

// Shared "is there a real node with this exact name?" predicate: an indexed node OR an
// authored source file (indexed or not — the source is identity truth).
function sourceSlugExists(root, slug) {
  try { return fs.existsSync(nodePath(root, slug)); }
  catch { return false; }
}

// Read-time endpoint resolution with source shadowing (F7). Write planning already
// treats an existing source filename as shadowing a slug alias (resolveWriteSlug);
// reads that canonicalize an AUTHORED endpoint for display or topology must agree,
// including pre-sync — otherwise a not-yet-indexed real node folds through its alias
// name and an honestly-authored edge reads as a false self-edge/cycle until the next
// sync. Indexed node wins, then the source file, then the alias (single-hop, like
// resolveSlug — which stays DB-first for query-slug resolution per H6).
function resolveReadSlug(ctx, reg, slug, db) {
  if (db && db.prepare(`SELECT 1 FROM nodes WHERE slug=?`).get(slug)) return slug;
  if (sourceSlugExists(ctx.root, slug)) return slug;
  const a = ownValue(reg.aliases, slug);
  return a && a.kind === 'slug' ? a.to : slug;
}

// Pure mirror of indexOne's live-vs-quarantined decision. Write-side alias resolution
// must recognize exactly the authored verbs a rebuilt index would expose: harmless
// preserved parser diagnostics remain live, while conflicts, NULs, bad filenames, and
// lossy structured/scalar shapes cannot supply identity evidence.
function sourceIndexState(ctx, slug, text) {
  if (hasFrontmatterFence(text)) {
    const fenceEnd = frontmatterFenceEnd(text);
    const frontmatter = fenceEnd === -1 ? text : text.slice(0, fenceEnd + 4);
    if (frontmatter.includes('\0')) return { live: false, parsed: null, problem: 'U+0000 NUL control in frontmatter' };
  }
  if (hasConflictMarkers(conflictRegion(text)))
    return { live: false, parsed: null, problem: 'unmerged VCS conflict markers — unresolved VCS conflict requires repair' };
  const parsed = parseFrontmatter(text);
  const sl = slugLint(slug);
  if (sl) return { live: false, parsed, problem: sl };
  if (!parsed) return { live: true, parsed: null, problem: null };
  const integrity = nodeLint(ctx.reg, { slug, ...parsed.fm, created: parsed.fm.date_created, profile: parsed.fm.profile || {} })
    .filter(p2 => /date_created is required|important must be true or false|must be a scalar text value|relations\[|updated\[|_brain_scalar_codec/.test(p2));
  const problem = integrity.find(p2 => /important must be true or false|must be a scalar text value|relations\[|updated\[|_brain_scalar_codec/.test(p2)) || null;
  return { live: !problem, parsed, problem };
}

function sourceAuthoredVerbs(ctx) {
  if (ctx.writeSourceVerbs instanceof Set) return ctx.writeSourceVerbs;
  const verbs = new Set();
  const dir = path.join(ctx.root, 'brain', '__source');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); }
  catch { /* an absent source directory has no authored verb identities */ }
  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      const state = sourceIndexState(ctx, file.slice(0, -3), text);
      const parsed = state.parsed;
      if (!state.live || !parsed) continue;
      const rels = parsed?.fm?.relations;
      if (!Array.isArray(rels)) continue;
      // A quarantined/ambiguous node cannot establish a real-verb identity. In
      // particular, never let one selected conflict arm override a canonical alias.
      validateRelations(rels, 'stored relations');
      for (const item of rels) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const keys = Object.keys(item).filter(k => k !== 'why');
        if (keys.length === 1 && !relationVerbProblem(keys[0])) verbs.add(keys[0]);
      }
    } catch { /* malformed authored nodes cannot make alias lookup impure */ }
  }
  ctx.writeSourceVerbs = verbs;
  return verbs;
}

function resolveWriteVerb(ctx, verb) {
  if (isRegistryVerb(ctx.reg, verb)) return verb;
  const a = ownValue(ctx.reg.aliases, verb);
  if (!a || a.kind !== 'verb') return verb;
  // Preserve the legacy real-verb-wins rule without consulting the index. This scan is
  // lazy and only occurs when input actually names a verb-alias source.
  return sourceAuthoredVerbs(ctx).has(verb) ? verb : a.to;
}

// Query-time aliases also reconnect relations authored BEFORE a file rename. The edge row
// deliberately retains the authored endpoint (`old-slug`); once old-slug→new-slug is
// registered, reads of EITHER spelling must match both. A real node named like an alias
// still wins — indexed (db) or merely authored (source file on disk, pre-sync — F7) —
// so a shadowed alias name is never folded into its nominal target's set.
function slugReadNames(ctx, reg, slug, db) {
  const canonical = resolveSlug(reg, slug, db);
  const names = [canonical];
  for (const [name, a] of Object.entries(reg.aliases || {})) {
    if (a?.kind !== 'slug' || a.to !== canonical || name === canonical) continue;
    if (db && db.prepare(`SELECT 1 FROM nodes WHERE slug=?`).get(name)) continue;
    if (sourceSlugExists(ctx.root, name)) continue;
    names.push(name);
  }
  return names;
}

const sqlSlots = (values) => values.map(() => '?').join(',');

function canonicalCycleKey(cycle) {
  const ring = cycle.slice(0, -1);
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const rotated = [...ring.slice(i), ...ring.slice(0, i)];
    const key = rotated.join('\0');
    if (best == null || key < best) best = key;
  }
  return best;
}

function partOfCyclesFrom(ctx, db, startSlug) {
  const cycles = new Map();
  // Live sources only (F5): a conflicted/quarantined source's STALE indexed edges must not
  // drive topology — no branch is live truth until reconciliation. (Literal SQL predicate:
  // INDEX cannot reference READ VERBS' edgeSourceLiveSQL const — same inline pattern as the
  // dbHasAuthoredVerb query above.)
  const q = db.prepare(`SELECT to_slug FROM edges WHERE from_slug=? AND verb='part_of' AND brain_edge_source_live(from_slug)=1 ORDER BY rowid`);
  let truncated = false;
  const walk = (slug, pathSlugs, onPath) => {
    for (const r of q.all(slug)) {
      // Alias-semantic traversal: canonicalize each authored endpoint the way the graph
      // reads resolve it (a real node still shadows its alias name), so a cycle whose
      // edges are spelled through slug aliases is walked — and signaled — as the cycle
      // it semantically is, never bypassed by the raw stored spelling. Source-shadow
      // aware (F7): an unindexed real node's file shadows its alias name here too, so
      // a pre-sync edge to it is NOT folded into a false cycle.
      const to = resolveReadSlug(ctx, ctx.reg, String(r.to_slug), db);
      if (onPath.has(to)) {
        const idx = pathSlugs.indexOf(to);
        const cycle = [...pathSlugs.slice(idx), to];
        const key = canonicalCycleKey(cycle);
        if (!cycles.has(key)) cycles.set(key, cycle);
        continue;
      }
      // depth budget — EXPLICIT, never silent (F6): a ring longer than the budget must
      // surface "analysis incomplete", never a false clean.
      if (pathSlugs.length >= 200) { truncated = true; continue; }
      onPath.add(to);
      pathSlugs.push(to);
      walk(to, pathSlugs, onPath);
      pathSlugs.pop();
      onPath.delete(to);
    }
  };
  walk(startSlug, [startSlug], new Set([startSlug]));
  return { cycles: [...cycles.values()], truncated };
}

const partOfCycleSignal = cycle => `part_of cycle: ${cycle.map((slug, i) => i === 0 ? slug : `part_of → ${slug}`).join(' → ')}`;

function resolveVerb(reg, verb, db = null) {
  // Defensive real-verb-wins rule for hand-authored legacy conflicts. New registrations
  // refuse this state, but reads/writes must remain deterministic until doctor is heeded.
  if (isRegistryVerb(reg, verb) || dbHasAuthoredVerb(db, verb)) return verb;
  const a = ownValue(reg.aliases, verb);
  return a && a.kind === 'verb' ? a.to : verb;
}

// C57: display-time inverse resolution (§2/§9.5 — inverses live only in the registry,
// resolved when read, never written to files). A verb's own inverse mapping wins; but a frozen
// edge carries the CONJUGATED (past) form of its verb, which usually has no inverse row of
// its own — fall back to the BASE verb's inverse (the verb whose conjugation produced this
// past form). So `advances`↔`contains` still reads as an inverse after `advances` freezes
// to `advanced`. No registry-format change: the conjugate + inverse_of rows already exist.
function inverseOf(reg, verb) {
  // An own empty value is a durable tombstone and MUST stop fallback through a base
  // conjugation. Otherwise `supported --inverse=` would still resurrect `supports`'
  // inverse after a fresh process open.
  if (hasOwnKey(reg.inverses, verb)) {
    const own = reg.inverses[verb];
    return own && !inverseTargetProblem(reg, own) ? own : null;
  }
  const bases = Object.entries(reg.conjugate || {}).filter(([, past]) => past === verb).map(([base]) => base);
  if (!bases.length) return null;
  const meanings = new Set(bases.map(base => baseInverse(reg, base) ?? '\0none'));
  // Defensive legacy rule: a hand-authored ambiguous many-to-one mapping gets NO inverse
  // label. Doctor reports it and new saves/freezes refuse it; reads must never pick the
  // first base by object iteration order and state a false relationship.
  if (meanings.size !== 1) return null;
  const inverse = baseInverse(reg, bases[0]);
  return inverse && !inverseTargetProblem(reg, inverse) ? inverse : null;
}

// first-use auto-registration: an unknown verb REGISTERS (name + first example), not
// merely tolerated. Known = a conjugation key/value, an inverse, a weak verb, or already registered.
function isKnownVerb(reg, v) {
  return isRegistryVerb(reg, v);
}

function makeInserters(db) {
  const ins = {
    insN: db.prepare(`INSERT INTO nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    insE: db.prepare(`INSERT INTO edges(from_slug,verb,to_slug,why) VALUES(?,?,?,?)`),
    insU: db.prepare(`INSERT INTO updates(card_slug,x,y,"from",why,record_slug,ord) VALUES(?,?,?,?,?,?,?)`),
    // fts rowid is pinned to the nodes rowid so deletes are a rowid lookup, not a
    // full FTS scan (the falsified-O(1)-write bug: DELETE ... WHERE slug=? scanned).
    insF: db.prepare(`INSERT INTO fts(rowid,slug,description,whys,profile,nslug,ndesc,nwhys,nprof) VALUES(?,?,?,?,?,?,?,?,?)`),
    insErr: db.prepare(`INSERT INTO errors VALUES(?,?)`),
    // fts_body is the SEPARATE body index (§9.6) — never the baselined `fts` (its BM25
    // stats are a priced asset). Standard fts5, not contentless: contentless can't
    // rowid-delete incrementally, and bodies are tiny/mostly-empty so the saving is
    // marginal. Null until a schema-3 reindex builds the table; kept a static property
    // (never conditionally added) so the inserters shape is stable — maintenance no-ops
    // on null.
    insFB: null,
  };
  if (hasTable(db, 'fts_body')) ins.insFB = db.prepare(`INSERT INTO fts_body(rowid, body) VALUES(?,?)`);
  return ins;
}

function indexResult(overrides = {}) {
  return { live: false, demoted: false, quarantined: false, problems: [], ...overrides };
}

function bindScalar(field, v, problems) {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  const type = Array.isArray(v) ? 'array' : typeof v;
  const bound = Array.isArray(v) ? v.map(x => String(x)).join(', ')
    : typeof v === 'boolean' ? (v ? 'true' : 'false')
      : String(v);
  problems.push(`${field}: ${JSON.stringify(v)} is not a scalar (hand-edited frontmatter minted a ${type}) — indexed as its string form; fix the file`);
  return bound;
}

function serializeFromCol(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v) || typeof v === 'object') return stringifyJsonExactNumbers(v);
  if (Object.is(v, -0)) return '-0';
  return String(v);
}

function fromColDisplay(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') return stringifyJsonExactNumbers(parsed);
  } catch { /* raw scalar */ }
  return s;
}

// parse one node file and insert its rows; returns index/signal counters for sync/rebuild
function indexOne(ins, slug, p, reg) {
  const problems = [];
  const text = fs.readFileSync(p, 'utf8');
  // V-1: node:sqlite truncates TEXT bindings at U+0000. Intake rejects new NUL scalars,
  // but authored Markdown predates/intentionally bypasses intake; never serve a truncated
  // index value as if it were the file's truth. Scope this to frontmatter so distilled body
  // bytes retain their existing contract.
  if (hasFrontmatterFence(text)) {
    const fenceEnd = frontmatterFenceEnd(text);
    const frontmatterRegion = fenceEnd === -1 ? text : text.slice(0, fenceEnd + 4);
    if (frontmatterRegion.includes('\0')) {
      ins.insErr.run(p, 'U+0000 NUL control in frontmatter — quarantined because SQLite would truncate the served scalar; remove the NUL, then: brain sync');
      return indexResult({ quarantined: true, problems });
    }
  }
  // F-23: an unmerged conflict file indexes last-value-wins — "theirs" silently becomes
  // served truth (a resolution nobody chose; jj materialization is worse). An unmerged
  // file is not yet truth by the VCS's own account: QUARANTINE it (error row, no live
  // rows) until the human resolves and syncs. get/check surface the quarantine loudly.
  if (hasConflictMarkers(conflictRegion(text))) {
    ins.insErr.run(p, 'unmerged VCS conflict markers — unresolved VCS conflict requires repair; quarantined with no live row and no selected branch. Resolve the source conflict, then: brain sync');
    return indexResult({ quarantined: true, problems });
  }
  const parsed = parseFrontmatter(text);
  const sl = slugLint(slug);
  if (sl) { // bug #55: a bad filename is quarantined into errors only, never live rows.
    ins.insErr.run(p, sl);
    return indexResult({ quarantined: true, problems });
  }
  if (!parsed) { // no frontmatter fence — index a BODY-ONLY row so it's never invisible (§4/H16)
    const st = fs.statSync(p);
    const info = ins.insN.run(slug, null, 'card', '', null, null, null, null, 0, null, '{}', p, contentHash(text), st.mtimeMs, st.size);
    if (ins.insFB) { const bt = bodyIndexText(text); if (bt) ins.insFB.run(info.lastInsertRowid, bt); }
    ins.insErr.run(p, 'malformed frontmatter — indexed as body-only (brain doctor)');
    return indexResult({ live: true, demoted: true, problems });
  }
  (parsed.errors || []).forEach(e => ins.insErr.run(p, e)); // surface out-of-subset lines etc.
  const { fm } = parsed;
  const integrityProblems = nodeLint(reg, { slug, ...fm, created: fm.date_created, profile: fm.profile || {} })
    .filter(p2 => /date_created is required|important must be true or false|must be a scalar text value|relations\[|updated\[|_brain_scalar_codec/.test(p2));
  integrityProblems.forEach(p2 => ins.insErr.run(p, p2));
  // Do not pass malformed structured/scalar values into SQLite and then surface a raw
  // bind exception (or, worse, coerce them into a different served truth). Keep only an
  // error row until the authored frontmatter is repaired and synced.
  if (integrityProblems.some(p2 => /important must be true or false|must be a scalar text value|relations\[|updated\[|_brain_scalar_codec/.test(p2)))
    return indexResult({ quarantined: true, problems });
  const cls = deriveClass(reg, fm);
  const edges = edgesOf(fm);
  const st = fs.statSync(p); // content_hash + mtime/size drive `sync`'s mark-and-sweep
  const info = ins.insN.run(slug, bindScalar('entity', fm.entity, problems), cls, String(fm.description ?? ''),
    bindScalar('status', fm.status, problems), bindScalar('due', fm.due, problems),
    bindScalar('occurred', fm.occurred, problems), bindScalar('date_created', fm.date_created, problems),
    fm.important === true ? 1 : 0,
    // brain-profiles §5: the INTEGER cast happens ONCE here — a non-canonical stored
    // value indexes NULL (COALESCE treats it as 0) and lint/vote teach the repair.
    canonicalVotesInt(fm.votes),
    stringifyJsonExactNumbers(fm.profile ?? {}), p, contentHash(text), st.mtimeMs, st.size);
  problems.forEach(e => ins.insErr.run(p, e)); // bug #65: parser-minted non-scalars stay live but visible.
  const rowid = info.lastInsertRowid;
  // no materialized inverse edges (§9.5, wave 5): the column is gone; inbound is
  // resolved at display time via to_slug queries.
  edges.forEach(e => ins.insE.run(slug, e.verb, e.to, e.why));
  (fm.updated || []).forEach((u, i) =>
    ins.insU.run(slug, String(u.x ?? ''), String(u.y ?? ''), serializeFromCol(u.from), u.why ?? null, u.record ?? null, i));
  // Profile VALUES are searchable (needle-amount finding, run 6/10): flatten scalars +
  // lists. Separately-authored values get a tokenizer-visible boundary. Whitespace alone
  // does not consume an FTS position, so joining with a plain space fabricated phrases
  // across two whys/profile cells (FB-4).
  const joinSegments = (xs) => xs.map(String).join(` ${SEARCH_SEGMENT_BOUNDARY} `);
  const profVals = joinSegments(Object.values(fm.profile ?? {}).flat());
  const whys = joinSegments(edges.map(e => e.why || ''));
  // C-3: the norm shadow — ONE column per raw surface, so a user-quoted phrase normalizes
  // WITHIN an authored value and can't span a surface OR value boundary.
  const desc = String(fm.description ?? '');
  ins.insF.run(rowid, slug, desc, whys, profVals,
    searchNormalize(slug), searchNormalize(desc), searchNormalize(whys), searchNormalize(profVals));
  if (ins.insFB) { const bt = bodyIndexText(parsed.body); if (bt) ins.insFB.run(rowid, bt); } // distilled tier (§9.6)
  return indexResult({ live: true, problems });
}


// incremental per-slug update — writes are O(1), never a corpus rebuild. Sound
// because all derived state (blocked, latest-record, collisions, inbound edges) is
// computed at query time. Deletes exactly the rows this node's file produced: its
// authored edges (all inverse=0 now that materialized inverses are dead).
// NO transaction — the caller owns BEGIN/COMMIT so `apply`/`sync` can fold many
// slugs into a single transaction (file-first, index-second).
function deleteIndexRows(root, db, slug) {
  const p = path.join(root, 'brain', '__source', slug + '.md');
  const old = db.prepare(`SELECT rowid FROM nodes WHERE slug=?`).get(slug);
  db.prepare(`DELETE FROM nodes WHERE slug=?`).run(slug);
  db.prepare(`DELETE FROM edges WHERE from_slug=?`).run(slug);
  db.prepare(`DELETE FROM updates WHERE card_slug=?`).run(slug);
  if (old) db.prepare(`DELETE FROM fts WHERE rowid=?`).run(old.rowid); // rowid-keyed: O(1), no FTS scan
  if (old && hasTable(db, 'fts_body')) db.prepare(`DELETE FROM fts_body WHERE rowid=?`).run(old.rowid);
  db.prepare(`DELETE FROM errors WHERE path=?`).run(p);
}

function reindexRows(root, db, slug, reg) {
  const p = path.join(root, 'brain', '__source', slug + '.md');
  deleteIndexRows(root, db, slug);
  if (fs.existsSync(p)) return indexOne(makeInserters(db), slug, p, reg);
  return { removed: true };
}

// Forget remains available when registry syntax is newer/ambiguous because it only moves
// Markdown bytes. If a CURRENT derived index already exists, dropping one absent source's
// rows needs no registry interpretation and keeps every read honest. Never bootstrap or
// upgrade an index here: either condition would require parsing authored nodes.
function deleteIndexRowsIfCurrent(ctx, slug) {
  const p = path.join(ctx.root, '.brain', 'index.sqlite');
  if (!fs.existsSync(p)) return false;
  acquireIndexReader(ctx); // publish before index.lock so a gated swap cannot deadlock us
  return withIndexLock(ctx.root, () => {
    // A rebuild may have swapped the pathname while this command was waiting. Never
    // delete through a cached handle to the retired inode.
    closeDb(ctx);
    const db = openDb(ctx);
    if (!hasIndex(db) || schemaVersion(db) !== SCHEMA_VERSION) return false;
    try {
      withBusyRetry(db, () => {
        db.exec('BEGIN');
        deleteIndexRows(ctx.root, db, slug);
        db.exec('COMMIT');
      });
      clearDirty(ctx.root, [slug]);
      return true;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled */ }
      throw e;
    }
  });
}

function indexNode(ctx, db, slug) {
  const { root } = ctx;
  // Every caller establishes a current schema before taking index.lock. Rebuilding here
  // would invert the global order (reindex.lock -> index.lock) while index.lock is already
  // held. Treat a vanished schema as a recoverable pending-index failure; the next open
  // can rebuild in the proper order without admitting two writers.
  if (!hasIndex(db)) throw new Error('index schema disappeared after validation — index left pending; retry so the derived index can rebuild');
  db.exec('BEGIN');
  const r = reindexRows(root, db, slug, ctx.reg);
  db.exec('COMMIT');
  return r;
}

function reapStaleNextFiles(root) {
  const dir = path.join(root, '.brain');
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = /^index\.sqlite\.(\d+)\.next(-wal|-shm|-journal)?$/.exec(f); // bug #59
    if (!m) continue;
    const pid = +m[1];
    if (pid === process.pid || pidAlive(pid)) continue;
    try { fs.unlinkSync(path.join(dir, f)); n++; } catch { /* ok */ }
  }
  return n;
}

function lockPathsForSpec(root, spec) {
  if (spec.rel) return [path.join(root, spec.rel)].filter(p => fs.existsSync(p));
  if (spec.relGlob) {
    const dir = path.join(root, path.dirname(spec.relGlob));
    if (!fs.existsSync(dir)) return [];
    const suffix = path.basename(spec.relGlob).slice(1);
    return fs.readdirSync(dir).filter(f => f.endsWith(suffix)).map(f => path.join(dir, f));
  }
  return [];
}

// bug #59: crashed lockfiles should be visible and reapable during the deep verify sweep.
function reapStaleLocks(root, report) {
  let n = 0;
  for (const spec of LOCKS) {
    for (const p of lockPathsForSpec(root, spec)) {
      try {
        if (!reapLockIfStale(p, spec)) continue; // identity-safe: never reap a replacement
        n++;
        if (report && n <= 20) report(`  lock: reaped stale ${path.relative(root, p)}`);
      } catch { /* disappeared or unreadable: leave it to the next verify */ }
    }
  }
  return n;
}

// full rebuild — recovery/migration verb, NOT the write path (writes use indexNode).
// Builds into a PID-UNIQUE temp (index.sqlite.<pid>.next) and ATOMICALLY swaps on
// success: an interrupted rebuild can never truncate the live index other sessions
// serve from, and two concurrent builders each rename only their OWN temp (a losing
// rename replaces cleanly — it can never ENOENT-crash).
// migrateStale: ONLY the explicit reindex verb persists a stale-format registry (bug #22).
// The read-path self-heals (autoRebuild/requireDb/corrupt-recovery) rebuild derived state
// from the same effective in-memory registry but must never write authored bytes — a read
// staying a read is load-bearing (the example-pa compat gate pins it).
function reindex(ctx, log = ctx.io.out, { migrateStale = false } = {}) { // log=console.error for auto-rebuild (keep the triggering read's stdout clean)
  const { root } = ctx;
  const { parseError, futureFormat, rewriteProblems } = ctx.regState;
  // REFUSE on a corrupt registry (H4/Opus-B N4): a full rebuild on the seed-fallback
  // would misclassify every custom-entity node and bake it corpus-wide.
  if (parseError) die(`refusing to reindex — brain/__meta/registry.md is unparseable (${parseError}); fix it first (a rebuild on the seed would misclassify custom-entity nodes corpus-wide)`);
  if (futureFormat != null)
    die(`refusing to reindex — brain/__meta/registry.md format ${futureFormat} is newer than this engine supports (format ${REG_FORMAT}); upgrade the engine first so newer authored truth is not misclassified`);
  if (rewriteProblems?.length)
    die(`refusing to reindex — brain/__meta/registry.md needs hand repair (${rewriteProblems[0]}); rebuilding from an ambiguous/invalid registry could misclassify authored nodes`);
  const dir = path.join(root, 'brain', '__source');
  if (!fs.existsSync(dir)) die(`no brain/__source/ — migrate: mkdir brain/__source && move brain/*.md into it`);
  // The source precondition is part of validation. A wrong-root reindex must not rewrite
  // authored registry bytes before discovering there is no corpus to rebuild.
  if (migrateStale) migrateRegistryIfStale(ctx);
  const brainDir = path.join(root, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });
  const livePath = path.join(brainDir, 'index.sqlite');
  const nextPath = path.join(brainDir, `index.sqlite.${process.pid}.next`);
  reapStaleNextFiles(root);
  for (const suf of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(nextPath + suf); } catch { /* absent */ } }
  const db = new DatabaseSync(nextPath);
  db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;`); // throwaway build: fast, single file, no WAL sidecars
  db.exec(`${NODES_DDL};
    CREATE TABLE edges(from_slug TEXT, verb TEXT, to_slug TEXT, why TEXT);
    CREATE TABLE updates(card_slug TEXT, x TEXT, y TEXT, "from" TEXT, why TEXT, record_slug TEXT, ord INTEGER);
    CREATE TABLE errors(path TEXT, problem TEXT);
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE VIRTUAL TABLE fts USING fts5(slug, description, whys, profile, nslug, ndesc, nwhys, nprof);
    CREATE VIRTUAL TABLE fts_body USING fts5(body);
  `);
  const buildStart = Date.now(); // watermark: files written after this may miss the snapshot
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(); // sorted → deterministic rowids
  const ins = makeInserters(db);
  let n = 0, demoted = 0, quarantined = 0;
  db.exec('BEGIN');
  for (const f of files) {
    const slug = f.replace(/\.md$/, '');
    const p = path.join(dir, f);
    try {
      const r = indexOne(ins, slug, p, ctx.reg);
      if (r.live) n++;
      if (r.demoted) demoted++;
      if (r.quarantined) quarantined++;
    } catch (e) {
      ins.insErr.run(p, `index failure: ${e.message} — file quarantined (brain doctor)`);
      quarantined++;
    }
  }
  db.exec('COMMIT');
  db.exec(`CREATE INDEX idx_edges_from ON edges(from_slug, verb);
    CREATE INDEX idx_edges_to ON edges(to_slug, verb);
    CREATE INDEX idx_edges_verb ON edges(verb);
    CREATE INDEX idx_nodes_class_status_due ON nodes(class, status, due);
    CREATE INDEX idx_nodes_class_occurred ON nodes(class, occurred);
    CREATE INDEX idx_nodes_entity ON nodes(entity);
    CREATE INDEX idx_nodes_name ON nodes(entity, json_extract(profile_json,'$.name'));
    CREATE INDEX idx_updates_card ON updates(card_slug, ord);`);
  db.prepare(`INSERT OR REPLACE INTO meta VALUES('schema_version', ?)`).run(SCHEMA_VERSION);
  const edgeC = db.prepare(`SELECT COUNT(*) c FROM edges`).get().c;
  const errC = db.prepare(`SELECT COUNT(*) c FROM errors`).get().c;
  let reconciled = 0, finalN = n, finalEdgeC = edgeC, finalErrC = errC;
  // This rebuild context may have opened the old generation while discovering a stale
  // schema. It cannot wait for itself during reader draining.
  closeBrain(ctx);
  // The build stays lock-free and disposable. At publication, gate fresh readers, drain
  // every old-generation lease, then serialize against incremental writers. Reconcile the
  // private file BEFORE publication: interruption leaves either complete old or complete
  // new, never a newly-visible snapshot that still needs post-rename repair.
  withIndexSwap(root, () => {
    try {
      let n2 = 0;
      const currentSlugs = new Set(), currentPaths = new Set();
      db.exec('BEGIN');
      // Watermark updates catch creates/edits that landed during the throwaway build.
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        const slug = f.replace(/\.md$/, '');
        const p = path.join(dir, f);
        try {
          const st = fs.statSync(p);
          currentSlugs.add(slug); currentPaths.add(p);
          if (st.mtimeMs >= buildStart) { reindexRows(root, db, slug, ctx.reg); n2++; }
        } catch (e) { if (e.code !== 'ENOENT') throw e; } // vanished mid-scan: absent sweep below
      }
      // A forget can complete against the prior live DB while the throwaway snapshot is
      // building. Source truth wins before any reader can open the replacement.
      for (const { slug } of db.prepare(`SELECT slug FROM nodes`).all()) {
        if (!currentSlugs.has(slug)) { deleteIndexRows(root, db, slug); n2++; }
      }
      const delErr = db.prepare(`DELETE FROM errors WHERE path=?`);
      for (const { path: errorPath } of db.prepare(`SELECT DISTINCT path FROM errors`).all())
        if (path.dirname(errorPath) === dir && !currentPaths.has(errorPath)) delErr.run(errorPath);
      db.exec('COMMIT');
      reconciled = n2;
      finalN = db.prepare(`SELECT COUNT(*) c FROM nodes`).get().c;
      finalEdgeC = db.prepare(`SELECT COUNT(*) c FROM edges`).get().c;
      finalErrC = db.prepare(`SELECT COUNT(*) c FROM errors`).get().c;
      // Do not clear the shared dirty ledger from a directory snapshot. A same-slug
      // writer can establish a newer claim after its file was scanned; its own index
      // phase (serialized by index.lock) or the next requireDb() consumes that claim.
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ok */ }
      // A failed private reconciliation is still structurally publishable only with a
      // pre-publication recovery claim. Every semantic reader consumes that claim before
      // serving rows, so no unreconciled snapshot escapes.
      writeDirty(root, files.map(f => f.replace(/\.md$/, '')));
      console.error(`⚠ post-rebuild reconcile failed (${e.message}) — recovery claims retained; the next derived read will reconcile them, or run: brain sync`); // bug #78
    }

    // Ship the replacement already in WAL mode with all frames flushed into its main
    // file. It is closed and single-file before the pathname becomes visible.
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE);`);
    db.close();
    for (const suf of ['-wal', '-shm', '-journal']) { try { fs.unlinkSync(nextPath + suf); } catch { /* absent/empty */ } }

    // No live reader remains. Checkpoint the OLD generation before removing its sidecars;
    // if the process dies before rename, that single main file is still a complete index.
    if (fs.existsSync(livePath)) {
      let old = null;
      try {
        old = new DatabaseSync(livePath);
        old.exec(`PRAGMA busy_timeout=10000; PRAGMA wal_checkpoint(TRUNCATE);`);
      } catch (e) {
        if (!/not a database|database disk image is malformed/i.test(String(e?.message || ''))) throw e;
      } finally { try { old?.close(); } catch { /* malformed handle */ } }
    }
    for (const suf of ['-wal', '-shm', '-journal']) { try { fs.unlinkSync(livePath + suf); } catch { /* absent */ } }
    fs.renameSync(nextPath, livePath);
    fsyncDir(brainDir);
  });
  log(`indexed ${finalN} nodes, ${finalEdgeC} edges${reconciled ? `, +${reconciled} reconciled` : ''}${demoted ? `, ${demoted} demoted to body-only — run doctor` : ''}${quarantined ? `, ${quarantined} quarantined (bad slug / index failure) — run doctor` : ''}` + (finalErrC ? ` — ${finalErrC} errors (brain doctor)` : ''));
}

function schemaCurrent(root, coordinated = true) {
  const p = path.join(root, '.brain', 'index.sqlite');
  if (!fs.existsSync(p)) return false; // probing derived state must never create it
  const probe = { root, readerLease: null };
  let d = null;
  try {
    if (coordinated) acquireIndexReader(probe);
    if (!fs.existsSync(p)) return false;
    d = new DatabaseSync(p, { readOnly: true });
    d.exec('PRAGMA busy_timeout=2000');
    return schemaVersion(d) === SCHEMA_VERSION;
  } catch { return false; }
  finally {
    try { d?.close(); } catch { /* malformed handle */ }
    if (coordinated) releaseIndexReader(probe);
  }
}

function autoRebuild(ctx) {
  const { root } = ctx;
  // Never wait for reindex.lock while retaining a DB generation. Otherwise a builder can
  // own reindex.lock and wait for this lease while this reader waits for that same lock.
  closeBrain(ctx);
  if (schemaCurrent(root)) return; // fast path — someone already rebuilt
  withReindexLock(root, () => {
    if (schemaCurrent(root)) return; // recheck inside the lock — a prior winner did it
    console.error(`note: index schema stale — rebuilding (single-flight, pid ${process.pid})…`);
    reindex(ctx, console.error); // builds a pid-unique temp, swaps, stamps schema
  });
}

function requireDb(ctx) {
  const { root } = ctx;
  const p = path.join(root, '.brain', 'index.sqlite');
  // F-18: .brain/ is DERIVED state (gitignored) — every fresh clone/worktree lands here
  // brainless, and dying made absent memory indistinguishable from empty memory. Treat
  // missing/corrupt/empty exactly like a stale schema: single-flight rebuild from the
  // md truth. (The registry parseError gate inside reindex still refuses when rebuilding
  // would bake misclassification.)
  const selfHeal = (why) => {
    if (!fs.existsSync(path.join(root, 'brain', '__source')))
      die(`no index — and no brain/__source/ to rebuild from (${why}); is this a brain root? (set BRAIN_ROOT or --root)`);
    console.error(`note: ${why} — rebuilding from brain/__source/ (single-flight, pid ${process.pid})…`);
    closeBrain(ctx); // reindex.lock is always acquired without a retained reader generation
    withReindexLock(root, () => { if (!schemaCurrent(root)) reindex(ctx, console.error); });
  };
  if (!fs.existsSync(p)) selfHeal('no index yet (.brain/ is derived and gitignored)');
  let db;
  try {
    db = openDb(ctx);
    if (!hasIndex(db)) { selfHeal('index file has no tables'); db = openDb(ctx); }
  } catch (e) {
    if (!/not a database|database disk image is malformed/i.test(String(e?.message || ''))) throw e;
    let failedIdentity = null;
    try { failedIdentity = fs.lstatSync(p); } catch (statErr) { if (statErr.code !== 'ENOENT') throw statErr; }
    closeDb(ctx);
    releaseIndexReader(ctx);
    console.error(`note: index file corrupt (it is disposable — replacing it) — rebuilding from brain/__source/ (single-flight, pid ${process.pid})…`);
    // A corrupt-handle failure may race a peer's completed rebuild. Serialize cleanup in
    // the same reindex -> index order as every swap, then remove only the exact inode that
    // failed. A valid successor at the pathname wins and is never unlinked by a delayed
    // recovery process.
    withReindexLock(root, () => {
      if (schemaCurrent(root)) return;
      let changed = false;
      withIndexSwap(root, () => {
        if (schemaCurrent(root, false)) return;
        let current = null;
        try { current = fs.lstatSync(p); } catch (statErr) { if (statErr.code !== 'ENOENT') throw statErr; }
        if (current && failedIdentity && !sameLockFile(current, failedIdentity)) { changed = true; return; }
        for (const suf of ['', '-wal', '-shm', '-journal']) {
          try { fs.unlinkSync(p + suf); } catch (unlinkErr) { if (unlinkErr.code !== 'ENOENT') throw unlinkErr; }
        }
      });
      if (schemaCurrent(root)) return;
      if (changed) die('index changed while corrupt-index recovery was waiting — refusing to delete the replacement; retry the command');
      reindex(ctx, console.error);
    });
    db = openDb(ctx);
  }
  if (schemaVersion(db) !== SCHEMA_VERSION) { // stale/absent schema → single-flight rebuild
    autoRebuild(ctx);
    db = openDb(ctx);
  }
  // Crash recovery belongs to the first command that ACTUALLY consumes current derived
  // state, not to main's prelude. Pure-validation failures and zero-DB verbs therefore
  // cannot mutate a dirty index before reporting "nothing executed". childCtx shares the
  // dirtyChecked slot, so embedded reads still heal at most once per process.
  if (!ctx.dirtyChecked && fs.existsSync(dirtyPath(root))) {
    db = withIndexLock(root, () => {
      // The rebuild may have swapped while this command was opening/waiting. Recovery
      // must reconcile the pathname's current DB, never a retired open inode.
      closeDb(ctx);
      const current = openDb(ctx);
      recoverDirty(ctx, current);
      return current;
    });
  } else recoverDirty(ctx, db);
  return db;
}

function recoverDirty(ctx, db) {
  const { root } = ctx;
  if (ctx.dirtyChecked) return; ctx.dirtyChecked = true;
  const p = dirtyPath(root);
  if (!fs.existsSync(p)) return;
  const { slugs: dirty, invalid, error } = readDirtySet(root);
  if (dirty == null) {
    console.error(`⚠ could not read the crash sentinel (${error?.message || 'unknown error'}) — leaving it for the next open; run: brain sync`);
    return;
  }
  if (invalid.length) {
    console.error(`⚠ crash sentinel contained ${invalid.length} invalid slug entr${invalid.length === 1 ? 'y' : 'ies'} — ignored and removed without reading outside brain/__source/: ${invalid.slice(0, 5).map(x => JSON.stringify(x.entry)).join(', ')}${invalid.length > 5 ? ', …' : ''}`);
    try { sanitizeDirtyLedger(root); }
    catch (e) {
      console.error(`⚠ could not sanitize the crash sentinel (${e.message}) — valid entries remain recoverable; invalid entries are still ignored`);
    }
  }
  const slugs = [...dirty];
  if (!slugs.length) {
    if (!invalid.length) clearDirty(root);
    return;
  }
  const unsafeReason = ctx.regState.parseError
    ? `the registry is unparseable`
    : ctx.regState.futureFormat != null
      ? `registry format ${ctx.regState.futureFormat} is newer than this engine`
      : ctx.regState.rewriteProblems?.length
        ? `the registry needs hand repair (${ctx.regState.rewriteProblems[0]})`
        : null;
  if (unsafeReason) {
    // Missing sources are forgets: deletion is registry-independent, so a current index
    // can be made honest. Existing sources may be creates/edits/recoveries and MUST stay
    // pending; interpreting one with fallback/old semantics would bake wrong rows.
    const absent = slugs.filter(s => !fs.existsSync(nodePath(root, s)));
    try {
      if (absent.length) {
        withBusyRetry(db, () => {
          db.exec('BEGIN');
          for (const s of absent) deleteIndexRows(root, db, s);
          db.exec('COMMIT');
        });
        clearDirty(root, absent);
      }
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled */ }
      console.error(`⚠ crash recovery could not remove archived-node index rows (${e.message}) — the sentinel is left in place`);
      return;
    }
    const pending = slugs.filter(s => !absent.includes(s));
    if (pending.length)
      console.error(`⚠ crash sentinel pending but ${unsafeReason} — left ${pending.length} existing source file(s) unindexed; repair/upgrade registry, then: brain sync`);
    return;
  }
  console.error(`note: recovering an interrupted write — re-syncing ${slugs.length} slug(s): ${slugs.slice(0, 8).join(', ')}${slugs.length > 8 ? '…' : ''}`);
  // bug #14: retry under a busy index, and clear ONLY on success (the old code cleared
  // the sentinel even when the reindex rolled back → the pending slugs were lost) and
  // ONLY the slugs we reconciled (a concurrent writer's fresh slug survives).
  // bug #62: one broken slug rolls back only its savepoint; healed slugs clear, stuck
  // slugs stay in the crash sentinel for the next open/sync.
  const healed = [], stuck = [];
  try {
    withBusyRetry(db, () => {
      healed.length = 0; stuck.length = 0;
      db.exec('BEGIN');
      for (const s of slugs) {
        db.exec('SAVEPOINT sp');
        try {
          reindexRows(root, db, s, ctx.reg);
          db.exec('RELEASE sp');
          healed.push(s);
        } catch {
          try { db.exec('ROLLBACK TO sp'); } finally { db.exec('RELEASE sp'); }
          stuck.push(s);
        }
      }
      db.exec('COMMIT');
    });
    clearDirty(root, healed);
    if (stuck.length) console.error(`⚠ crash recovery: ${stuck.join(', ')} still pending — run: brain sync`);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ok */ }
    console.error(`⚠ crash recovery could not run (${e.message}) — the sentinel is left in place; run: brain sync`); // bug #66
  } // still locked — leave the sentinel for the next open
}

// ===== SECTION: MUTATION-CORE =====

// read a node for mutation: fm + the EXACT body bytes (everything past the closing
// '---') + the content hash captured at read (for CAS).
function readNode(root, slug) {
  const p = nodePath(root, slug);
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8');
  const parsed = parseFrontmatter(text);
  if (!parsed) {
    if (hasConflictMarkers(conflictRegion(text)))
      die(`'${slug}' carries unmerged conflict markers in an open/broken frontmatter block — unresolved VCS conflict requires repair before any branch can be served. Resolve the source conflict, then: brain sync --slug ${slug}`);
    die(`'${slug}' has no frontmatter`);
  }
  if (parsed._unparseable?.length) parsed.fm._unparseable = parsed._unparseable;
  return { fm: parsed.fm, body: text.slice(parsed.bodyStart), hash: contentHash(text), errors: parsed.errors || [], text };
}

function readSourceFileOrDie(root, slug) {
  const p = nodePath(root, slug);
  try { return fs.readFileSync(p, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT')
      die(`no source file for '${slug}' at ${p} — the node is indexed but its file is gone; run: brain sync`);
    throw e;
  }
}

// forget = archive, never delete (H1): move the node's md file byte-untouched into
// the forgotten brain (sibling of __source/, WITH the truth — never in .brain/).
// reindex/sync only read __source/, so a forgotten file is invisible to every verb.
// Name collision → date prefix; a same-day re-collision gets a numeric suffix.
// Returns the destination path. The caller drops the index rows afterward.
function forgetFile(root, slug, today = () => localDate(null), opts = {}) {
  const move = () => {
    const source = nodePath(root, slug);
    if (opts.expectHash != null) {
      if (!fs.existsSync(source))
        die(`'${slug}' changed on disk since your read — the file is GONE (already forgotten or renamed); nothing archived`);
      const cur = contentHash(fs.readFileSync(source, 'utf8'));
      if (cur !== opts.expectHash && !opts.force)
        die(`'${slug}' changed on disk since your read (now ${cur.slice(0, 8)} ≠ read ${String(opts.expectHash).slice(0, 8)}) — re-read or pass --force`);
      if (cur !== opts.expectHash && opts.force)
        (opts.signals || []).push(`⚠ --force: '${slug}' changed after prepare (now ${cur.slice(0, 8)} ≠ read ${String(opts.expectHash).slice(0, 8)}) — archiving the current bytes`);
    }
    const dir = forgottenDir(root);
    fs.mkdirSync(dir, { recursive: true });
    let dest = path.join(dir, slug + '.md');
    if (fs.existsSync(dest)) {
      const base = `${today()}-${slug}`;
      dest = path.join(dir, base + '.md');
      for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${base}-${i}.md`);
    }
    fs.renameSync(source, dest); // same filesystem: atomic, bytes preserved
    return dest;
  };
  return opts.expectHash != null && !opts.lockHeld ? withLock(nodeLockPath(root, slug), move) : move();
}

function writeNode(root, slug, fm, body, opts = {}) {
  const text = '---\n' + serializeFrontmatter(fm) + '---' + body;
  const dest = nodePath(root, slug);
  // the verify → write must be ONE critical section. bug #15: two concurrent sets with
  // the SAME --base-hash both passed the check (each read the pre-write file) and both
  // wrote — a silent lost update. Re-verifying the hash INSIDE a per-slug lock, right
  // before the rename, makes the loser see the winner's bytes and refuse.
  const verifyAndWrite = () => {
    if (opts.expectHash != null) {
      if (!fs.existsSync(dest))
        die(`'${slug}' changed on disk since your read — the file is GONE (forgotten or renamed); refusing to recreate it. Re-read; to recreate deliberately use: brain new --force`); // bug #53
      const cur = contentHash(fs.readFileSync(dest, 'utf8'));
      if (cur !== opts.expectHash) {
        if (!opts.force) die(`'${slug}' changed on disk since your read (now ${cur.slice(0, 8)} ≠ read ${String(opts.expectHash).slice(0, 8)}) — re-read or pass --force`);
        const keep = forgetFile(root, slug, opts.today); // --force: don't lose the clobbered version
        console.error(`⚠ CAS: '${slug}' was concurrently modified; the on-disk version is archived to ${path.relative(root, keep)} before overwrite`);
      }
    }
    const tmp = writeTempFsynced(path.join(root, '.brain', 'tmp'), `${slug}.${process.pid}.${Date.now()}.tmp`, text);
    fs.renameSync(tmp, dest);
    fsyncDir(path.dirname(dest));
  };
  // Only CAS writes need the cross-process lock; a plain single-turn overwrite (no
  // expectHash) is last-writer-wins by design and skips the lock cost.
  if (opts.expectHash != null && !opts.lockHeld) withLock(nodeLockPath(root, slug), verifyAndWrite);
  else verifyAndWrite();
  if (fm._unparseable?.length)
    console.error(`⚠ '${slug}': ${fm._unparseable.length} unparseable frontmatter line(s) preserved verbatim (fix by hand): ${fm._unparseable.join(' | ')}`);
  return text;
}

// exclusive create for a fresh node (H2): linkSync is atomic and fails EEXIST, giving
// O_EXCL semantics with no TOCTOU (existsSync-then-rename lets two `new`s both win).
function writeNodeExclusive(root, slug, fm, body, dirtyOwned = true) {
  const text = '---\n' + serializeFrontmatter(fm) + '---' + body;
  const dest = nodePath(root, slug);
  const tmp = writeTempFsynced(path.join(root, '.brain', 'tmp'), `${slug}.${process.pid}.${Date.now()}.new`, text);
  try { fs.linkSync(tmp, dest); }
  catch (e) { try { fs.unlinkSync(tmp); } catch { /* ok */ } if (e.code === 'EEXIST') { if (dirtyOwned) clearDirty(root, [slug]); die(`'${slug}' exists — inspect it: brain get ${slug}; a different thing? mint a suffixed slug (${slug}-2); the same thing? update it: brain set ${slug} --field …`); } throw e; } // bug #66
  fs.unlinkSync(tmp);
  fsyncDir(path.dirname(dest));
  return text;
}


// the data keys an op actually carried (minus the envelope) — names the typo in a
// missing-key error, so {"field":"due","value":..} reports "got keys: field, value".
const opKeys = (op) => Object.keys(op).filter(k => !['op', 'id', 'slug'].includes(k)).join(', ') || '(none)';

// read a field's value from an fm (scalar or profile.<k>) — used by T4 auto-from to
// capture the pre-set value that a paired push should record as `from` (decision #66).
const readField = (fm, field) => field.startsWith('profile.') ? ownValue(fm.profile, field.slice(8)) : ownValue(fm, field);

// build a full fm for a fresh node (used by `new` and the apply `new` op — one
// authored node, serialized once even when it carries profile/relations inline).
function buildNewFm(env, o) {
  o = { ...o };
  if (!o.entity || !o.slug || !o.description) die(`new requires entity, slug, description`);
  if (typeof o.entity !== 'string') die(`entity must be a string — got ${jsonType(o.entity)}; nothing written`);
  const extraNewKeys = Object.keys(o).filter(k => !NEW_OP_KEYS.has(k));
  if (extraNewKeys.length)
    die(`new op has unknown key(s): ${extraNewKeys.join(', ')} (allowed: ${[...NEW_OP_KEYS].join(', ')})`);
  const lint = slugLint(o.slug); // H11/H18: one lint at every mint path
  if (lint) die(lint);
  if (typeof o.description !== 'string' || o.description.trim() === '')
    die(`description is required (THE search surface) and must contain non-whitespace text — nothing written`);
  if (o.profile != null && (!o.profile || typeof o.profile !== 'object' || Array.isArray(o.profile)))
    die(`profile must be an object whose values are scalars or flat scalar lists — got ${jsonType(o.profile)}; nothing written`);
  const validationOpts = { quiet: !!env.quietValidation };
  assertScalarSize('description', o.description, validationOpts); // F-6
  if (o.profile && typeof o.profile === 'object' && !Array.isArray(o.profile))
    Object.entries(o.profile).forEach(([k, v]) => assertScalarSize(`profile.${k}`, v, validationOpts)); // F-6
  // bug #23: ISO-date validation before anything is written (covers `new` AND apply's
  // `new` op — both route here). Malformed due/occurred never enters a fresh node.
  o.due = assertFieldWrite('due', o.due); // bug #76
  o.occurred = assertFieldWrite('occurred', o.occurred); // bug #76
  o.date_created = assertFieldWrite('date_created', o.date_created); // bug #76
  o.date_updated = assertFieldWrite('date_updated', o.date_updated); // bug #76
  o.status = assertFieldWrite('status', o.status); // bug #76
  if (o.superseded_by != null && o.superseded_by !== '') o.superseded_by = assertFieldWrite('superseded_by', o.superseded_by); // bug #76
  if (o.profile && typeof o.profile === 'object' && !Array.isArray(o.profile))
    Object.keys(o.profile).forEach(k => assertKeyShape('profile key', k)); // bug #86
  const updatedItems = validateUpdatedItems(o.updated, validationOpts); // bug G5: inline updated[] uses push's x/y + ISO gate
  if (updatedItems.length > UPDATED_CAP)
    die(`updated[] carries ${updatedItems.length} entries — the stack caps at ${UPDATED_CAP} (FILO); trim the import`); // bug #76
  const today = env.today();
  const reg = ownValue(env.reg.entities, o.entity);
  const hasExplicitClass = hasOwnKey(o, 'class') && o.class != null;
  if (hasExplicitClass && typeof o.class !== 'string')
    die(`class must be a string when provided — got ${jsonType(o.class)}; nothing written`);
  // bug #21: the effective registry (merged seed + custom, brain/__meta/registry.md) is
  // authored truth — a node's entity MUST be a registered type. An unregistered string
  // (usually a typo) mints a node invisible to every entity-filtered read, a silent wrong
  // answer. Refuse at the write path, naming the registry + the register verb. Nothing is
  // written. (deriveClass/index keep tolerating unregistered entities on ALREADY-STORED
  // files — no migration; this guards creation only.)
  // ontology-cleanup §8 refusal point 2: on a LOCKED store the repair path is not "register
  // it first" — that door is shut — so the teaching becomes the PROPOSAL path (same string
  // as the register refusal, and it never names the bypass). The proposal is a note card
  // (notes are registered and always writable); the asks ledger is machine-authored and
  // read-only, so "file an ask" was uncompliable as taught. Reads are untouched: legacy
  // cards with unregistered entities still serve with the advisory signal.
  if (!reg && env.schemaLock && !env.adminMode)
    die(`entity '${o.entity}' is not in the registry (brain/__meta/registry.md) and schema is locked — a schema change is an admin-mode act; record the proposal as a note ("schema proposal: <what and why>") for the next admin session, or fix the typo. Nothing written.`);
  if (!reg)
    die(`entity '${o.entity}' is not in the registry (brain/__meta/registry.md) — register it first: brain register --entity ${o.entity} --tenses <card|record|future,…>, or fix the typo. Nothing written.`);
  // brain-profiles §2: the registration check ran FIRST (an unregistered name gets the
  // teaching above, never this one). Reads never lie — existing cards of a disabled type
  // stay fully served; only CREATION refuses. BRAIN_ADMIN does NOT bypass (one
  // mechanism: an admin who wants the type edits the config).
  if ((env.disabledEntities || []).includes(o.entity))
    die(`entity '${o.entity}' is disabled by this brain's config (__meta/config.json disabled_entities) — remove it from the list to enable. Nothing written.`);
  // C83: occurred marks a record; card-only entities cannot carry it.
  if (o.occurred && !reg.tenses.includes('record'))
    die(`entity '${o.entity}' is card-only (tenses: ${reg.tenses.join(', ')}) and cannot carry occurred — occurred marks a record (something that happened). Nothing written.`);
  lintFutureOccurred(env, o.occurred); // bug #32: signal-only future-date note after format + tense gates
  // H15/V4: an explicit class must be one of the entity's registered tenses (else a
  // node is born mislabeled).
  if (hasExplicitClass && !reg.tenses.includes(o.class))
    die(`class '${o.class}' invalid for entity '${o.entity}' (allowed tenses: ${reg.tenses.join(', ')})`);
  if (o.due && o.occurred)
    die(`a fresh node can't carry both due and occurred — due marks a future, occurred marks a record; pick one (freeze a future to a record later if it happens).`);
  const fm = { entity: o.entity };
  // bug #6: a multi-tense entity used to blind-default to tenses[0], so event+occurred
  // landed as class:future (occurred means it HAPPENED → record). Derive from the signal
  // instead: occurred ⇒ record; otherwise the open-item default (future). Only when the
  // class is genuinely undecidable (no explicit class, no occurred, and the entity has no
  // 'future' tense) do we die with the §7.6 teaching — that never fires for the shipped
  // action/decision/event/obligation, so `new action --due …` (no class) still works.
  if (reg && reg.tenses.length > 1) {
    if (hasExplicitClass) fm.class = o.class;
    else if (o.occurred && reg.tenses.includes('record')) fm.class = 'record';
    else if (reg.tenses.includes('future')) fm.class = 'future';
    else die(`entity '${o.entity}' is multi-tense (${reg.tenses.join('|')}) — an explicit class is REQUIRED (spec §7.6)${o.occurred ? `; occurred=${o.occurred} suggests class:record` : ''}`);
  } else if (hasExplicitClass) fm.class = o.class;
  fm.description = o.description;
  const effectiveClass = deriveClass(env.reg, fm);
  // Temporal fields are class signals, not free-form dates. Enforce their effective-class
  // domains after explicit/default class selection so `event class:card + due` and
  // `event class:future + occurred` cannot become check-clean contradictions.
  if (o.due && effectiveClass !== 'future')
    die(`cannot create '${o.slug}' with due while its effective class is '${effectiveClass}' — due belongs only on a future; choose class future or remove due. Nothing written.`);
  if (o.occurred && effectiveClass !== 'record')
    die(`cannot create '${o.slug}' with occurred while its effective class is '${effectiveClass}' — occurred belongs only on a record; choose/derive class record or remove occurred. Nothing written.`);
  if (updatedItems.length && effectiveClass === 'record')
    die(`cannot create record '${o.slug}' with updated[] — updated[] is cards-only (§2); a record is the frozen past and carries no mutation history. This is a structural invariant, not a gate: --force cannot override it.`); // bug #76
  // H18 migration: accept date_created / date_updated / updated[] overrides so an
  // import preserves bitemporal history (default: today / today / []). Forcing today
  // on import destroys when-it-happened vs when-we-learned.
  fm.date_created = o.date_created || today;
  fm.date_updated = o.date_updated || o.date_created || today;
  // brain-profiles §6: create-time attribution — provenance, not ownership (never
  // rewritten). BRAIN_WHO unset ⇒ no stamp, silently (visibly absent beats falsely named).
  if (env.whoCreated !== false && env.who) fm.created_by = env.who;
  // record-status-revert: only actions carry 'done' — "completedness" is not a dimension
  // the past has, and a done-stamped record joins the default-excluded cohort (invisible
  // to plain search/list/count). Refuse the explicit pair; dropped/superseded stay legal
  // (a cancelled dinner is not a meeting). Explicit-wins is narrowed by exactly this one
  // class/value pair, not repealed.
  if (o.status === 'done' && effectiveClass === 'record')
    die(`cannot create record '${o.slug}' with status done — records carry no completion status (the past simply happened; occurred marks when). done is a FUTURE's terminal outcome: freeze <slug> --outcome done leaves the record statusless; --outcome dropped|superseded stamps those. Drop the status; nothing written.`);
  if (o.status) fm.status = o.status;
  else if (effectiveClass === 'future') fm.status = 'open';
  if (o.due) fm.due = o.due;
  if (o.occurred) fm.occurred = o.occurred;
  if (o.superseded_by) fm.superseded_by = o.superseded_by;
  fm.profile = o.profile || {};
  fm.relations = validateRelations(o.relations, 'relations', env.reg, validationOpts); // bug #5a: strict item shape at intake; alias sources resolve before authorship
  for (const item of fm.relations || []) {
    const verb = Object.keys(item).find(k => k !== 'why');
    if (verb) assertNoReflexiveHarnessEdge(resolveWriteSlug(env, o.slug), verb, resolveWriteSlug(env, String(item[verb])));
    if (verb) assertAuthorableWorkVerb(env.reg, verb, 'inline relation verb', resolveWriteSlug(env, o.slug), resolveWriteSlug(env, String(item[verb])));
  }
  fm.updated = updatedItems;
  fm.focus = null;
  assertFmClean(fm); // bug #19: no newline may enter a frontmatter scalar (names the offending field)
  return fm;
}

// mutate an in-memory {fm, body} per one op — the shared ops table both primitives
// and apply dispatch through. Throws (BrainError) on a bad op; never touches disk.
// Missing REQUIRED keys die loudly here (bug #5 family): the standalone verbs guard at
// the flag layer, but the apply path calls applyOp directly, so the guard must live here.
function applyOp(env, state, op, signals = null) {
  const fm = state.fm;
  // A malformed hand-authored multi-verb item is not a bag of independently mutable
  // edges: unlinking or dropping one key would filter the WHOLE object and silently lose
  // its sibling + shared why. Refuse every relation mutation until the item is repaired.
  if (op.op === 'link' || op.op === 'unlink' || op.op === 'freeze')
    validateRelations(fm.relations, 'stored relations');
  if (op.op === 'push') validateUpdatedItems(fm.updated);
  assertApplyWriteOpKeys(op);
  switch (op.op) {
    case 'set': {
      // bug #5b: a set with neither `to` nor `del` (e.g. the wrong key {"field":"due",
      // "value":..}) was reported ok:true but wrote nothing — a silent no-op. Require the
      // shape explicitly, naming the keys we actually got so the typo is obvious.
      if (op.field == null) die(`set op needs 'field' — e.g. {"op":"set","field":"due","to":"2026-09-01"}`);
      if (!op.del && op.to == null) die(`set op needs 'to' (or del) — got keys: ${opKeys(op)}`);
      if (op.del && op.to !== undefined)
        die(`set op can't combine 'del':true with 'to' — choose removal or replacement; nothing written`);
      // H14/V5: allowlist gates BOTH branches — `--to` on a block field writes
      // per-character garbage; `--del` on one wipes it cleanly (worse: silent). Only
      // scalar fields + profile.<k> are settable; blocks have their own verbs.
      const SETTABLE = new Set(['description', 'status', 'due', 'occurred', 'important', 'expires', 'renews', 'visibility', 'superseded_by']);
      if (op.field === 'body') die(`use the body verb to write the body, not set --field body`);
      if (['relations', 'updated', 'focus'].includes(op.field)) die(`'${op.field}' is a block — use link/unlink · push, not set`);
      if (!op.field.startsWith('profile.') && !SETTABLE.has(op.field))
        die(`set can't touch '${op.field}' (settable: ${[...SETTABLE].join(', ')}, profile.<key>; class/entity are identity — use new/register)`);
      if (op.field.startsWith('profile.')) assertKeyShape('profile key', op.field.slice(8)); // bug #86
      if (!op.del && op.field === 'description' && (typeof op.to !== 'string' || op.to.trim() === ''))
        die(`description is required (THE search surface) and must contain non-whitespace text — nothing written`);
      // bug #23: a set that WRITES due/occurred must carry a real ISO date (standalone set
      // AND apply's set both dispatch here). A --del removes the field, no value to check.
      if (!op.del && !op.field.startsWith('profile.')) op.to = assertFieldWrite(op.field, op.to); // bug #76
      if (!op.del && op.field === 'due' && deriveClass(env.reg, fm) !== 'future')
        die(`cannot set due on '${op.slug || 'node'}' — its effective class is '${deriveClass(env.reg, fm)}', and due belongs only on a future. --force cannot put future state on a card/record; nothing written.`);
      if (!op.del && op.field === 'occurred') {
        if (op.field === 'occurred') {
          const reg = ownValue(env.reg.entities, fm.entity);
          // C83: occurred marks a record; card-only entities cannot carry it.
          if (reg && !reg.tenses.includes('record'))
            die(`entity '${fm.entity}' is card-only (tenses: ${reg.tenses.join(', ')}) and cannot carry occurred — occurred marks a record (something that happened). Nothing written.`);
          if (deriveClass(env.reg, fm) === 'card')
            die("'" + (op.slug || 'node') + "' is a card, not a future/record — occurred marks something that happened. Create a record or use freeze on a future; nothing written.");
          lintFutureOccurred(env, op.to); // bug #32: signal-only future-date note after format + tense gates
        }
      }
      if (op.field === 'description' && op.del)
        die(`description is required (THE search surface) — you can't --del it; replace it with: set <slug> --field description --to "<text>"`);
      // record-status-revert: 'done' on a record is a non-state — accepting it explicitly
      // recreates the record-invisibility bug one node at a time (the excluded cohort).
      // dropped/superseded remain legal record statuses.
      if (!op.del && op.field === 'status' && String(op.to) === 'done' && deriveClass(env.reg, fm) === 'record')
        die(`cannot set status done on record '${op.slug || 'node'}' — records carry no completion status (the past simply happened; occurred marks when). done is a FUTURE's terminal outcome (freeze --outcome done leaves the record statusless); dropped/superseded remain settable. Nothing written.`);
      if (!op.del && op.field === 'status' && TERMINAL_STATUSES.has(String(op.to)) &&
          deriveClass(env.reg, fm) === 'future' && !TERMINAL_STATUSES.has(String(fm.status ?? '')))
        console.error(`⚠ setting a terminal status on a future bypasses freeze — freeze conjugates its edges + stamps occurred; use: brain freeze ${op.slug || '<slug>'} --outcome <done|dropped|superseded>`);
      // F-9 (amended): archived is excluded-but-NOT-terminal — it fell between both
      // guards, so one word silently vanished a future from every default view with no
      // freeze, no occurred, and a clean `check`. Same warning class as the freeze-bypass.
      if (!op.del && op.field === 'status' && EXCLUDED_SET.has(String(op.to)) && !TERMINAL_STATUSES.has(String(op.to)) &&
          deriveClass(env.reg, fm) === 'future' && !EXCLUDED_SET.has(String(fm.status ?? '')))
        console.error(`⚠ status '${op.to}' removes this future from futures/outbox/list/search WITHOUT freezing it (nothing frozen, no occurred). If it ended, use: brain freeze ${op.slug || '<slug>'} --outcome <done|dropped|superseded>; deliberate shelving is fine (signal only).`);
      if (!op.del && op.field === 'occurred' && deriveClass(env.reg, fm) === 'future')
        console.error(`⚠ setting occurred on a future records it without freeze — freeze conjugates its edges + stamps the outcome; use: brain freeze ${op.slug || '<slug>'} --outcome <done|dropped|superseded>`); // bug #85
      if (!op.del) assertScalarSize(op.field, op.to); // F-6
      if (op.del) { // remove a field
        if (op.field.startsWith('profile.')) delete fm.profile[op.field.slice(8)];
        else delete fm[op.field];
      } else if (op.field.startsWith('profile.')) { fm.profile[op.field.slice(8)] = op.to; }
      else fm[op.field] = op.to;
      break;
    }
    case 'link': {
      // bug #5 family: a missing verb mints an edge keyed literally 'undefined'; a
      // missing target stores an undefined value. Require both.
      if (op.verb == null || op.to == null) die(`link op needs 'verb' and 'to' — e.g. {"op":"link","slug":"…","verb":"works_at","to":"acme-inc"} — got keys: ${opKeys(op)}`);
      assertRelationVerb('relation verb', op.verb); // bug #86
      assertRelationTarget('relation target', op.to);
      if (op.why != null && (typeof op.why !== 'string' || op.why.trim() === '')) die(`relation why must be non-empty text — nothing written`);
      if (op.why) assertScalarSize('why', op.why); // F-6
      // Alias resolution normally canonicalizes NEW writes, but old/hand-authored edges
      // may still store the alias spelling. Compare endpoints semantically through the
      // same real-node-shadows-alias rule used by reads; otherwise link can create two
      // logically identical edges merely by spelling one side through an alias.
      const incomingEndpoint = resolveWriteSlug(env, op.to);
      assertNoReflexiveHarnessEdge(resolveWriteSlug(env, op.slug || ''), op.verb, incomingEndpoint);
      assertAuthorableWorkVerb(env.reg, op.verb, 'relation verb', resolveWriteSlug(env, op.slug || ''), incomingEndpoint);
      if (fm.relations.some(it => {
        const stored = ownValue(it, op.verb);
        return stored != null && resolveWriteSlug(env, String(stored)) === incomingEndpoint;
      }))
        die(`edge already exists: ${op.slug || '<slug>'} → ${op.verb} → ${op.to} — link is set-like by endpoint (unlink it first to replace its why); nothing written`);
      const e = { [op.verb]: op.to };
      if (op.why) e.why = op.why;
      fm.relations.push(e);
      break;
    }
    case 'unlink': {
      // without verb+to this filters on it[undefined] → matches nothing → silent no-op.
      if (op.verb == null || op.to == null) die(`unlink op needs 'verb' and 'to' — got keys: ${opKeys(op)}`);
      assertRelationVerb('relation verb', op.verb); // bug #86
      assertRelationTarget('relation target', op.to);
      const semanticTo = resolveWriteSlug(env, String(op.to));
      const matches = (v) => v === String(op.to) || (op.rawTo != null && v === String(op.rawTo)) ||
        resolveWriteSlug(env, v) === semanticTo; // A1: either spelling removes the one semantic edge; real-node shadows remain distinct.
      const matched = fm.relations.filter(it => it[op.verb] != null && matches(String(it[op.verb])));
      if (matched.length > 1)
        die(`refusing to unlink ${op.slug || '<slug>'} → ${op.verb} → ${op.to}: ${matched.length} duplicate authored edges match that identity. Unlink cannot choose one why and deleting all would lose authored rows; repair/disambiguate the duplicate relation items by hand, then sync. Nothing written`);
      const before = fm.relations.length;
      fm.relations = fm.relations.filter(it => !(it[op.verb] != null && matches(String(it[op.verb]))));
      if (fm.relations.length === before)
        die(`no such edge: ${op.slug || '<slug>'} → ${op.verb} → ${op.to} — nothing written`);
      break;
    }
    case 'push': { // updated FILO — newest FIRST (prepend)
      // bug (W1 residual): a missing y (e.g. the wrong key {"x":..,"value":..}) serialized
      // the literal string "undefined" into the stack. Require x AND y.
      if (typeof op.x !== 'string' || op.x.trim() === '' || op.y == null || op.y === '') die(`push op needs non-empty string 'x' (what changed) and non-empty 'y' (ISO date) — e.g. {"op":"push","slug":"…","x":"profile.city","y":"2026-03-14"} — got keys: ${opKeys(op)}`);
      assertScalarSize('push x', op.x);
      assertIsoDate('y', op.y);
      if (op.why != null && (typeof op.why !== 'string' || op.why.trim() === '')) die(`push why must be non-empty text when present — nothing written`);
      if (op.why) assertScalarSize('push why', op.why); // F-6
      if (op.from !== undefined) assertScalarSize('push from', op.from); // F-6
      if (op.record != null) assertRelationTarget('push record', op.record);
      const u = { x: op.x, y: op.y };
      if (op.from !== undefined) u.from = op.from; // T4: the prior value (auto-filled by apply on a paired set+push; decision #66)
      if (op.why) u.why = op.why;
      if (op.record) u.record = op.record;
      fm.updated.unshift(u);
      if (fm.updated.length > UPDATED_CAP) {
        fm.updated.length = UPDATED_CAP; // cap the stack (low-tier): drop the oldest tail
        const warning = `⚠ updated[] hit the ${UPDATED_CAP}-entry cap — the oldest entry was dropped (FILO; history beyond ${UPDATED_CAP} belongs in records)`;
        if (signals) signals.push(warning);
        else console.error(warning); // direct low-level callers retain the legacy visible fallback
      }
      break;
    }
    case 'body': {
      // H20 parity for the apply path: a missing/empty `body` used to silently blank the
      // distilled tier. Require content unless this is an explicit clear.
      if (op.body != null && typeof op.body !== 'string')
        die(`body must be text (a JSON string) — got ${jsonType(op.body)}; nothing written`);
      if (op.append && op.clear) die(`body op can't combine append and clear — choose exactly one mode; nothing written`);
      if (op.append && String(op.body ?? '').length === 0)
        die(`empty body append has no content — nothing written (supply bytes to append, including intentional whitespace)`);
      if (op.clear && op.body != null && String(op.body).length)
        die(`body clear refuses non-empty body input — discard the input or drop clear; nothing written`);
      if (!op.append && !op.clear && (op.body == null || String(op.body).trim() === ''))
        die(`body op needs 'body' text — pass "clear":true to blank it; an append needs actual bytes — got keys: ${opKeys(op)}`);
      // bug #17: size guards live HERE (shared) so the apply path enforces them too, not
      // only the standalone `body` verb — raw content belongs in files/, §9.1.
      // @ts-ignore no root @types/node in this workspace; runtime Buffer is available.
      const bytes = Buffer.byteLength(String(op.body ?? ''), 'utf8');
      if (bytes > 1_048_576 && !op.force) die(`body is ${(bytes / 1048576).toFixed(1)}MB — bodies are distilled prose, not raw storage (raw → files/, §9.1); pass --force (or force:true) if you really mean it`);
      if (bytes > 65_536) console.error(`⚠ body is ${(bytes / 1024).toFixed(0)}KB — distilled prose is usually far smaller; is this raw content that belongs in files/?`);
      // C-2: the payload is EXACT bytes. state.body = structural newline + payload; the
      // only structural byte is that ONE separator after the closing fence (a CRLF file
      // carries '\r\n' there). Set stores stdin verbatim; append concatenates verbatim
      // onto the current payload — no leading/trailing-newline normalization on either
      // side, so authored blank lines and missing/multiple final newlines all survive.
      const raw = op.clear ? '' : String(op.body ?? '');
      const curPayload = state.body.startsWith('\r\n') ? state.body.slice(2) : state.body.startsWith('\n') ? state.body.slice(1) : state.body;
      state.body = '\n' + (op.append ? curPayload + raw : raw);
      break;
    }
    case 'vote': {
      // brain-profiles §5: score-only — the scalar moves, --why prints in the transcript
      // and is NOT stored (an updated[] entry would block every daily freeze on a voted
      // memory — the bug-#24 structural invariant, --force-proof).
      if (env.votesEnabled === false) die(`votes are disabled by this brain's config (__meta/config.json votes) — nothing written`);
      const up = op.up === true, down = op.down === true;
      if (up === down) die(`vote needs exactly one of --up | --down — got ${up ? 'both' : 'neither'}; nothing written`);
      if (typeof op.why !== 'string' || op.why.trim() === '') die(`vote requires a non-empty --why (it prints in the transcript, not the card); nothing written`);
      const stored = fm.votes;
      if (stored != null && canonicalVotesInt(String(stored)) == null)
        die(`stored votes '${String(stored)}' is not a canonical signed integer — repair the field by hand (a plain "3"/"-2"), then vote; nothing written`);
      const next = (stored == null ? 0 : canonicalVotesInt(String(stored))) + (up ? 1 : -1);
      if (!Number.isSafeInteger(next)) die(`vote would leave the score outside the safe integer range; nothing written`);
      fm.votes = String(next); // string-canonical scalar; the index casts once (§5)
      break;
    }
    case 'freeze': {
      // SAME guard as the standalone verb (H15/V4): a classless card derives to
      // 'card', not 'future', so it can no longer be frozen through apply.
      // brain-profiles §3: PLUS the generic card→record transition — a CARD whose entity
      // registers the record tense may freeze (memory is the first user; event rides
      // free). A card-only entity still cannot.
      const freezeClass = deriveClass(env.reg, fm);
      const cardToRecord = freezeClass === 'card' && !!ownValue(env.reg.entities, fm.entity)?.tenses?.includes('record');
      if (freezeClass !== 'future' && !cardToRecord) die(`'${op.slug || 'node'}' is a ${freezeClass}, not a future`);
      // updated[] is cards-only. Carrying a card's mutation stack through the class flip
      // would mint a record state that both new-record and push-on-record hard-refuse.
      // Never drop authored history implicitly: the operator must distill/move it first.
      if (fm.updated?.length)
        die(`cannot freeze '${op.slug || 'node'}' while updated[] has ${fm.updated.length} entr${fm.updated.length === 1 ? 'y' : 'ies'} — records carry no card mutation stack (§2). Preserve/distill that history in the body or linked records, remove updated[] by hand + sync, then freeze; nothing written.`);
      // decision #69: an obligation RECURS — freezing ends the series. This guard lives in
      // the shared mutation so it fires on BOTH the standalone verb and the apply path,
      // BEFORE any change. Now a GATE, not a warn: refuse without --force (single teaching,
      // no double-print), name the §7.5 roll ritual; --force is the deliberate override.
      if (fm.entity === 'obligation' && !op.force) die(`'${op.slug || 'node'}' is an obligation (recurring) — freezing ENDS the series. To roll the next instance, use: brain roll ${op.slug || '<slug>'} --occurred <date> — due advances one cadence step per roll; an elapsed cycle is never skipped (rolling late leaves the remaining owed cycles in the outbox); manual fallback: filing record + set 'due' one cadence step forward + push. Override with --force (or "force":true) to truly end the series.`);
      if (fm.entity === 'obligation' && op.force)
        console.error(`⚠ --force: ending obligation series '${op.slug || 'node'}' without a deliberate #69 roll step — the recurring series is over.`);
      const outcome = op.outcome == null ? 'done' : op.outcome; // H15: only absence defaults; explicit falsy data is invalid, never silently done
      if (typeof outcome !== 'string' || !TERMINAL_STATUSES.has(outcome))
        die(`freeze --outcome must be done|dropped|superseded (got ${JSON.stringify(outcome)})`);
      if (hasOwnKey(op, 'occurred') && op.occurred != null && op.occurred === '')
        die(`freeze occurred must be a non-empty ISO date (YYYY-MM-DD) when provided; omit/null to use today`);
      assertIsoDate('occurred', op.occurred); // bug #23: an explicit freeze --occurred must be a real ISO date (a bad one is PERMANENT — records are frozen)
      lintFutureOccurred(env, op.occurred); // bug #32: signal-only future-date note for explicit freeze --occurred
      let occurred = op.occurred;
      if (occurred == null && cardToRecord) {
        // brain-profiles §3 + sol-5.6 R1: a card→record freeze REQUIRES occurred, and
        // derivation is entity 'memory' ONLY — a memory's dated slug (memory-YYYY-MM-DD
        // or a YYYY-MM-DD- prefix), else its date_created (a daily log's filing day IS
        // the day it covers). For every other entity a slug date and date_created are
        // filing artifacts, not history — deriving either would mint a false permanent
        // occurred on a frozen record.
        if (fm.entity === 'memory') {
          const slugDay = /-(\d{4}-\d{2}-\d{2})$/.exec(String(op.slug || ''))?.[1]
            ?? /^(\d{4}-\d{2}-\d{2})-/.exec(String(op.slug || ''))?.[1] ?? null;
          occurred = (slugDay && isIsoDate(slugDay) ? slugDay : null)
            ?? (typeof fm.date_created === 'string' && isIsoDate(fm.date_created) ? fm.date_created : null);
        }
        if (occurred == null)
          die(`freezing card '${op.slug || 'node'}' to a record needs --occurred <YYYY-MM-DD> (the day it covers) — only a memory card derives it (dated slug, else date_created: a daily log's filing day IS the day it covers); for every other entity a slug date/date_created is a filing artifact, not history, and records are frozen, so a guessed date would be permanent. Pass --occurred; nothing written`);
      }
      if (occurred == null) occurred = env.today();
      // conjugate edges by MUTATING relations (null in the table = drop the edge).
      // F-7 ruling (second-pass position #2): ONLY a successful outcome asserts the past
      // tense — past-tensing a dropped/superseded future writes affirmative history for
      // an event that never happened (was_with a dinner that was cancelled). Non-done
      // outcomes keep their prospective verbs; the terminal status carries the truth on
      // every read surface. DAG edges (conjugate=null) drop on ANY terminal — the
      // dependency graph is future-only by spec.
      const conjugating = outcome === 'done';
      const freezeStats = { conjugated: 0, kept: 0, dropped: 0, keptProspective: 0 };
      const nextRelations = fm.relations.flatMap(it => {
        const verbKeys = Object.keys(it).filter(k => k !== 'why');
        if (verbKeys.length !== 1)
          die(`cannot freeze '${op.slug || 'node'}' — stored relation item has ${verbKeys.length ? `${verbKeys.length} verb keys (${verbKeys.join(', ')})` : 'no verb key'}; each item must carry EXACTLY one verb plus optional why. Repair the hand-authored frontmatter and sync; nothing written`);
        const verb = verbKeys[0];
        if (verb) assertRelationVerb('stored relation verb during freeze', verb);
        if (verb && hasOwnKey(env.reg.conjugate, verb)) {
          const past = env.reg.conjugate[verb];
          if (past == null) { freezeStats.dropped++; return []; } // dropped on freeze (waiting_on/depends_on/do_before)
          // Empty is the durable "mapping cleared" tombstone, not an authored empty verb.
          if (past === '') { freezeStats.kept++; return [it]; }
          assertRelationVerbTarget(env.reg, `conjugation target for '${verb}' during freeze`, past);
          if (hasOwnKey(env.reg.inverses, verb) && env.reg.inverses[verb] !== '')
            assertInverseTarget(env.reg, `inverse target for '${verb}' during freeze`, env.reg.inverses[verb]);
          // inverseOf(past) gives an own row on the resulting spelling precedence over
          // the base row. Validate that exact post-freeze meaning before conjugating;
          // otherwise an alias/reserved/unknown past inverse becomes a false read claim.
          if (hasOwnKey(env.reg.inverses, past) && env.reg.inverses[past] !== '')
            assertInverseTarget(env.reg, `inverse target for resulting past verb '${past}' during freeze`, env.reg.inverses[past]);
          const inverseConflict = conjugationInverseConflict(env.reg, verb, past);
          if (inverseConflict)
            die(`cannot freeze '${op.slug || 'node'}' — registry ${inverseConflict}; repair brain/__meta/registry.md first; nothing written`);
          // context-retrieval §4 ruling: freeze evicts from focus on EVERY outcome,
          // LOUDLY — done, dropped, or superseded, the terminal thing leaves your hand
          // (the was_in_context edge keeps the history). Other prospective verbs keep
          // the F-7 rule below on non-done outcomes.
          const focusEviction = verb === 'in_context' && resolveWriteSlug(env, String(it[verb])) === 'focus';
          if (!conjugating && !focusEviction) { freezeStats.keptProspective++; return [it]; } // F-7: outcome≠done, the event didn't happen — keep the prospective verb (it HAS a mapping)
          const { [verb]: to, ...rest } = it;
          freezeStats.conjugated++;
          if (focusEviction) freezeStats.leftFocus = true;
          return [{ [past]: to, ...rest }];
        }
        if (verb) freezeStats.kept++; // genuinely no past-tense mapping in the registry
        return [it];
      });
      // Conjugation is a many-to-one rename. Two distinct authored rows can collapse onto
      // one verb+endpoint (including raw/canonical slug aliases), where keeping either why
      // would silently destroy the other. Validate the COMPLETE transformed set before
      // assigning it to fm; a refusal leaves every source byte untouched.
      const endpoints = new Map();
      for (const item of nextRelations) {
        for (const [verb, to] of Object.entries(item)) {
          if (verb === 'why' || to == null) continue;
          assertRelationVerb('resulting relation verb during freeze', verb);
          const semanticTo = resolveWriteSlug(env, String(to));
          const key = `${verb}\0${semanticTo}`;
          const prior = endpoints.get(key);
          if (prior)
            die(`cannot freeze '${op.slug || 'node'}' — conjugation would collapse two authored edges onto ${verb} → ${semanticTo} (whys/rows cannot be chosen or merged implicitly). Unlink or re-point one edge, then freeze; nothing written`);
          endpoints.set(key, { verb, to: semanticTo, why: ownValue(item, 'why') });
        }
      }
      fm.relations = nextRelations;
      state.freezeStats = freezeStats;
      if (freezeStats.leftFocus) {
        const msg = `left focus on freeze (was_in_context edge keeps the history)`;
        if (signals) signals.push(msg); else console.error(msg);
      }
      fm.occurred = occurred;
      fm.class = 'record';
      // record-status-revert: a done outcome DELETES the status (clearing the future's
      // live open/waiting — merely skipping the write would leave a stale 'open' for T2
      // to trip on). Records carry no completion status; only the not-happened outcomes
      // (dropped/superseded) stamp. Edge conjugation keys off `outcome` (F-7).
      if (outcome === 'done') delete fm.status;
      else fm.status = outcome;
      delete fm.due; // F-12: a record carries occurred, never due (buildNewFm refuses the pair at birth; §2)
      break;
    }
    default: die(`unknown op '${op.op}'`);
  }
  assertFmClean(fm); // bug #19: reject a newline in any scalar this op wrote (body content is exempt — it's not in fm)
  return state;
}

const WRITE_REQ_KEYS = ['slug', 'kind', 'newOp', 'ops', 'baseHash', 'force', 'permits', 'index'];
const WRITE_REQ_ALLOWED_KEYS = [...WRITE_REQ_KEYS, 'autoFrom', 'batchOps']; // bug #83 · batchOps: whole-batch view for the batch-aware ref guard (M2 rider b)
const WRITE_PLAN_KEYS = ['slug', 'kind', 'state', 'node', 'readHash', 'signals', 'force', 'index', 'dest'];
const WRITE_PLAN_ALLOWED_KEYS = [...WRITE_PLAN_KEYS, 'asks']; // asks-contract: optional, present only when a detector fired
const WRITE_RESULT_KEYS = ['fileCommitted', 'indexCommitted', 'hash', 'dest', 'signals'];
const WRITE_RESULT_ALLOWED_KEYS = [...WRITE_RESULT_KEYS, 'asks'];

function withWriteOpContext(op, fn) {
  try { return fn(); }
  catch (e) {
    if (e && typeof e === 'object' && !e.writeOp)
      Object.defineProperty(e, 'writeOp', { value: op, configurable: true });
    throw e;
  }
}

// deterministic-checks: the shared read-only-index accessor for the write-time detectors that need
// a graph/cohort lookup (C3/C4 open futures, R2 place cards, R3 same-entity cards, O3 filings). Same
// coordinated read-only-handle + schema-check pattern as entityGuardCardRows; never rebuilds, never
// throws — { result: fn(db), skipped: false } or { result: null, skipped: true } when no current index.
function withReadOnlyIndex(ctx, fn) {
  const p = path.join(ctx.root, '.brain', 'index.sqlite');
  if (!fs.existsSync(p)) return { result: null, skipped: true };
  const probe = { root: ctx.root, readerLease: null };
  let db = null;
  try {
    acquireIndexReader(probe);
    if (!fs.existsSync(p)) return { result: null, skipped: true };
    db = new DatabaseSync(p, { readOnly: true });
    db.exec('PRAGMA busy_timeout=2000');
    if (schemaVersion(db) !== SCHEMA_VERSION) return { result: null, skipped: true };
    return { result: fn(db), skipped: false };
  } catch { return { result: null, skipped: true }; }
  finally { try { db?.close(); } catch { /* malformed handle */ } releaseIndexReader(probe); }
}

// R3 possible-duplicate (deterministic-checks LAW · map R3): on a new CARD, ENUMERATE the SAME-ENTITY
// cards [closed cohort]; FILTER by the exact identity folds — slug, slugified profile.name, slugified aka
// member, and registered slug-aliases (the guard's own folds, exact-equality only, no fuzz); COUNT ≥1 → ask
// reuse/alias/keep-both. DIVERGE: a second card vs reusing the first are different graph identities.
function cardDuplicateAsk(ctx, writingSlug, fm, signals) {
  if (deriveClass(ctx.reg, fm) !== 'card' || !fm.entity) return null;
  const keysOf = (slug, prof) => { // the identity surface of a card
    const s = new Set([slug]);
    const name = prof?.name; if (typeof name === 'string' && name.trim()) s.add(slugify(name));
    for (const a of Array.isArray(prof?.aka) ? prof.aka : []) if (typeof a === 'string' && a.trim()) s.add(slugify(a));
    return s;
  };
  const mine = keysOf(writingSlug, fm.profile || {});
  const view = withReadOnlyIndex(ctx, db =>
    db.prepare(`SELECT slug, profile_json FROM nodes WHERE entity=? AND class='card' AND slug != ?`).all(fm.entity, writingSlug));
  if (view.skipped) return null;
  const byKey = new Map(); // identity key → existing same-entity card slug (first stable)
  for (const r of (view.result || []).sort((a, b) => a.slug < b.slug ? -1 : 1)) {
    let prof = {}; try { prof = JSON.parse(r.profile_json || '{}'); } catch { /* ignore */ }
    for (const k of keysOf(r.slug, prof)) if (!byKey.has(k)) byKey.set(k, r.slug);
  }
  for (const [name, a] of Object.entries(ctx.reg.aliases || {})) // registered slug-aliases fold in too
    if (a?.kind === 'slug' && !byKey.has(name)) byKey.set(name, a.to);
  let hit = null;
  for (const k of mine) { const t = byKey.get(k); if (t && t !== writingSlug) { hit = t; break; } }
  if (!hit) return null;
  const evidence = { checked: [`existing ${fm.entity} cards by slug/name/aka fold`], found: [`'${hit}' shares an identity fold`] };
  signals.push(`'${writingSlug}' may duplicate the existing ${fm.entity} card '${hit}' (same slug/name/aka) — reuse it, add '${writingSlug}' as an alias, or keep both if they are genuinely distinct.${askEvidenceClause(evidence)}`);
  return buildAsk('possible-duplicate', { slug: writingSlug, field: null, value: null,
    question: `You already have '${hit}' by that name — is '${writingSlug}' the same one, or a different thing to keep separately?`,
    options: [{ id: `reuse-${hit}`, label: `reuse ${hit}`, effect: `write to the existing '${hit}' instead of a new card` },
      { id: 'keep-text', label: 'keep both', effect: `keep '${writingSlug}' as a distinct card (or alias it to '${hit}' via register)` }],
    context: { evidence, candidates: [{ slug: hit, entity: fm.entity }] } });
}

// O3 filing-unanchored (deterministic-checks LAW · map O3): a new `filing` record whose edges include
// no `filed_by` and no edge to an obligation-tense node → ask which duty it files. ENUMERATE the node's
// edge targets [closed]; FILTER by whether any is a filed_by or resolves to an obligation (index lookup);
// COUNT 0 anchors → ask (link the obligation, or keep it standalone). Roll-created filings carry filed_by → never fire.
function filingUnanchoredAsk(ctx, writingSlug, fm, signals) {
  if (fm.entity !== 'filing') return null;
  const rels = Array.isArray(fm.relations) ? fm.relations : [];
  const targets = [];
  for (const item of rels) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const vk = Object.keys(item).filter(k => k !== 'why');
    if (vk.length === 1) { if (vk[0] === 'filed_by') return null; if (item[vk[0]] != null) targets.push(resolveWriteSlug(ctx, String(item[vk[0]]))); }
  }
  if (targets.length) { // any edge to an obligation-tense node also anchors it
    const view = withReadOnlyIndex(ctx, db => targets.some(t => {
      const r = db.prepare(`SELECT entity FROM nodes WHERE slug=?`).get(t); return r && r.entity === 'obligation';
    }));
    if (view.skipped || view.result) return null; // anchored (or can't read → don't nag)
  }
  const evidence = { checked: [`'${writingSlug}' edges for a filed_by / obligation link`], found: targets.length ? [`edges to ${targets.sort().join(', ')} (none an obligation)`] : ['no edges'] };
  signals.push(`filing '${writingSlug}' has no filed_by edge (nor any edge to an obligation) — which duty did it file? Link it (link ${writingSlug} --verb filed_by --to <obligation>), or keep it standalone deliberately.${askEvidenceClause(evidence)}`);
  return buildAsk('filing-unanchored', { slug: writingSlug, field: null, value: null,
    question: `'${writingSlug}' isn't linked to any recurring bill — which one does it settle, or is it a one-off?`,
    options: [{ id: 'link-obligation', label: 'link its obligation', effect: `link ${writingSlug} --verb filed_by --to <obligation>` },
      { id: 'keep-text', label: 'keep standalone', effect: 'leave it unanchored deliberately (a one-off filing)' }],
    context: { evidence, candidates: [{ role: 'obligation' }] } });
}

// C4 duplicate-future (deterministic-checks LAW · map C4): a new OPEN future whose normalized
// description equals an existing open future's, or whose slug is the collision-suffix `<base>-N` of one.
// ENUMERATE open futures [index cohort]; FILTER by exact normalized-description equality or the slug-N
// form; COUNT ≥1 → ask reuse vs keep-both. DIVERGE: two open futures = two reminders vs one.
const normDescFold = (d) => String(d || '').trim().toLowerCase().replace(/\s+/g, ' ');
function duplicateFutureAsk(ctx, writingSlug, fm, signals) {
  if (deriveClass(ctx.reg, fm) !== 'future' || !isOpen(fm.status)) return null;
  const mine = normDescFold(fm.description);
  const suffix = /^(.*)-[0-9]+$/.exec(writingSlug);
  const base = suffix ? suffix[1] : null;
  const view = withReadOnlyIndex(ctx, db =>
    db.prepare(`SELECT slug, description FROM nodes WHERE class='future' AND slug != ? AND ${openFutureSQL('nodes')}`).all(writingSlug));
  if (view.skipped) return null;
  let hit = null, why = '';
  for (const r of (view.result || []).sort((a, b) => a.slug < b.slug ? -1 : 1)) {
    if (mine && normDescFold(r.description) === mine) { hit = r.slug; why = 'same description'; break; }
    if (base && r.slug === base) { hit = r.slug; why = `a '-N' collision suffix of '${r.slug}'`; break; }
  }
  if (!hit) return null;
  const evidence = { checked: ['open futures by normalized description / slug'], found: [`'${hit}' matches (${why})`] };
  signals.push(`'${writingSlug}' duplicates the open future '${hit}' (${why}) — reuse it, or keep both if they are genuinely separate commitments.${askEvidenceClause(evidence)}`);
  return buildAsk('duplicate-future', { slug: writingSlug, field: null, value: null,
    question: `'${hit}' is already on your list and looks the same as '${writingSlug}' — a duplicate to drop, or a separate thing to keep?`,
    options: [{ id: `reuse-${hit}`, label: `reuse ${hit}`, effect: `drop '${writingSlug}'; the commitment '${hit}' already exists` },
      { id: 'keep-text', label: 'keep both', effect: `keep '${writingSlug}' as a separate commitment (deliberately repeated)` }],
    context: { evidence, candidates: [{ slug: hit }] } });
}

// R2 place-role (deterministic-checks LAW · map R2): a weak (about/mentions) edge from an event/
// conversation to a PLACE card, when the node has no location evidence, is a real fork — subject vs
// venue. ENUMERATE the weak edges' place-card targets [index cohort]; FILTER by "no location evidence"
// (no at/happening_at/happened_at/was_at edge, empty profile.location); COUNT ≥1 → ask. DIVERGE: a
// location edge changes futures --for/reachability; a subject edge does not.
const LOCATION_VERBS = new Set(['at', 'happening_at', 'happened_at', 'was_at']);
function placeRoleAsks(ctx, writingSlug, fm, signals) {
  if (fm.entity !== 'event' && fm.entity !== 'conversation') return [];
  const rels = Array.isArray(fm.relations) ? fm.relations : [];
  const verbKey = (item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item).filter(k => k !== 'why') : [];
  if (rels.some(item => { const vk = verbKey(item); return vk.length === 1 && LOCATION_VERBS.has(vk[0]); })) return []; // has a location edge
  if (typeof fm.profile?.location === 'string' && fm.profile.location.trim() !== '') return []; // has a location ref
  const weakTargets = [];
  for (const item of rels) { const vk = verbKey(item); if (vk.length === 1 && (vk[0] === 'about' || vk[0] === 'mentions') && item[vk[0]] != null) weakTargets.push(resolveWriteSlug(ctx, String(item[vk[0]]))); }
  if (!weakTargets.length) return [];
  const hits = withReadOnlyIndex(ctx, db => weakTargets.filter(t => { const r = db.prepare(`SELECT entity FROM nodes WHERE slug=? AND class='card'`).get(t); return r && r.entity === 'place'; }));
  if (hits.skipped || !hits.result?.length) return [];
  const asks = [];
  for (const place of hits.result) {
    const evidence = { checked: [`'${writingSlug}' location edges (at/happening_at/…) and profile.location`], found: ['no location evidence'] };
    signals.push(`'${writingSlug}' has a weak edge to the place '${place}' but no location — is '${place}' WHERE it happens (link happening_at), or only its subject? Keep the about edge deliberately if it's the topic.${askEvidenceClause(evidence)}`);
    asks.push(buildAsk('place-role', { slug: writingSlug, field: null, value: null,
      question: `Is '${place}' where '${writingSlug}' happens, or just what it's about?`,
      options: [{ id: `at-${place}`, label: `happens at ${place}`, effect: `link ${writingSlug} --verb happening_at --to ${place}` },
        { id: 'keep-text', label: 'only its subject', effect: `keep the about edge — ${place} is the topic, not the venue` }],
      context: { evidence, candidates: [{ slug: place }] } }));
  }
  return asks;
}

// Entity-echo guard, lookup half (§3 candidate targets). Read the CURRENT derived index
// with a coordinated read-only handle (the schemaCurrent pattern) and return every
// card-tense node's identity surface. NEVER rebuilds and never throws — a missing/stale/
// unreadable index yields {skipped:true}, so the guard degrades to a single notice and the
// write is untouched. One query serves every candidate string of the write.
function entityGuardCardRows(ctx) {
  const p = path.join(ctx.root, '.brain', 'index.sqlite');
  if (!fs.existsSync(p)) return { rows: null, skipped: true };
  const probe = { root: ctx.root, readerLease: null };
  let db = null;
  try {
    acquireIndexReader(probe);
    if (!fs.existsSync(p)) return { rows: null, skipped: true };
    db = new DatabaseSync(p, { readOnly: true });
    db.exec('PRAGMA busy_timeout=2000');
    if (schemaVersion(db) !== SCHEMA_VERSION) return { rows: null, skipped: true }; // stale schema = no trustworthy index
    const rows = db.prepare(`SELECT slug, entity, description FROM nodes WHERE class='card'`).all();
    return { rows, skipped: false };
  } catch { return { rows: null, skipped: true }; }
  finally {
    try { db?.close(); } catch { /* malformed handle */ }
    releaseIndexReader(probe);
  }
}

// The entity-echo guard (design: profile-entity-guard §2–3). After a write introduces or
// changes profile STRING values (the named `keys`), flag any value that is really an entity
// reference stored as text: slugify(value) equals a card slug (alias-resolved), OR the value
// equals a card description (trim + case-insensitive). Non-fatal — pushes one teaching notice
// per hit onto `signals` (the same channel as the unregistered-field warnings) and returns
// the machine-readable matches. Suppressed when the writing node already has ANY edge to a
// candidate (the reference is already an edge). When several cards share the name (same-name
// twins — cf. nameCollisions), `match` stays the first stable hit and the entry also carries
// `twins` (the other cards, capped at 8) so the PA disambiguates instead of guessing.
// Skips silently save one notice when no index.
function profileEntityGuard(ctx, writingSlug, fm, keys, signals, batchOps) {
  const candidates = profileEntityCandidates(ctx.reg, fm.entity, fm.profile || {}, keys);
  if (!candidates.length) return { asks: [] };
  const view = entityGuardCardRows(ctx);
  // M2 rider (b): a CARD minted earlier in the SAME apply is not indexed yet — include it so a ref to it
  // is satisfied (no false entity-new "should this be an entity?" for a card the batch is creating).
  const sameBatchCards = [];
  for (const o of Array.isArray(batchOps) ? batchOps : []) {
    if (o.op !== 'new' || typeof o.slug !== 'string' || o.slug === writingSlug) continue;
    if (deriveClass(ctx.reg, { entity: o.entity, class: o.class, occurred: o.occurred, due: o.due, status: o.status }) === 'card')
      sameBatchCards.push({ slug: o.slug, entity: o.entity, description: o.description });
  }
  if (view.skipped && !sameBatchCards.length) { signals.push(`entity-guard skipped (no index)`); return { asks: [] }; }
  const normDesc = (s) => typeof s === 'string' ? s.trim().toLowerCase() : '';
  const rows = [...(view.skipped ? [] : view.rows), ...sameBatchCards].filter(r => r.slug !== writingSlug) // exclude the writing node (self-match)
    .sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); // stable order → deterministic primary + twins
  const bySlug = new Map(), byDesc = new Map();
  for (const r of rows) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, r);
    const nd = normDesc(r.description);
    if (nd) { if (!byDesc.has(nd)) byDesc.set(nd, []); byDesc.get(nd).push(r); } // ALL same-description cards, in slug order
  }
  const edgeTargets = new Set(); // canonical targets of the writing node's edges (this write + pre-existing)
  for (const item of Array.isArray(fm.relations) ? fm.relations : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const vk = Object.keys(item).filter(k => k !== 'why');
    if (vk.length === 1 && item[vk[0]] != null) edgeTargets.add(resolveWriteSlug(ctx, String(item[vk[0]])));
  }
  const keepText = { id: 'keep-text', label: 'keep as plain text', effect: 'leave the value as authored text (tell the operator which you chose)' };
  const asks = [];
  for (const cand of candidates) {
    const slugForm = slugify(cand.value);
    const canonical = slugForm ? resolveWriteSlug(ctx, slugForm) : '';
    // Every card this value could name, deduped, slug-form first then descriptions in slug order.
    const hits = [], seen = new Set();
    const add = (r) => { if (r && !seen.has(r.slug)) { seen.add(r.slug); hits.push(r); } };
    if (canonical) add(bySlug.get(canonical));
    for (const r of byDesc.get(normDesc(cand.value)) || []) add(r);
    const alreadyLinked = hits.some(h => edgeTargets.has(h.slug) || edgeTargets.has(resolveWriteSlug(ctx, h.slug)));
    const edgeEvidence = { // fork-doctrine §2: the evidence the FILTER step consulted, stated for the PA to relay
      checked: [`'${writingSlug}' existing links (a link to it suppresses the ask)`],
      found: edgeTargets.size ? [`edges to ${[...edgeTargets].sort().join(', ')}`] : ['no edges yet'],
    };
    // entity-match ask (fork-doctrine LAW · map R1): ENUMERATE = identity-fold card lookup (slugify +
    // trim/casefold description) over class='card' rows [closed set]; FILTER = the writing node's edges
    // (already linked → 0 survivors, suppressed); COUNT ≥1 → ask; DIVERGE = each candidate card is a
    // distinct reachable node (aliases already collapsed by resolveWriteSlug before counting).
    if (hits.length && !alreadyLinked) {
      const primary = hits[0];
      const candidateRows = hits.slice(0, 9).map(h => ({ slug: h.slug, entity: h.entity, description: h.description })); // primary first, twins next, capped at 9
      const context = { evidence: edgeEvidence, candidates: candidateRows };
      if (hits.length > 9) context.more = hits.length - 9;
      const options = [
        ...candidateRows.map(c => ({ id: `link-${c.slug}`, label: `link to ${c.slug}`, effect: `link ${writingSlug} --verb <v> --to ${c.slug}` })),
        keepText,
      ];
      const question = hits.length > 1
        ? `'${cand.value}' — do you mean one of the ${hits.length} you already have by that name, or is it just text here?`
        : `Is '${cand.value}' the same ${primary.entity} you already have ('${primary.slug}'), or just plain text here?`;
      asks.push(buildAsk('entity-match', { slug: writingSlug, field: cand.field, value: cand.value, question, options, context }));
      if (hits.length > 1) {
        const slugList = hits.slice(0, 9).map(h => h.slug).join(', ');
        const overflow = hits.length > 9 ? `, …and ${hits.length - 9} more` : '';
        signals.push(`'${cand.value}' could be one of ${hits.length} you already have by that name (${slugList}${overflow}) — connect it to the right one, or keep it as plain text deliberately and tell the operator which you chose.${askEvidenceClause(edgeEvidence)}`);
      } else {
        signals.push(`'${cand.value}' looks like the ${primary.entity} '${primary.slug}' you already have — connect them, or keep it as plain text deliberately and tell the operator which you chose.${askEvidenceClause(edgeEvidence)}`);
      }
    }
    // entity-new ask (fork-doctrine LAW · map R1, 0-candidate branch): ENUMERATE = the same card lookup
    // scoped by entities=; FILTER = that lookup finding no SATISFYING card; COUNT 0 → teach ("should this
    // be an entity?"); DIVERGE = minting a new card vs keeping text yield different graphs. A ref field only.
    if (cand.ref) {
      const satisfied = hits.some(h => !cand.restrict || cand.restrict.includes(h.entity));
      if (!satisfied) {
        const evidence = {
          checked: [`existing cards for '${cand.value}'${cand.restrict ? ` of entity ${cand.restrict.join('/')}` : ''}`],
          found: hits.length ? hits.map(h => `${h.slug} (${h.entity})`) : ['nothing'], // wrong-entity matches list but don't satisfy
        };
        const options = [
          { id: 'create-and-link', label: 'create the card and link it', effect: `new ${cand.restrict ? cand.restrict.join('|') : '<entity>'} + link ${writingSlug} to it` },
          keepText,
        ];
        asks.push(buildAsk('entity-new', { slug: writingSlug, field: cand.field, value: cand.value, question: `'${cand.value}' isn't someone or something I have on file yet — want me to add it and connect it, or keep it as plain text?`, options, context: { evidence, candidates: [], restrict: cand.restrict } }));
        signals.push(`'${cand.value}' isn't someone or something on file yet — add it and connect it, or keep it as plain text deliberately and tell the operator which you chose.${askEvidenceClause(evidence)}`);
      }
    }
  }
  return { asks };
}

// P2/P3/P4 (deterministic-checks provenance) — write-time value-provenance warns within one slug-group.
// LAW: closed comparison over the group's own set/push ops + the pre/post frontmatter (no NLP). Returns
// warn strings. P2 = a set replacing a different non-empty value with no paired push (card/open future);
// P3 = a superseded push `from` still verbatim in description / an untouched profile string field; P4 =
// the same field set to differing values twice in one group.
function provenanceSignals(reg, preFm, postFm, ops, slug) {
  const out = [];
  const sets = ops.filter(o => o.op === 'set' && typeof o.field === 'string');
  const setFields = new Set(sets.map(o => o.field));
  const pushedFields = new Set(ops.filter(o => o.op === 'push' && o.x != null).map(o => o.x));
  const klass = deriveClass(reg, postFm);
  const cardOrOpenFuture = klass === 'card' || (klass === 'future' && isOpen(postFm.status));
  const byField = new Map(); // P4
  for (const o of sets) { if (o.del || o.to == null) continue; if (!byField.has(o.field)) byField.set(o.field, new Set()); byField.get(o.field).add(String(o.to)); }
  for (const [field, vals] of byField) if (vals.size > 1)
    out.push(`${slug}: '${field}' is set to ${vals.size} differing values in one apply (${[...vals].join(' → ')}) — only the last lands and a paired push's from would describe an ambiguous transition; keep one set per field (P4)`);
  if (cardOrOpenFuture) for (const o of sets) { // P2
    const f = o.field;
    if (o.del || !(f === 'description' || f === 'due' || f === 'expires' || f.startsWith('profile.'))) continue;
    if (pushedFields.has(f)) continue;
    const pre = readField(preFm, f);
    if (pre == null || pre === '' || (Array.isArray(pre) && pre.length === 0)) continue; // initialization, not a replacement
    const post = readField(postFm, f);
    if (String(pre) === String(post)) continue; // same-value rewrite
    out.push(`${slug}: '${f}' changed from '${String(pre)}' with no push — the prior value is now unrecoverable; pair the set with a push (x=${f}) so "what was it before?" stays answerable, or keep it deliberately (P2)`);
  }
  for (const o of ops.filter(o => o.op === 'push' && o.from != null && o.x != null)) { // P3
    const from = String(o.from).trim();
    if (from.length < 3 || /^\d{1,2}$/.test(from)) continue; // bounded: ≥3 chars, no short numerics
    const scan = [];
    if (o.x !== 'description' && typeof postFm.description === 'string') scan.push(['description', postFm.description]);
    for (const [k, v] of Object.entries(postFm.profile || {})) { const ff = `profile.${k}`; if (ff !== o.x && !setFields.has(ff) && typeof v === 'string') scan.push([ff, v]); }
    for (const [field, text] of scan) if (text.includes(from)) { out.push(`${slug}: the superseded value '${from}' still appears in ${field} — the old value is still active there; update ${field} too, or keep it deliberately (P3)`); break; }
  }
  return out;
}

function prepareWrite(ctx, req) {
  assertShape('write req', req, WRITE_REQ_KEYS, WRITE_REQ_ALLOWED_KEYS);
  if (ctx.regState.parseError && req.kind !== 'forget')
    die("refusing to write — brain/__meta/registry.md is unparseable (" + ctx.regState.parseError + "); fix it first (writing against the built-in seed would misclassify custom-entity nodes and bake wrong rows into the index)"); // bug #77
  if (ctx.regState.futureFormat != null && req.kind !== 'forget')
    die(`refusing to write — brain/__meta/registry.md format ${ctx.regState.futureFormat} is newer than this engine supports (format ${REG_FORMAT}). Upgrade the engine first; forget/recover remain available because they move source bytes without reserializing them`);
  if (ctx.regState.rewriteProblems?.length && req.kind !== 'forget')
    die(`refusing to write — brain/__meta/registry.md needs hand repair (${ctx.regState.rewriteProblems[0]}); writing against ambiguous/invalid registry semantics could corrupt classification, and the source was left byte-identical`);
  const { root } = ctx;
  const signals = [];
  let asks = null; // asks-contract: deterministic-ambiguity asks, attached to plan/result/frames when non-empty
  const baseCarrier = req.baseHash && typeof req.baseHash === 'object' ? req.baseHash : null;
  const baseHash = baseCarrier ? baseCarrier.hash : req.baseHash;
  const baseOp = baseCarrier?.op || null;
  const autofillOps = (state) => {
    const autoFields = new Set(req.autoFrom || []);
    if (!autoFields.size) return req.ops;
    const preBatch = {};
    // T4 ORDER CONTRACT: auto-from is derived from the same state read whose hash becomes the CAS base.
    for (const f of autoFields) preBatch[f] = readField(state.fm, f);
    return req.ops.map(op => op.op === 'push' && op.from === undefined && autoFields.has(op.x) && preBatch[op.x] !== undefined ? { ...op, from: preBatch[op.x] } : op); // bug #83
  };
  if (!req.slug) die('slug required');
  // F-34: ONE slug-lint choke for EVERY write kind. mutate/forget used to join the raw
  // slug straight into nodePath — a '../'-bearing slug could read-mutate-rewrite any
  // reachable frontmatter file (demonstrated cross-store). Lint-clean slugs cannot
  // traverse (lowercase/digits/hyphens only), and bad-slug files are quarantined anyway.
  {
    const lint = slugLint(req.slug);
    if (lint) die(lint);
  }
  if (req.kind === 'create') {
    const forgotten = path.join(forgottenDir(root), req.slug + '.md');
    if (fs.existsSync(forgotten)) {
      if (!req.force && req.newOp?.force !== true) die(`'${req.slug}' was forgotten (brain/__forgotten/${req.slug}.md) — a new node here silently resurrects it for historical inbound edges; pass --force to deliberately reuse the slug`); // bug #83
      signals.push(`⚠ reusing a forgotten slug '${req.slug}' — historical inbound edges will attach to this new node; pick a fresh slug if that's not intended`);
    }
    if (fs.existsSync(nodePath(root, req.slug)))
      die(`'${req.slug}' exists — inspect it: brain get ${req.slug}; a different thing? mint a suffixed slug (${req.slug}-2); the same thing? update it: brain set ${req.slug} --field …`); // bug #58
    if (baseHash != null)
      die(`base_hash asserts a prior read — '${req.slug}' is being CREATED here (no prior version exists to compare); drop base_hash from the new op`); // bug #69
  }
  let node = null, readHash = null, state = null, dest = null;
  if (req.kind === 'mutate') {
    node = readNode(root, req.slug);
    if (!node) die(missingNodeMsg(ctx, ctx.db, req.slug)); // F-25
    if (hasOwnKey(node.fm, SCALAR_CODEC_FIELD) && node.fm[SCALAR_CODEC_FIELD] !== SCALAR_CODEC_VERSION)
      die(`'${req.slug}' uses unsupported ${SCALAR_CODEC_FIELD} '${String(node.fm[SCALAR_CODEC_FIELD])}' (this engine supports '${SCALAR_CODEC_VERSION}'). A rewrite could reinterpret scalar bytes, so nothing was written. Upgrade the engine, or manually convert/remove the stamp and its encoded values, then: brain sync --slug ${req.slug}`);
    // F-24: an unmerged VCS conflict is not yet truth — parse folds last-value-wins, so a
    // write here would COLLAPSE the conflict into an accidental resolution and destroy
    // the 'ours' hunk. Refuse; resolve the merge first. --force stays the escape hatch.
    if (hasConflictMarkers(conflictRegion(node.text)) && !req.force)
      die(`'${req.slug}' carries unmerged conflict markers — unresolved VCS conflict requires repair; a write now would collapse it into an accidental resolution. Resolve the source conflict, then: brain sync --slug ${req.slug}. (--force overrides deliberately.)`);
    readHash = node.hash;
    const duplicateErrors = (node.errors || []).filter(e => /duplicate .*key|duplicate top-level key/.test(e));
    if (duplicateErrors.length)
      die(`'${req.slug}' has ambiguous duplicate frontmatter keys — refusing to rewrite and choose one value: ${duplicateErrors.join(' | ')}. Fix the file by hand, then: brain sync --slug ${req.slug}`);
    if (node.errors?.length)
      signals.push(`'${req.slug}' carries ${node.errors.length} unparseable/out-of-subset frontmatter line(s) — preserved verbatim; fix by hand (brain check ${req.slug})`);
    withWriteOpContext(baseOp, () => casGuard(node, req.slug, { 'base-hash': baseHash, force: req.force || baseOp?.force === true, signals })); // bug #83
    state = { fm: node.fm, body: node.body };
    const ops = autofillOps(state);
    const preFm = structuredClone(node.fm); // P2/P3/P4: the pre-mutation frontmatter (applyOp mutates state.fm in place below)
    for (const op of ops) {
      withWriteOpContext(op, () => {
        recordGuard(ctx.reg, state, req.slug, op, { force: req.force || op.force === true, permits: req.permits, signals }); // bug #83
        applyOp(ctx, state, { ...op, slug: req.slug, force: op.force === true || req.force }, signals); // bug #83
      });
    }
    provenanceSignals(ctx.reg, preFm, state.fm, ops, req.slug).forEach(p => signals.push(p)); // P2/P3/P4 provenance discipline
    if (ops.some(op => op.field?.startsWith?.('profile.')))
      profileSignals(ctx.reg, state.fm.entity, state.fm.profile).forEach(p => signals.push(p)); // bug #76
    {
      const changed = ops.filter(op => op.op === 'set' && typeof op.field === 'string' && op.field.startsWith('profile.') && !op.del && op.to != null).map(op => op.field.slice(8));
      if (changed.length) {
        const guard = profileEntityGuard(ctx, req.slug, state.fm, changed, signals, req.batchOps); // asks-contract detectors (entity-match / entity-new)
        if (guard.asks.length) asks = guard.asks;
        const va = profileVariantAsks(ctx.reg, state.fm.entity, state.fm.profile || {}, changed, req.slug, signals); // V4/V5
        if (va.length) asks = (asks || []).concat(va);
      }
      if (ops.some(op => op.op === 'link' && (op.verb === 'about' || op.verb === 'mentions'))) { // R2: a weak edge just landed
        const pr = placeRoleAsks(ctx, req.slug, state.fm, signals); if (pr.length) asks = (asks || []).concat(pr);
      }
    }
    if (ops.some(op => op.op === 'set' && (op.field === 'profile.cadence' || op.field === 'profile.period'))) { // O1: only when cadence LANDS
      const o1 = obligationCadenceSignal(ctx.reg, state.fm); if (o1) signals.push(`${req.slug}: ${o1}`);
    }
    // brain-profiles §5 (wave-2 F4): a vote-only write moves the score and NOTHING else —
    // refreshing date_updated here made an old card look edited and silently cleared the
    // working-memory staleness warn. Any non-vote op in the group refreshes as before.
    if (!(ops.length && ops.every(op => op.op === 'vote')))
      state.fm.date_updated = ctx.today();
    assertFmClean(state.fm); // every mutation path shares the same scalar/flat-list serialization choke
  } else if (req.kind === 'create') {
    state = withWriteOpContext(req.newOp, () => ({ fm: buildNewFm(ctx, { ...req.newOp, slug: req.slug }), body: '\n' }));
    const ops = autofillOps(state);
    for (const op of ops) withWriteOpContext(op, () => applyOp(ctx, state, { ...op, slug: req.slug, force: op.force === true || req.force }, signals)); // bug #83
    if (state.fm.due && state.fm.occurred && !ops.some(o => o.op === 'freeze'))
      die(`a fresh node can't carry both due and occurred — due marks a future, occurred marks a record; pick one (freeze a future to a record later if it happens).`); // bug #76
    if (state.fm.entity)
      profileSignals(ctx.reg, state.fm.entity, state.fm.profile || {}, { checkRequired: true }).forEach(p => signals.push(p)); // bug #76 + R1: required-field warn fires on CREATE only (never set/mutate — a partial update mustn't nag for a field it isn't touching)
    {
      const pk = Object.keys(state.fm.profile || {});
      const guard = profileEntityGuard(ctx, req.slug, state.fm, pk, signals, req.batchOps); // asks-contract detectors (entity-match / entity-new)
      if (guard.asks.length) asks = guard.asks;
      const va = profileVariantAsks(ctx.reg, state.fm.entity, state.fm.profile || {}, pk, req.slug, signals); // V4/V5
      if (va.length) asks = (asks || []).concat(va);
    }
    if (deriveClass(ctx.reg, state.fm) === 'future' && !state.fm.occurred) { // T4: a future born terminal/excluded bypasses freeze
      const st = String(state.fm.status ?? '');
      if (TERMINAL_STATUSES.has(st))
        signals.push(`⚠ '${req.slug}' is born with terminal status '${st}' but never frozen — it never became a record and is absent from futures/outbox; create it open then freeze in one apply, or F-9 shelve it deliberately`);
      else if (EXCLUDED_SET.has(st))
        signals.push(`⚠ '${req.slug}' is born archived — hidden from every default view without being frozen; deliberate shelving, or create it open?`);
    }
    { const o1 = obligationCadenceSignal(ctx.reg, state.fm); if (o1) signals.push(`${req.slug}: ${o1}`); } // O1 (birth of an open obligation)
    { const dup = cardDuplicateAsk(ctx, req.slug, state.fm, signals); if (dup) asks = (asks || []).concat([dup]); } // R3 possible-duplicate
    { const fu = filingUnanchoredAsk(ctx, req.slug, state.fm, signals); if (fu) asks = (asks || []).concat([fu]); } // O3 filing-unanchored
    { const pr = placeRoleAsks(ctx, req.slug, state.fm, signals); if (pr.length) asks = (asks || []).concat(pr); } // R2 place-role
    { const df = duplicateFutureAsk(ctx, req.slug, state.fm, signals); if (df) asks = (asks || []).concat([df]); } // C4 duplicate-future
    // buildNewFm already defaults date_updated to today. Keep an explicit import
    // override byte-for-byte; this create path must not silently replace authored
    // bitemporal history after promising date_created/date_updated preservation.
    assertFmClean(state.fm); // apply-added profile/why/update values must remain serializable too
  } else if (req.kind === 'forget') {
    const p = nodePath(root, req.slug);
    let sourceText = null;
    try { sourceText = fs.readFileSync(p, 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (sourceText == null && baseHash != null)
      die(`'${req.slug}' changed on disk since your read — the source file is GONE (already forgotten or renamed); refusing CAS forget because there are no bytes to archive`);
    if (sourceText != null) {
      const hash = contentHash(sourceText);
      // Optional user base_hash is one guard. Independently, every existing-source
      // forget carries the exact bytes prepared here into the lock-time recheck. Without
      // that internal CAS, a writer could verify old bytes, let an unlocked forget move
      // them, then rename a new version back into __source__ after forget reported success.
      if (baseHash != null) {
        withWriteOpContext(baseOp, () => casGuard({ hash }, req.slug, {
          'base-hash': baseHash,
          force: req.force || baseOp?.force === true,
          signals,
        }));
      }
      readHash = hash;
    }
    if (sourceText == null) {
      if (ctx.regState.futureFormat != null)
        die(`no source file for '${req.slug}' — registry format ${ctx.regState.futureFormat} is newer than this engine, so the stale/missing index cannot be trusted; nothing archived`);
      if (ctx.regState.parseError)
        die(`no source file for '${req.slug}' — the registry is unparseable, so the stale/missing index cannot be trusted; nothing archived`);
      if (ctx.regState.rewriteProblems?.length)
        die(`no source file for '${req.slug}' — the registry needs hand repair, so the stale/missing index cannot be trusted; nothing archived`);
      // Authored Markdown, not a disposable row, is what forget archives. Consulting an
      // absent/stale index merely to decide that there are no bytes used to rebuild the
      // index and migrate registry syntax on a refused command. A hand-deleted source is
      // reconciled by sync; forget itself has no valid file operation to commit.
      die(`no source file for '${req.slug}' — forget archives authored Markdown and has nothing to move; if the file was removed by hand, run: brain sync`);
    }
  } else die(`unknown write kind '${req.kind}'`);
  const plan = { slug: req.slug, kind: req.kind, state, node, readHash, signals, force: req.force, index: req.index, dest };
  if (asks) plan.asks = asks; // asks-contract: omitted when empty — never a fabricated empty key
  assertShape('write plan', plan, WRITE_PLAN_KEYS, WRITE_PLAN_ALLOWED_KEYS);
  return plan;
}

function assertPlanSourceCurrent(root, plan) {
  if (plan.readHash == null || (plan.kind !== 'mutate' && plan.kind !== 'forget')) return;
  const p = nodePath(root, plan.slug);
  if (!fs.existsSync(p)) {
    if (plan.kind === 'forget')
      die(`'${plan.slug}' changed on disk since your read — the file is GONE (already forgotten or renamed); nothing archived`);
    die(`'${plan.slug}' changed on disk since your read — the file is GONE (forgotten or renamed); refusing to recreate it. Re-read; to recreate deliberately use: brain new --force`);
  }
  const cur = contentHash(fs.readFileSync(p, 'utf8'));
  if (cur !== plan.readHash && !plan.force)
    die(`'${plan.slug}' changed on disk since your read (now ${cur.slice(0, 8)} ≠ read ${String(plan.readHash).slice(0, 8)}) — re-read or pass --force`);
}

function commitPlan(ctx, plan, opts = {}) {
  assertShape('write plan', plan, WRITE_PLAN_KEYS, WRITE_PLAN_ALLOWED_KEYS);
  const { root } = ctx;
  const signals = plan.signals || [];
  const withAsks = (result) => { if (plan.asks) result.asks = plan.asks; return result; };
  let text = null, dest = plan.dest || null;
  const lockRecheck = plan.readHash != null && (plan.kind === 'mutate' || plan.kind === 'forget');
  // Reject an already-stale CAS before any derived-state/bootstrap work. Database
  // preparation then completes before publication takes locks, preserving the one global
  // order: reindex -> index -> slug (never slug -> index/reindex).
  if (lockRecheck) {
    assertPlanSourceCurrent(root, plan);
    // Cross the slug arbiter once as a mutation-free validation boundary before registry
    // migration/recovery. Release it before database preparation to avoid lock inversion;
    // publication takes index -> slug and repeats the exact check a third/final time.
    const validationLockDir = path.dirname(nodeLockPath(root, plan.slug));
    const hadValidationLockDir = fs.existsSync(validationLockDir);
    try { withLock(nodeLockPath(root, plan.slug), () => assertPlanSourceCurrent(root, plan)); }
    catch (e) {
      if (!hadValidationLockDir) { try { fs.rmdirSync(validationLockDir); } catch { /* nonempty/concurrent */ } }
      throw e;
    }
  }
  if (plan.kind !== 'forget') migrateRegistryIfStale(ctx);
  if (!(ctx.regState.parseError || ctx.regState.futureFormat != null || ctx.regState.rewriteProblems?.length))
    requireDb(ctx);
  const commitFile = () => {
    const dirtyAdded = opts.skipDirtyWrite ? (opts.dirtyAdded || []) : writeDirty(root, [plan.slug]); // bug #66
    if (plan.kind === 'create')
      text = writeNodeExclusive(root, plan.slug, plan.state.fm, plan.state.body, dirtyAdded.includes(plan.slug)); // bug #66
    else if (plan.kind === 'mutate')
      text = writeNode(root, plan.slug, plan.state.fm, plan.state.body, { expectHash: plan.readHash, force: plan.force, today: ctx.today, lockHeld: true });
    else if (plan.kind === 'forget') {
      const p = nodePath(root, plan.slug);
      dest = fs.existsSync(p) ? forgetFile(root, plan.slug, ctx.today, {
        expectHash: plan.readHash,
        force: plan.force,
        signals,
        lockHeld: true,
      }) : null;
    }
  };
  // The crash sentinel and Phase-A source publication are one index-serialized critical
  // section. Recovery can therefore see either no claim, or a claim whose source rename
  // has completed; it can never index old/absent bytes and clear a pre-publication claim.
  // The slug lock remains the CAS/no-clobber arbiter inside that outer serialization.
  const lockDir = path.dirname(nodeLockPath(root, plan.slug));
  const hadLockDir = fs.existsSync(lockDir);
  let crossedBoundary = false;
  try {
    withIndexLock(root, () => {
      withLock(nodeLockPath(root, plan.slug), () => {
        assertPlanSourceCurrent(root, plan);
        // F2: re-check the create's entity INSIDE the publication critical section —
        // a concurrent unregister since load invalidates this plan's validation.
        assertCreateEntityCurrent(ctx, plan);
        crossedBoundary = true;
        commitFile();
      });
    });
  } catch (e) {
    if (!crossedBoundary && !hadLockDir) { try { fs.rmdirSync(lockDir); } catch { /* nonempty/concurrent */ } }
    throw e;
  }
  let indexCommitted = false;
  if (plan.index && typeof plan.index === 'object' && plan.index.defer) {
    try { plan.index.defer(plan.slug); }
    catch (e) { signals.push(`file written, index pending (${e.message}) — reconciles on next open, or run: brain sync`); }
    const result = withAsks({ fileCommitted: true, indexCommitted: false, hash: text ? contentHash(text) : null, dest, signals });
    assertShape('write result', result, WRITE_RESULT_KEYS, WRITE_RESULT_ALLOWED_KEYS);
    return result;
  }
  if ((ctx.regState.parseError || ctx.regState.futureFormat != null || ctx.regState.rewriteProblems?.length) && plan.kind === 'forget') {
    try {
      indexCommitted = deleteIndexRowsIfCurrent(ctx, plan.slug);
    } catch (e) {
      signals.push(`file archived byte-identically; index removal pending (${e.message})`);
    }
    if (!indexCommitted) signals.push(ctx.regState.parseError
      ? `file archived byte-identically; index pending because registry.md is unparseable`
      : ctx.regState.futureFormat != null
        ? `file archived byte-identically; index pending because registry format ${ctx.regState.futureFormat} is newer than this engine (upgrade first)`
        : `file archived byte-identically; index pending because registry.md needs hand repair`);
    const result = withAsks({ fileCommitted: true, indexCommitted, hash: null, dest, signals });
    assertShape('write result', result, WRITE_RESULT_KEYS, WRITE_RESULT_ALLOWED_KEYS);
    return result;
  }
  try {
    withIndexLock(root, () => {
      // Re-open by pathname after waiting: a concurrent rebuild may have retired the
      // cached inode while Phase A was writing the source file.
      closeDb(ctx);
      const db = openDb(ctx); // commitFile already required/current-checked the DB
      withBusyRetry(db, () => indexNode(ctx, db, plan.slug));
      clearDirty(root, [plan.slug]);
      indexCommitted = true;
    });
  } catch (e) {
    try { ctx.db?.exec('ROLLBACK'); } catch { /* already rolled */ }
    signals.push(`file written, index pending (${e.message}) — reconciles on next open, or run: brain sync`); // bug #54
  }
  const result = withAsks({ fileCommitted: true, indexCommitted, hash: text ? contentHash(text) : null, dest, signals });
  assertShape('write result', result, WRITE_RESULT_KEYS, WRITE_RESULT_ALLOWED_KEYS);
  return result;
}

function commitWrite(ctx, req) {
  return commitPlan(ctx, prepareWrite(ctx, req));
}

// ===== SECTION: READ VERBS =====
// A tiny per-command projection makes retained pre-rename endpoints resolve without
// rewriting authored Markdown. Shadowed aliases are omitted: the real node still wins.
function buildSlugAliasTemp(ctx, db) {
  db.exec(`DROP TABLE IF EXISTS temp._slug_aliases;
    CREATE TEMP TABLE _slug_aliases(alias TEXT PRIMARY KEY, canonical TEXT NOT NULL) WITHOUT ROWID;`);
  const exists = db.prepare(`SELECT 1 FROM nodes WHERE slug=?`);
  const ins = db.prepare(`INSERT INTO _slug_aliases(alias,canonical) VALUES(?,?)`);
  for (const [name, a] of Object.entries(ctx.reg.aliases || {}))
    if (a?.kind === 'slug' && !exists.get(name)) ins.run(name, a.to);
}

// Index-driven list/search reads must not serve a row whose CURRENT source has become
// an unresolved conflict since the last sync. Keep the common path cheap: SQLite asks
// this function only for rows in the query's candidate cohort. The first evaluation of
// each candidate MUST inspect current bytes: mtime+size can be restored after a same-size
// VCS materialization. Repeated COUNT/page/search passes in one command reuse that
// first-observed source decision, so each candidate file is opened at most once per
// command. Detection is the same structural/body-scoped decision as indexOne.
// Missing/unreadable sources retain their existing doctor --verify contract; this guard
// is deliberately scoped to VCS-conflict quarantine rather than redefining phantom rows.
const currentSourceConflictFreeSQL = (alias = 'n') => `brain_current_source_conflict_free(${alias}.slug)=1`;
const edgeSourceLiveSQL = (alias = 'e') => `brain_edge_source_live(${alias}.from_slug)=1`;
const currentSourceLiveSQL = (alias = 'n') => `brain_edge_source_live(${alias}.slug)=1`;

// ---------- the loaded-desk state (context-retrieval §2) ----------
// Operational state, not truth: .brain/active.json, gitignored beside the index. Losing
// it means "no desks loaded", never data loss. `focus` is implicitly ALWAYS active.
// brain-profiles §6: GROUP stores keep PER-WRITER active sets (.brain/active/<BRAIN_WHO>
// .json, writes locked) — one crew member's load/drop never reshapes another's ranking;
// subject stores keep the single shared file (one writer by doctrine).
function activeStatePath(ctx) {
  if (ctx.group && ctx.who)
    return path.join(ctx.root, '.brain', 'active', `${ctx.who.replace(/[^A-Za-z0-9._-]/g, '-')}.json`);
  return path.join(ctx.root, '.brain', 'active.json');
}

// wave-2 F9: a group store's active state is per-writer BY DOCTRINE — with no BRAIN_WHO
// there is no writer identity, and falling back to the shared file would let anonymous
// sessions reshape every crew member's ranking. No identity ⇒ stateless: no active-set
// read or write, one warn naming the wiring fix.
function activeStateless(ctx) {
  if (!ctx.group || ctx.who) return false;
  if (!ctx._warnedActiveStateless) {
    ctx._warnedActiveStateless = true;
    console.error(`⚠ group store with no BRAIN_WHO — the loaded-desk state is per-writer, so this session is stateless (no desks load or persist); fix the launcher: export BRAIN_WHO=<name>`);
  }
  return true;
}

function readActiveState(ctx) {
  if (activeStateless(ctx)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(activeStatePath(ctx), 'utf8'));
    const list = Array.isArray(parsed?.active) ? parsed.active : [];
    return [...new Set(list.filter(s => typeof s === 'string' && !registrySlugProblem(s)))];
  } catch { return []; } // absent/corrupt = nothing loaded (the index-file philosophy)
}

function writeActiveState(ctx, slugs) {
  if (activeStateless(ctx)) return;
  const p = activeStatePath(ctx);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  atomicWrite(p, JSON.stringify({ active: slugs }) + '\n');
}

// Serialize every active-state read-modify-write (the §6 "writes locked" rule).
const withActiveLock = (ctx, fn) => withLock(path.join(ctx.root, '.brain', 'active.lock'), fn);

// Resolve the active set for a consulting read, ONCE per command (cached on ctx):
// - a gone/archived/non-context entry prunes SILENTLY (state, not truth);
// - a CONFLICTED active context is NOT pruned — it is suspended from ranking/shading and
//   every consulting read prints ONE ⚠ line until it is resolved or dropped
//   (silent result-shifting is what conflict honesty forbids);
// - `names` is the tier/shade endpoint list: every live active context (focus always)
//   plus its non-shadowed slug aliases, slug-grammar-safe for SQL inlining.
function activeContexts(ctx, db) {
  if (ctx._activeContexts) return ctx._activeContexts;
  const recorded = readActiveState(ctx);
  const active = [], suspended = [];
  const liveContext = (slug) => !!db.prepare(`SELECT 1 FROM nodes n WHERE n.slug=? AND ${LIVE_CONTEXT_SQL('n')}`).get(slug);
  for (const raw of recorded) {
    const slug = resolveSlug(ctx.reg, raw, db);
    if (!liveContext(slug)) continue; // gone/archived/SUPERSEDED/non-context (F7: one predicate) — silently pruned on the next write below
    if (!currentSourceIsConflictFree(db, slug)) { suspended.push(slug); continue; }
    if (!active.includes(slug)) active.push(slug);
  }
  if (active.length + suspended.length !== recorded.length)
    try { withActiveLock(ctx, () => writeActiveState(ctx, [...active, ...suspended])); } catch { /* state, not truth */ }
  for (const slug of suspended)
    console.error(`⚠ active context '${slug}' has an unresolved source conflict — suspended from ranking until resolved (brain contexts to review)`);
  // F7: implicit focus rides the SAME validation. No focus card = implicitly active
  // (nothing to validate); a focus card that is retired ranks nothing; a conflicted
  // focus card is suspended with the same ⚠ (never written into the state file — focus
  // is implicit, not recorded).
  let focusRanks = true;
  const focusSlug = resolveSlug(ctx.reg, 'focus', db);
  if (db.prepare(`SELECT 1 FROM nodes WHERE slug=?`).get(focusSlug)) {
    if (!liveContext(focusSlug)) focusRanks = false;
    else if (!currentSourceIsConflictFree(db, focusSlug)) {
      focusRanks = false;
      console.error(`⚠ active context '${focusSlug}' has an unresolved source conflict — suspended from ranking until resolved (brain contexts to review)`);
    }
  }
  const names = [];
  for (const slug of [...(focusRanks ? ['focus'] : []), ...active])
    for (const name of slugReadNames(ctx, ctx.reg, resolveSlug(ctx.reg, slug, db), db))
      if (!slugLint(name) && !names.includes(name)) names.push(name);
  ctx._activeContexts = { active, suspended, names };
  return ctx._activeContexts;
}

// Membership subquery over the active desks. Names are slug-grammar-validated above, so
// inlining is injection-safe (tier text is reused inside ORDER BY where binds can't ride).
// The member itself must be in the availability cohort: a superseded skill/tool whose
// in_context edge survives must neither rank tier-0 nor unshade (the context read already
// excludes it — same predicate, one subquery for tiering AND shading).
const activeMemberSubSQL = (names) => `SELECT te.from_slug FROM edges te
      JOIN nodes tn ON tn.slug=te.from_slug
      WHERE te.verb='in_context' AND te.to_slug IN (${names.length ? names.map(s => `'${s}'`).join(',') : `''`})
      AND ${edgeSourceLiveSQL('te')} AND ${AVAILABILITY_COHORT_SQL('tn')}`;

// Two-tier default ordering for search/list (context-retrieval §3): (0) members of any
// ACTIVE context (focus included), (1) everything else — existing relevance order within
// each tier. Rides the SAME statement as LIMIT, so tiering binds before any result cap.
const contextTierSQL = (names, alias = 'n') => `CASE WHEN ${alias}.slug IN (${activeMemberSubSQL(names)}) THEN 0 ELSE 1 END`;

// Capability shading (context-retrieval §3): skill/tool rows are desk equipment — hidden
// from DEFAULT search/list unless a member of an active context. IFNULL keeps a NULL
// entity row visible (NULL IN (...) is NULL, and NOT NULL would silently drop it).
const capabilityShadeSQL = (names, alias = 'n') => `NOT (IFNULL(${alias}.entity,'') IN ('skill','tool')
      AND ${alias}.slug NOT IN (${activeMemberSubSQL(names)}))`;

// The exact inverse — the disclosure count's predicate (hidden = matched but shaded).
const capabilityHiddenSQL = (names, alias = 'n') => `IFNULL(${alias}.entity,'') IN ('skill','tool')
      AND ${alias}.slug NOT IN (${activeMemberSubSQL(names)})`;

// Disclosure, never silence (read-honesty): the ONE trailing line when shading removed
// matches — count only, no rows, naming both followable paths.
const shadeDisclosureLine = (n) => `(+ ${n} capability match${n === 1 ? '' : 'es'} hidden — skills/tools load with a context: brain context <slug> · or ask explicitly: --entity skill)`;

// brain-profiles §5: within each tier the order is votes DESC then existing relevance —
// the full order is context → votes → relevance. COALESCE so absent = 0 exactly;
// vote-disabled stores keep the plain two-tier order (the column is simply not in the
// ORDER BY — the empty string).
const votesOrderSQL = (ctx, alias = 'n') => ctx.votesEnabled === false ? '' : `COALESCE(${alias}.votes, 0) DESC, `;

// context-retrieval §4: the ◉focus row badge re-lands on MEMBERSHIP (in_context → focus).
// Focus members only — other active-context members get no badge in v1. Module state,
// refreshed by installCurrentSourceConflictGuard (which every row-printing read installs
// first), so row() stays a plain formatter.
let ROW_FOCUS_MEMBERS = null;

function refreshFocusBadge(ctx, db) {
  try {
    const names = slugReadNames(ctx, ctx.reg, resolveSlug(ctx.reg, 'focus', db), db).filter(n => !slugLint(n));
    const set = new Set();
    for (const r of db.prepare(`SELECT e.from_slug FROM edges e WHERE e.verb='in_context'
        AND e.to_slug IN (${sqlSlots(names)}) AND ${edgeSourceLiveSQL('e')}`).all(...names)) {
      set.add(String(r.from_slug));
      set.add(resolveSlug(ctx.reg, String(r.from_slug), db));
    }
    ROW_FOCUS_MEMBERS = set;
  } catch { ROW_FOCUS_MEMBERS = null; }
}

function installCurrentSourceConflictGuard(ctx, db) {
  const cache = new Map();
  const edgeCache = new Map();
  db.function('brain_current_source_conflict_free', (rawSlug) => {
    const slug = String(rawSlug);
    if (cache.has(slug)) return cache.get(slug) ? 0 : 1;
    try {
      const p = nodePath(ctx.root, slug);
      const text = fs.readFileSync(p, 'utf8');
      const conflict = hasConflictMarkers(conflictRegion(text));
      cache.set(slug, conflict);
      return conflict ? 0 : 1;
    } catch { return 1; }
  });
  db.function('brain_edge_source_live', (rawSlug) => {
    const raw = String(rawSlug);
    if (edgeCache.has(raw)) return edgeCache.get(raw);
    let live = 0;
    try {
      // Retained pre-rename endpoints follow a non-shadowed authored slug alias, but a
      // real filename always wins. The source/indexability mirror rejects missing bytes,
      // conflicts, NUL/structured quarantine, and every other non-live edge author.
      const slug = resolveWriteSlug(ctx, raw);
      const text = fs.readFileSync(nodePath(ctx.root, slug), 'utf8');
      live = sourceIndexState(ctx, slug, text).live ? 1 : 0;
    } catch { live = 0; }
    edgeCache.set(raw, live);
    return live;
  });
  refreshFocusBadge(ctx, db); // ◉focus badge rides membership; every reader lands here first
}

function currentSourceIsConflictFree(db, slug) {
  return db.prepare(`SELECT brain_current_source_conflict_free(?) ok`).get(slug).ok === 1;
}

const blockedJoinSQL = (fromSlugExpr = null, a = 'n') => `edges e
    LEFT JOIN _slug_aliases ef ON ef.alias=e.from_slug
    LEFT JOIN _slug_aliases et ON et.alias=e.to_slug
    JOIN nodes ${a} ON ${a}.slug=COALESCE(et.canonical,e.to_slug)
    WHERE ${fromSlugExpr ? `COALESCE(ef.canonical,e.from_slug)=${fromSlugExpr} AND ` : ''}e.verb='depends_on'
    AND ${edgeSourceLiveSQL('e')}
    AND ${a}.class='future' AND ${openFutureSQL(a)} AND ${currentSourceConflictFreeSQL(a)}`;

// the OPEN futures this slug depends_on — its blockers (indexed, single node)
function blockersOf(db, slug) {
  return db.prepare(`SELECT DISTINCT COALESCE(et.canonical,e.to_slug) to_slug FROM ${blockedJoinSQL('?')}`).all(slug).map(r => r.to_slug);
}

function isBlocked(db, slug) {
  return !!db.prepare(`SELECT 1 FROM ${blockedJoinSQL('?')} LIMIT 1`).get(slug);
}

// cockpit blocked-set: one join into a temp table, then LEFT JOIN + sort in SQL
// (no 70k-row JS materialization). Rebuilt per call so writes stay reflected.
function buildBlockedTemp(ctx, db) {
  buildSlugAliasTemp(ctx, db);
  db.exec(`DROP TABLE IF EXISTS temp._blocked;
    CREATE TEMP TABLE _blocked AS
      SELECT DISTINCT COALESCE(ef.canonical,e.from_slug) slug FROM ${blockedJoinSQL(null, 'bt')};
    CREATE INDEX temp._bidx ON _blocked(slug);`);
}


// ---------- collisions ----------
// name-collision awareness: same display name (profile.name) on other nodes.
// Uses idx_nodes_name expression index (verify: EXPLAIN QUERY PLAN).
function nameCollisions(db, r) {
  try {
    const name = JSON.parse(r.profile_json || '{}').name;
    if (!name) return null;
    const twins = db.prepare(
      `SELECT n.slug, n.description FROM nodes n
       WHERE n.slug != ? AND n.entity = ? AND json_extract(n.profile_json,'$.name') = ?
       AND ${currentSourceConflictFreeSQL('n')}`
    ).all(r.slug, r.entity, name);
    return twins.length ? { name, twins } : null;
  } catch { return null; }
}

function warnCollisions(db, r, out) {
  const c = nameCollisions(db, r);
  if (!c) return;
  out(`⚠ warning: ${c.twins.length + 1} ${r.entity}s named "${c.name}" exist — you have ${r.slug}. Others:`);
  c.twins.slice(0, 8).forEach(t => out(`    ${t.slug} — ${t.description}`));
  if (c.twins.length > 8) out(`    …and ${c.twins.length - 8} more (search "${c.name}")`);
}


// ---------- output ----------
// compact class/status/blocked annotation for a related node
function annotate(ctx, db, slug) {
  slug = resolveSlug(ctx.reg, slug, db);
  const n = db.prepare(`SELECT n.class, n.status FROM nodes n WHERE n.slug=?
    AND ${currentSourceConflictFreeSQL('n')}`).get(slug);
  if (!n) return '(?)';
  let s = n.class + (n.status ? '·' + n.status : '');
  if (n.class === 'future' && isOpen(n.status) && isBlocked(db, slug)) s += '·⛔blocked';
  return `(${s})`;
}

function row(r) {
  const bits = [r.slug, r.class + ':' + (r.entity ?? '?')];
  if (r.status) bits.push(r.status);
  if (r.due) bits.push('due ' + r.due);
  if (r.occurred) bits.push('occurred ' + r.occurred);
  if (r.important) bits.push('IMPORTANT');
  if (ROW_FOCUS_MEMBERS?.has(r.slug)) bits.push('◉focus');
  bits.push('— ' + r.description);
  return bits.join('  ');
}

function tsvCell(v) { return String(v ?? '').replace(/[\t\r\n]+/g, ' '); }

function shownSuffix(total, shown, hint) {
  return `total ${total}, shown ${shown}${hint ? ` (${hint})` : ''}`;
}

function printRows(rows, label, total, hint, out) {
  total = total ?? rows.length;
  out(`${label}: ${shownSuffix(total, rows.length, hint)}`);
  rows.forEach(r => out('  ' + row(r)));
  if (!rows.length) out('  (0 results)');
}

// facet hint on a zero-result cohort (spec §5 output grammar): name the active filters
// and enumerate the PRESENT values of the tightest facet, so an empty/typo'd filter
// self-corrects instead of dead-ending. One small GROUP BY, only on a zero result.
function zeroFacetHint(db, flags) {
  const active = [];
  if (flags.entity) active.push(`entity=${flags.entity}`);
  if (flags.class) active.push(`class=${flags.class}`);
  if (flags.status) active.push(`status=${flags.status}`);
  if (flags.important != null) active.push(`important=${flags.important}`);
  if (flags.profile) active.push(`profile ${flags.profile}`);
  if (flags.edge) active.push(`edge ${flags.edge}`);
  for (const f of ['occurred', 'due', 'created']) {
    if (flags[f + '-from']) active.push(`${f}≥${flags[f + '-from']}`);
    if (flags[f + '-to']) active.push(`${f}≤${flags[f + '-to']}`);
  }
  const top = (col) => db.prepare(`SELECT ${col} v, COUNT(*) c FROM nodes n
    WHERE ${currentSourceConflictFreeSQL('n')} GROUP BY ${col} ORDER BY c DESC`).all();
  let present = '';
  if (flags.entity) present = 'entities present: ' + top('entity').slice(0, 8).map(r => `${r.v ?? '(none)'}(${r.c})`).join(', ');
  else if (flags.class) present = 'classes present: ' + top('class').map(r => `${r.v ?? '(none)'}(${r.c})`).join(', ');
  else if (flags.status) present = 'statuses present: ' + top('status').filter(r => r.v != null).slice(0, 8).map(r => `${r.v}(${r.c})`).join(', ');
  const relax = (!flags.all && !flags.status) ? ` · --all includes ${[...EXCLUDED_SET].join('/')}` : '';
  return `facet hint: 0 for {${active.join(', ') || 'no filters'}}${present ? ' — ' + present : ''}${relax}`;
}

function isoDateUTC(dateStr) {
  const y = +dateStr.slice(0, 4), mo = +dateStr.slice(5, 7), d = +dateStr.slice(8, 10);
  // setUTCFullYear, not Date.UTC — Date.UTC maps years 00–99 to 19xx, so window math on a
  // legal historical bound (0044-03-15, blessed by assertReadDateFlags) would silently
  // compute a 19xx cohort (F-16's own class, on inputs its validation now accepts).
  const dt = new Date(0); dt.setUTCFullYear(y, mo - 1, d); return dt.getTime();
}

function ymdUTC(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// bug #60: window math is pure YYYY-MM-DD string arithmetic. No local Date rollover,
// timezone offset, or DST edge can widen a cockpit window by accident.
function addDaysISO(dateStr, n) {
  return ymdUTC(isoDateUTC(dateStr) + n * 86400000);
}

function addMonthsISO(dateStr, n) {
  const y = +dateStr.slice(0, 4), mo = +dateStr.slice(5, 7), d = +dateStr.slice(8, 10);
  const total = y * 12 + (mo - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  const nd = Math.min(d, new Date(Date.UTC(ny, nm, 0)).getUTCDate());
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

function elapsedMonthsISO(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return 0;
  let months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7));
  if (addMonthsISO(from, months) > to) months--;
  return Math.max(0, months);
}

// working-memory §4: whole elapsed days for the staleness sweep — the brief rots in days,
// skills in months, so PROFILE_STALE_MONTHS is deliberately NOT reused.
function elapsedDaysISO(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return 0;
  return Math.round((isoDateUTC(to) - isoDateUTC(from)) / 86400000);
}

function addYearsISO(dateStr, n) {
  const y = +dateStr.slice(0, 4) + n, mo = +dateStr.slice(5, 7), d = +dateStr.slice(8, 10);
  const nd = Math.min(d, new Date(Date.UTC(y, mo, 0)).getUTCDate());
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

function windowBoundsExclusive(today, window) {
  const toEx = window === 'day' ? addDaysISO(today, 1)
    : window === 'week' ? addDaysISO(today, 7)
    : window === 'month' ? addMonthsISO(today, 1)
    : window === 'year' ? addYearsISO(today, 1)
    : null;
  return toEx ? { from: today, toEx } : null;
}

function fmtDueRel(ctx, due) {
  if (!due || !String(due).includes('T')) return '';
  const s = String(due);
  const days = Math.round((isoDateUTC(s.slice(0, 10)) - isoDateUTC(ctx.today())) / 86400000);
  const now = localTime(ctx.tz);
  const nowMin = +now.slice(0, 2) * 60 + +now.slice(3, 5);
  const dueMin = +s.slice(11, 13) * 60 + +s.slice(14, 16);
  const diff = days * 1440 + dueMin - nowMin;
  const abs = Math.abs(diff);
  if (abs < 60) return diff >= 0 ? `(in ${abs}m)` : `(${abs}m ago)`;
  const h = Math.round(abs / 60);
  return diff >= 0 ? `(in ~${h}h)` : `(~${h}h ago)`;
}

const aliasSuffix = (raw, resolved) => raw !== resolved ? ` (alias '${raw}')` : '';

function normalizeEdgeFilter(ctx, db, flags) {
  if (!flags.edge) return { flags, edgeAliasLabel: '', edgeTargets: null };
  const raw = String(flags.edge), i = raw.indexOf(':');
  const rawVerb = i < 0 ? raw : raw.slice(0, i);
  const rawTarget = i < 0 ? null : raw.slice(i + 1);
  const verb = resolveVerb(ctx.reg, rawVerb, db);
  const target = rawTarget == null ? null : resolveSlug(ctx.reg, rawTarget, db);
  const edgeTargets = target == null ? null : slugReadNames(ctx, ctx.reg, target, db);
  const edge = target == null ? verb : `${verb}:${target}`;
  return { flags: edge === flags.edge ? flags : { ...flags, edge }, edgeAliasLabel: edge === raw ? '' : ` --edge ${edge}${aliasSuffix(raw, edge)}`, edgeTargets };
}

// SQL-first: indexed narrowing (entity/class/status/date ranges/edge) then the
// profile json_extract as a residual predicate. DISTINCT because --edge can fan out.
// opts.shadeNames: active-context names → capability shading (context-retrieval §3) rides
// the retrieval statements only; an explicit --entity skill|tool is never shaded.
function listQuery(flags, selectCols, edgeTargets = null, opts = {}) {
  const joins = [], where = ['1=1', currentSourceConflictFreeSQL('n')], jargs = [], wargs = [];
  if (opts.shadeNames)
    where.push(opts.invertShade ? capabilityHiddenSQL(opts.shadeNames) : capabilityShadeSQL(opts.shadeNames));
  // default hides only the archive, UNLESS --all or an explicit --status (else the
  // filter contradicts itself: `list --status archived` would exclude the rows asked for)
  if (!flags.all && !flags.status) where.push(defaultCohortSQL('n'));
  if (flags.entity) { where.push('n.entity=?'); wargs.push(flags.entity); }
  if (flags.class) { where.push('n.class=?'); wargs.push(flags.class); }
  if (flags.status) { where.push('n.status=?'); wargs.push(flags.status); }
  if (flags.important === true) where.push('n.important=1'); // bug #3: a real filter, not a silently-ignored flag
  else if (flags.important === false) where.push('n.important=0');
  for (const [f, col] of [['occurred', 'occurred'], ['due', 'due'], ['created', 'created']]) {
    if (flags[f + '-from']) {
      // A date-only due means the whole authored day. For a timed lower bound, keep a
      // date-only item on that same day while comparing timed items at minute precision.
      // Raw lexical comparison made `2099-01-31` sort before every timed spelling and
      // silently dropped it even though its day overlaps the requested range (FB-7/19).
      if (f === 'due' && String(flags[f + '-from']).includes('T')) {
        where.push(`((length(n.${col})=10 AND n.${col}>=?) OR (length(n.${col})<>10 AND n.${col}>=?))`);
        wargs.push(String(flags[f + '-from']).slice(0, 10), flags[f + '-from']);
      } else { where.push(`n.${col}>=?`); wargs.push(flags[f + '-from']); }
    }
    if (flags[f + '-to']) {
      if (f === 'due' && String(flags[f + '-to']).includes('T')) { where.push(`n.${col}<=?`); wargs.push(flags[f + '-to']); }
      else if (f === 'due') { where.push(`n.${col}<?`); wargs.push(addDaysISO(flags[f + '-to'], 1)); } // date-only upper bound includes the whole boundary day (#81)
      else { where.push(`n.${col}<=?`); wargs.push(flags[f + '-to']); }
    }
  }
  if (flags.edge) {
    const s = String(flags.edge), i = s.indexOf(':');
    const verb = i < 0 ? s : s.slice(0, i), target = i < 0 ? null : s.slice(i + 1);
    joins.push(`JOIN edges ce ON ce.from_slug=n.slug AND ce.verb=? AND ${edgeSourceLiveSQL('ce')}`);
    jargs.push(verb);
    if (target) {
      const targets = edgeTargets || [target];
      where.push(`ce.to_slug IN (${sqlSlots(targets)})`); wargs.push(...targets);
    }
  }
  if (flags.profile) {
    const eq = String(flags.profile), i = eq.indexOf('=');
    if (i < 0) die('--profile expects key=value');
    const key = eq.slice(0, i);
    if (!key || !FM_KEY_RE.test(key))
      die(`--profile key '${key}' is invalid — use a non-empty frontmatter key ([A-Za-z0-9_.-]+), then '=' and the value (e.g. --profile tier=T1)`);
    // bug #7: list-aware. json_each(profile_json, '$.key') yields the scalar value OR each
    // element of a multi-select array, so `relationship=client` matches both a scalar
    // "client" and a list ["client","vendor"] (exact-match json_extract missed the list).
    // The CLI's key=value syntax is textual (there is no typed selector), so preserve its
    // literal-string contract while also matching typed JSON scalars with the same text:
    // count=123 matches both "123" and 123; enabled=true matches both "true" and true.
    // Type branches matter: blanket CAST would turn JSON booleans into 1/0 and would make
    // malformed numeric prefixes compare equal. Parse only a complete finite JSON number.
    const needle = eq.slice(i + 1);
    const clauses = [`(pv.type='text' AND pv.value=?)`];
    const values = [needle];
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(needle)) {
      const numeric = analyzeJsonNumberLexeme(needle);
      if (numeric.ok) {
        // json_each exposes both JSON -0 and 0 as the same SQL numeric zero. Compare
        // the canonical JSON token at the leaf path instead so signed zero remains an
        // authored distinction; canonicalization still makes 1e3/1.00 query 1000/1.
        clauses.push(`(pv.type IN ('integer','real') AND (n.profile_json -> pv.fullkey)=?)`);
        values.push(stringifyJsonExactNumbers(numeric.value));
      }
    }
    if (needle === 'true' || needle === 'false') clauses.push(`pv.type='${needle}'`);
    where.push(`EXISTS (SELECT 1 FROM json_each(n.profile_json, ?) pv WHERE ${clauses.join(' OR ')})`);
    // Profile keys are flat and may legitimately contain dots/hyphens. Quote the path
    // member so `a.b` addresses the literal key, not a fictitious nested object.
    wargs.push('$.' + JSON.stringify(key), ...values);
  }
  return { sql: `SELECT ${selectCols} FROM nodes n ${joins.join(' ')} WHERE ${where.join(' AND ')}`, args: [...jargs, ...wargs] };
}

function projectRow(db, r, fields, relMaps) {
  return fields.map(f => {
    if (f === 'slug') return r.slug;
    // note: get --field date_created reads the file for bitemporal exactness; list projection stays index-only.
    if (f === 'date_created') return r.created ?? '';
    if (f === 'important') return r.important ? 'true' : 'false';
    if (['description', 'occurred', 'due', 'status', 'entity', 'class', 'created'].includes(f)) return r[f] ?? '';
    if (f.startsWith('profile.')) {
      try {
        const p = JSON.parse(r.profile_json), value = ownValue(p, f.slice(8));
        return value == null ? '' : typeof value === 'object' ? stringifyJsonExactNumbers(value) : Object.is(value, -0) ? '-0' : String(value);
      }
      catch { return ''; }
    }
    if (f.startsWith('rel.')) {
      // bug #12: use the pre-batched map when the caller built one (list --fields), else
      // fall back to a per-row query (single-row callers).
      if (relMaps && relMaps[f]) return (relMaps[f].get(r.slug) || []).join(';');
      return db.prepare(`SELECT e.to_slug FROM edges e WHERE e.from_slug=? AND e.verb=? AND ${edgeSourceLiveSQL('e')} ORDER BY e.rowid`).all(r.slug, f.slice(4)).map(e => e.to_slug).join(';');
    }
    return '';
  }).map(tsvCell);
}

const LIST_PROJECTABLE_FIELDS = new Set(['slug', 'description', 'occurred', 'due', 'status',
  'entity', 'class', 'created', 'date_created', 'important']);

function assertListProjectionField(field) {
  if (LIST_PROJECTABLE_FIELDS.has(field)) return;
  if (field.startsWith('profile.') && FM_KEY_RE.test(field.slice(8))) return;
  if (field.startsWith('rel.') && FM_KEY_RE.test(field.slice(4)) && !RESERVED_REL_VERBS.has(field.slice(4))) return;
  die(`list --fields has unknown/unprojectable field '${field}' — use slug,description,occurred,due,status,entity,class,date_created,important,profile.<key>,rel.<verb>`);
}

function assertGetFieldPath(field) {
  field = String(field);
  if (field.startsWith('profile.')) {
    const key = field.slice(8);
    if (key && FM_KEY_RE.test(key)) return;
    die(`get --field '${field}' is not projectable — use profile or profile.<key>`);
  }
  const bits = String(field).split('.');
  const root = bits[0];
  if (root === 'slug' && bits.length === 1) return;
  if (!KNOWN_FM_FIELDS.has(root))
    die(`get --field has unknown field '${field}' — fields are the authored §2 frontmatter names (plus slug and profile.<key>)`);
  if (root === 'profile') {
    if (bits.length === 1) return;
    die(`get --field '${field}' is not projectable — use profile or profile.<key>`);
  }
  if (root === 'focus')
    die(`get --field '${field}' is retired — focus is membership now (in_context → focus); the why lives on the edge: brain relations <slug>`);
  if (bits.length !== 1)
    die(`get --field '${field}' is not projectable — '${root}' is not a nested field`);
}

// bug #12: resolve every rel.<verb> projection for the shown page with ONE prepared
// statement per verb, reused across the page's rows, instead of preparing a fresh
// correlated subquery per row. Per-row EQUALITY on from_slug drives idx_edges_from
// (from_slug, verb) — an `IN (…)` batch mis-plans to idx_edges_verb and SCANS every edge
// of that verb corpus-wide (250k `was_with` at 500k), which is far slower. Measured on the
// XL pen: the rel projection drops from a ~470ms add (551ms total) to a low-single-digit
// add over the base list query.
function batchRelMaps(db, rows, fields) {
  const relMaps = {};
  const relFields = fields.filter(f => f.startsWith('rel.'));
  if (!relFields.length || !rows.length) return relMaps;
  for (const f of relFields) {
    const verb = f.slice(4), m = new Map();
    const st = db.prepare(`SELECT e.to_slug FROM edges e WHERE e.from_slug=? AND e.verb=? AND ${edgeSourceLiveSQL('e')} ORDER BY e.rowid`);
    for (const r of rows) m.set(r.slug, st.all(r.slug, verb).map(e => e.to_slug));
    relMaps[f] = m;
  }
  return relMaps;
}

function mkBuffer() {
  const buf = [];
  return { out: s => buf.push(String(s)), raw: s => buf.push(String(s)), text: () => buf.join('\n') };
}

function cmdNow(ctx, _args, _flags) { const { out } = ctx.io; out(todayStamp(ctx)); }

function cmdGet(ctx, slugs, flags) {
    const { out } = ctx.io; const { root } = ctx;
    assertExclusiveModes('get', flags, ['field', 'body', 'raw']);
    if (!slugs.length) die(`get requires a slug (brain get <slug> [<slug>...])`);
    // The recovery/inspection channel is deliberately registry- and index-free. A raw
    // argument is a canonical filename, never an alias: resolving an ambiguous alias is
    // exactly what an operator inspecting a damaged registry must be able to avoid.
    const registryUnsafe = !!(ctx.regState.parseError || ctx.regState.futureFormat != null || ctx.regState.rewriteProblems?.length);
    if (flags.raw && registryUnsafe) {
      for (const slug of slugs) { assertReadSlug(slug, 'get slug'); (ctx.io.raw || out)(readSourceFileOrDie(root, slug)); }
      return;
    }
    const db = requireDb(ctx);
    installCurrentSourceConflictGuard(ctx, db);
    const multi = slugs.length > 1;
    for (const raw of slugs) {
      assertReadSlug(raw, 'get slug');
      const slug = resolveSlug(ctx.reg, raw, db); // aliases resolve at QUERY time (no file rewrite); real slug wins
      const r = db.prepare(`SELECT * FROM nodes WHERE slug=?`).get(slug);
      if (!r) {
        if (multi) { console.error(`error: ${missingNodeMsg(ctx, db, slug)}`); process.exitCode = 1; continue; } // F-25
        die(missingNodeMsg(ctx, db, slug)); // F-25
      }
      if (flags.raw) { (ctx.io.raw || out)(readSourceFileOrDie(root, slug)); continue; }
      if (Object.prototype.hasOwnProperty.call(flags, 'field')) {
        // BARE value only (H2/Opus-B N2): no collision warning, no hash line — the
        // eval harness / scripts consume this verbatim.
        assertGetFieldPath(flags.field);
        // Source Markdown is truth. Projecting from the index here used to serve a
        // deleted node and stale pre-edit values with exit 0, contradicting plain get.
        const text = readSourceFileOrDie(root, slug);
        if (hasConflictMarkers(conflictRegion(text)))
          die(`'${slug}' carries unmerged conflict markers — unresolved VCS conflict requires repair; refusing --field projection rather than serving one unresolved branch. Resolve the source conflict, then: brain sync --slug ${slug}`);
        const fileHash = contentHash(text);
        if (r.content_hash && r.content_hash !== fileHash)
          console.error(`⚠ index is stale for '${slug}' (file changed since last index) — projecting --field from the current source; run: brain sync`);
        const parsed = parseFrontmatter(text);
        if (!parsed) die(`'${slug}' has no authored frontmatter fields — use brain get ${slug} --body for a body-only node`);
        const duplicateErrors = (parsed.errors || []).filter(e => /duplicate .*key|duplicate top-level key/.test(e));
        if (duplicateErrors.length)
          die(`'${slug}' has ambiguous duplicate frontmatter keys — refusing --field projection rather than choosing one authored value: ${duplicateErrors.join(' | ')}. Fix the file by hand, then: brain sync --slug ${slug}`);
        // class is a public derived field when omitted from single-tense authored
        // frontmatter; keep that contract while every authored value still comes from
        // current source truth. An explicit authored class wins (and remains inspectable).
        const src = { ...parsed.fm, slug, class: deriveClass(ctx.reg, parsed.fm) };
        const v = flags.field.startsWith('profile.')
          ? ownValue(src.profile, flags.field.slice(8))
          : flags.field.split('.').reduce((o, k) => o != null ? ownValue(o, k) : undefined, src);
        const val = typeof v === 'object' && v !== null ? stringifyJsonExactNumbers(v) : Object.is(v, -0) ? '-0' : String(v ?? '');
        out(multi ? `${slug}\t${tsvCell(val)}` : val);
        continue;
      }
      // C-9: --raw is the MACHINE channel — the exact source bytes, ZERO diagnostics
      // (no collision warning, no hash line, no body-size hint). The eval readback and
      // any script consume this verbatim; a diagnostic can never masquerade as content,
      // and an authored body line that happens to start with '[hash:' / '[body:' survives.
      // C-9: EXACT bytes — write straight to stdout so console.log's trailing '\n' can't
      // drift a byte-exact consumer (a file with no final newline would otherwise gain one).
      // Embedded (buffer) callers fall back to out(); nothing embeds --raw.
      warnCollisions(db, r, out);
      const openAsk = openAsksFor(root, slug)[0]; // ask-ledger §1.6: surface an unanswered blocking ask on the node
      if (openAsk) out(`  open ask: ${openAsk.id} (${openAsk.kind}) — ${openAsk.question}`);
      // §9.6 output contract: bodyless node → whole file. With a body → frontmatter +
      // a size hint by default; --body opts into the distilled prose. The hash line
      // (H2) is the CAS base for a cross-turn write: `... --base-hash <hash>`.
      const text = readSourceFileOrDie(root, slug);
      if (hasConflictMarkers(conflictRegion(text)))
        die(`'${slug}' carries unmerged conflict markers — unresolved VCS conflict requires repair; refusing rendered get rather than showing one unresolved branch. Inspect exact bytes: brain get ${slug} --raw; resolve the source conflict, then: brain sync --slug ${slug}`);
      const parsed = parseFrontmatter(text);
      const body = parsed?.body ?? '';
      const fileHash = contentHash(text); // bug #82
      if (r.content_hash && r.content_hash !== fileHash)
        console.error(`⚠ index is stale for '${slug}' (file changed since last index) — run: brain sync`);
      const hashLine = `  [hash: ${fileHash.slice(0, 8)} — CAS base: brain set ${slug} … --base-hash ${fileHash.slice(0, 8)}]`;
      if (!body.trim() || flags.body) { out(text); out(hashLine); continue; } // C-2: body is exact bytes now; whitespace-only still displays as bodyless
      out(text.slice(0, parsed.bodyStart)); // frontmatter block through the closing ---
      out(`  [body: ${body.length} chars — brain get ${slug} --body · searchable via search --deep]`);
      out(hashLine);
    }
}

function cmdPeek(ctx, [rawSlug], _flags) {
    const { out } = ctx.io;
    const db = requireDb(ctx);
    if (!rawSlug) die(`peek requires a slug`);
    assertReadSlug(rawSlug, 'peek slug');
    const slug = resolveSlug(ctx.reg, rawSlug, db);
    installCurrentSourceConflictGuard(ctx, db);
    if (!currentSourceIsConflictFree(db, slug))
      die(`'${slug}' has unresolved VCS conflict markers — unresolved VCS conflict requires repair; refusing peek rather than serving stale indexed truth. Resolve the source conflict, then: brain sync --slug ${slug}`);
    const r = db.prepare(`SELECT n.* FROM nodes n WHERE n.slug=? AND ${currentSourceConflictFreeSQL('n')}`).get(slug);
    if (!r) die(missingNodeMsg(ctx, db, slug)); // F-25
    buildSlugAliasTemp(ctx, db);
    warnCollisions(db, r, out);
    out(row(r));
    // A5: peek stays index-only by design; get hashes the file bytes it prints.
    out(`  hash: ${(r.content_hash || '').slice(0, 8)}  (CAS base for a cross-turn write)`);
    const prof = JSON.parse(r.profile_json);
    for (const [k, v] of Object.entries(prof)) out(`  ${k}: ${Array.isArray(v) ? v.map(x => Object.is(x, -0) ? '-0' : String(x)).join(', ') : Object.is(v, -0) ? '-0' : v}`);
    const ups = db.prepare(`SELECT COUNT(*) c, MAX(y) latest FROM updates WHERE card_slug=?`).get(slug);
    if (ups.c) out(`  updated: ${ups.c} entries (latest ${ups.latest}) — full history: brain relations ${slug}`);
    if (r.class === 'future' && isOpen(r.status)) {
      const bl = blockersOf(db, slug);
      out(bl.length ? `  ⛔ blocked by: ${bl.join(', ')}` : `  ▶ workable (nothing blocks it)`);
    }
}

function cmdList(ctx, _args, flags) {
    const { out } = ctx.io;
    assertExclusiveModes('list', flags, ['count', 'fields']);
    if (flags.count && Object.prototype.hasOwnProperty.call(flags, 'limit'))
      die(`list --count cannot combine with --limit — an aggregate count has no limited page`);
    checkCohortFlags('list', flags); // bug #3: an unknown filter (e.g. --important's old silent-ignore) errors, never returns ALL
    assertReadDateFlags(flags); // F-16
    assertCohortFilterShapes(flags, ctx.reg);
    const db = requireDb(ctx);
    installCurrentSourceConflictGuard(ctx, db);
    const act = activeContexts(ctx, db); // desks first; suspended conflicts already warned
    // Explicit reads are never shaded — --entity skill|tool asks for the equipment.
    const shadeNames = ['skill', 'tool'].includes(flags.entity) ? null : act.names;
    const norm = normalizeEdgeFilter(ctx, db, flags); // bug #64: verb/slug aliases resolve before the cohort query binds.
    flags = norm.flags;
    const limit = flags.limit ?? null;
    // context-retrieval §3 disclosure: ONE extra COUNT per shaded read path — count only,
    // never rows (hidden = matched-but-shaded, the exact inverse predicate).
    const hiddenDisclosure = () => {
      if (!shadeNames) return null;
      const q = listQuery(flags, 'COUNT(DISTINCT n.slug) c', norm.edgeTargets, { shadeNames, invertShade: true });
      const c = db.prepare(q.sql).get(...q.args).c;
      return c ? shadeDisclosureLine(c) : null;
    };
    // record-status-revert change 5 (amended): an empty default cohort may be hiding
    // real rows in the archive (the only default-hidden status) — re-run the same
    // filters with the archive door opened and disclose the count. Null when
    // --all/--status already lift it. SHADED: --all is not an unshading path.
    const excludedDisclosure = () => {
      if (flags.all || flags.status) return null;
      const q = listQuery({ ...flags, all: true }, 'COUNT(DISTINCT n.slug) c', norm.edgeTargets, { shadeNames });
      const c = db.prepare(q.sql).get(...q.args).c;
      return c ? `${c} hit(s) in the archive (--all to include)` : null;
    };
    if (flags.count) {
      const { sql, args } = listQuery(flags, 'COUNT(DISTINCT n.slug) c', norm.edgeTargets, { shadeNames });
      const c = db.prepare(sql).get(...args).c;
      out(String(c));
      if (c === 0) console.error(zeroFacetHint(db, flags)); // hint to STDERR — stdout stays a bare number for scripts
      if (c === 0) { const d = excludedDisclosure(); if (d) console.error(d); }
      { const h = hiddenDisclosure(); if (h) console.error(h); }
      return;
    }
    const cnt = listQuery(flags, 'COUNT(DISTINCT n.slug) c', norm.edgeTargets, { shadeNames });
    const total = db.prepare(cnt.sql).get(...cnt.args).c;
    const CAP = 60;
    const cap = limit ?? (flags.all ? null : CAP);
    const { sql, args } = listQuery(flags, 'DISTINCT n.*', norm.edgeTargets, { shadeNames });
    const rows = db.prepare(sql + ` ORDER BY ${contextTierSQL(act.names)}, ${votesOrderSQL(ctx)}n.slug` + (cap != null ? ` LIMIT ${cap}` : '')).all(...args);
    const capped = cap != null && total > rows.length;
    const hint = capped ? `narrow with filters, --limit N, or --all` : null;
    if (flags.fields) {
      const fields = String(flags.fields).split(',').map(s => s.trim()).filter(Boolean);
      if (!fields.length) die(`list --fields needs at least one projectable field`);
      fields.forEach(assertListProjectionField);
      out(`list${norm.edgeAliasLabel}: ${shownSuffix(total, rows.length, hint)} — fields ${fields.join(',')}`);
      const relMaps = batchRelMaps(db, rows, fields); // bug #12: one query per rel.<verb>, not per row
      rows.forEach(r => out(projectRow(db, r, fields, relMaps).join('\t')));
      if (total === 0) {
        out('  ' + zeroFacetHint(db, flags));
        const d = excludedDisclosure(); if (d) out('  ' + d);
      }
      { const h = hiddenDisclosure(); if (h) out(h); }
      return;
    }
    printRows(rows, `list${norm.edgeAliasLabel}`, total, hint, out);
    if (total === 0) {
      out('  ' + zeroFacetHint(db, flags));
      const d = excludedDisclosure(); if (d) out('  ' + d);
    }
    { const h = hiddenDisclosure(); if (h) out(h); }
}

function searchNarrowers(ctx, db, flags) {
    assertExclusiveModes('search scope', flags, ['for', 'within']);
    assertReadDateFlags(flags); // F-16: --from/--to validated before they bind lexically
    const cond = [], args = [];
    if (flags.entity) { cond.push('n.entity=?'); args.push(flags.entity); }
    if (flags.class) { cond.push('n.class=?'); args.push(flags.class); }
    if (flags.from) { cond.push(`COALESCE(n.occurred,n.due,n.created)>=?`); args.push(flags.from); }
    if (flags.to) { cond.push(`COALESCE(n.occurred,n.due,n.created)<?`); args.push(addDaysISO(flags.to, 1)); } // bug #81
    // bug #22: include the anchor node itself, not only its inbound-edge neighborhood.
    // F-15: BOTH directions — spec §2 authors an edge wherever it reads naturally, so a
    // neighborhood scope must union nodes pointing AT the anchor and nodes the anchor
    // points AT (both indexed: idx_edges_to / idx_edges_from — still a narrow walk).
    const rawFor = flags.for || null, rawWithin = flags.within || null;
    if (rawFor) assertReadSlug(rawFor, 'search --for');
    if (rawWithin) assertReadSlug(rawWithin, 'search --within');
    const forSlug = rawFor ? resolveSlug(ctx.reg, rawFor, db) : null; // bug #64
    const withinSlug = rawWithin ? resolveSlug(ctx.reg, rawWithin, db) : null; // bug #64
    if (forSlug || withinSlug) {
      const anchor = forSlug || withinSlug;
      if (!currentSourceIsConflictFree(db, anchor))
        die(`'${anchor}' has unresolved VCS conflict markers — unresolved VCS conflict requires repair; refusing scoped search rather than traversing stale indexed edges. Resolve the source conflict, then: brain sync --slug ${anchor}`);
      const names = slugReadNames(ctx, ctx.reg, anchor, db), slots = sqlSlots(names);
      cond.push(`(n.slug IN (${slots}) OR n.slug IN (SELECT se.from_slug FROM edges se WHERE se.to_slug IN (${slots}) AND ${edgeSourceLiveSQL('se')}) OR n.slug IN (SELECT se.to_slug FROM edges se WHERE se.from_slug IN (${slots}) AND ${edgeSourceLiveSQL('se')}))`);
      args.push(...names, ...names, ...names);
    }
    const scopeLabel = [flags.entity && `--entity ${flags.entity}`, flags.class && `--class ${flags.class}`,
      rawFor && `--for ${forSlug}${aliasSuffix(rawFor, forSlug)}`, rawWithin && `--within ${withinSlug}${aliasSuffix(rawWithin, withinSlug)}`,
      flags.from && `--from ${flags.from}`, flags.to && `--to ${flags.to}`].filter(Boolean).join(' ');
    // Search can surface an edge why through the denormalized FTS row, so its author
    // needs the same strong current-source/indexability test as semantic edge consumers.
    // This excludes NUL/structured quarantine, conflicts, missing bytes, and every other
    // non-live author from both shallow and deep paths without waiting for sync.
    const statusBase = (flags.all ? '' : ' AND ' + defaultCohortSQL('n'))
      + ` AND ${currentSourceLiveSQL('n')}`;
    // context-retrieval §3: tier + capability shading ride the retrieval statements.
    // --entity skill|tool is an explicit ask — never shaded. --all is NOT an unshading path.
    const act = activeContexts(ctx, db);
    const shadeNames = ['skill', 'tool'].includes(flags.entity) ? null : act.names;
    const shadeSQL = shadeNames ? ` AND ${capabilityShadeSQL(shadeNames)}` : '';
    const hiddenStatusSQL = shadeNames ? statusBase + ` AND ${capabilityHiddenSQL(shadeNames)}` : null;
    return { cond, args, scopeLabel, statusSQL: statusBase + shadeSQL, statusBase, shadeSQL, hiddenStatusSQL, tierNames: act.names };
}

// C-4/C-5: the shared query grammar. Embedded double quotes mark a PHRASE the user typed
// (brain search '"machine learning"') — preserved as a real FTS phrase, never flattened
// into unordered AND terms. Bare words stay AND terms. Each token carries its normalized
// variant (C-3) OR'd in, so one exact hit can no longer suppress an equivalent spelling.
// Symbol-only, mixed lexical/symbol, and singleton-CJK requirements are also retained as
// literal predicates below; unicode61/bigram tokenization must never silently erase them.
function parseQueryTokens(raw) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(raw))) {
    if (m[1] != null) { const t = m[1].trim(); if (t) tokens.push({ text: t, phrase: true }); }
    else tokens.push({ text: m[2], phrase: false });
  }
  return tokens;
}

const ftsQuote = (s) => '"' + String(s).replace(/"/g, '""') + '"';

const hasLexical = (s) => /[\p{L}\p{N}]/u.test(s);

const isSingletonCjk = (s) => [...String(s)].length === 1 &&
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(String(s));

// Punctuation/symbol bytes inside a lexical token are authored requirements, not FTS
// decoration: unicode61 tokenization would otherwise turn #launch/C++/@Acme/launch🚀
// into launch/C/Acme/launch. Grouped amounts are the deliberate exception — their
// punctuation is an equivalence spelling handled by searchNormalize.
function needsLiteralConstraint(t) {
  if (!hasLexical(t.text) || isSingletonCjk(t.text)) return true;
  // Normal prose punctuation at a bare token boundary is query punctuation, not an
  // authored symbol requirement (`launch,` should still search launch). Inside quotes it
  // remains literal; semantic prefixes/suffixes such as #/@/+ are never stripped.
  const probe = t.phrase ? t.text : t.text.replace(/^[.,;:!?]+|[.,;:!?]+$/g, '');
  // Valid grouped-thousands punctuation is an equivalence spelling wherever it occurs,
  // not only when the whole token is the amount. Mask every valid occurrence before
  // asking whether some OTHER authored symbol still needs literal confirmation.
  return /[^\p{L}\p{N}\p{M}\s]/u.test(foldGroupedThousands(probe));
}

function termVariants(text) {
  const norm = searchNormalize(text);
  // A valid grouped amount must travel through the normalized shadow only. Feeding the
  // raw `$13,377` spelling to unicode61 produces the FTS phrase `13 377`, which also
  // matches authored `13 377` / `13-377` text that is NOT amount-equivalent. Every
  // indexed surface has the same normalized shadow, so omitting only this lossy raw
  // tokenization preserves grouped/plain recall while keeping the boundary symmetric.
  if (foldGroupedThousands(text) !== String(text)) return norm.trim() ? [norm] : [];
  const vs = [text];
  if (norm.trim() && norm !== text.toLowerCase()) vs.push(norm);
  return [...new Set(vs)];
}

function buildMatchExpr(tokens) {
  return tokens.map(t => {
    const vs = termVariants(t.text).map(ftsQuote);
    return vs.length > 1 ? `(${vs.join(' OR ')})` : vs[0];
  }).join(' ');
}

const likePattern = (s) => '%' + String(s).replace(/[\\%_]/g, (c) => '\\' + c) + '%';

// The four advertised search surfaces: description, slug, authored profile LEAF values,
// and edge why-texts. Never LIKE profile_json itself: its keys, quotes, colons and braces
// are serialization syntax, not words/symbols the user authored as a value.
const LITERAL_SURFACE_SQL = `(n.description LIKE ? ESCAPE '\\' OR n.slug LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM json_tree(n.profile_json) lp
        WHERE lp.type NOT IN ('object','array') AND CAST(lp.atom AS TEXT) LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM edges le WHERE le.from_slug=n.slug AND ${edgeSourceLiveSQL('le')} AND le.why LIKE ? ESCAPE '\\'))`;

// A mixed lexical+symbol token still needs its symbol bytes, but lexical equivalences
// inside it remain equivalences: `Soren 🚀` must meet `Søren 🚀`, and `$13,377 🚀` must
// meet `13377 🚀`. The v9 normalized columns preserve symbols while folding letters and
// grouped numbers. Their per-value sentinel prevents a phrase spanning two whys/profile
// values; the raw arm retains exact nested-profile leaf behavior.
const NORMALIZED_LITERAL_SURFACE_SQL = `(fts.ndesc LIKE ? ESCAPE '\\' OR fts.nslug LIKE ? ESCAPE '\\'
      OR fts.nprof LIKE ? ESCAPE '\\' OR fts.nwhys LIKE ? ESCAPE '\\')`;
const EQUIVALENT_LITERAL_SURFACE_SQL = `(${LITERAL_SURFACE_SQL} OR ${NORMALIZED_LITERAL_SURFACE_SQL})`;
// Boundary-bearing queries cannot trust the joined normalized columns (the boundary is
// also engine metadata there). Normalize EACH raw authored value independently instead;
// this keeps Søren<U+E000>↔Soren<U+E000> equivalence without ever matching a separator
// injected between two profile/why values.
const AUTHORED_EQUIVALENT_LITERAL_SURFACE_SQL = `(
      n.description LIKE ? ESCAPE '\\' OR brain_search_normalize(n.description) LIKE ? ESCAPE '\\'
      OR n.slug LIKE ? ESCAPE '\\' OR brain_search_normalize(n.slug) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM json_tree(n.profile_json) lp WHERE lp.type NOT IN ('object','array')
        AND (CAST(lp.atom AS TEXT) LIKE ? ESCAPE '\\' OR brain_search_normalize(CAST(lp.atom AS TEXT)) LIKE ? ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM edges le WHERE le.from_slug=n.slug AND ${edgeSourceLiveSQL('le')}
        AND (le.why LIKE ? ESCAPE '\\' OR brain_search_normalize(le.why) LIKE ? ESCAPE '\\')))`;

// C-5: function words dropped (with a label) on a zero-hit retry of a natural-language
// query — never silently, never on the primary pass (true AND stays the contract).
const SEARCH_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'by',
  'with', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'it', 'its',
  'this', 'that', 'these', 'those', 'my', 'our', 'your', 'his', 'her', 'their', 'and', 'or',
  'not', 'no', 'what', 'when', 'where', 'who', 'whom', 'which', 'why', 'how', 'i', 'we',
  'you', 'he', 'she', 'they', 'them', 'us', 'me']);

function cmdSearch(ctx, terms, flags) {
    const { out } = ctx.io;
    const db = requireDb(ctx);
    installCurrentSourceConflictGuard(ctx, db);
    // Registered at the read boundary (searchNormalize is declared in this section;
    // openDb lives earlier under the downward-reference discipline). Re-registering on
    // an already-open handle replaces the same deterministic implementation harmlessly.
    db.function('brain_search_normalize', { deterministic: true }, value => searchNormalize(String(value ?? '')));
    const raw = terms.join(' ').trim();
    if (!raw) die(`search needs a query (e.g. brain search "vintage tractors")`);
    const CAP = 60;
    const allTokens = parseQueryTokens(raw);
    // a non-empty query that yields NO tokens (e.g. an empty quoted phrase '""') must not
    // fall through to the token-less `1=1` path and dump the whole open corpus as "hits".
    if (!allTokens.length) die(`search '${raw}' has no searchable term (an empty quoted phrase?) — give at least one word or symbol: brain search "<words>"`);
    // A token may contribute BOTH an FTS requirement and a literal requirement. This is
    // intentionally not a lexical-vs-symbol partition: mixed/attached symbols must not
    // disappear when unicode61 extracts the token's word portion. A singleton CJK term
    // is literal-only because long CJK runs are indexed as bigrams (there is no matching
    // unigram to AND through FTS).
    const lexTokens = allTokens.filter(t => hasLexical(t.text) && !isSingletonCjk(t.text));
    const literalTokens = allTokens.filter(needsLiteralConstraint);
    const authoredTokenMatch = (value, token) => value.includes(token.text)
      || searchNormalize(value).includes(searchNormalize(token.text));
    if (flags.deep) { // §9.6: the SEPARATE body tier, gated — a narrow walk, never a sweep
      if (!hasTable(db, 'fts_body')) die(`--deep: body index not built yet (pending a reindex). Normal search already covers descriptions, edge whys, and profile values.`);
      if (!['entity', 'class', 'for', 'within', 'from', 'to', 'all'].some(k => flags[k]))
        die(`--deep needs a narrower (--entity/--class/--for <slug>/--within <slug>/--from/--to) or --all — deep body search is a narrow walk, not a sweep`);
      if (!lexTokens.length) die(`--deep needs at least one word with letters or digits — bodies index lexically`);
      const m = buildMatchExpr(lexTokens); // C-5: user-quoted phrases stay phrases in --deep too
      const { cond, args, statusSQL, hiddenStatusSQL, tierNames } = searchNarrowers(ctx, db, flags);
      const where = cond.length ? ` AND ${cond.join(' AND ')}` : '';
      // SEARCH_SEGMENT_BOUNDARY is engine metadata inside fts_body. Never confirm an
      // authored query containing that byte against the derived body column: it could
      // match the injected raw/normalized separator. Those rare tokens are confirmed
      // below against the source body's exact authored bytes instead.
      const boundaryLiterals = literalTokens.filter(t => t.text.includes(SEARCH_SEGMENT_BOUNDARY));
      const derivedLiterals = literalTokens.filter(t => !t.text.includes(SEARCH_SEGMENT_BOUNDARY));
      const deepLitSQL = derivedLiterals.map(() => ` AND fts_body.body LIKE ? ESCAPE '\\'`).join('');
      // fts_body contains the raw body and a sentinel-separated normalized shadow.
      // Confirm against the normalized spelling so equivalence survives beside a required
      // symbol; malformed groupings (4,5) and #/@/+ remain unchanged by searchNormalize.
      const deepLitArgs = derivedLiterals.map(t => likePattern(searchNormalize(t.text)));
      const authoredBody = (r) => {
        try {
          const text = fs.readFileSync(r.path, 'utf8');
          return parseFrontmatter(text)?.body ?? text;
        } catch { return null; }
      };
      let rows = [], total = 0;
      try {
        const baseSQL = `FROM fts_body JOIN nodes n ON n.rowid=fts_body.rowid
          WHERE fts_body MATCH ?${statusSQL}${where}${deepLitSQL}`;
        if (boundaryLiterals.length) {
          // Source confirmation is necessarily outside the derived FTS value, but keep
          // it streaming: a common lexical term plus a private-use token must not
          // materialize the whole corpus in memory. Count all exact matches, retain CAP.
          // Tier and votes join the ORDER BY (brain-profiles §5: context → votes →
          // rank, same as plain search), so the streamed cap retention stays
          // tier-and-vote-faithful.
          const candidates = db.prepare(`SELECT n.*, snippet(fts_body,0,'«','»','…',12) m_body ${baseSQL} ORDER BY ${contextTierSQL(tierNames)}, ${votesOrderSQL(ctx)}rank`)
            .iterate(m, ...args, ...deepLitArgs);
          for (const r of candidates) {
            const body = authoredBody(r);
            if (body == null || !boundaryLiterals.every(t => authoredTokenMatch(body, t))) continue;
            total++;
            if (rows.length < CAP) rows.push(r);
          }
        } else {
          total = db.prepare(`SELECT COUNT(*) c ${baseSQL}`).get(m, ...args, ...deepLitArgs).c;
          if (total) rows = db.prepare(`SELECT n.*, snippet(fts_body,0,'«','»','…',12) m_body ${baseSQL} ORDER BY ${contextTierSQL(tierNames)}, ${votesOrderSQL(ctx)}rank LIMIT ${CAP}`).all(m, ...args, ...deepLitArgs);
        }
      } catch (e) { die(`--deep query error: ${e.message}`); }
      out(`search --deep "${raw}": ${rows.length} body hit${rows.length === 1 ? '' : 's'}${total > rows.length ? ` (total ${total}, shown ${rows.length}; narrow with more words)` : ''}`);
      rows.forEach(r => {
        out('  ' + row(r));
        if (r.m_body?.includes('«')) {
          if (boundaryLiterals.length || String(r.m_body).includes(SEARCH_SEGMENT_BOUNDARY)) {
            const body = authoredBody(r) || '';
            const compact = body.replace(/\s+/g, ' ').trim();
            out(`      ↳ body (authored): ${compact.length > 240 ? compact.slice(0, 237) + '…' : compact}`);
          } else out(`      ↳ body: ${String(r.m_body).replaceAll(SEARCH_SEGMENT_BOUNDARY, '…')}`);
        }
      });
      if (!rows.length) out(`  (0 body matches under this narrower${!flags.all ? ` — --all includes ${[...EXCLUDED_SET].join('/')}` : ''})`);
      if (hiddenStatusSQL) { // context-retrieval §3 disclosure — count only, never rows
        try {
          const hidden = db.prepare(`SELECT COUNT(*) c FROM fts_body JOIN nodes n ON n.rowid=fts_body.rowid
            WHERE fts_body MATCH ?${hiddenStatusSQL}${where}${deepLitSQL}`).get(m, ...args, ...deepLitArgs).c;
          if (hidden) out(`  ${shadeDisclosureLine(hidden)}`);
        } catch { /* the primary query error already taught */ }
      }
      return;
    }
    // The advertised narrowers bind in PLAIN search too (bug #9a-era fix); same
    // predicates as the --deep branch; additive (no narrower ⇒ byte-identical query).
    const { cond: ncond, args: nargs, scopeLabel: scope, statusSQL, shadeSQL, hiddenStatusSQL, tierNames } = searchNarrowers(ctx, db, flags);
    const narrow = ncond.length ? ` AND ${ncond.join(' AND ')}` : '';
    // C-4: ONE unified query — every lexical token is (raw OR normalized) inside a single
    // FTS conjunction, so there is no first-success rescue ladder an exact hit could
    // suppress. Literal requirements (symbol-only OR mixed lexical/symbol tokens, plus
    // singleton CJK) become predicates over all four surfaces so AND semantics hold.
    const bareWords = lexTokens.filter(t => !t.phrase).map(t => t.text);
    const phraseBoostExpr = bareWords.length > 1
      ? buildMatchExpr([{ text: bareWords.join(' '), phrase: true }]) : null;
    const runPass = (tokens, boostExpr = null, status = statusSQL) => {
      const hasFts = tokens.length > 0;
      const FROM = hasFts ? `fts JOIN nodes n ON n.slug=fts.slug` : `nodes n`;
      // Keep provenance when the hit came through a normalized shadow. Raw snippets are
      // preferred for authored spelling; nwhys/nprof are the honest fallback for a fold
      // such as Soren→Søren (FB-34).
      const cols = (hasFts ? `n.*, snippet(fts,2,'«','»','…',10) m_whys, snippet(fts,3,'«','»','…',10) m_prof,
        snippet(fts,6,'«','»','…',10) m_nwhys, snippet(fts,7,'«','»','…',10) m_nprof` : `n.*`)
        + `, ${contextTierSQL(tierNames)} context_tier`; // carried so the substring-arm merge below can tier ACROSS the union
      const surfaceFor = t => t.text.includes(SEARCH_SEGMENT_BOUNDARY)
        ? AUTHORED_EQUIVALENT_LITERAL_SURFACE_SQL
        : hasFts ? EQUIVALENT_LITERAL_SURFACE_SQL : LITERAL_SURFACE_SQL;
      const litSQL = literalTokens.map(t => ` AND ${surfaceFor(t)}`).join('');
      const litArgs = literalTokens.flatMap(t => {
        const rawPattern = likePattern(t.text);
        const rawArgs = [rawPattern, rawPattern, rawPattern, rawPattern];
        const normPattern = likePattern(searchNormalize(t.text));
        if (t.text.includes(SEARCH_SEGMENT_BOUNDARY))
          return [rawPattern, normPattern, rawPattern, normPattern, rawPattern, normPattern, rawPattern, normPattern];
        if (!hasFts) return rawArgs;
        return [...rawArgs, normPattern, normPattern, normPattern, normPattern];
      });
      const where = `${hasFts ? 'fts MATCH ?' : '1=1'}${status}${narrow}${litSQL}`;
      const qargs = [...(hasFts ? [buildMatchExpr(tokens)] : []), ...nargs, ...litArgs];
      let total2 = 0, rows2 = [];
      try {
        total2 = db.prepare(`SELECT COUNT(*) c FROM ${FROM} WHERE ${where}`).get(...qargs).c;
        // brain-profiles §5: "relevance" includes the shipped phrase-boost — the full
        // order is tier → COALESCE(votes,0) DESC → (boost + rank), so a quoted-phrase
        // hit still wins within equal votes.
        if (total2) rows2 = db.prepare(`SELECT ${cols} FROM ${FROM} WHERE ${where}
          ORDER BY ${contextTierSQL(tierNames)}, ${votesOrderSQL(ctx)}${hasFts && boostExpr
            ? `CASE WHEN n.rowid IN (SELECT rowid FROM fts WHERE fts MATCH ?) THEN 0 ELSE 1 END, `
            : ''}${hasFts ? 'rank, ' : ''}n.slug LIMIT ${CAP}`).all(...qargs, ...(hasFts && boostExpr ? [boostExpr] : []));
      } catch { total2 = 0; rows2 = []; }
      return {
        total: total2,
        rows: rows2,
        // Reuse the exact primary membership query when the bounded substring arm is
        // unioned below. Keeping this SQL/argument pair together prevents the two arms
        // from drifting on status, scope, phrase, or literal constraints.
        slugSQL: `SELECT n.slug FROM ${FROM} WHERE ${where}`,
        slugArgs: qargs,
      };
    };
    const primary = runPass(lexTokens, phraseBoostExpr);
    let { total, rows } = primary;
    let via = 'fts';
    let unionRan = false; // the hidden-capability disclosure below mirrors the union shape
    let disclosureTokens = lexTokens; // wave-2 F10: when the reduced retry produced the printed rows, the disclosure counts from the SAME reduced token set
    // C-5/V-7 phrase boost is part of the SQL ORDER BY above, BEFORE LIMIT. A quoted
    // phrase remains a hard constraint; this boost applies only to bare-word AND terms.
    // Substring arm — a full-corpus LIKE scan, so BOUNDED: single-token queries (a
    // substring needle worth the scan) or a narrower/--all scope. Ordinary searches keep
    // the cheap zero-hit fallback. A nonzero primary is augmented only when the authored
    // query has a real normalization variant: that is the first-success trap where an
    // exact formatted spelling can suppress an embedded equivalent spelling
    // (`prefix$13,377` vs `prefix13377`). Union membership is counted exactly, primary
    // BM25 order stays first, and slugs are deduped. Covers all four advertised surfaces
    // and escapes %/_ (C-4/F-19).
    const scoped = ncond.length > 0 || !!flags.all;
    // Every bounded SINGLE-token query unions the authored/normalized substring arm,
    // even after a primary hit. An ASCII-normalized spelling (Soren, 1000) carries no
    // lexical evidence that some source used Søren or 1,000, so a heuristic based on
    // query-side variants can never be symmetric. The old five-digit shortcut therefore
    // missed both accent substrings and four-digit grouped amounts whenever an unrelated
    // exact FTS hit existed. Single-token is already the deliberate bounded scan tier;
    // correctness wins there. Scoped multi-token queries retain the variant trigger.
    const needsNormalizationUnion = allTokens.length === 1 || allTokens.some(t =>
      t.text.includes(SEARCH_SEGMENT_BOUNDARY) || termVariants(t.text).length > 1);
    // a single user-quoted phrase carries its quote bytes in `raw`; scan for the token
    // TEXT (unquoted) so the substring match can actually hit. Hoisted so the zero-result
    // excluded-by-status disclosure below can reuse the identical arm with the open-cohort
    // restriction lifted (record-status-revert change 5).
    const needle = allTokens.length === 1 ? allTokens[0].text : raw;
    const p = likePattern(needle), np = likePattern(searchNormalize(needle));
    const boundaryNeedle = needle.includes(SEARCH_SEGMENT_BOUNDARY);
    const likeWhereFor = (status) => `${boundaryNeedle ? AUTHORED_EQUIVALENT_LITERAL_SURFACE_SQL : EQUIVALENT_LITERAL_SURFACE_SQL}${status}${narrow}`;
    const likeArgs = [...(boundaryNeedle
      ? [p, np, p, np, p, np, p, np]
      : [p, p, p, p, np, np, np, np]), ...nargs];
    if ((allTokens.length === 1 || scoped) && (!total || needsNormalizationUnion)) {
      unionRan = true;
      const likeWhere = likeWhereFor(statusSQL);
      const likeSlugSQL = `SELECT n.slug FROM fts JOIN nodes n ON n.slug=fts.slug WHERE ${likeWhere}`;
      const primaryTotal = total;
      // UNION (not UNION ALL) is the source of truth for the displayed total. When the
      // primary tier has room under CAP, append only substring-only rows; the nested
      // primary query applies the identical phrase/literal/scope contract used above.
      total = db.prepare(`SELECT COUNT(*) c FROM (${primary.slugSQL} UNION ${likeSlugSQL})`)
        .get(...primary.slugArgs, ...likeArgs).c;
      // The tier must bind across BOTH arms of the union (focus-ranking change 3: a
      // neighborhood hit is never crowded off a capped page): fetch substring-only rows
      // even when the primary filled the CAP, then stable-merge by tier — primary BM25
      // order stays first WITHIN each tier, extras follow in slug order. A corpus with
      // no focused project is all tier 2, so the merge is order-preserving there.
      const extra = db.prepare(`SELECT n.*, ${contextTierSQL(tierNames)} context_tier FROM fts JOIN nodes n ON n.slug=fts.slug
        WHERE ${likeWhere} AND n.slug NOT IN (${primary.slugSQL})
        ORDER BY ${contextTierSQL(tierNames)}, ${votesOrderSQL(ctx)}n.slug LIMIT ${CAP}`).all(...likeArgs, ...primary.slugArgs);
      // the JS merge carries tier THEN votes across the union (stable within: primary
      // BM25 order first, extras in their fetched order) — brain-profiles §5 amendment.
      const voteKey = (r) => ctx.votesEnabled === false ? 0 : -(r.votes ?? 0);
      if (extra.length) rows = [...rows, ...extra].sort((a, b) =>
        ((a.context_tier ?? 1) - (b.context_tier ?? 1)) || (voteKey(a) - voteKey(b))).slice(0, CAP);
      if (total > primaryTotal) via = primaryTotal ? 'fts+like' : 'like';
    }
    const capped = total > rows.length;
    out(`search "${raw}"${scope ? ' ' + scope : ''}: ${shownSuffix(total, rows.length, capped ? `narrow with more words / --entity / or --all` : null)}${via === 'like' ? ' [substring match]' : via === 'fts+like' ? ' [includes substring matches]' : ''}`);
    rows.forEach(r => {
      out('  ' + row(r));
      const cleanSnippet = (s) => String(s).replaceAll(SEARCH_SEGMENT_BOUNDARY, '…');
      const boundaryTokens = literalTokens.filter(t => t.text.includes(SEARCH_SEGMENT_BOUNDARY));
      const whySnippet = r.m_whys?.includes('«') ? r.m_whys : r.m_nwhys?.includes('«') ? r.m_nwhys : null;
      const profSnippet = r.m_prof?.includes('«') ? r.m_prof : r.m_nprof?.includes('«') ? r.m_nprof : null;
      const whyNeedsSource = boundaryTokens.length || String(whySnippet || '').includes(SEARCH_SEGMENT_BOUNDARY);
      const profNeedsSource = boundaryTokens.length || String(profSnippet || '').includes(SEARCH_SEGMENT_BOUNDARY);
      const sourceTokens = boundaryTokens.length ? boundaryTokens : allTokens;
      const matchesSource = value => sourceTokens.some(t => authoredTokenMatch(String(value), t));
      if (whyNeedsSource) {
        const why = db.prepare(`SELECT e.why FROM edges e WHERE e.from_slug=? AND e.why IS NOT NULL AND ${edgeSourceLiveSQL('e')}`).all(r.slug).map(x => x.why).find(matchesSource);
        if (why != null) out(`      ↳ matched why (authored): ${why}`);
      } else if (r.m_whys?.includes('«')) out(`      ↳ matched why: ${cleanSnippet(r.m_whys)}`);
      else if (r.m_nwhys?.includes('«')) out(`      ↳ matched why (normalized): ${cleanSnippet(r.m_nwhys)}`);
      if (profNeedsSource) {
        let prof = null;
        try {
          const values = Object.values(JSON.parse(r.profile_json || '{}')).flatMap(v => Array.isArray(v) ? v : [v]);
          prof = values.find(v => v != null && matchesSource(v)) ?? null;
        } catch { /* malformed JSON is quarantined before search */ }
        if (prof != null) out(`      ↳ matched profile value (authored): ${String(prof)}`);
      } else if (r.m_prof?.includes('«')) out(`      ↳ matched profile value: ${cleanSnippet(r.m_prof)}`);
      else if (r.m_nprof?.includes('«')) out(`      ↳ matched profile value (normalized): ${cleanSnippet(r.m_nprof)}`);
    });
    // same-display-name disambiguation (run-5: ~4.3 people/name at 50k; Haiku REFUSED
    // rather than resolving one). Group hits sharing entity+profile.name and invite
    // "which one?" — warnCollisions style, additive (fires only when ≥2 hits collide).
    if (rows.length) {
      const nameGroups = new Map();
      for (const r of rows) {
        let nm; try { nm = JSON.parse(r.profile_json || '{}').name; } catch { nm = null; }
        if (!nm) continue;
        const k = `${r.entity}\t${nm}`;
        if (!nameGroups.has(k)) nameGroups.set(k, []);
        nameGroups.get(k).push(r);
      }
      for (const [k, rs] of nameGroups) {
        if (rs.length < 2) continue;
        const [entity, nm] = k.split('\t');
        out(`  ⚠ ${rs.length} ${entity}s named "${nm}" among these hits — which one? distinguish:`);
        rs.slice(0, 8).forEach(r => out(`      ${r.slug} — ${r.description}`));
        if (rs.length > 8) out(`      …and ${rs.length - 8} more`);
      }
    }
    if (!total) {
      out('  (0 results)');
      // record-status-revert change 5 (amended): a zero result under the default cohort
      // may be hiding real matches in the archive (the only default-hidden status).
      // Re-run the SAME match with the archive door opened and disclose the count — a
      // silent nothing is a wrong answer.
      if (!flags.all) {
        // SHADED: the archive count must not advertise hidden capability rows behind
        // --all, which is not an unshading path (context-retrieval §3).
        const liftedSQL = ` AND ${currentSourceLiveSQL('n')}${shadeSQL}`;
        const lifted = runPass(lexTokens, null, liftedSQL);
        let hidden = lifted.total;
        if (allTokens.length === 1 || scoped) {
          try {
            hidden = db.prepare(`SELECT COUNT(*) c FROM (${lifted.slugSQL} UNION SELECT n.slug FROM fts JOIN nodes n ON n.slug=fts.slug WHERE ${likeWhereFor(liftedSQL)})`)
              .get(...lifted.slugArgs, ...likeArgs).c;
          } catch { /* keep the primary-pass count */ }
        }
        if (hidden) out(`  ${hidden} hit(s) in the archive (--all to include)`);
      }
      // zero-hit ladder: word-form hints + a LABELED reduced-query retry (C-5). Probes run
      // UNDER THE SAME narrowers (bug #11), so a term that is ALSO 0 in this scope is not
      // suggested (killed the renewal↔renewals dead-loop on --entity-scoped searches).
      const probe = (v) => { try { return db.prepare(`SELECT COUNT(*) c FROM fts JOIN nodes n ON n.slug=fts.slug WHERE fts MATCH ?${statusSQL}${narrow}`).get(buildMatchExpr([{ text: v, phrase: false }]), ...nargs).c; } catch { return 0; } };
      const hints = [];
      for (const t of lexTokens.filter(t2 => !t2.phrase)) {
        const w = t.text;
        const v = w.endsWith('s') ? w.slice(0, -1) : w + 's';
        const n = probe(v); if (n) hints.push(`"${v}" (${n})`);
      }
      if (hints.length) out(`  nearby: ${[...new Set(hints)].slice(0, 5).join(' · ')}`);
      // C-5: the reduced-query retry — drop function words first, then terms that match
      // nothing anywhere in this scope. AND semantics hold for what remains; the header
      // above stays honest (the FULL query found 0) and the retry is explicitly labeled.
      let printedReduced = false;
      if (lexTokens.length > 1 && !literalTokens.length) {
        const nonStop = lexTokens.filter(t => t.phrase || !SEARCH_STOPWORDS.has(t.text.toLowerCase()));
        let reduced = (nonStop.length && nonStop.length < lexTokens.length) ? nonStop : lexTokens;
        let pass = reduced !== lexTokens ? runPass(reduced) : { total: 0, rows: [] };
        if (!pass.total) {
          const hitTerms = reduced.filter(t => probe(t.text) > 0);
          if (hitTerms.length && hitTerms.length < reduced.length) { reduced = hitTerms; pass = runPass(reduced); }
        }
        if (pass.total) {
          const kept = new Set(reduced);
          const dropped = lexTokens.filter(t => !kept.has(t)).map(t => t.text);
          out(`  reduced query "${reduced.map(t => t.text).join(' ')}" (dropped: ${dropped.join(', ')}): ${shownSuffix(pass.total, Math.min(pass.rows.length, 10), null)}`);
          pass.rows.slice(0, 10).forEach(r => out('  ' + row(r)));
          printedReduced = true;
          disclosureTokens = reduced; // F10: the printed rows came from THIS token set
        }
      }
      if (!hints.length && !printedReduced) out(`  hint: try fewer or different words`);
    }
    if (hiddenStatusSQL) { // context-retrieval §3 disclosure — count only, never rows
      try {
        // F10: hidden capabilities are counted from the token set that produced the
        // printed rows — the reduced set when the reduced retry printed. The union arm
        // rides only the full-query shape (it never ran for a reduced print).
        const hp = runPass(disclosureTokens, null, hiddenStatusSQL);
        let hidden = hp.total;
        if (unionRan && disclosureTokens === lexTokens)
          hidden = db.prepare(`SELECT COUNT(*) c FROM (${hp.slugSQL} UNION SELECT n.slug FROM fts JOIN nodes n ON n.slug=fts.slug WHERE ${likeWhereFor(hiddenStatusSQL)})`)
            .get(...hp.slugArgs, ...likeArgs).c;
        if (hidden) out(`  ${shadeDisclosureLine(hidden)}`);
      } catch { /* disclosure is additive; the primary result already printed */ }
    }
}

function cmdRelations(ctx, [rawSlug], flags) {
    const { out } = ctx.io;
    const db = requireDb(ctx);
    if (!rawSlug) die(`relations requires a slug`);
    assertReadSlug(rawSlug, 'relations slug');
    installCurrentSourceConflictGuard(ctx, db);
    buildSlugAliasTemp(ctx, db);
    const slug = resolveSlug(ctx.reg, rawSlug, db);           // alias → canonical at query time; real slug wins
    const slugNames = slugReadNames(ctx, ctx.reg, slug, db);
    const slugSlots = sqlSlots(slugNames);
    // An inbound edge is authored by its from-node. If that source became conflicted
    // after indexing, the edge/why is also unresolved branch material and must not leak
    // through another healthy node's relations view. Retained pre-rename endpoints fold
    // through the alias table before the current-source check; a genuinely dangling
    // source has no live scalar row to quarantine and retains the existing doctor-visible
    // edge contract.
    const edgeSourceJoin = `LEFT JOIN _slug_aliases es_alias ON es_alias.alias=e.from_slug
      LEFT JOIN nodes es_node ON es_node.slug=COALESCE(es_alias.canonical,e.from_slug)`;
    const edgeSourceTruth = edgeSourceLiveSQL('e');
    // F7: display canonicalization is source-shadow aware — an unindexed real node's
    // file shadows its alias name, so a pre-sync edge to it renders as the distinct,
    // honest endpoint it is instead of folding into a false self-edge.
    const displayEndpoint = (raw) => {
      const resolved = resolveReadSlug(ctx, ctx.reg, raw, db);
      return `${resolved}${aliasSuffix(raw, resolved)}`;
    };
    const verb = flags.verb ? resolveVerb(ctx.reg, flags.verb, db) : null;
    if (!currentSourceIsConflictFree(db, slug))
      die(`'${slug}' has unresolved VCS conflict markers — unresolved VCS conflict requires repair; refusing relations rather than serving stale indexed edges or semantic fields. Resolve the source conflict, then: brain sync --slug ${slug}`);
    const node = db.prepare(`SELECT n.* FROM nodes n WHERE n.slug=? AND ${currentSourceConflictFreeSQL('n')}`).get(slug);
    if (node) warnCollisions(db, node, out); // relations is THE person-question verb — must warn like get/peek
    const DEG = 50;
    const vf = verb ? ` AND e.verb=?` : '';
    const va = verb ? [...slugNames, verb] : slugNames;
    const outCount = db.prepare(`SELECT COUNT(*) c FROM edges e WHERE e.from_slug IN (${slugSlots}) AND ${edgeSourceLiveSQL('e')}${vf}`).get(...va).c;
    const inCount = db.prepare(`SELECT COUNT(*) c FROM edges e ${edgeSourceJoin}
      WHERE e.to_slug IN (${slugSlots}) AND ${edgeSourceTruth}${vf}`).get(...va).c;
    // bug #16: a nonexistent/forgotten slug with no truthful edges printed "0 out, 0 in"
    // — indistinguishable from a real zero-edge node. A dangling target with a healthy
    // inbound author remains inspectable; an edge selected only from a conflicted source
    // cannot manufacture a live-looking identity.
    if (!node && outCount === 0 && inCount === 0) die(`no node '${slug}'`);
    out(`relations ${slug}: ${outCount} out, ${inCount} in${verb ? ` (verb=${verb})` : ''}`);
    // own workability as a stated fact, not an inference from edge direction (run-6 finding)
    if (node?.class === 'future' && isOpen(node.status)) {
      const bl = blockersOf(db, slug);
      out(bl.length ? `  ⛔ blocked by: ${bl.join(', ')}` : `  ▶ workable (nothing blocks it)`);
    }
    // degree-aware: a designed-in hub (user card, big project) collapses to verb
    // counts rather than dumping thousands of edges — narrow walk, not narrow node.
    if (!verb && outCount > DEG) {
      db.prepare(`SELECT e.verb, COUNT(*) c FROM edges e WHERE e.from_slug IN (${slugSlots}) AND ${edgeSourceLiveSQL('e')} GROUP BY e.verb ORDER BY c DESC`).all(...slugNames)
        .forEach(g => out(`  ${slug} → ${g.verb} → ${g.c}   (drill: relations ${slug} --verb ${g.verb})`));
    } else {
      db.prepare(`SELECT e.* FROM edges e WHERE e.from_slug IN (${slugSlots}) AND ${edgeSourceLiveSQL('e')}${vf} ORDER BY e.rowid LIMIT ${verb ? -1 : DEG}`).all(...va)
        .forEach(e => out(`  ${slug} → ${e.verb} → ${displayEndpoint(e.to_slug)} ${annotate(ctx, db, e.to_slug)}${e.why ? `   (why: ${e.why})` : ''}`));
    }
    if (!verb && inCount > DEG) {
      db.prepare(`SELECT e.verb, COUNT(*) c FROM edges e ${edgeSourceJoin}
        WHERE e.to_slug IN (${slugSlots}) AND ${edgeSourceTruth}
        GROUP BY e.verb ORDER BY c DESC`).all(...slugNames)
        .forEach(g => out(`  ${g.c} → ${g.verb} → ${slug}   (drill: relations ${slug} --verb ${g.verb})`));
    } else {
      db.prepare(`SELECT e.* FROM edges e ${edgeSourceJoin}
        WHERE e.to_slug IN (${slugSlots}) AND ${edgeSourceTruth}${vf}
        ORDER BY e.rowid LIMIT ${verb ? -1 : DEG}`).all(...va)
        .forEach(e => {
          // reconcile item 3 + C57: consume the registry's inverse_of at display time — an
          // inbound `contains` reads, from THIS node, as `advances` back. Relabel so the
          // reciprocal relationship is legible, not just the raw stored direction. A frozen
          // edge's verb is a conjugated past form; inverseOf falls back to the base verb's
          // inverse so the label survives freeze.
          const inv = inverseOf(ctx.reg, e.verb);
          const from = displayEndpoint(e.from_slug);
          out(`  ${from} ${annotate(ctx, db, e.from_slug)} → ${e.verb} → ${slug}${e.why ? `   (why: ${e.why})` : ''}${inv ? `   [${slug} ${inv} ${from}]` : ''}`);
        });
    }
    // brain-convergence §3: the owner relations-projection targets the ME card in EVERY
    // store — no config pointer, no subject-kind branch (both subjects are people, so
    // "my staff / my operator / my clients" project identically).
    if (node?.entity === 'me') {
      const projectedCount = db.prepare(`SELECT COUNT(*) c
        FROM nodes n, json_each(n.profile_json, '$.relationship') je
        WHERE n.entity='person' AND n.slug != ? AND ${currentSourceConflictFreeSQL('n')}`).get(slug).c;
      if (projectedCount) {
        out(`projected (profile.relationship):`);
        if (projectedCount > DEG) {
          db.prepare(`SELECT je.value value, COUNT(*) c
            FROM nodes n, json_each(n.profile_json, '$.relationship') je
            WHERE n.entity='person' AND n.slug != ? AND ${currentSourceConflictFreeSQL('n')}
            GROUP BY je.value ORDER BY c DESC, je.value`).all(slug)
            .forEach(g => out(`  ${g.c} —[${g.value}]→ ${slug}`));
        } else {
          db.prepare(`SELECT n.slug, je.value
            FROM nodes n, json_each(n.profile_json, '$.relationship') je
            WHERE n.entity='person' AND n.slug != ? AND ${currentSourceConflictFreeSQL('n')}
            ORDER BY n.slug, je.value`).all(slug)
            // same status honesty as ordinary relations rows: an archived/superseded
            // person must not project as current staff without the annotation.
            .forEach(r => out(`  ${r.slug} ${annotate(ctx, db, r.slug)} —[${r.value}]→ ${slug}`));
        }
      }
    }
    const upCount = db.prepare(`SELECT COUNT(*) c FROM updates WHERE card_slug=?`).get(slug).c;
    db.prepare(`SELECT * FROM updates WHERE card_slug=? ORDER BY ord LIMIT 20`).all(slug)
      .forEach(u => {
        const from = fromColDisplay(u.from);
        out(`  updated[${u.x} @ ${u.y}]${from ? ` (from: ${from})` : ''}${u.why ? ` (why: ${u.why})` : ''}${u.record_slug ? ` ← ${u.record_slug}` : ''}`);
      });
    if (upCount > 20) out(`  …+${upCount - 20} more updates (newest 20 shown)`);
    // "when did we last X" answers live here — state the latest record instead of
    // making models scan-and-max the edge list (run-10 finding: scan slips at 500k).
    // F-11 (board bug #1): a record whose event DIDN'T HAPPEN (dropped/superseded) or was
    // deliberately hidden (archived/dissolved) must not answer "when did we last…" — a
    // cancelled dinner is not a meeting. done + records-born (status NULL) stay: "done"
    // must not erase history (second-pass position #1).
    const happened = `(n.status IS NULL OR n.status NOT IN ('dropped','superseded','archived','dissolved'))`;
    const latest = db.prepare(`SELECT n.slug, n.occurred, n.entity FROM edges e
      LEFT JOIN _slug_aliases ef ON ef.alias=e.from_slug
      JOIN nodes n ON n.slug=COALESCE(ef.canonical,e.from_slug)
      WHERE e.to_slug IN (${slugSlots}) AND n.class='record' AND n.occurred IS NOT NULL AND ${happened}
      AND ${currentSourceConflictFreeSQL('n')} AND ${edgeSourceLiveSQL('e')}
      ORDER BY n.occurred DESC LIMIT 1`).get(...slugNames);
    if (latest) {
      out(`  latest record: ${latest.slug} (occurred ${latest.occurred})`);
      if (latest.entity !== 'conversation') {
        const conv = db.prepare(`SELECT n.slug, n.occurred FROM edges e
          LEFT JOIN _slug_aliases ef ON ef.alias=e.from_slug
          JOIN nodes n ON n.slug=COALESCE(ef.canonical,e.from_slug)
          WHERE e.to_slug IN (${slugSlots}) AND n.class='record' AND n.entity='conversation' AND n.occurred IS NOT NULL AND ${happened}
          AND ${currentSourceConflictFreeSQL('n')} AND ${edgeSourceLiveSQL('e')}
          ORDER BY n.occurred DESC LIMIT 1`).get(...slugNames);
        if (conv) out(`  latest conversation: ${conv.slug} (occurred ${conv.occurred})`);
      }
    }
    // OPT-IN multi-hop (spec §5 "depth ≤3"): appended AFTER the depth-1 body so the
    // default output is byte-identical (guardrail). Bounded per level — a narrow
    // walk, never a corpus sweep: cap the frontier + shown lines each hop.
    if (flags.depth && Number(flags.depth) > 1) {
      const maxD = Math.min(3, Number(flags.depth) | 0), PER = 30;
      const visited = new Set([slug]);
      const edgeRows = (s) => {
        const resolved = resolveSlug(ctx.reg, s, db);
        const names = slugReadNames(ctx, ctx.reg, resolved, db), slots = sqlSlots(names);
        const canAuthor = currentSourceIsConflictFree(db, resolved);
        return [
          ...(canAuthor ? db.prepare(`SELECT e.from_slug, e.verb, e.to_slug FROM edges e
            WHERE e.from_slug IN (${slots}) AND ${edgeSourceLiveSQL('e')} ORDER BY e.rowid`).all(...names) : []),
          ...db.prepare(`SELECT e.from_slug, e.verb, e.to_slug FROM edges e ${edgeSourceJoin}
            WHERE e.to_slug IN (${slots}) AND ${edgeSourceTruth} ORDER BY e.rowid`).all(...names),
        ];
      };
      // seed the walk at BOTH direct targets and direct sources (already shown in the
      // depth-1 body); a depth-2 line is a neighbor-of-a-neighbor, not a direct edge
      // re-shown.
      let frontier = edgeRows(slug).map(e => resolveSlug(ctx.reg, slugNames.includes(e.from_slug) ? e.to_slug : e.from_slug, db));
      frontier = [...new Set(frontier)];
      frontier.forEach(s => visited.add(s));
      // bug #13: iterate every requested level (don't stop at an empty frontier) and
      // ALWAYS print the footer — an empty walk prints "depth 2: 0 nodes" so it's
      // distinguishable from an ignored flag (byte-identical-to-depth-1 read as a no-op).
      for (let d = 2; d <= maxD; d++) {
        const next = []; let shown = 0, more = 0;
        const seenEdges = new Set();
        for (const f of frontier) {
          const fNames = slugReadNames(ctx, ctx.reg, f, db);
          const edges = edgeRows(f);
          for (const e of edges) {
            const ek = `${e.from_slug}\t${e.verb}\t${e.to_slug}`;
            if (seenEdges.has(ek)) continue;
            seenEdges.add(ek);
            const neighbor = resolveSlug(ctx.reg, fNames.includes(e.from_slug) ? e.to_slug : e.from_slug, db);
            if (visited.has(neighbor)) continue;
            visited.add(neighbor); next.push(neighbor);
            if (shown < PER) out(`  [depth ${d}] ${displayEndpoint(e.from_slug)} → ${e.verb} → ${displayEndpoint(e.to_slug)} ${annotate(ctx, db, neighbor)}`);
            else more++;
            shown++;
          }
        }
        out(`  depth ${d}: ${shown} nodes${more ? ` (showing ${PER}, +${more} capped)` : ''}`);
        frontier = next.slice(0, PER);
      }
    }
}

function cmdFutures(ctx, _args, flags) {
    const { out } = ctx.io;
    const db = requireDb(ctx);
    installCurrentSourceConflictGuard(ctx, db);
    buildBlockedTemp(ctx, db);
    const today = ctx.today();
    const nowStamp = today + 'T' + localTime(ctx.tz);
    // §2.2 / bug #9b: when scoped to a project, DRIVE FROM edges(to_slug) — walk the
    // slug's inbound edges (idx_edges_to) instead of forcing a scan over all 70k
    // class=future rows via the old `slug IN (SELECT …)` subquery. Measured at 500k on a
    // high-degree hub: class-driven count 383ms → edge-driven 11ms warm. DISTINCT because
    // a node may edge to the same target more than once.
    const rawFor = flags.for || null;
    if (rawFor) assertReadSlug(rawFor, 'futures --for');
    const forSlug = rawFor ? resolveSlug(ctx.reg, rawFor, db) : null; // bug #64
    const forLabel = forSlug ? ` --for ${forSlug}${aliasSuffix(rawFor, forSlug)}` : '';
    if (forSlug && !currentSourceIsConflictFree(db, forSlug))
      die(`'${forSlug}' has unresolved VCS conflict markers — unresolved VCS conflict requires repair; refusing futures --for rather than traversing stale indexed edges. Resolve the source conflict, then: brain sync --slug ${forSlug}`);
    // F-15: BOTH directions — a future the project card points AT (contains →) is as
    // scoped to it as one pointing at the card (advances →). Both IN-subqueries ride
    // their edge indexes (idx_edges_to / idx_edges_from): still a narrow walk.
    const from = `nodes n`;
    const cnt = 'COUNT(*)';
    const dist = '';
    const baseWhere = [`n.class='future'`, openFutureSQL('n'), currentSourceConflictFreeSQL('n')];
    const baseArgs = [];
    if (forSlug) {
      const names = slugReadNames(ctx, ctx.reg, forSlug, db), slots = sqlSlots(names);
      baseWhere.unshift(`(n.slug IN (SELECT se.from_slug FROM edges se WHERE se.to_slug IN (${slots}) AND ${edgeSourceLiveSQL('se')}) OR n.slug IN (SELECT se.to_slug FROM edges se WHERE se.from_slug IN (${slots}) AND ${edgeSourceLiveSQL('se')}))`);
      baseArgs.push(...names, ...names);
    }
    // outbox count is scope-aware (matches the --for filter) but window-independent
    const outboxN = db.prepare(`SELECT ${cnt} c FROM ${from} WHERE ${baseWhere.join(' AND ')} AND n.due IS NOT NULL AND (n.due<? OR (length(n.due)>10 AND n.due<?))`).get(...baseArgs, today, nowStamp).c; // bug #81
    const where = [...baseWhere], args = [...baseArgs];
    if (flags.window) {
      // bug #26: an invalid window silently mapped to week while the header echoed the bogus
      // word ("futures (fortnight)") — teach the valid values (C40 unknown-filter style), exit 1.
      const WINDOWS = ['day', 'week', 'month', 'year'];
      if (!WINDOWS.includes(flags.window)) die(`unknown futures --window '${flags.window}' — valid values: ${WINDOWS.join(', ')}`);
      const bounds = windowBoundsExclusive(today, flags.window);
      // forward-looking: UPCOMING only — overdue lives in the outbox, not the window
      where.push(`n.due IS NOT NULL AND n.due>=? AND n.due<?`); args.push(bounds.from, bounds.toEx);
    }
    const total = db.prepare(`SELECT ${cnt} c FROM ${from} WHERE ${where.join(' AND ')}`).get(...args).c;
    const CAP = 60;
    const cap = !flags.all;
    const rows = db.prepare(`SELECT ${dist}n.*, (b.slug IS NOT NULL) blocked FROM ${from}
      LEFT JOIN _blocked b ON b.slug=n.slug WHERE ${where.join(' AND ')}
      ORDER BY blocked, COALESCE(n.due,'9999'), n.slug${cap ? ` LIMIT ${CAP}` : ''}`).all(...args);
    const capped = cap && total > rows.length;
    out(`futures${forLabel}${flags.window ? ` (${flags.window})` : ''}: total ${total}${capped ? `, shown ${CAP} (narrow with --for <slug> / --window, or --all)` : ''}${outboxN ? `  [⚠ ${outboxN} passed unprocessed — brain outbox]` : ''} — ${todayStamp(ctx)}`);
    rows.forEach(r => {
      const b = r.blocked;
      const rel = fmtDueRel(ctx, r.due);
      out(`  ${b ? '⛔' : '▶'} ${row(r)}${rel ? ' ' + rel : ''}${b ? `  [blocked by: ${blockersOf(db, r.slug).join(',')}]` : ''}`);
    });
    // facet hint on an empty cockpit (spec §5): point at the broader views instead of
    // dead-ending — a scoped/windowed 0 usually just means "look wider".
    if (!rows.length) {
      const relaxes = [];
      if (flags.window) relaxes.push(`drop --window (it shows only UPCOMING within ${flags.window})`);
      if (forSlug) relaxes.push(`'relations ${forSlug}' — maybe nothing open is scoped to it`);
      relaxes.push(`'brain outbox' holds passed-unprocessed futures`);
      out(`  facet hint: 0 open futures${forSlug ? ` for ${forSlug}` : ''}${flags.window ? ` in ${flags.window}` : ''} — ${relaxes.join(' · ')}`);
    }
}

function cmdOutbox(ctx, _args, _flags) {
    const { out } = ctx.io;
    // passed-but-unprocessed futures: a COMPUTED view — nothing was moved anywhere.
    const db = requireDb(ctx);
    installCurrentSourceConflictGuard(ctx, db);
    const today = ctx.today();
    const nowStamp = today + 'T' + localTime(ctx.tz);
    const rows = db.prepare(`SELECT n.* FROM nodes n WHERE n.class='future'
      AND ${openFutureSQL('n')} AND ${currentSourceConflictFreeSQL('n')}
      AND n.due IS NOT NULL AND (n.due < ? OR (length(n.due) > 10 AND n.due < ?))
      ORDER BY n.due`).all(today, nowStamp); // bug #81
    out(`outbox — passed but unprocessed: ${rows.length}${rows.length ? '  (process each: freeze with outcome, recommit with a new date, or drop)' : ''} — ${todayStamp(ctx)}`);
    rows.forEach(r => {
      const rel = fmtDueRel(ctx, r.due);
      out(`  ${row(r)}${rel ? ' ' + rel : ''}`);
    });
}

// ask-ledger §1.6: the durable blocking-ask cockpit. Reads brain/__meta/asks.md directly (no index),
// so it works even on a pen with no built index. --open filters to still-open asks.
function cmdAsks(ctx, _args, flags) {
    const { out } = ctx.io;
    const { rows, warnings } = readAsksLedger(ctx.root);
    const openCount = rows.filter(r => r.status === 'open').length;
    const shown = flags.open ? rows.filter(r => r.status === 'open') : rows;
    out(`asks — ${flags.open ? `open: ${shown.length}` : `${rows.length} total (${openCount} open)`} — ${todayStamp(ctx)}`);
    for (const r of shown) {
      const tail = r.status === 'open'
        ? `raised ${r.raised_at || '?'}`
        : `${r.status}${r.answered_with ? ` ${r.answered_with}` : ''}${r.answered_at ? ` ${r.answered_at}` : ''}${r.answer_ref ? ` — ${r.answer_ref}` : ''}`;
      out(`  ${r.id}  [${r.status}]  ${r.slug} (${r.kind})  ${tail}`);
      if (r.question) out(`      ${r.question}`);
    }
    warnings.forEach(w => console.error(`⚠ asks ledger: ${w}`));
}

function cmdCheck(ctx, [slug], flags) {
    const { out } = ctx.io; const { root } = ctx;
    if (slug && flags.all) die(`check takes either <slug> or --all, not both`);
    if (slug) assertReadFilename(slug, 'check slug');
    if (!slug && !flags.all) { out(`check <slug> — checks one node. use --all to scan the whole corpus (slow).`); return; }
    const db = requireDb(ctx);
    installCurrentSourceConflictGuard(ctx, db); // registers brain_edge_source_live for the topology walk
    const probs = [];
    let rows;
    if (slug) {
      slug = resolveSlug(ctx.reg, slug, db); // bug: check resolves aliases like the other read verbs.
      const node = db.prepare(`SELECT * FROM nodes WHERE slug=?`).get(slug);
      if (!node) {
        const errRows = db.prepare(`SELECT path, problem FROM errors WHERE path=?`).all(nodePath(root, slug));
        if (!errRows.length) die(`no node '${slug}'`);
        errRows.forEach(e => probs.push(`${path.basename(e.path)}: ${e.problem}`));
        out(probs.map(p => 'signal: ' + p).join('\n'));
        out('(signals only — never gates)');
        return;
      }
      rows = [node];
    } else {
      rows = db.prepare(`SELECT * FROM nodes`).all();
    }
    for (const r of rows) {
      // Check CURRENT authored truth once. The old row pass plus frontmatter pass emitted
      // typed signals twice and could lint a stale value alongside its replacement.
      let checkedCurrent = false;
      try {
        const text = fs.readFileSync(nodePath(root, r.slug), 'utf8');
        if (hasConflictMarkers(conflictRegion(text))) {
          probs.push(`${r.slug}: unmerged VCS conflict markers present — unresolved VCS conflict requires repair; no branch is live truth`);
          checkedCurrent = true;
          continue; // no unresolved arm may feed semantic lint or stale-row fallback
        }
        const parsed = parseFrontmatter(text);
        if (parsed) {
          checkedCurrent = true;
          const current = { ...lintSrcFromFm(parsed.fm), slug: r.slug, class: deriveClass(ctx.reg, parsed.fm) };
          nodeLint(ctx.reg, current, { capacityAdvisories: true, db, sourceExists: (s) => sourceSlugExists(root, s) }).forEach(p => probs.push(p));
          nodeLint(ctx.reg, parsed.fm, { unknownFieldsOnly: true, prefixSlug: r.slug }).forEach(p => probs.push(p));
          (parsed.errors || []).forEach(p => probs.push(`${r.slug}: ${p}`));
        }
      } catch { /* file gone/unreadable — doctor --verify surfaces that separately */ }
      if (!checkedCurrent) nodeLint(ctx.reg, lintSrcFromRow(r)).forEach(p => probs.push(p));
    }
    const cycleSignals = new Map();
    let topologyTruncated = false;
    if (slug) {
      const { cycles, truncated } = partOfCyclesFrom(ctx, db, slug);
      topologyTruncated ||= truncated;
      for (const cycle of cycles)
        cycleSignals.set(canonicalCycleKey(cycle), partOfCycleSignal(cycle));
    } else if (flags.all) {
      for (const r of rows) {
        const { cycles, truncated } = partOfCyclesFrom(ctx, db, r.slug);
        topologyTruncated ||= truncated;
        for (const cycle of cycles)
          cycleSignals.set(canonicalCycleKey(cycle), partOfCycleSignal(cycle));
      }
    }
    cycleSignals.forEach(p => probs.push(p));
    if (topologyTruncated)
      probs.push('part_of topology analysis truncated at depth 200 — cycle detection incomplete: a chain longer than the walk budget may hide a cycle. Break the deep chain into segments under 200, or restructure, then re-check');
    // bug #19: orphan / out-of-subset frontmatter lines are the SIGNATURE of a newline-corrupted
    // scalar (text after a raw \n became a bare line the line-parser can't place). The index already
    // records them at parse time, so surface them for the checked node(s) — cheap (no file read),
    // signal-only, never a gate. Single-slug gains this visibility too (was --all only).
    const errRows = slug
      ? db.prepare(`SELECT path, problem FROM errors WHERE path=?`).all(nodePath(root, slug))
      : (flags.all ? db.prepare(`SELECT path, problem FROM errors`).all() : []);
    errRows.forEach(e => probs.push(`${path.basename(e.path)}: ${e.problem}`));
    const unique = [...new Set(probs)];
    out(unique.length ? unique.map(p => 'signal: ' + p).join('\n') : 'check: clean');
    out('(signals only — never gates)');
}

// entity-ref-fields §4 — doctor's always-on, report-only profile-reference audit. Two
// bounded subsections off the derived index (same read-only card view as the write-time
// guard): (1) UNLINKED references — a profile string that matches an existing card while the
// node has no edge to it; (2) UNREALIZED entities — a 'ref'-typed field whose value matches
// no satisfying card ("should this be an entity?"). No writes, no exit-code effect; index
// absent → one skip line.
function profileReferenceAudit(ctx, db, out) {
  const view = entityGuardCardRows(ctx);
  if (view.skipped) { out(`profile-reference audit: skipped (no index)`); return; }
  const normDesc = (s) => typeof s === 'string' ? s.trim().toLowerCase() : '';
  const bySlug = new Map(), byDesc = new Map();
  for (const r of [...view.rows].sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, r);
    const nd = normDesc(r.description);
    if (nd) { if (!byDesc.has(nd)) byDesc.set(nd, []); byDesc.get(nd).push(r); }
  }
  const edgesBySrc = new Map(); // from_slug → set of edge targets (canonical + authored spelling)
  for (const e of db.prepare(`SELECT from_slug, to_slug FROM edges`).all()) {
    if (!edgesBySrc.has(e.from_slug)) edgesBySrc.set(e.from_slug, new Set());
    const set = edgesBySrc.get(e.from_slug);
    set.add(e.to_slug);
    set.add(resolveSlug(ctx.reg, e.to_slug, db));
  }
  const unlinked = [], unrealized = [];
  for (const n of db.prepare(`SELECT slug, entity, profile_json FROM nodes`).all()) {
    let profile;
    try { profile = JSON.parse(n.profile_json || '{}'); } catch { continue; }
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
    const cands = profileEntityCandidates(ctx.reg, n.entity, profile, Object.keys(profile));
    if (!cands.length) continue;
    const edgeSet = edgesBySrc.get(n.slug) || new Set();
    for (const cand of cands) {
      const slugForm = slugify(cand.value);
      const canonical = slugForm ? resolveSlug(ctx.reg, slugForm, db) : '';
      const hits = [], seen = new Set();
      const add = (r) => { if (r && r.slug !== n.slug && !seen.has(r.slug)) { seen.add(r.slug); hits.push(r); } }; // exclude self
      if (canonical) add(bySlug.get(canonical));
      for (const r of byDesc.get(normDesc(cand.value)) || []) add(r);
      if (hits.length && !hits.some(h => edgeSet.has(h.slug))) unlinked.push({ slug: n.slug, field: cand.field, value: cand.value, card: hits[0].slug });
      if (cand.ref && !hits.some(h => !cand.restrict || cand.restrict.includes(h.entity))) unrealized.push({ slug: n.slug, field: cand.field, value: cand.value });
    }
  }
  const bySlugField = (a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : a.field < b.field ? -1 : a.field > b.field ? 1 : 0;
  unlinked.sort(bySlugField); unrealized.sort(bySlugField);
  out(`profile-reference audit: ${unlinked.length} unlinked reference${unlinked.length === 1 ? '' : 's'}, ${unrealized.length} unrealized entit${unrealized.length === 1 ? 'y' : 'ies'}`);
  const cap = (items, render) => { items.slice(0, 20).forEach(i => out(render(i))); if (items.length > 20) out(`  …and ${items.length - 20} more`); };
  if (unlinked.length) cap(unlinked, u => `  ⚠ ${u.slug}.${u.field} '${u.value}' → ${u.card} (matches a card; no edge)`);
  if (unrealized.length) cap(unrealized, u => `  ⚠ ${u.slug}.${u.field} '${u.value}' — should this be an entity?`);
}

function cmdDoctor(ctx, _args, flags) {
    const { out } = ctx.io; const { root } = ctx;
    assertExclusiveModes('doctor', flags, ['orphans', 'verify', 'vacuum', 'merge']);
    const registryUnsafe = ctx.regState.parseError
      ? `CORRUPT (${ctx.regState.parseError}) — running reads on seed is unsafe`
      : ctx.regState.futureFormat != null
        ? `FUTURE FORMAT ${ctx.regState.futureFormat} (engine supports ${REG_FORMAT})`
        : ctx.regState.rewriteProblems?.length
          ? `NEEDS HAND REPAIR (${ctx.regState.rewriteProblems[0]})`
          : null;
    // Doctor itself must remain available in a fresh clone with a damaged registry. Do
    // not auto-build an index from unsafe semantics merely to print the diagnosis.
    if (registryUnsafe) {
      const requestedMode = ['orphans', 'verify', 'vacuum', 'merge'].find(name => flags[name] === true);
      if (requestedMode)
        die(`cannot run doctor --${requestedMode} while registry.md is unsafe (${registryUnsafe}) — that mode needs trustworthy registry/index semantics and must not report success after doing nothing. Repair or upgrade the registry, then retry; bare doctor remains available for diagnosis. Nothing executed`);
      const indexPresent = fs.existsSync(path.join(root, '.brain', 'index.sqlite'));
      // Do not open a WAL database merely to label its schema: even a readOnly
      // DatabaseSync handle can create -wal/-shm sidecars. Under unsafe registry this is
      // a byte-pure diagnostic, so existence is all we may report.
      out(`doctor: registry-only (${indexPresent ? 'index file present; currency/semantics unchecked' : 'no index file; rebuild refused until registry repair'})`);
      out(`registry: ${registryUnsafe}`);
      (ctx.regState.rewriteProblems || []).forEach(p => out(`  ⚠ rewrite blocked: ${p}`));
      if (ctx.regState.unparseable.length) ctx.regState.unparseable.slice(0, 20).forEach(u => out(`  ⚠ [${u.section || '?'}] ${u.line}`));
      return;
    }
    const db = requireDb(ctx);
    installCurrentSourceConflictGuard(ctx, db);
    if (flags.merge || flags.vacuum) {
      // Maintenance mutates SQLite and must participate in the same serialization as
      // incremental indexing/reindex swaps. Reopen by pathname after waiting so a cached
      // handle can never optimize/vacuum the retired inode of a concurrent rebuild.
      return withIndexLock(root, () => {
        closeDb(ctx);
        const current = openDb(ctx);
        if (flags.merge) {
          current.exec(`INSERT INTO fts(fts) VALUES('optimize')`);
          if (hasTable(current, 'fts_body')) current.exec(`INSERT INTO fts_body(fts_body) VALUES('optimize')`);
          out(`doctor: FTS optimized (segments merged)${hasTable(current, 'fts_body') ? ' incl. fts_body' : ''}`);
        } else {
          current.exec(`VACUUM`);
          out(`doctor: VACUUM complete`);
        }
      });
    }
    buildSlugAliasTemp(ctx, db);
    const dumpCapped = (items, render) => {
      items.slice(0, 20).forEach(item => out(render(item)));
      if (items.length > 20) out(`  …and ${items.length - 20} more`);
    };
    if (flags.orphans) { // dangling edges BOTH directions (missing target and missing source)
      const noTarget = db.prepare(`SELECT e.from_slug, e.verb, e.to_slug FROM edges e
        LEFT JOIN _slug_aliases ea ON ea.alias=e.to_slug
        LEFT JOIN nodes n ON n.slug=COALESCE(ea.canonical,e.to_slug) WHERE n.slug IS NULL`).all();
      const noSource = db.prepare(`SELECT e.from_slug, e.verb, e.to_slug FROM edges e
        LEFT JOIN _slug_aliases ea ON ea.alias=e.from_slug
        LEFT JOIN nodes n ON n.slug=COALESCE(ea.canonical,e.from_slug) WHERE n.slug IS NULL`).all();
      out(`orphans: ${noTarget.length} edges → missing target, ${noSource.length} edges ← missing source`);
      noTarget.slice(0, 50).forEach(e => out(`  → ${e.from_slug} → ${e.verb} → ${e.to_slug} (target gone)`));
      noSource.slice(0, 50).forEach(e => out(`  ← ${e.from_slug} → ${e.verb} → ${e.to_slug} (source gone)`));
      out(`fix: if <old> was renamed, restore read-time resolution: brain register --alias <old> --to <new>; or re-point each edge: brain unlink/link.`);
      return;
    }
    if (flags.verify) { // H22 + C-6: BIDIRECTIONAL file↔index sweep + class∈tenses lint on CURRENT frontmatter + tmp reaping
      let checked = 0, drift = 0, missing = 0, tense = 0, reaped = 0, nextReaped = 0, lockReaped = 0, pathMismatch = 0, statBlindDrift = 0, sourceOnly = 0;
      const danglingSupersededBy = [];
      const unresolvedConflicts = new Set();
      const indexedSlugs = new Set();
      for (const r of db.prepare(`SELECT slug, content_hash, entity, class, mtime, size, path FROM nodes`).all()) {
        checked++;
        indexedSlugs.add(r.slug);
        const expectedPath = nodePath(root, r.slug);
        if (r.path !== expectedPath) { pathMismatch++; if (pathMismatch <= 20) out(`  path: ${r.slug} stored path differs from canonical source path — run: brain sync`); }
        let fm = null, conflicted = false;
        try {
          const p = expectedPath;
          const text = fs.readFileSync(p, 'utf8');
          const h = contentHash(text);
          conflicted = hasConflictMarkers(conflictRegion(text));
          if (conflicted) unresolvedConflicts.add(r.slug);
          // C-6: lint what the file says NOW, not the possibly-stale index row. A conflict
          // has no selected parse arm, so never derive current semantic fields from it.
          fm = conflicted ? null : parseFrontmatter(text)?.fm ?? null;
          const supersededBy = fm?.superseded_by;
          if (supersededBy && !db.prepare(`SELECT 1 FROM nodes WHERE slug=?`).get(resolveSlug(ctx.reg, String(supersededBy), db)))
            danglingSupersededBy.push({ slug: r.slug, to: String(supersededBy) });
          if (h !== r.content_hash) {
            drift++;
            const st = fs.statSync(p);
            const statBlind = st.mtimeMs === r.mtime && st.size === r.size;
            if (statBlind) statBlindDrift++;
            if (drift <= 20) out(`  drift: ${r.slug} (index ${String(r.content_hash).slice(0, 8)} ≠ file ${h.slice(0, 8)} — ${statBlind ? 'run: brain sync --deep (plain sync will MISS it: bytes changed with mtime+size preserved)' : 'run: brain sync'})`); // bug #33
          }
        }
        catch (e) { if (e.code === 'ENOENT') { missing++; if (missing <= 20) out(`  phantom: ${r.slug} (indexed but file gone — run: brain sync)`); } else throw e; }
        if (conflicted) continue; // hash/conflict diagnostics above are complete; no arm supplies semantic lint
        // C-6: class∈tenses from the CURRENT source frontmatter when readable (a hand-edit
        // is visible immediately, not only after the next sync); index row as fallback.
        const curEntity = fm ? fm.entity : r.entity;
        const curClass = fm ? deriveClass(ctx.reg, fm) : r.class;
        const reg = ownValue(ctx.reg.entities, curEntity);
        if (curEntity && reg && !reg.tenses.includes(curClass)) { tense++; if (tense <= 20) out(`  class: ${r.slug} is '${curClass}' but entity '${curEntity}' allows [${reg.tenses.join(', ')}]`); }
      }
      // C-6: the reverse direction — source files the index has NO row for. A quarantined
      // file at least has an errors row; a silently-unindexed valid file had NOTHING.
      const srcDir = path.join(root, 'brain', '__source');
      if (fs.existsSync(srcDir)) {
        for (const f of fs.readdirSync(srcDir).filter(f2 => f2.endsWith('.md')).sort()) {
          const slug = f.replace(/\.md$/, '');
          if (indexedSlugs.has(slug)) continue;
          sourceOnly++;
          const sourcePath = path.join(srcDir, f);
          const quarantined = !!db.prepare(`SELECT 1 FROM errors WHERE path=?`).get(sourcePath);
          try {
            const text = fs.readFileSync(sourcePath, 'utf8');
            if (hasConflictMarkers(conflictRegion(text))) unresolvedConflicts.add(slug);
          } catch { /* unreadable source remains a generic source-only diagnosis */ }
          if (sourceOnly <= 20) out(`  source-only: ${slug} (file exists, no index row${quarantined ? '; quarantined — see doctor errors' : ''} — run: brain sync)`);
        }
      }
      const tmp = path.join(root, '.brain', 'tmp'); // reap stale temp files a crash may have left
      if (fs.existsSync(tmp)) for (const f of fs.readdirSync(tmp)) { try { if (Date.now() - fs.statSync(path.join(tmp, f)).mtimeMs > 3600000) { fs.unlinkSync(path.join(tmp, f)); reaped++; } } catch { /* ok */ } }
      nextReaped = reapStaleNextFiles(root);
      lockReaped = reapStaleLocks(root, out);
      out(`doctor --verify: ${checked} nodes hash-checked — ${drift} drifted, ${missing} phantom, ${tense} class∉tenses, ${sourceOnly} source-only (unindexed), ${unresolvedConflicts.size} unresolved VCS conflict${unresolvedConflicts.size === 1 ? '' : 's'}, ${pathMismatch} path mismatch${pathMismatch === 1 ? '' : 'es'}, ${danglingSupersededBy.length} dangling superseded_by; reaped ${reaped} stale tmp file${reaped === 1 ? '' : 's'}, ${nextReaped} stale reindex next file${nextReaped === 1 ? '' : 's'}, ${lockReaped} stale lock${lockReaped === 1 ? '' : 's'}`);
      if (unresolvedConflicts.size) {
        out(`unresolved VCS conflicts requiring repair: ${unresolvedConflicts.size}`);
        dumpCapped([...unresolvedConflicts], slug => `  ⚠ ${slug}: unresolved VCS conflict requires repair; no branch is live truth — resolve the source conflict, then: brain sync --slug ${slug}`);
      }
      if (danglingSupersededBy.length) {
        out(`dangling superseded_by: ${danglingSupersededBy.length}`);
        dumpCapped(danglingSupersededBy, r => `  ⚠ ${r.slug} → ${r.to} (no node)`);
      }
      if (statBlindDrift) out(`note: ${statBlindDrift} drifted node(s) have mtime+size matching the index — plain sync will miss them; use: brain sync --deep`); // bug #33
      const rp = validateRegistry(ctx.reg, db);
      const rewriteProblems = ctx.regState.rewriteProblems || [];
      const shadow = seedShadowAdvisories(ctx.regState);
      if (rp.length || rewriteProblems.length || shadow.length) {
        out(`registry:`);
        rewriteProblems.forEach(p => out(`  ⚠ rewrite blocked: ${p}`));
        rp.forEach(p => out(`  ⚠ ${p}`));
        shadow.forEach(p => out(`  ⚠ ${p}`)); // brain-convergence §2 — advisory, never a gate
      }
      // bug #28: edges whose verb has no registry row (a de-registered-but-live verb, or one
      // never registered). Signal only — this is a data-hygiene lint, home in the deep sweep
      // next to class∈tenses. isKnownVerb counts conjugation values (past forms) so frozen
      // edges are never falsely flagged.
      const orphanVerbs = db.prepare(`SELECT verb, COUNT(*) c FROM edges GROUP BY verb`).all().filter(r => !isKnownVerb(ctx.reg, r.verb));
      if (orphanVerbs.length) {
        out(`orphaned-verb edges: ${orphanVerbs.length} verb(s) used by edges but absent from the registry (register or re-point):`);
        orphanVerbs.slice(0, 20).forEach(r => out(`  ⚠ '${r.verb}' — ${r.c} edge${r.c === 1 ? '' : 's'}`));
      }
      profileReferenceAudit(ctx, db, out); // entity-ref-fields §4 (always on, --verify included)
      return;
    }
    const dang = db.prepare(`SELECT e.* FROM edges e
      LEFT JOIN _slug_aliases ea ON ea.alias=e.to_slug
      LEFT JOIN nodes n ON n.slug=COALESCE(ea.canonical,e.to_slug)
      WHERE n.slug IS NULL`).all();
    out(`doctor: ${dang.length} dangling edge targets`);
    dumpCapped(dang, e => `  ${e.from_slug} → ${e.verb} → ${e.to_slug} (no node)`);
    // brain-convergence §3: the me matrix (rewrites the user_card warn — the engine keys
    // on entity='me', no config pointer). A group store has NO subject (brain-profiles
    // §6): `group: true` silences the no-me warn, and only that.
    {
      // wave-2 F8: LIVE cards only — an archived/superseded me is the taught repair for
      // a duplicate, so it must clear the N-cards warn (and all-superseded = no subject).
      const meCount = db.prepare(`SELECT COUNT(*) c FROM nodes n WHERE n.entity='me' AND ${AVAILABILITY_COHORT_SQL('n')}`).get().c;
      if (meCount === 0 && !ctx.group)
        out(`no me card — the brain has no subject anchor (relations projection is off); mint one: brain new --entity me --slug me --description "<whose brain this is>"`);
      if (meCount > 1) out(`${meCount} me cards — a brain has ONE me; merge and supersede the rest`);
      if (rawConfigHasKey(root, 'user_card'))
        out(`stale user_card key — the me card replaced it (INSTALL §Upgrading); delete the key`);
    }
    // brain-profiles §2: the profile posture, disclosed once (reads never lie — existing
    // cards of a disabled type stay fully served); the never-disableable floor warns.
    if (ctx.disabledEntities?.length)
      out(`config: ${ctx.disabledEntities.length} entities disabled (${ctx.disabledEntities.join(', ')})`);
    for (const e of ctx.disabledEntitiesIgnored || [])
      out(`disabled_entities names '${e}' — ${e === 'note' ? 'notes' : 'contexts'} must stay writable; entry ignored`);
    // context-entity §6: the role_card matrix is replaced. `contexts` is the bootstrap read —
    // there is no config key to dangle, so the checks are (1) no desks minted, (2) the stale
    // legacy key, (3) a registry that still authors 'role'. Cases 1+2 here; 3 rides the
    // registry advisories below; the context-less sweep rides the card sweeps further down.
    if (!db.prepare(`SELECT 1 FROM nodes WHERE entity='context' LIMIT 1`).get()
      && db.prepare(`SELECT 1 FROM nodes WHERE class='card' LIMIT 1`).get())
      out(`no contexts minted — retrieval has no desks; mint one: a context card with profile.name + profile.mission`);
    if (rawConfigHasKey(root, 'role_card'))
      out(`stale role_card key — roles were replaced by contexts (INSTALL §Upgrading: role → context ritual); remove the key after migrating`);
    const hist = db.prepare(`SELECT entity, COUNT(*) c FROM nodes GROUP BY entity ORDER BY c DESC`).all();
    out('entities: ' + hist.map(h => `${h.entity ?? '(none)'}:${h.c}`).join(' '));
    // index_errors surfaced (spec §4 promise): malformed frontmatter / out-of-subset lines
    const errN = db.prepare(`SELECT COUNT(*) c FROM errors`).get().c;
    if (errN) {
      out(`index errors: ${errN}`);
      db.prepare(`SELECT path, problem FROM errors LIMIT 20`).all().forEach(e => out(`  ${path.basename(e.path)}: ${e.problem}`));
      if (errN > 20) out(`  …and ${errN - 20} more`);
    }
    // registry validation (H4): parse state, alias targets, conjugation/inverse refs
    const rp = validateRegistry(ctx.reg, db);
    const rewriteProblems = ctx.regState.rewriteProblems || [];
    out(`registry: ${ctx.regState.parseError ? `CORRUPT (${ctx.regState.parseError}) — running on seed` : ctx.regState.futureFormat != null ? `FUTURE FORMAT ${ctx.regState.futureFormat} — semantic reads/rebuilds/writes blocked (engine supports ${REG_FORMAT})` : rewriteProblems.length ? `NEEDS HAND REPAIR — rewrites blocked (${Object.keys(ctx.reg.entities).length} parsed entities)` : `ok (${Object.keys(ctx.reg.entities).length} entities, ${Object.keys(ctx.reg.verbs || {}).length} custom verbs, ${Object.keys(ctx.reg.aliases || {}).length} aliases)`}`);
    rewriteProblems.forEach(p => out(`  ⚠ rewrite blocked: ${p}`));
    rp.forEach(p => out(`  ⚠ ${p}`));
    seedShadowAdvisories(ctx.regState).forEach(p => out(`  ⚠ ${p}`)); // brain-convergence §2 — advisory, never a gate
    // context-entity §6 case 3: 'role' left the seed, so an entities row for it can only be
    // AUTHORED — an install mid-ritual (or one that never ran it). Advisory, never a gate.
    if (hasOwnKey(ctx.reg.entities, 'role'))
      out(`  ⚠ the registry still authors 'role' — roles were replaced by contexts; finish the INSTALL §Upgrading ritual (tombstone last)`);
    // ontology-cleanup §8: one disclosure line, both states. Info, not a warn.
    out(`schema: ${ctx.schemaLock ? 'locked' : 'UNLOCKED (ad-hoc type creation possible)'}`);
    // bug #25: unparseable registry lines preserved verbatim (count + first few) — signal only.
    // Silent on a clean registry (test-pa), so bare doctor stays uncluttered there.
    if (ctx.regState.unparseable.length) {
      out(`registry unparseable lines: ${ctx.regState.unparseable.length} (preserved verbatim under "# UNPARSEABLE — fix by hand:"):`);
      ctx.regState.unparseable.slice(0, 5).forEach(u => out(`  ⚠ [${u.section || '?'}] ${u.line.slice(0, 70)}`));
    }
    // Bare doctor already inspects current source for typed-field signals. Detect
    // unresolved conflicts first and exclude those slugs from every later semantic
    // diagnosis: doctor must request repair, never lint an arbitrarily parsed arm.
    const unresolvedConflicts = [];
    const conflictSlugs = new Set();
    const currentFmBySlug = new Map();
    for (const r of db.prepare(`SELECT slug FROM nodes`).all()) {
      try {
        const text = fs.readFileSync(nodePath(root, r.slug), 'utf8');
        if (hasConflictMarkers(conflictRegion(text))) {
          unresolvedConflicts.push(r.slug);
          conflictSlugs.add(r.slug);
        } else currentFmBySlug.set(r.slug, parseFrontmatter(text)?.fm ?? null);
      } catch { /* verify covers missing/unreadable files */ }
    }
    if (unresolvedConflicts.length) {
      out(`unresolved VCS conflicts requiring repair: ${unresolvedConflicts.length}`);
      dumpCapped(unresolvedConflicts, slug => `  ⚠ ${slug}: unresolved VCS conflict requires repair; no branch is live truth — resolve the source conflict, then: brain sync --slug ${slug}`);
    }
    const today = ctx.today();
    const openObligationsNoDue = db.prepare(`SELECT slug FROM nodes WHERE entity='obligation' AND class='future' AND due IS NULL
      AND ${openFutureSQL('nodes')} ORDER BY slug`).all().filter(r => !conflictSlugs.has(r.slug));
    if (openObligationsNoDue.length) {
      out(`open obligations with no due: ${openObligationsNoDue.length}`);
      dumpCapped(openObligationsNoDue, r => `  ⚠ ${r.slug}`);
    }
    // working-memory §4: the config-pointer matrix (the role_card 3-state shape, ▲D1
    // conditional-unset refinement) + the FIRST consumer of date_updated (staleness) and
    // the brief-not-a-journal size signal. Doctor hard-codes the entity name — the ONE
    // deliberate variant-entity exception (working-memory §1): every sweep is inert in a
    // store that never mints the entity. Signals, never gates.
    {
      // wave-2 F8: LIVE cards only — the superseded losers of the taught merge repair
      // must not keep the N-cards warn firing.
      const wmCount = db.prepare(`SELECT COUNT(*) c FROM nodes n WHERE n.entity='working-memory' AND ${AVAILABILITY_COHORT_SQL('n')}`).get().c;
      if (ctx.workingMemory == null) {
        if (wmCount > 0) out(`working_memory not set in __meta/config.json but a working-memory card exists — session start won't load it`);
      } else {
        const resolved = resolveSlug(ctx.reg, ctx.workingMemory, db);
        const r = db.prepare(`SELECT entity, status FROM nodes WHERE slug=?`).get(resolved);
        if (!r) out(`configured working_memory '${ctx.workingMemory}' has no such node`);
        else if (r.entity !== 'working-memory') out(`'${ctx.workingMemory}' is not a working-memory card (entity 'working-memory' required)`);
        // the pointer must be LIVE (the availability cohort): a retired card passing
        // doctor keeps the SessionStart hook injecting a superseded brief.
        else if (r.status === 'superseded' || r.status === 'archived')
          out(`configured working_memory '${ctx.workingMemory}' is ${r.status} — repoint to the live card (jq '.working_memory = "<live-slug>"' brain/__meta/config.json > brain/__meta/config.json.tmp && mv brain/__meta/config.json.tmp brain/__meta/config.json)`);
        else if (!conflictSlugs.has(resolved)) {
          const fm = currentFmBySlug.get(resolved);
          const updated = typeof fm?.date_updated === 'string' && isIsoDate(fm.date_updated) ? fm.date_updated : null;
          const days = updated ? elapsedDaysISO(updated, today) : null;
          if (days != null && days > WORKING_MEMORY_STALE_DAYS)
            out(`working memory unchanged in ${days} days — a stale brief misleads every session start; rewrite it (brain body ${resolved}) or clear the shipped threads`);
          try {
            const wmBody = parseFrontmatter(fs.readFileSync(nodePath(root, resolved), 'utf8'))?.body ?? '';
            const bytes = Buffer.byteLength(wmBody, 'utf8');
            if (bytes > WORKING_MEMORY_SIZE_BYTES)
              out(`working memory is a brief, not a journal (${(bytes / 1024).toFixed(1)} KB) — distill; history belongs in records`);
          } catch { /* verify covers missing/unreadable files */ }
        }
      }
      if (wmCount > 1) out(`${wmCount} working-memory cards — working memory is ONE card; merge and supersede the rest`);
    }
    // brain-profiles §3: nothing runs on its own (no daemons, no clock) — the daily
    // freeze is a taught next-session act; doctor signals open PAST-day memory cards
    // (judged by the dated-slug convention; a free-slug memory has no day to judge).
    const openPastMemories = db.prepare(`SELECT slug FROM nodes WHERE entity='memory' AND class='card' ORDER BY slug`).all()
      .filter(r => !conflictSlugs.has(r.slug))
      .filter(r => {
        const day = /-(\d{4}-\d{2}-\d{2})$/.exec(r.slug)?.[1] ?? /^(\d{4}-\d{2}-\d{2})-/.exec(r.slug)?.[1] ?? null;
        return day != null && isIsoDate(day) && day < today;
      });
    if (openPastMemories.length) {
      out(`${openPastMemories.length} memory cards from past days are still open — freeze them (brain freeze memory-<date>)`);
      dumpCapped(openPastMemories, r => `  ⚠ ${r.slug}`);
    }
    // context-retrieval §4/§5: unmigrated focus: blocks — byte-safe indefinitely (the
    // serializer round-trips them), semantically inert; the signal is the migration pointer.
    const legacyFocusBlocks = [];
    for (const [slug, fm] of currentFmBySlug) {
      if (!fm || conflictSlugs.has(slug) || fm.focus == null) continue;
      legacyFocusBlocks.push(LEGACY_FOCUS_BLOCK_SIGNAL({ slug }));
    }
    if (legacyFocusBlocks.length) {
      out(`legacy focus: blocks: ${legacyFocusBlocks.length}`);
      dumpCapped(legacyFocusBlocks, p => `  ⚠ ${p}`);
    }
    const obligationCadenceRows = []; // O1: the stored-state backstop (same predicate as the write warn)
    for (const [slug, fm] of currentFmBySlug) {
      if (!fm || conflictSlugs.has(slug)) continue;
      const o1 = obligationCadenceSignal(ctx.reg, fm); if (o1) obligationCadenceRows.push(`${slug}: ${o1}`);
    }
    if (obligationCadenceRows.length) {
      out(`obligations roll can't compute: ${obligationCadenceRows.length}`);
      dumpCapped(obligationCadenceRows, p => `  ⚠ ${p}`);
    }
    const requiredFieldRows = []; // R1: stored-state backstop for the create-path required warn (same predicate, doctrine rule 3)
    for (const [slug, fm] of currentFmBySlug) {
      if (!fm || !fm.entity || conflictSlugs.has(slug)) continue;
      profileSignals(ctx.reg, fm.entity, fm.profile || {}, { checkRequired: true })
        .filter(p => / is required for /.test(p))
        .forEach(p => requiredFieldRows.push(`${slug}: ${p}`));
    }
    if (requiredFieldRows.length) {
      out(`missing required profile fields: ${requiredFieldRows.length}`);
      dumpCapped(requiredFieldRows, p => `  ⚠ ${p}`);
    }
    const partOfCycleRows = new Map();
    let topologyTruncated = false;
    for (const [slug, fm] of currentFmBySlug) {
      if (!fm || conflictSlugs.has(slug)) continue;
      const { cycles, truncated } = partOfCyclesFrom(ctx, db, slug);
      topologyTruncated ||= truncated;
      for (const cycle of cycles)
        partOfCycleRows.set(canonicalCycleKey(cycle), cycle);
    }
    if (partOfCycleRows.size) {
      out(`part_of cycles: ${partOfCycleRows.size}`);
      dumpCapped([...partOfCycleRows.values()], cycle => `  ⚠ ${partOfCycleSignal(cycle)}`);
    }
    if (topologyTruncated)
      out(`  ⚠ part_of topology analysis truncated at depth 200 — cycle detection incomplete: a chain longer than the walk budget may hide a cycle. Break the deep chain into segments under 200, or restructure, then re-run doctor`);
    const toolUnwiredRows = [];
    for (const [slug, fm] of currentFmBySlug) {
      if (!fm || conflictSlugs.has(slug) || fm.entity !== 'tool') continue;
      if (fm.status === 'archived' || fm.status === 'superseded') continue;
      if (toolIsUnwired(fm.relations)) toolUnwiredRows.push({ slug });
    }
    if (toolUnwiredRows.length) {
      out(`tool cards with no serves or in_context edge: ${toolUnwiredRows.length}`);
      dumpCapped(toolUnwiredRows, r => `  ⚠ ${r.slug}: ${toolUnwiredBody(r.slug)}`);
    }
    // context-entity §6 case 4: the "every card gets a desk" teeth — advisory, ZERO GATES.
    // SKIPPED ENTIRELY when no context card exists: its remedy (`--to <context>`) is
    // unfollowable with zero contexts, and case 1 ("no contexts minted") already teaches
    // the one act that helps. "Any live edge touching a context card" (either direction)
    // counts as placed, so an order bound FROM the base context is placed without naming
    // one variant entity here.
    const contextSlugs = new Set(db.prepare(`SELECT slug FROM nodes WHERE entity='context'`).all().map(r => r.slug));
    if (contextSlugs.size) {
      // Alias endpoints are resolved ONCE against the registry (small) instead of calling
      // resolveSlug per edge row: a real node always shadows an alias (resolveSlug's rule),
      // so shadowed alias names drop out of the map here and resolve to themselves below.
      const aliasTo = new Map();
      const isNode = db.prepare(`SELECT 1 FROM nodes WHERE slug=?`);
      for (const [name, a] of Object.entries(ctx.reg.aliases || {}))
        if (a?.kind === 'slug' && !isNode.get(name)) aliasTo.set(name, a.to);
      // …and the edge scan is restricted in SQL to edges that actually touch a context
      // (canonical slug or a live alias of one), not the whole edges table.
      const contextNames = [...contextSlugs, ...[...aliasTo].filter(([, to]) => contextSlugs.has(to)).map(([name]) => name)];
      const cslots = sqlSlots(contextNames);
      const placedInContext = new Set();
      for (const e of db.prepare(`SELECT DISTINCT e.from_slug, e.to_slug FROM edges e
        WHERE ${edgeSourceLiveSQL('e')} AND (e.to_slug IN (${cslots}) OR e.from_slug IN (${cslots}))`)
        .all(...contextNames, ...contextNames)) {
        const from = aliasTo.get(e.from_slug) ?? e.from_slug, to = aliasTo.get(e.to_slug) ?? e.to_slug;
        if (contextSlugs.has(to)) placedInContext.add(from);
        if (contextSlugs.has(from)) placedInContext.add(to);
      }
      const contextLessRows = db.prepare(`SELECT slug, entity FROM nodes
        WHERE class='card' AND (entity IS NULL OR entity != 'context')
          AND (status IS NULL OR status NOT IN ('archived','superseded')) ORDER BY slug`).all()
        .filter(r => !conflictSlugs.has(r.slug) && !placedInContext.has(r.slug));
      if (contextLessRows.length) {
        out(`context-less cards: ${contextLessRows.length}`);
        dumpCapped(contextLessRows, r => `  ⚠ ${r.slug} (${r.entity ?? 'no entity'}) — no live edge touching a context card; place it (brain link ${r.slug} --verb in_context --to <context> --why "…"), or keep it deliberately`);
      }
    }
    const staleSkillRows = [];
    for (const [slug, fm] of currentFmBySlug) {
      if (!fm || conflictSlugs.has(slug) || fm.entity !== 'skill') continue;
      if (fm.status === 'archived' || fm.status === 'superseded') continue;
      const lv = ownValue(fm.profile || {}, 'last_verified');
      const verified = typeof lv === 'string' && isIsoDate(lv);
      const anchor = verified ? lv : fm.date_created;
      if (typeof anchor === 'string' && isIsoDate(anchor) && addMonthsISO(anchor, PROFILE_STALE_MONTHS) <= today)
        staleSkillRows.push({ slug, months: elapsedMonthsISO(anchor, today), verified });
    }
    if (staleSkillRows.length) {
      out(`skills unverified in ${PROFILE_STALE_MONTHS}+ months: ${staleSkillRows.length}`);
      dumpCapped(staleSkillRows, r => `  ⚠ ${r.slug}: ${r.verified ? `last verified ${r.months}mo ago` : `never verified, created ${r.months}mo ago`} — re-verify (brain set ${r.slug} --field profile.last_verified --to <today>), or keep it deliberately`);
    }
    const temporalClassSignals = [];
    // source frontmatter (not the index row) so T3's expires/renews — never indexed as columns — are seen too
    for (const [slug, fm] of currentFmBySlug) {
      if (!fm || conflictSlugs.has(slug)) continue;
      nodeLint(ctx.reg, { slug, ...lintSrcFromFm(fm) })
        .filter(p => /due belongs only on a future|occurred belongs only on a record|record without occurred|record with status|record with expires|record with renews/.test(p)) // dueClass/occurredClass + T1/T2/T3
        .forEach(p => temporalClassSignals.push(p));
    }
    if (temporalClassSignals.length) {
      out(`temporal class signals: ${temporalClassSignals.length}`);
      dumpCapped(temporalClassSignals, p => `  ⚠ ${p}`);
    }
    const typedFieldSignals = [];
    for (const r of db.prepare(`SELECT slug FROM nodes`).all()) {
      if (conflictSlugs.has(r.slug)) continue;
      const fm = currentFmBySlug.get(r.slug);
      if (fm) {
        nodeLint(ctx.reg, { slug: r.slug, ...fm }, { frontmatterFieldsOnly: true })
          .filter(p => / is not an ISO date | is not a boolean /.test(p))
          .forEach(p => typedFieldSignals.push(`${r.slug}: ${p}`)); // bug #76
      }
    }
    if (typedFieldSignals.length) {
      out(`typed field signals: ${typedFieldSignals.length}`);
      typedFieldSignals.forEach(p => out(`  ⚠ ${p}`));
    }
    const updatedCapacitySignals = [];
    for (const [slug, fm] of currentFmBySlug) {
      const advisory = updatedCapacityAdvisory({ slug, ...fm });
      if (advisory) updatedCapacitySignals.push(advisory);
    }
    if (updatedCapacitySignals.length) {
      out(`updated[] capacity advisories: ${updatedCapacitySignals.length}`);
      dumpCapped(updatedCapacitySignals, p => `  ⚠ ${p}`);
    }
    const overBudgetSignals = [];
    const staleProfileSignals = [];
    for (const r of db.prepare(`SELECT slug, path, entity FROM nodes`).all()) {
      if (conflictSlugs.has(r.slug)) continue;
      const budgeted = budgetedListProfileFields(ctx.reg, r.entity);
      if (!budgeted.length) continue;
      const fm = currentFmBySlug.get(r.slug);
      if (!fm) continue;
      profileSignals(ctx.reg, r.entity, fm.profile || {}, { checkBudget: true })
        .filter(p => /profile\.[^. ]+ over budget /.test(p))
        .forEach(p => overBudgetSignals.push({ slug: r.slug, msg: p }));
      for (const [field] of budgeted) {
        const value = ownValue(fm.profile, field);
        if (!Array.isArray(value) || value.length === 0) continue;
        const touched = (fm.updated || [])
          .filter(u => u?.x === `profile.${field}` && isIsoDate(u.y))
          .map(u => u.y)
          .sort()
          .at(-1);
        const lastTouch = touched || fm.date_created;
        if (isIsoDate(lastTouch) && addMonthsISO(lastTouch, PROFILE_STALE_MONTHS) <= today)
          staleProfileSignals.push({ entity: r.entity, field, months: elapsedMonthsISO(lastTouch, today) });
      }
    }
    if (overBudgetSignals.length) {
      out(`over-budget profile fields: ${overBudgetSignals.length}`);
      overBudgetSignals.forEach(p => out(`  ⚠ ${p.slug}: ${p.msg}`));
    }
    if (staleProfileSignals.length) {
      out(`profile staleness: ${staleProfileSignals.length}`);
      staleProfileSignals.forEach(p => out(`  ⚠ ${p.entity}.${p.field} unchanged in ${p.months} months — verify with the operator`));
    }
    const terminalFutures = db.prepare(`SELECT slug FROM nodes WHERE class='future' AND status IN (${TERMINAL_STATUS_SQL}) AND occurred IS NULL ORDER BY slug`)
      .all().filter(r => !conflictSlugs.has(r.slug));
    if (terminalFutures.length) {
      out(`terminal futures never frozen: ${terminalFutures.length}`);
      dumpCapped(terminalFutures, r => `  ⚠ ${LINT_MSG.terminalFutureNeverFrozen(r)}`);
    }
    const slugDateSignals = db.prepare(`SELECT slug, class, occurred, created, due FROM nodes`).all() // due: T5 future-half
      .filter(r => !conflictSlugs.has(r.slug)).map(slugDateSignal).filter(Boolean);
    if (slugDateSignals.length) {
      out(`slug-date signals: ${slugDateSignals.length}`);
      dumpCapped(slugDateSignals, p => `  ⚠ ${p}`);
    }
    // the forgotten brain (H23): count + age so it can't grow invisibly. No auto-purge
    // — deletion is an operator ritual (design in the wave report; discretion call is the operator's).
    const fdir = forgottenDir(root);
    const ffiles = fs.existsSync(fdir) ? fs.readdirSync(fdir).filter(f => f.endsWith('.md')) : [];
    let oldest = null;
    for (const f of ffiles) { try { const m = fs.statSync(path.join(fdir, f)).mtimeMs; if (oldest === null || m < oldest) oldest = m; } catch { /* ok */ } }
    const ageDays = oldest === null ? null : Math.floor((Date.now() - oldest) / 86400000);
    out(`forgotten: ${ffiles.length} archived node${ffiles.length === 1 ? '' : 's'} in brain/__forgotten/${ageDays !== null ? ` (oldest ${ageDays}d)` : ''}`);
    asksLedgerAudit(ctx, out); // ask-ledger §1.6: stale open asks + b15 same-invocation-answer signature
    profileReferenceAudit(ctx, db, out); // entity-ref-fields §4 (always on)
}

// ask-ledger §1.6 doctor audit (reads the ledger file, no index): open asks older than 7 days that
// were never answered, and answered rows whose answered_at == raised_at — the b15 signature (a model
// answered the blocking ask in the same invocation it was raised, never relaying it). Reports counts
// + capped examples; NEVER blocks and never asks (doctrine rule 2). Also surfaces parse warnings.
const ASKS_STALE_DAYS = 7;
function asksLedgerAudit(ctx, out) {
    const { rows, warnings } = readAsksLedger(ctx.root);
    const today = ctx.today();
    const cap = (items, render) => { items.slice(0, 20).forEach(i => out(render(i))); if (items.length > 20) out(`  …and ${items.length - 20} more`); };
    const stale = rows.filter(r => r.status === 'open' && isIsoDate(String(r.raised_at).slice(0, 10))
      && Math.round((isoDateUTC(today) - isoDateUTC(String(r.raised_at).slice(0, 10))) / 86400000) > ASKS_STALE_DAYS);
    if (stale.length) {
      out(`stale open asks (>${ASKS_STALE_DAYS}d unanswered): ${stale.length}`);
      cap(stale, r => `  ⚠ ${r.id} (${r.slug}) raised ${r.raised_at} — relay it or answer: brain asks --open`);
    }
    const sameInvocation = rows.filter(r => r.status === 'answered' && r.answered_at && r.answered_at === r.raised_at);
    if (sameInvocation.length) {
      out(`same-invocation ask answers (b15 signature — answered as raised): ${sameInvocation.length}`);
      cap(sameInvocation, r => `  ⚠ ${r.id} (${r.slug}) ${r.answered_with} at ${r.answered_at} — minted and answered in one call`);
    }
    warnings.forEach(w => out(`  ⚠ asks ledger: ${w}`));
}

function cmdLint(ctx, [target], flags) {
    const { out } = ctx.io;
    // migration pre-linter (H18): validate a candidate node file's frontmatter subset
    // + slug BEFORE it enters brain/__source/. Reads a path arg or stdin. Exit non-zero
    // if not import-ready. Needs no index — safe to run mid-migration.
    let text, name;
    if (target) { text = fs.readFileSync(target, 'utf8'); name = path.basename(target).replace(/\.md$/, ''); }
    else { try { text = fs.readFileSync(0, 'utf8'); } catch { die('lint needs a file path or piped stdin'); } name = flags.slug || 'stdin'; }
    const probs = [];
    const advisories = [];
    if (ctx.regState.parseError) probs.push(`registry is corrupt (${ctx.regState.parseError}); entity/profile validation cannot be trusted`);
    else if (ctx.regState.futureFormat != null) probs.push(`registry format ${ctx.regState.futureFormat} is newer than this engine; entity/profile validation cannot be trusted`);
    else (ctx.regState.rewriteProblems || []).forEach(p => probs.push(`registry needs hand repair: ${p}`));
    const sl = slugLint(name); if (sl && name !== 'stdin') probs.push(sl);
    const parsed = parseFrontmatter(text);
    if (!parsed) probs.push('no frontmatter fence (--- … ---)');
    else {
      (parsed.errors || []).forEach(e => probs.push(e));
      const fm = parsed.fm;
      // bug #27: an alien frontmatter field or a §2 scalar field carrying a list makes a
      // candidate NOT import-ready (each problem named). The running registry now carries
      // both entity tenses and per-field profile schemas, so lint also checks typed profile
      // signals below and treats them as import-readiness problems.
      nodeLint(ctx.reg, lintSrcFromFm(fm), { importReady: true, checkRequired: true, checkBudget: true, capacityAdvisories: true, sourceExists: (s) => sourceSlugExists(ctx.root, s) }).forEach(p => {
        // T1/T2/T3/T5 + V2/V3 are warn-level (doctrine rule 6: imports pass with warns, never block) — advisory, not import-blocker
        // (the legacy focus: block signal too — unmigrated blocks are safe indefinitely, context-retrieval §4)
        if (/profile\.[^. ]+ over budget |updated\[\] (?:near|at|over) capacity|record without occurred|record with status|record with expires|record with renews|carries a full date prefix but is a card|leading date .* ≠ due |is a number with no currency|is not a 3-letter|legacy focus: block/.test(p)) advisories.push(p);
        else probs.push(p);
      });
    }
    if (probs.length) { out(`lint ${name}: ${probs.length} problem(s) — NOT import-ready`); probs.forEach(p2 => out('  ✗ ' + p2)); process.exitCode = 1; } // A4: lint is top-level-only; embedded doors run READ_OK.
    else out(`lint ${name}: clean — import-ready`);
    advisories.forEach(p => out(`  ⚠ ${p} (advisory — does not block import)`));
}

function cmdFiles(ctx, _args, flags) {
    const { out } = ctx.io;
    // raw artifacts (files/ tier) reachable from a slug's neighborhood — surfaces
    // profile.file / profile.url on the node itself and on nodes that edge into it.
    const db = requireDb(ctx);
    installCurrentSourceConflictGuard(ctx, db);
    if (!flags.for) die(`files --for <slug>`);
    assertReadSlug(flags.for, 'files --for');
    const slug = resolveSlug(ctx.reg, flags.for, db);
    const names = slugReadNames(ctx, ctx.reg, slug, db), slots = sqlSlots(names);
    if (!currentSourceIsConflictFree(db, slug))
      die(`'${slug}' has unresolved VCS conflict markers — unresolved VCS conflict requires repair; refusing files --for rather than projecting stale profile fields. Resolve the source conflict, then: brain sync --slug ${slug}`);
    const node = db.prepare(`SELECT 1 FROM nodes n WHERE n.slug=? AND ${currentSourceConflictFreeSQL('n')}`).get(slug);
    if (!node && !db.prepare(`SELECT 1 FROM edges e WHERE (e.from_slug IN (${slots}) OR e.to_slug IN (${slots})) AND ${edgeSourceLiveSQL('e')} LIMIT 1`).get(...names, ...names)) die(`no node '${slug}'`);
    const slugs = new Set([slug]);
    db.prepare(`SELECT e.from_slug FROM edges e WHERE e.to_slug IN (${slots}) AND ${edgeSourceLiveSQL('e')}`).all(...names).forEach(e => slugs.add(resolveSlug(ctx.reg, e.from_slug, db)));
    const rows = [];
    for (const s of slugs) {
      const n = db.prepare(`SELECT n.slug, n.entity, n.profile_json FROM nodes n WHERE n.slug=?
        AND ${currentSourceConflictFreeSQL('n')}`).get(s);
      if (!n) continue;
      const prof = JSON.parse(n.profile_json || '{}');
      if (prof.file || prof.url) rows.push({ slug: s, entity: n.entity, file: prof.file, url: prof.url });
    }
    out(`files --for ${flags.for}: ${rows.length}`);
    rows.forEach(r => out(`  ${r.slug} (${r.entity})${r.file ? `  file: ${r.file}` : ''}${r.url ? `  url: ${r.url}` : ''}`));
    if (!rows.length) out(`  (no files/ artifacts linked — attach one: reference node with profile.file + about → ${slug})`);
}

const skillRow = r => `  ${r.slug}  — ${r.description ?? ''}`
  + (r.prof.cadence ? `  (cadence: ${r.prof.cadence})` : '')
  + (r.prof.last_verified ? `  [verified ${r.prof.last_verified}]` : '');
const toolRow = r => `  ${r.slug}`
  + (r.prof.command ? `  command: ${r.prof.command}` : '')
  + (r.prof.path ? `  path: ${r.prof.path}` : '')
  + (r.prof.data ? `  data: ${r.prof.data}` : '')
  + (r.prof.url ? `  url: ${r.prof.url}` : '');
const toolHint = (slug) => `(no tools linked — attach one: tool card with profile.command + serves → ${slug})`;
const skillHint = (slug, _db, verbs) =>
  verbs.length > 1
    ? `(no skills attached — attach one: skill card with serves → ${slug} (availability) or part_of → ${slug} (sub-skill/task))`
    : verbs[0] === 'part_of'
      ? `(no sub-skills/tasks — attach one: skill card with part_of → ${slug})`
      : `(no skills available — attach one: skill card with serves → ${slug})`;

function anchorDispatchVerbs(db, slug) {
  const n = db.prepare(`SELECT entity FROM nodes n WHERE n.slug=?`).get(slug);
  if (!n) return ['serves', 'part_of'];
  if (n.entity === 'skill' || n.entity === 'tool') return ['part_of'];
  return ['serves'];
}

// UDF-free (mirrors anchorDispatchVerbs): the availability --for reads never anchor on a
// context — membership is in_context, and `brain context <slug>` is the read that serves it.
function assertNotContextAnchor(db, slug) {
  const n = db.prepare(`SELECT entity FROM nodes n WHERE n.slug=?`).get(slug);
  if (n?.entity === 'context')
    die(`'${slug}' is a context — availability in a context rides in_context: brain context ${slug}`);
}

function quarantinedAttachmentScan(ctx, db, { entity, verbs, anchorSlug }) {
  const out = new Set();
  for (const r of db.prepare(`SELECT path FROM errors ORDER BY path`).all()) {
    const p = String(r.path);
    const slug = path.basename(p).replace(/\.md$/, '');
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    // An errors row can carry harmless preserved parser diagnostics (out-of-subset
    // lines) on a source that stayed LIVE — that node is served by the indexed path
    // below, so refusing here would be a false "unresolved conflict". Only a non-live
    // (conflicted/quarantined) source suppresses an availability read.
    if (sourceIndexState(ctx, slug, text).live) continue;
    if (sourceAttachmentMatches(ctx, db, text, { entity, verbs, anchorSlug })) out.add(slug);
  }
  return [...out].sort();
}

// entity === null is the entity-agnostic mode (the context roster collects EVERY entity):
// the entity arm drops out entirely — the relation alone matches, agreeing with the
// row-collection SQL (which also drops its n.entity filter). Requiring an entity line here
// would silently drop a conflicted/quarantined member that has none, which is exactly the
// silent omission the suppression refusal exists to prevent.
function sourceAttachmentMatches(ctx, db, text, { entity, verbs, anchorSlug }) {
  const verbSet = new Set(verbs);
  const armMatch = (facts) => (entity == null ? true : facts.entities.includes(entity))
    && facts.relations.some(rel => verbSet.has(rel.verb) && resolveSlug(ctx.reg, rel.to, db) === anchorSlug);
  // per-VERSION first (F4, version-composed in sol rev 3): entity and relation must co-occur
  // in the SAME authored version — two arms of ONE hunk never mix, while arm choices across
  // hunks compose with the shared context (conflictVersionTexts). A flattened union would
  // correlate an entity from arm A with a relation from arm B and refuse a read no single
  // authored version ever described.
  for (const armFacts of rawSourceFactsPerHead(text)) if (armMatch(armFacts)) return true;
  // the whole-file parse is the authoritative single "arm" for a clean/quarantined file.
  // A CONFLICTED file is excluded here: last-value-wins folding would merge arms back into
  // one flattened fact set and resurrect the cross-arm false positive the per-arm pass
  // above exists to kill (F4).
  const parsed = hasConflictMarkers(text) ? null : parseFrontmatter(text);
  if (parsed?.fm) {
    const facts = { entities: parsed.fm.entity != null ? [parsed.fm.entity] : [], relations: [] };
    for (const item of parsed.fm.relations || [])
      for (const k of Object.keys(item)) { if (k !== 'why' && item[k] != null) facts.relations.push({ verb: k, to: String(item[k]) }); }
    if (armMatch(facts)) return true;
  }
  return false;
}

function staleIndexedAttachmentScan(ctx, db, { entity, verbs, anchorSlug, anchorNames }) {
  const vslots = verbs.map(() => '?').join(',');
  const slots = sqlSlots(anchorNames);
  const out = new Set();
  const candidates = db.prepare(`SELECT DISTINCT e.from_slug FROM edges e
    WHERE e.verb IN (${vslots}) AND e.to_slug IN (${slots})`).all(...verbs, ...anchorNames);
  for (const r of candidates) {
    const slug = resolveWriteSlug(ctx, String(r.from_slug));
    let text;
    try { text = fs.readFileSync(nodePath(ctx.root, slug), 'utf8'); } catch { continue; }
    if (sourceIndexState(ctx, slug, text).live) continue;
    if (sourceAttachmentMatches(ctx, db, text, { entity, verbs, anchorSlug })) out.add(slug);
  }
  return [...out].sort();
}

// An attached provider can be conflicted with NO index footprint at all: authored (or
// retargeted from another anchor) and never reconciled — no live row, no old indexed
// edge into this anchor, no errors row. The source directory is the only truth for
// those, so scan it with the same non-live predicate the other scans use. The Set
// union in servesLookup dedupes the overlap with both.
function conflictedSourceAttachmentScan(ctx, db, { entity, verbs, anchorSlug }) {
  const dir = path.join(ctx.root, 'brain', '__source');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); }
  catch { return []; } // an absent source directory has no attachments to suppress
  const out = new Set();
  for (const file of files) {
    const slug = file.slice(0, -3);
    let text;
    try { text = fs.readFileSync(path.join(dir, file), 'utf8'); } catch { continue; }
    if (sourceIndexState(ctx, slug, text).live) continue;
    if (sourceAttachmentMatches(ctx, db, text, { entity, verbs, anchorSlug })) out.add(slug);
  }
  return [...out].sort();
}

// Row collection for every availability read (skills/tools --for AND the context roster).
// Provenance scans run BEFORE the anchor-existence check (F4): an edge-only anchor
// whose only attachments are conflicted has no live node row and no live edges, so the
// old order died "no node" and never reached these scans — the mandated refusal naming
// the conflicted provider was unreachable for exactly the case that needed it.
// refuseLabel shapes the suppression message ("skills --for" / "tools --for" / "context").
// entity === null = ENTITY-AGNOSTIC mode (context-entity §4): the entity filter drops out
// of both the row query and the conflict scans, and each row carries its own entity so the
// renderer can group. A member whose entity is unregistered still returns a row — the
// conflict-honesty doctrine forbids exactly that silent drop.
function collectAvailability(ctx, db, { verb, entity, verbs, anchorSlug, anchorNames, refuseLabel, missingAnchorOk = false }) {
    const slots = sqlSlots(anchorNames);
    verbs = verbs || anchorDispatchVerbs(db, anchorSlug);
    const suppressed = new Set(staleIndexedAttachmentScan(ctx, db, { entity, verbs, anchorSlug, anchorNames }));
    if (db.prepare(`SELECT 1 FROM errors LIMIT 1`).get())
      quarantinedAttachmentScan(ctx, db, { entity, verbs, anchorSlug }).forEach(s => suppressed.add(s));
    conflictedSourceAttachmentScan(ctx, db, { entity, verbs, anchorSlug }).forEach(s => suppressed.add(s));
    const suppressedList = [...suppressed].sort();
    if (suppressedList.length)
      die(`${suppressedList.length} attached ${entity == null ? '' : `${entity} `}card(s) suppressed by unresolved source conflicts (${suppressedList.slice(0, 5).join(', ')}${suppressedList.length > 5 ? ', …' : ''}) — refusing ${refuseLabel || `${verb} --for`} rather than silently omitting them. Resolve the source conflicts, then: brain sync --slug <slug>`);
    const node = db.prepare(`SELECT 1 FROM nodes n WHERE n.slug=? AND ${currentSourceConflictFreeSQL('n')}`).get(anchorSlug);
    if (!node && !db.prepare(`SELECT 1 FROM edges e WHERE (e.from_slug IN (${slots}) OR e.to_slug IN (${slots})) AND ${edgeSourceLiveSQL('e')} LIMIT 1`).get(...anchorNames, ...anchorNames)) {
      if (missingAnchorOk) return { rows: [], verbs }; // focus show on a pen with no focus card yet: 0 in, never a refusal
      die(`no node '${anchorSlug}'`);
    }
    const vslots = verbs.map(() => '?').join(',');
    const srcSlugs = db.prepare(`SELECT DISTINCT e.from_slug FROM edges e
      WHERE e.verb IN (${vslots}) AND e.to_slug IN (${slots}) AND ${edgeSourceLiveSQL('e')}`).all(...verbs, ...anchorNames)
      .map(e => resolveSlug(ctx.reg, e.from_slug, db));
    const rows = [];
    for (const s of new Set(srcSlugs)) {
      if (s === anchorSlug) continue;
      const n = db.prepare(`SELECT n.slug, n.entity, n.description, n.status, n.profile_json FROM nodes n
        WHERE n.slug=? ${entity == null ? '' : 'AND n.entity=?'} AND ${AVAILABILITY_COHORT_SQL('n')} AND ${currentSourceConflictFreeSQL('n')}`)
        .get(...(entity == null ? [s] : [s, entity]));
      if (!n) continue;
      rows.push({ slug: s, entity: n.entity, description: n.description, prof: JSON.parse(n.profile_json || '{}') });
    }
    rows.sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    return { rows, verbs };
}

function servesLookup(ctx, db, flags, { verb, entity, verbs, render, emptyHint }) {
    const { out } = ctx.io;
    installCurrentSourceConflictGuard(ctx, db);
    if (!flags.for) die(`${verb} --for <slug>`);
    assertReadSlug(flags.for, `${verb} --for`);
    const slug = resolveSlug(ctx.reg, flags.for, db);
    const names = slugReadNames(ctx, ctx.reg, slug, db);
    if (!currentSourceIsConflictFree(db, slug))
      die(`'${slug}' has unresolved VCS conflict markers — unresolved VCS conflict requires repair; refusing ${verb} --for rather than projecting stale rows. Resolve the source conflict, then: brain sync --slug ${slug}`);
    // context-entity §5: ONE gate for BOTH --for paths (skills dispatches; tools passes a
    // fixed ['serves']) — availability inside a context rides in_context, not serves, so a
    // context anchor must never print the misleading serves/part_of attach hint.
    assertNotContextAnchor(db, slug);
    const got = collectAvailability(ctx, db, { verb, entity, verbs, anchorSlug: slug, anchorNames: names });
    out(`${verb} --for ${flags.for}: ${got.rows.length}`);
    got.rows.forEach(r => out(render(r)));
    if (!got.rows.length) out(`  ${emptyHint(slug, db, got.verbs)}`);
}

function cmdSkills(ctx, _args, flags) {
    servesLookup(ctx, requireDb(ctx), flags, {
      verb: 'skills',
      entity: 'skill',
      render: skillRow,
      emptyHint: skillHint,
    });
}

function cmdTools(ctx, _args, flags) {
    servesLookup(ctx, requireDb(ctx), flags, {
      verb: 'tools',
      entity: 'tool',
      verbs: ['serves'],
      render: toolRow,
      emptyHint: toolHint,
    });
}

// Entity-group headings on the context roster. Cosmetic only — a wrong plural on an exotic
// custom entity misleads nobody; the slug rows underneath are the truth.
const pluralEntity = (e) => !e ? '(no entity)'
  : e === 'person' ? 'people'
    : /[^aeiou]y$/.test(e) ? `${e.slice(0, -1)}ies`
      : /(s|x|z|ch|sh)$/.test(e) ? `${e}es` : `${e}s`;
// The generic roster row: every entity that is not skill/tool (which keep their shipped
// renderers). Deliberately trivial — slug + profile.name, falling back to the description.
// A NULL-entity member carries no suffix — the `(no entity)` group heading above it IS the
// diagnosis; "unregistered entity" would be the wrong one. The suffix is for a non-null
// entity string that no registry entry covers.
const memberRow = (reg) => (r) => `  ${r.slug} — ${r.prof?.name ?? r.description ?? ''}`
  + (r.entity == null || ownValue(reg.entities, r.entity) ? '' : '  (unregistered entity)');
const contextRosterRow = (r) => {
  const parts = [r.prof?.name, r.prof?.mission ?? r.description].filter(v => v != null && String(v).trim() !== '');
  return `  ${r.slug}${parts.length ? ` — ${parts.join(': ')}` : ''}`;
};

// `brain contexts` — the roster of worlds: every live context card, slug-sorted, with
// active desks marked ● (context-retrieval §2). The agent's session-start read (and the
// bootstrap: there is no config key to point at one).
function cmdContexts(ctx, _args, _flags) {
    const { out } = ctx.io;
    const db = requireDb(ctx);
    installCurrentSourceConflictGuard(ctx, db);
    const act = activeContexts(ctx, db); // prunes stale entries; ⚠-lines suspended conflicts
    const rows = db.prepare(`SELECT n.slug, n.description, n.profile_json FROM nodes n
      WHERE ${LIVE_CONTEXT_SQL('n')} AND ${currentSourceConflictFreeSQL('n')}
      ORDER BY n.slug`).all()
      .map(n => ({ slug: n.slug, description: n.description, prof: JSON.parse(n.profile_json || '{}') }));
    out(`contexts (${rows.length}):`);
    const isActive = (slug) => slug === 'focus' || act.active.includes(slug); // focus is always active
    let activeShown = 0;
    rows.forEach(r => {
      const on = isActive(r.slug);
      if (on) activeShown++;
      out(on ? `●${contextRosterRow(r).slice(1)}` : contextRosterRow(r));
    });
    if (!rows.length) out(`  (no contexts — mint one: a context card with profile.name + profile.mission, optional prose via brain body <slug>)`);
    if (activeShown) out(`(active: ${activeShown} — members rank first in search; drop: brain context --drop <slug>)`);
}

// `brain context <slug> [<slug>…]` — sit down at the desk(s): the card's body plus the
// member ROSTER (grouped by entity, one line each), never the bodies. Each slug renders as
// its own section so provenance stays obvious; recognition first, recall on use.
// context-retrieval §2: the CLI read also RECORDS the slug(s) as active (idempotent);
// --drop unloads (never touches cards or edges — only the state file). Embedded reads
// print but never carry side-state.
// brain-teaching §1.4: --drop touches ranking state, never truth — retiring the desk
// itself has its own path, and the drop line names it.
const CONTEXT_DROP_NOTE = `note: drop only unloads the desk (ranking state, not truth) — to retire the desk itself: brain set <slug> --field status --to archived`;

function cmdContext(ctx, args, flags) {
    const { out } = ctx.io;
    const db = requireDb(ctx);
    if (flags.drop) {
      if (ctx.embeddedRead) die(`context --drop writes the loaded-desk state — run it top-level, never inside apply/batch`);
      installCurrentSourceConflictGuard(ctx, db);
      if (flags.all) {
        withActiveLock(ctx, () => writeActiveState(ctx, []));
        out(`dropped every desk (active: 0)`);
        out(CONTEXT_DROP_NOTE);
        return;
      }
      args.forEach(raw => assertReadSlug(raw, 'context --drop'));
      withActiveLock(ctx, () => {
        const remaining = new Set(readActiveState(ctx));
        for (const raw of args) {
          const slug = resolveSlug(ctx.reg, raw, db);
          if (slug === 'focus')
            die(`focus is always active — remove members instead: brain focus remove <slug>`);
          if (remaining.has(slug) || remaining.has(raw)) { remaining.delete(slug); remaining.delete(raw); out(`dropped ${slug}`); }
          else out(`${slug} was not active`);
        }
        writeActiveState(ctx, [...remaining]);
        out(`(active: ${remaining.size})`);
        out(CONTEXT_DROP_NOTE);
      });
      return;
    }
    if (!args.length) die(`context requires a slug (brain context <slug> [<slug>…])`);
    args.forEach(raw => assertReadSlug(raw, 'context'));
    installCurrentSourceConflictGuard(ctx, db);
    const loaded = [];
    args.forEach((raw, i) => {
      if (i) out('');
      const slug = resolveSlug(ctx.reg, raw, db);
      const names = slugReadNames(ctx, ctx.reg, slug, db);
      if (!currentSourceIsConflictFree(db, slug))
        die(`'${slug}' has unresolved VCS conflict markers — unresolved VCS conflict requires repair; refusing context rather than loading one unresolved branch. Resolve the source conflict, then: brain sync --slug ${slug}`);
      const node = db.prepare(`SELECT n.slug, n.entity, n.status, n.description, n.profile_json FROM nodes n WHERE n.slug=? AND ${currentSourceConflictFreeSQL('n')}`).get(slug);
      if (!node) die(missingNodeMsg(ctx, db, slug));
      if (node.entity !== 'context')
        die(`'${slug}' is entity '${node.entity}', not a context — the context read loads context cards only. For a thing's own attachments: brain relations ${slug}`);
      // F7: the SAME live-context predicate as ranking/pruning/the roster — a retired
      // desk refuses to load with teaching instead of loading, ranking nothing, and
      // being silently pruned on the next read.
      if (!db.prepare(`SELECT 1 FROM nodes n WHERE n.slug=? AND ${LIVE_CONTEXT_SQL('n')}`).get(slug))
        die(`'${slug}' is ${node.status} — a retired desk cannot be loaded (it ranks nothing and would only be pruned). Revive it first (brain set ${slug} --field status --del) or pick a live desk: brain contexts`);
      const prof = JSON.parse(node.profile_json || '{}');
      out(`context: ${slug} — ${prof.mission ?? node.description ?? ''}`);
      // Body from source truth (the md is truth, never the index) — free-form, optional.
      const parsed = parseFrontmatter(readSourceFileOrDie(ctx.root, slug));
      const body = parsed?.body ?? '';
      out('');
      if (body.trim()) out(body.replace(/\s+$/, ''));
      else out(`  (no body — optional prose: brain body ${slug})`);
      // One entity-agnostic collection; grouping happens here, in the renderer.
      const { rows } = collectAvailability(ctx, db, { verb: 'context', entity: null, verbs: ['in_context'], anchorSlug: slug, anchorNames: names, refuseLabel: 'context' });
      const groups = new Map();
      for (const r of rows) {
        const key = r.entity || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      for (const key of [...groups.keys()].sort()) {
        const render = key === 'skill' ? skillRow : key === 'tool' ? toolRow : memberRow(ctx.reg);
        out('');
        out(`${pluralEntity(key)} (${groups.get(key).length}):`);
        groups.get(key).forEach(r => out(render(r)));
      }
      out('');
      if (rows.length) out(`(full entry: brain get <slug> --body)`);
      else out(`  (nothing in this context — add one: brain link <thing> --verb in_context --to ${slug} --why "…")`);
      loaded.push(slug);
    });
    // Record the load AFTER every roster rendered (a refusal loads nothing). focus never
    // needs loading — it is implicitly always active. Embedded reads never record.
    if (!ctx.embeddedRead) {
      const toRecord = loaded.filter(s => s !== 'focus');
      if (toRecord.length) withActiveLock(ctx, () => {
        const active = readActiveState(ctx);
        for (const s of toRecord) if (!active.includes(s)) active.push(s);
        writeActiveState(ctx, active);
      });
    }
}

function cmdCount(ctx, _args, flags) {
    const { out } = ctx.io;
    checkFlags('count', flags, COUNT_VERB_FLAGS, 'read'); // C-12: count's OWN flag set — list-only flags are rejected, never silently swallowed
    assertReadDateFlags(flags); // F-16
    assertCohortFilterShapes(flags, ctx.reg);
    // cohort filters present → single filtered number; otherwise the class breakdown
    const cohort = COHORT_FILTER_FLAGS.some(k => flags[k] != null);
    if (flags.all === true && !cohort)
      die(`count --all needs at least one cohort filter — bare count already prints the class breakdown across every status, so --all alone changes nothing; add a filter or drop --all. Nothing executed`);
    const db = requireDb(ctx);
    installCurrentSourceConflictGuard(ctx, db);
    const norm = normalizeEdgeFilter(ctx, db, flags); // bug #64 + retained pre-rename endpoints
    flags = norm.flags;
    if (cohort) {
      const { sql, args } = listQuery(flags, 'COUNT(DISTINCT n.slug) c', norm.edgeTargets);
      const c = db.prepare(sql).get(...args).c;
      out(String(c));
      if (c === 0) console.error(zeroFacetHint(db, flags)); // hint to STDERR — stdout stays a bare number for scripts
      return;
    }
    db.prepare(`SELECT class, COUNT(*) c FROM nodes n WHERE ${currentSourceConflictFreeSQL('n')} GROUP BY class`)
      .all().forEach(r => out(`${r.class}: ${r.c}`));
}

// ===== SECTION: WRITE VERBS =====
function registerVerbsBestEffort(ctx, entries /* [{verb, example}] */) {
  // A10: node-triggered registry writes happen after the node commit, are idempotent,
  // and never throw past that commit point; a registry failure is a loud signal.
  const registered = [];
  for (const entry of entries || []) {
    const verb = entry?.verb;
    if (!verb || isKnownVerb(ctx.reg, verb)) continue;
    ctx.reg.verbs = ctx.reg.verbs || {};
    setOwn(ctx.reg.verbs, verb, { example: entry.example || `first use ${ctx.today()}` });
    registered.push(verb);
    if (!hasOwnKey(ctx.reg.conjugate, verb))
      console.error(`⚠ '${verb}' registered with no past tense — freeze will leave this edge unconjugated; add one: brain register --verb ${verb} --conjugate <past> (or edit brain/__meta/registry.md)`); // bug #8ii
  }
  if (registered.length) {
    try { saveRegistry(ctx); } // bug #79
    catch (e) {
      for (const verb of registered)
        console.error(`⚠ verb '${verb}' could not be registered (${e.message}) — the edge is committed; register it by hand: brain register --verb ${verb}`);
    }
  }
  return { registered };
}

function drainSignals(result) {
  for (const s of result.signals || []) console.error(s);
}

function assertApplyFrame(frame) {
  assertShape('apply frame', frame, ['id', 'ok'], ['id', 'ok', 'output', 'error', 'warn', 'index_pending', 'asks']);
  const payload = ['output', 'error', 'warn'].filter(k => frame[k] != null).length;
  if (payload > 1 && !frame.index_pending)
    die(`internal: apply frame shape violation — missing [] / unknown [ambiguous payload] (bug in the caller, not your input)`);
}

function normalizeOpBools(op) {
  for (const key of [...(ownValue(OP_BOOL_KEYS, op.op) || []), 'force']) {
    if (!Object.prototype.hasOwnProperty.call(op, key)) continue;
    if (typeof op[key] === 'boolean') continue;
    const got = typeof op[key] === 'string'
      ? `${JSON.stringify(op[key])} (a string; strings are truthy)`
      : `${JSON.stringify(op[key])} (${jsonType(op[key])})`;
    return `${key} must be a JSON boolean true/false — got ${got}`; // A3
  }
  return null;
}

function applyPreGroupFrame(op, payload) {
  const frame = { id: op?.id ?? null, ...payload };
  // Summary inventory is derived from this non-wire property. Every failure that occurs
  // before grouping still owns its lint-clean source slug; omitting it made failed_slugs
  // claim an empty batch even when a named write failed at bool/op/read normalization.
  if (op && typeof op.slug === 'string' && !slugLint(op.slug))
    Object.defineProperty(frame, 'failedSlug', { value: op.slug, configurable: true });
  if (op && typeof op === 'object')
    Object.defineProperty(frame, 'failedOp', { value: op });
  return frame;
}

// `apply --continue` isolates canonical identity groups, not individual lines. A real
// source filename shadows an alias; otherwise every operation shares the alias target's
// group. This includes `new`: one authored batch cannot create through an alias while a
// canonical-spelling sibling independently mutates the alias target.
function applyCanonicalSlugGroup(ctx, op) {
  if (!op || typeof op.slug !== 'string' || slugLint(op.slug)) return null;
  return resolveWriteSlug(ctx, op.slug);
}

function applyFailureFrame(ctx, op, payload) {
  const frame = applyPreGroupFrame(op, payload);
  const slug = applyCanonicalSlugGroup(ctx, op);
  if (slug && frame.failedSlug !== slug)
    Object.defineProperty(frame, 'failedSlug', { value: slug, configurable: true });
  return frame;
}

function normalizeInlineRelations(ctx, rels) {
  if (!Array.isArray(rels)) return rels;
  return rels.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const keys = Object.keys(item).filter(k => k !== 'why');
    if (keys.length !== 1 || RESERVED_REL_KEYS.has(keys[0])) return item;
    const rawVerb = keys[0], rawTo = item[rawVerb];
    if (rawTo == null) return item;
    assertRelationTarget(`relations item verb '${rawVerb}' target`, rawTo);
    const verb = resolveWriteVerb(ctx, rawVerb);
    assertRelationVerb('relation verb', verb); // alias source may be friendly; its authored target may not be
    const to = resolveWriteSlug(ctx, rawTo);
    const outItem = { [verb]: to }; // A1
    if (item.why != null) outItem.why = item.why;
    return outItem;
  });
}

function assertApplyWriteEnvelope(ctx, op, opts = {}) {
  if (hasOwnKey(op, 'base_hash')) op.base_hash = assertBaseHash(op.base_hash, 'base_hash');
  if (op.op === 'new') {
    const allowed = new Set([...NEW_OP_KEYS, 'base_hash']);
    const extra = Object.keys(op).filter(k => !allowed.has(k));
    if (extra.length) die(`new op has unknown key(s): ${extra.join(', ')} (allowed: ${[...allowed].join(', ')})`);
    if (!op.entity || !op.slug || !op.description) die(`new requires entity, slug, description`);
    if (hasOwnKey(op, 'base_hash'))
      die(`base_hash asserts a prior read — '${op.slug}' is being CREATED here (no prior version exists to compare); drop base_hash from the new op`);
    buildNewFm(opts.quiet ? { ...ctx, quietValidation: true } : ctx, op); // pure semantic validation: registry, dates, profile, relations, updated
    if (op.body != null) {
      if (typeof op.body !== 'string') die(`body must be text (a JSON string) — got ${jsonType(op.body)}; nothing written`);
      const bytes = Buffer.byteLength(op.body, 'utf8');
      if (bytes > 1_048_576 && op.force !== true)
        die(`body is ${(bytes / 1048576).toFixed(1)}MB — bodies are distilled prose, not raw storage (raw → files/, §9.1); pass force:true if you really mean it`);
    }
    return;
  }
  assertApplyWriteOpKeys(op);
  switch (op.op) {
    case 'set':
      if (op.field == null) die(`set op needs 'field' — e.g. {"op":"set","field":"due","to":"2026-09-01"}`);
      if (typeof op.field !== 'string') die(`set field must be a string — got ${jsonType(op.field)}; nothing written`);
      if (!op.del && op.to == null) die(`set op needs 'to' (or del) — got keys: ${opKeys(op)}`);
      if (op.del && op.to !== undefined) die(`set op can't combine 'del':true with 'to' — choose removal or replacement; nothing written`);
      {
        const settable = new Set(['description', 'status', 'due', 'occurred', 'important', 'expires', 'renews', 'visibility', 'superseded_by']);
        if (op.field === 'body') die(`use the body verb to write the body, not set --field body`);
        if (['relations', 'updated', 'focus'].includes(op.field)) die(`'${op.field}' is a block — use link/unlink · push, not set`);
        if (!String(op.field).startsWith('profile.') && !settable.has(op.field))
          die(`set can't touch '${op.field}' (settable: ${[...settable].join(', ')}, profile.<key>; class/entity are identity — use new/register)`);
        if (String(op.field).startsWith('profile.')) assertKeyShape('profile key', String(op.field).slice(8));
        if (op.del && op.field === 'description')
          die(`description is required (THE search surface) — you can't --del it; replace it with: set <slug> --field description --to "<text>"`);
        if (!op.del && op.field === 'description' && (typeof op.to !== 'string' || op.to.trim() === ''))
          die(`description is required (THE search surface) and must contain non-whitespace text — nothing written`);
        if (!op.del && String(op.field).startsWith('profile.')) assertCleanValue(op.field, op.to);
        if (!op.del && !String(op.field).startsWith('profile.')) assertScalarValue(op.field, assertFieldWrite(op.field, op.to));
        if (!op.del) assertScalarSize(op.field, op.to, opts);
      }
      break;
    case 'link':
    case 'unlink':
      if (op.verb == null || op.to == null) die(`${op.op} op needs 'verb' and 'to' — got keys: ${opKeys(op)}`);
      if (typeof op.verb !== 'string') die(`relation verb must be a string — got ${jsonType(op.verb)}; nothing written`);
      assertRelationVerbInput(ctx.reg, 'relation verb', op.verb);
      assertRelationTarget('relation target', op.to);
      if (op.op === 'link' && op.why != null && (typeof op.why !== 'string' || op.why.trim() === ''))
        die(`relation why must be non-empty text — nothing written`);
      if (op.op === 'link' && op.why != null) { assertScalarValue('why', op.why); assertScalarSize('why', op.why, opts); }
      if (op.op === 'unlink' && hasOwnKey(op, 'rawTo'))
        die(`unlink op key 'rawTo' is internal alias bookkeeping, not caller input (allowed public keys: op, id, slug, force, base_hash, verb, to); nothing written`);
      break;
    case 'push':
      if (typeof op.x !== 'string' || op.x.trim() === '' || op.y == null || op.y === '')
        die(`push op needs non-empty string 'x' (what changed) and non-empty 'y' (ISO date) — e.g. {"op":"push","slug":"…","x":"profile.city","y":"2026-03-14"} — got keys: ${opKeys(op)}`);
      assertScalarValue('push x', op.x); assertScalarSize('push x', op.x, opts);
      assertIsoDate('y', op.y);
      if (op.why != null && (typeof op.why !== 'string' || op.why.trim() === '')) die(`push why must be non-empty text when present — nothing written`);
      if (op.why != null) { assertScalarValue('push why', op.why); assertScalarSize('push why', op.why, opts); }
      if (op.from !== undefined) { assertCleanValue('push from', op.from); assertScalarSize('push from', op.from, opts); }
      if (op.record != null) assertRelationTarget('push record', op.record);
      break;
    case 'body':
      if (op.body != null && typeof op.body !== 'string') die(`body must be text (a JSON string) — got ${jsonType(op.body)}; nothing written`);
      if (op.append && op.clear) die(`body op can't combine append and clear — choose exactly one mode; nothing written`);
      if (op.append && String(op.body ?? '').length === 0) die(`empty body append has no content — nothing written (supply bytes to append, including intentional whitespace)`);
      if (op.clear && op.body != null && String(op.body).length) die(`body clear refuses non-empty body input — discard the input or drop clear; nothing written`);
      if (!op.append && !op.clear && (op.body == null || String(op.body).trim() === ''))
        die(`body op needs 'body' text — pass "clear":true to blank it; an append needs actual bytes — got keys: ${opKeys(op)}`);
      {
        const bytes = Buffer.byteLength(String(op.body ?? ''), 'utf8');
        if (bytes > 1_048_576 && op.force !== true)
          die(`body is ${(bytes / 1048576).toFixed(1)}MB — bodies are distilled prose, not raw storage (raw → files/, §9.1); pass force:true if you really mean it`);
      }
      break;
    case 'vote':
      if (op.up === true && op.down === true) die(`vote needs exactly one of --up | --down — got both; nothing written`);
      if (op.up !== true && op.down !== true) die(`vote needs exactly one of --up | --down — got neither; nothing written`);
      if (typeof op.why !== 'string' || op.why.trim() === '') die(`vote requires a non-empty --why (it prints in the transcript, not the card); nothing written`);
      assertScalarValue('vote why', op.why); assertScalarSize('vote why', op.why, opts);
      break;
    case 'freeze':
      if (op.outcome != null && (typeof op.outcome !== 'string' || !TERMINAL_STATUSES.has(op.outcome)))
        die(`freeze --outcome must be done|dropped|superseded (got ${JSON.stringify(op.outcome)})`);
      if (op.occurred != null) assertIsoDate('occurred', op.occurred);
      break;
    case 'forget':
      break;
  }
}

function normalizeApplyWriteOp(ctx, op) {
  // Folding set-occurred into freeze happens after normalization. Shape-check here so an
  // unknown key on the folded-away set cannot evade applyOp and be reported ok:true.
  assertApplyWriteOpKeys(op);
  if (op.op === 'link' && op.verb != null && op.to != null) {
    if (typeof op.verb !== 'string') die(`relation verb must be a string — got ${jsonType(op.verb)}; nothing written`);
    assertRelationTarget('relation target', op.to);
    const verb = resolveWriteVerb(ctx, op.verb);
    assertRelationVerb('relation verb', verb); // alias source may be friendly; gate the authored target
    return { ...op, verb, to: resolveWriteSlug(ctx, op.to) }; // A1
  }
  if (op.op === 'unlink' && op.verb != null && op.to != null) {
    if (hasOwnKey(op, 'rawTo')) die(`unlink op key 'rawTo' is internal alias bookkeeping, not caller input (allowed public keys: op, id, slug, force, base_hash, verb, to); nothing written`);
    if (typeof op.verb !== 'string') die(`relation verb must be a string — got ${jsonType(op.verb)}; nothing written`);
    assertRelationTarget('relation target', op.to);
    const verb = resolveWriteVerb(ctx, op.verb);
    assertRelationVerb('relation verb', verb); // alias source may be friendly; gate the authored target
    return { ...op, verb, to: resolveWriteSlug(ctx, op.to), rawTo: op.to }; // A1
  }
  if (op.op === 'new' && Object.prototype.hasOwnProperty.call(op, 'relations'))
    return { ...op, relations: normalizeInlineRelations(ctx, op.relations) }; // A1
  return op;
}

function relationTargetsFromOp(op) {
  if (op.op === 'link' && op.to != null) return [String(op.to)];
  if (op.op !== 'new' || !Array.isArray(op.relations)) return [];
  const targets = [];
  for (const item of op.relations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const keys = Object.keys(item).filter(k => k !== 'why');
    if (keys.length === 1 && item[keys[0]] != null) targets.push(String(item[keys[0]]));
  }
  return targets;
}

function appendFrameWarn(frame, warn) {
  frame.warn = [frame.warn, warn].filter(Boolean).join(' | ');
}

// `apply` is atomic across its write intent. An embedded read must therefore not be the
// first operation to bootstrap/migrate/recover the pen when another op will make the
// batch refuse. Validate the source-semantic failure cases without SQLite; actual reads
// are deferred until every write group has a valid in-memory plan.
function embeddedSourceState(ctx, raw) {
  const slug = resolveWriteSlug(ctx, raw);
  const p = nodePath(ctx.root, slug);
  let text;
  try { text = fs.readFileSync(p, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { slug, live: false, problem: null, parsed: null }; throw e; }
  return { slug, text, ...sourceIndexState(ctx, slug, text) };
}

function sourceHasIncidentEdge(ctx, raw) {
  const wanted = resolveWriteSlug(ctx, raw);
  const dir = path.join(ctx.root, 'brain', '__source');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { return false; }
  for (const file of files) {
    const from = file.slice(0, -3);
    try {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      const state = sourceIndexState(ctx, from, text);
      if (!state.live) continue;
      if (resolveWriteSlug(ctx, from) === wanted) return true;
      const parsed = state.parsed;
      if (!parsed) continue;
      validateRelations(parsed.fm.relations, 'stored relations');
      for (const item of parsed.fm.relations || []) {
        const verb = Object.keys(item).find(k => k !== 'why');
        if (verb && resolveWriteSlug(ctx, String(item[verb])) === wanted) return true;
      }
    } catch { /* only clean/indexable authored edges establish incidence */ }
  }
  return false;
}

// F3: compose the unregister refusal from EVERY state a use was found in — labeling the
// whole set from the first sample hid recoverable/unreadable sources behind a "live"
// verdict (or vice versa). Example names carry their state so the operator can find them.
function registryUseDescription(kind, use) {
  const word = kind === 'entity' ? 'node' : 'edge';
  const plural = use.count === 1 ? word : `${word}s`;
  const action = kind === 'entity' ? 'Reclassify' : 'Re-point';
  const exampleText = (ex) => !ex ? null : kind === 'entity' ? ex.slug : `${ex.from_slug} → ${ex.to_slug}`;
  const liveCount = use.byState.get('source')?.count || 0;
  const others = [...use.byState.entries()].filter(([s]) => s !== 'source');
  if (liveCount === use.count)
    return { summary: `${use.count} live ${plural} (e.g. ${exampleText(use.byState.get('source').example)})`, guidance: `${action} or remove the ${plural} first` };
  if (liveCount === 0) {
    const examples = others.map(([s, b]) => `${exampleText(b.example)}; state: ${s}`).slice(0, 3).join(', ');
    return { summary: `${use.count} recoverable ${plural} (e.g. ${examples})`, guidance: `${action}, recover, or repair the ${plural} first` };
  }
  const parts = [`${liveCount} live`, ...others.map(([s, b]) => `${b.count} ${s}`)].join(', ');
  const examples = [...use.byState.values()].map(b => exampleText(b.example)).filter(Boolean).slice(0, 3).join(', ');
  return { summary: `${use.count} ${plural} (${parts}; e.g. ${examples})`, guidance: `${action} or remove the live, recover or repair the rest first` };
}

function sourceRegistryUse(ctx, kind, value) {
  let count = 0, sample = null;
  const byState = new Map(); // state label -> { count, example } — the refusal enumerates every state
  const note = (stateLabel, example) => {
    count++; sample ||= { ...example, state: stateLabel };
    const b = byState.get(stateLabel) || { count: 0, example: null };
    b.count++; b.example ||= example; byState.set(stateLabel, b);
  };
  const dirs = [
    { dir: path.join(ctx.root, 'brain', '__source'), state: 'source' },
    { dir: path.join(ctx.root, 'brain', '__forgotten'), state: 'forgotten' },
  ];
  for (const { dir, state: dirState } of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { continue; }
    for (const file of files) {
    const slug = file.slice(0, -3);
    let text;
    try { text = fs.readFileSync(path.join(dir, file), 'utf8'); }
    catch {
      // fail closed (F3): an unreadable source MAY use the value — count it, never skip it.
      if (kind === 'entity') note(`${dirState}: unreadable`, { slug });
      else note(`${dirState}: unreadable`, { from_slug: slug, to_slug: '?' });
      continue;
    }
    try {
      const state = sourceIndexState(ctx, slug, text);
      if (kind === 'entity') {
        if (state.parsed?.fm?.entity != null) {
          if (state.parsed.fm.entity === value) note(state.live ? dirState : `${dirState}: ${state.problem || 'quarantined'}`, { slug });
        } else if (rawSourceFacts(text).entities.includes(value)) {
          note(`${dirState}: raw frontmatter match${state.problem ? ` (${state.problem})` : ''}`, { slug });
        }
        continue;
      }
      const rels = [];
      if (Array.isArray(state.parsed?.fm?.relations)) {
        for (const item of state.parsed.fm.relations || []) {
          // EVERY verb key of the item — a multi-verb item is several edges, not one.
          for (const k of Object.keys(item)) {
            if (k === 'why') continue;
            rels.push({ verb: k, to: String(item[k]), state: state.live ? dirState : `${dirState}: ${state.problem || 'quarantined'}` });
          }
        }
      } else {
        rawSourceFacts(text).relations.forEach(r => rels.push({ ...r, state: `${dirState}: raw frontmatter match${state.problem ? ` (${state.problem})` : ''}` }));
      }
      for (const rel of rels) {
        if (rel.verb !== value) continue;
        note(rel.state, { from_slug: slug, to_slug: rel.to });
      }
    } catch { /* quarantined/invalid sources are not live registry consumers */ }
  }
  }
  return { count, sample, byState };
}

function preflightEmbeddedReadSource(ctx, verb, args, flags, opts = {}) {
  const plannedCreates = opts.plannedCreates || new Set();
  const plannedSlug = (raw) => plannedCreates.has(String(raw))
    ? String(raw)
    : resolveWriteSlug(ctx, raw);
  if (verb === 'get' || verb === 'peek') {
    for (const raw of args || []) {
      const candidate = plannedSlug(raw);
      if (plannedCreates.has(candidate) && !fs.existsSync(nodePath(ctx.root, candidate))) continue;
      const state = embeddedSourceState(ctx, raw);
      if (verb === 'get' && flags.raw && state.text !== undefined) continue;
      if (!state.live)
        die(`no node '${state.slug}'${state.problem ? ` — source is quarantined: ${state.problem}` : ''}`);
      if (verb === 'get' && hasOwnKey(flags, 'field')) {
        if (!state.parsed)
          die(`'${state.slug}' has no authored frontmatter fields — use brain get ${state.slug} --body for a body-only node`);
        const duplicates = (state.parsed.errors || []).filter(e => /duplicate .*key|duplicate top-level key/.test(e));
        if (duplicates.length)
          die(`'${state.slug}' has ambiguous duplicate frontmatter keys — refusing --field projection rather than choosing one authored value: ${duplicates.join(' | ')}`);
      }
    }
    return;
  }
  if (verb === 'relations') {
    const raw = args?.[0];
    if (raw && plannedCreates.has(plannedSlug(raw))) return;
    if (raw && !sourceHasIncidentEdge(ctx, raw)) die(`no node '${resolveWriteSlug(ctx, raw)}'`);
    return;
  }
  if (verb === 'files') {
    const raw = flags?.for;
    if (raw && plannedCreates.has(plannedSlug(raw))) return;
    if (raw && !sourceHasIncidentEdge(ctx, raw)) die(`no node '${resolveWriteSlug(ctx, raw)}'`);
    return;
  }
  if (verb === 'tools') {
    const raw = flags?.for;
    if (raw && plannedCreates.has(plannedSlug(raw))) return;
    if (raw && !sourceHasIncidentEdge(ctx, raw)) die(`no node '${resolveWriteSlug(ctx, raw)}'`);
    return;
  }
  if (verb === 'skills') {
    const raw = flags?.for;
    if (raw && plannedCreates.has(plannedSlug(raw))) return;
    if (raw && !sourceHasIncidentEdge(ctx, raw)) die(`no node '${resolveWriteSlug(ctx, raw)}'`);
    return;
  }
  if (verb === 'context') {
    for (const raw of args || []) {
      if (plannedCreates.has(plannedSlug(raw))) continue;
      if (!sourceHasIncidentEdge(ctx, raw)) die(`no node '${resolveWriteSlug(ctx, raw)}'`);
    }
    return;
  }
  if (verb === 'check' && args?.[0]) {
    if (plannedCreates.has(plannedSlug(args[0])) && !fs.existsSync(nodePath(ctx.root, plannedSlug(args[0])))) return;
    const state = embeddedSourceState(ctx, args[0]);
    if (!state.text && !state.live) die(`no node '${state.slug}'`);
  }
}

function editPermits(flags) {
  return new Set(flags.force ? ['edit-record'] : []);
}

function cmdReindex(ctx, _args, _flags) {
  const { out } = ctx.io; const { root } = ctx;
  closeBrain(ctx); // explicit/exported reindex obeys the same no-reader-lease -> reindex.lock order
  return withReindexLock(root, () => reindex(ctx, out, { migrateStale: true }));
}

// context-retrieval §4: `focus` survives as SUGAR over membership (in_context → focus) —
// same UX, new spine. The since-stamp folds into the edge why at add time; re-add updates
// the why in place, preserving the ORIGINAL folded since; show is the context-focus read
// plus a why line per member.
const FOCUS_SINCE_RE = /\(since (\d{4}-\d{2}-\d{2})\)\s*$/;

const focusEdgeOf = (ctx, fm) => (fm.relations || []).find(it => it && typeof it === 'object'
  && !Array.isArray(it) && it.in_context != null && resolveWriteSlug(ctx, String(it.in_context)) === 'focus');

function cmdFocus(ctx, [sub, slug], flags) {
    const { out } = ctx.io; const { root } = ctx;
    if (!sub || sub === 'show') {
      const unused = ['why', 'force', 'base-hash'].filter(k => hasOwnKey(flags, k));
      if (unused.length) die(`focus show does not use ${unused.map(k => '--' + k).join(', ')} — --why is add-only and write controls apply only to add/remove; nothing executed`);
      if (slug) die(`focus show takes no slug (got '${slug}')`);
      const db = requireDb(ctx);
      installCurrentSourceConflictGuard(ctx, db);
      // The membership spine with the context read's conflict honesty (a suppressed
      // attachment refuses); the bespoke part is the why line per member.
      const anchor = resolveSlug(ctx.reg, 'focus', db);
      const names = slugReadNames(ctx, ctx.reg, anchor, db);
      // The SAME live/conflict gate as the context read and ranking (F7): a conflicted
      // or retired focus card refuses instead of printing a ghost bubble while ranking
      // suspends it. focus remove stays available for cleanup (a write path, ungated).
      const anchorNode = db.prepare(`SELECT n.entity, n.status FROM nodes n WHERE n.slug=?`).get(anchor);
      if (anchorNode) {
        if (!currentSourceIsConflictFree(db, anchor))
          die(`'${anchor}' has unresolved VCS conflict markers — unresolved VCS conflict requires repair; refusing focus show rather than loading one unresolved branch. Resolve the source conflict, then: brain sync --slug ${anchor}`);
        if (!db.prepare(`SELECT 1 FROM nodes n WHERE n.slug=? AND ${LIVE_CONTEXT_SQL('n')}`).get(anchor))
          die(`'${anchor}' is ${anchorNode.status ?? `entity '${anchorNode.entity}'`} — a retired desk cannot be loaded (it ranks nothing and would only be pruned). Revive it first (brain set ${anchor} --field status --del) or pick a live desk: brain contexts`);
      }
      const got = collectAvailability(ctx, db, { verb: 'focus', entity: null, verbs: ['in_context'],
        anchorSlug: anchor, anchorNames: names, refuseLabel: 'focus show', missingAnchorOk: true });
      out(`focus — the bubble of happening: ${got.rows.length} in`);
      const whyOf = db.prepare(`SELECT e.why FROM edges e WHERE e.from_slug=? AND e.verb='in_context'
        AND e.to_slug IN (${sqlSlots(names)}) AND ${edgeSourceLiveSQL('e')} ORDER BY e.rowid LIMIT 1`);
      for (const r of got.rows) {
        const full = db.prepare(`SELECT n.* FROM nodes n WHERE n.slug=?`).get(r.slug);
        const why = whyOf.get(r.slug, ...names)?.why ?? null;
        out(`  ${row(full || r)}\n      why: ${why ?? '—'}`);
      }
      return;
    }
    if (sub !== 'add' && sub !== 'remove') die(`focus: show|add|remove`);
    if (sub === 'remove' && hasOwnKey(flags, 'why'))
      die(`focus remove can't combine with --why — removal has no stored why; nothing written`);
    assertReadSlug(slug, 'focus slug');
    const node = readNode(root, slug);
    if (!node) die(`no node '${slug}'`);
    const existing = focusEdgeOf(ctx, node.fm);
    let ops;
    if (sub === 'remove') {
      // Removal is always allowed (legacy-cleanup parity; the record exemption covers records).
      ops = [{ op: 'unlink', verb: 'in_context', to: 'focus', ...(existing ? { rawTo: String(existing.in_context) } : {}) }];
    } else {
      if (typeof flags.why !== 'string' || flags.why.trim() === '') die('focus add requires a non-empty text why (exit-testable)');
      // The since-stamp folds into the why (edges carry no dates); a re-add carries the
      // ORIGINAL since forward and updates the why in place (unlink+relink, one write).
      const prior = existing?.why != null ? FOCUS_SINCE_RE.exec(String(existing.why)) : null;
      const why = `${flags.why} (since ${prior ? prior[1] : ctx.today()})`;
      assertScalarSize('focus why', why);
      ops = existing
        ? [{ op: 'unlink', verb: 'in_context', to: 'focus', rawTo: String(existing.in_context) },
           { op: 'link', verb: 'in_context', to: 'focus', why }]
        : [{ op: 'link', verb: 'in_context', to: 'focus', why }];
    }
    const result = commitWrite(ctx, { slug, kind: 'mutate', newOp: null, ops, baseHash: flags['base-hash'] || node.hash, force: !!flags.force, permits: new Set(), index: 'now' }); // bug #83
    drainSignals(result);
}

function cmdFreeze(ctx, [slug], flags) {
    const { out } = ctx.io;
    if (!slug) die(`freeze requires a slug`);
    // occurred passes through NULL so applyOp owns the default: today for a future, the
    // slug/date_created derivation for a card→record freeze (brain-profiles §3).
    const occurred0 = flags.occurred ?? null;
    const outcome = flags.outcome || 'done';
    const plan = prepareWrite(ctx, { slug, kind: 'mutate', newOp: null, ops: [{ op: 'freeze', occurred: occurred0, outcome, force: !!flags.force }], baseHash: flags['base-hash'] || null, force: !!flags.force, permits: new Set(), index: 'now' }); // A9
    const result = commitPlan(ctx, plan);
    const occurred = /** @type {any} */ (plan.state).fm.occurred; // the effective stamp (derived for cards)
    const stats = /** @type {any} */ (plan.state).freezeStats || { conjugated: 0, kept: 0, dropped: 0, keptProspective: 0 };
    const conj = stats.conjugated, kept = stats.kept, dropped = stats.dropped, keptProspective = stats.keptProspective || 0;
    const cparts = [`${conj} edge${conj === 1 ? '' : 's'} conjugated`];
    if (keptProspective) cparts.push(`${keptProspective} kept prospective (outcome ${outcome} — the event did not happen; verbs left unconjugated per F-7)`);
    if (kept) cparts.push(`${kept} kept (no past-tense mapping — add one in __meta/registry.md)`);
    if (dropped) cparts.push(`${dropped} dropped`);
    out(`froze '${slug}' → record (occurred ${occurred}, outcome ${outcome}); ${cparts.join(', ')}.`);
    out(`next (PA judgment, not automated): outcome edges · updated pushes onto changed cards · spawn follow-up futures`);
    drainSignals(result);
}

function cmdNew(ctx, _args, flags) {
    const { out } = ctx.io;
    const result = commitWrite(ctx, { slug: flags.slug, kind: 'create', newOp: { entity: flags.entity, slug: flags.slug, description: flags.description, class: flags.class, due: flags.due, occurred: flags.occurred, date_created: flags.date_created, status: flags.status }, ops: [], baseHash: flags['base-hash'] || null, force: !!flags.force, permits: new Set(), index: 'now' });
    out(`created ${flags.slug}`);
    drainSignals(result);
}

function cmdSet(ctx, [slug], flags) {
    const { out } = ctx.io;
    if (!flags.field) die(`set requires --field <dot.path> (--to <value> or --del)`);
    if (!flags.del && flags.to == null) die(`set requires --to <value> (or --del to remove)`);
    const result = commitWrite(ctx, { slug, kind: 'mutate', newOp: null, ops: [{ op: 'set', field: flags.field, to: flags.to, del: !!flags.del }], baseHash: flags['base-hash'] || null, force: !!flags.force, permits: editPermits(flags), index: 'now' });
    out(`set ${slug}.${flags.field}`);
    drainSignals(result);
}

function cmdLink(ctx, [slug], flags) {
    const { out } = ctx.io;
    if (!flags.verb || flags.to == null) die(`link requires --verb <v> --to <slug>`);
    const rawVerb = flags.verb, rawTo = flags.to;
    const verb = resolveWriteVerb(ctx, rawVerb); // A1, source-truth shadowing without derived-state effects
    const to = resolveWriteSlug(ctx, rawTo); // A1
    const result = commitWrite(ctx, { slug, kind: 'mutate', newOp: null, ops: [{ op: 'link', verb, to, why: flags.why }], baseHash: flags['base-hash'] || null, force: !!flags.force, permits: editPermits(flags), index: 'now' });
    out(`linked ${slug} → ${verb}${aliasSuffix(rawVerb, verb)} → ${to}${aliasSuffix(rawTo, to)}`);
    const reg = result.fileCommitted ? registerVerbsBestEffort(ctx, [{ verb, example: `${slug} → ${verb} → ${to}` }]) : { registered: [] }; // bug #79
    for (const v of reg.registered) out(`registered new verb '${v}'`);
    if (!ctx.db?.prepare(`SELECT 1 FROM nodes WHERE slug=?`).get(to)) // warn on dangling, never block
      result.signals.unshift(`⚠ warning: link target '${to}' is not a node (dangling edge — fine if intentional)`);
    drainSignals(result);
}

function cmdUnlink(ctx, [slug], flags) {
    const { out } = ctx.io;
    if (!flags.verb || flags.to == null) die(`unlink requires --verb <v> --to <slug>`);
    const rawVerb = flags.verb, rawTo = flags.to;
    const verb = resolveWriteVerb(ctx, rawVerb); // A1: source truth preserves real-verb shadowing.
    const to = resolveWriteSlug(ctx, rawTo); // A1: source truth preserves real-slug shadowing.
    const result = commitWrite(ctx, { slug, kind: 'mutate', newOp: null, ops: [{ op: 'unlink', verb, to, rawTo }], baseHash: flags['base-hash'] || null, force: !!flags.force, permits: editPermits(flags), index: 'now' });
    out(`unlinked ${slug} → ${verb}${aliasSuffix(rawVerb, verb)} → ${to}${aliasSuffix(rawTo, to)}`);
    // brain-teaching §1.4: unlink is for edges that were WRONG — an edge that merely ended
    // keeps its history as the past-tense verb instead of vanishing.
    out(`note: unlink erases the edge and its why — an edge that ended keeps history via its past-tense verb: brain link ${slug} --verb <past-verb> --to ${to} --why "…"`);
    drainSignals(result);
}

function cmdPush(ctx, [slug], flags) {
    const { out } = ctx.io;
    if (!flags.x || !flags.y) die(`push requires --x <what> --y <date> [--why …] [--record <slug>]`);
    const result = commitWrite(ctx, { slug, kind: 'mutate', newOp: null, ops: [{ op: 'push', x: flags.x, y: flags.y, why: flags.why, record: flags.record }], baseHash: flags['base-hash'] || null, force: !!flags.force, permits: new Set(), index: 'now' });
    out(`pushed updated[${flags.x} @ ${flags.y}] onto ${slug}`);
    drainSignals(result);
}

function cmdBody(ctx, [slug], flags) {
    const { out } = ctx.io;
    let input = '';
    try { input = fs.readFileSync(0, 'utf8'); } catch { /* empty */ }
    // H20 body safety: empty non-append stdin used to SILENTLY wipe the distilled tier.
    // Require an explicit --clear to blank a body; guard against pasting a whole raw
    // file into the distilled tier (raw belongs in files/, §9.1).
    if (!flags.append && !input.trim() && !flags.clear)
      die(`empty body would wipe ${slug}'s distilled tier — pass --clear to blank it; --append also requires actual bytes`);
    // size guards (>64KB warn / >1MB die) now live in the shared applyOp body case (bug #17).
    const result = commitWrite(ctx, { slug, kind: 'mutate', newOp: null, ops: [{ op: 'body', body: input, append: !!flags.append, clear: !!flags.clear, force: !!flags.force }], baseHash: flags['base-hash'] || null, force: !!flags.force, permits: editPermits(flags), index: 'now' });
    // @ts-ignore runtime Buffer is available (Node >= 22.5)
    out(`${flags.append ? 'appended' : 'set'} body of ${slug} (${Buffer.byteLength(input, 'utf8')} bytes)`); // C-2: count the bytes actually stored
    drainSignals(result);
}

// brain-profiles §5: brain vote <slug> --up|--down --why "…" — ±1 per call, why required
// (printed, never stored: score-only, so voted cards/memories still freeze). Any tense
// votable via the recordGuard op exemption. ⚑ no per-voter dedup in v1.
function cmdVote(ctx, [slug], flags) {
    const { out } = ctx.io;
    if (!slug) die(`vote requires a slug: brain vote <slug> --up|--down --why "…"`);
    const result = commitWrite(ctx, { slug, kind: 'mutate', newOp: null, ops: [{ op: 'vote', up: !!flags.up, down: !!flags.down, why: flags.why }], baseHash: flags['base-hash'] || null, force: !!flags.force, permits: new Set(), index: 'now' });
    const score = canonicalVotesInt(String(readNode(ctx.root, slug)?.fm?.votes ?? '')) ?? 0;
    out(`vote recorded (score ${score}) — whys live in the transcript, not the card`);
    drainSignals(result);
}

function cmdForget(ctx, [slug], flags) {
    const { out } = ctx.io;
    if (!slug) die(`forget requires a slug`);
    // brain-teaching §1.1/§1.3: pre-read for the teaching lines only (class + the edges
    // about to leave with the file) — the write path below stays byte-identical.
    const pre = readNode(ctx.root, slug);
    const result = commitWrite(ctx, { slug, kind: 'forget', newOp: null, ops: [], baseHash: null, force: !!flags.force, permits: new Set(), index: 'now' });
    // C-7: the printed recovery recipe names the EXACT archive file and the EXACT
    // canonical destination — after a collision the archive is date-prefixed, and a bare
    // "mv it back" restores the wrong identity (the date-prefixed name becomes the slug).
    const recipe = result.dest ? `recover: brain recover ${path.basename(result.dest, '.md')}${path.basename(result.dest, '.md') !== slug ? ` --as ${slug}` : ''}  (or: mv ${path.relative(ctx.root, result.dest)} brain/__source/${slug}.md && brain sync --slug ${slug})` : '';
    if (result.indexCommitted) {
      out(result.dest ? `forgot ${slug} → ${path.relative(ctx.root, result.dest)} (index rows removed; ${recipe})`
               : `forgot ${slug} (no file; index rows removed)`);
    } else {
      out(result.dest ? `forgot ${slug} → ${path.relative(ctx.root, result.dest)} (file archived; index rows pending — reconciles on next open, or run: brain sync; ${recipe})`
               : `forgot ${slug} (no file; index rows pending — reconciles on next open, or run: brain sync)`);
    }
    // brain-teaching §1.3: forget auto-drops the node's own edges with the file — say what left.
    const edges = pre ? edgesOf(pre.fm) : [];
    if (edges.length)
      out(`dropped ${edges.length} edge${edges.length === 1 ? '' : 's'} with it: ${edges.map(e => `${e.verb}:${e.to}`).join(', ')}`);
    // brain-teaching §1.1: a card's listings honor status, so a rescinded card had a
    // history-keeping path (records/futures have their own: the past happened / freeze).
    if (pre && deriveClass(ctx.reg, pre.fm) === 'card')
      out(`note: forget records no why — a rescinded order keeps its ruling as history via: brain set <slug> --field status --to dropped`);
    drainSignals(result);
}

// C-7: the safe inverse of forget. Moves brain/__forgotten/<archive>.md back into
// brain/__source/ under its CANONICAL slug (--as restores identity after a collision
// archive picked up a date prefix) and reindexes that one slug. Byte-preserving atomic
// no-clobber link+unlink refuses to overwrite a live/concurrently-created node; the
// resurrection warning does not apply — this IS the sanctioned restoration path.
function cmdRecover(ctx, [archive], flags) {
    const { out } = ctx.io; const { root } = ctx;
    if (!archive) die(`recover requires an archive name — brain recover <archive[.md]> [--as <slug>] (archives live in brain/__forgotten/)`);
    const base = String(archive).replace(/\.md$/, '');
    // The SOURCE name has its own containment gate. It is not the destination slug: a
    // generated collision archive can be `YYYY-MM-DD-<80-char-slug>-N` (>80 chars), so
    // retain that valid grammar while refusing separators, dots, normalization twins,
    // and every `..` traversal before joining it to the forgotten directory.
    if (base !== base.normalize('NFC') || !/^[a-z0-9][a-z0-9-]*$/.test(base) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base))
      die(`bad archive name '${base}' — recover reads one .md file directly inside brain/__forgotten/ (letters, digits, hyphens; no paths)`);
    const archiveDir = path.resolve(forgottenDir(root));
    const src = path.resolve(archiveDir, base + '.md');
    if (path.dirname(src) !== archiveDir)
      die(`bad archive name '${base}' — recover source must stay inside brain/__forgotten/`);
    if (!fs.existsSync(src)) die(`no archive brain/__forgotten/${base}.md — list the forgotten brain: ls brain/__forgotten/`);
    const slug = flags.as ? String(flags.as) : base;
    const lint = slugLint(slug);
    if (lint) die(flags.as ? lint : `${lint} — the archive name is not a usable slug; pass --as <slug> (a collision archive is date-prefixed: the original slug is the tail)`);
    const dest = nodePath(root, slug);
    if (fs.existsSync(dest)) die(`'${slug}' already exists in brain/__source/ — recover would overwrite it. Inspect: brain get ${slug}; a different thing? recover --as <other-slug>`);
    let dirtyAdded = [];
    // Match commitPlan's index -> slug publication order. A concurrent requireDb cannot
    // consume and clear this claim in the gap between ledger publication and hard-link.
    withIndexLock(root, () => withLock(nodeLockPath(root, slug), () => {
        dirtyAdded = writeDirty(root, [slug]); // crash sentinel: file lands before the index learns it
        try {
          // `rename(src, dest)` replaces an existing dest on POSIX: a concurrent `new`
          // between the check above and the syscall could report success and then lose its
          // authored bytes. Hard-linking is the same no-clobber primitive as fresh `new`:
          // exactly one creator wins EEXIST, and the archive remains intact on a loser.
          try { fs.linkSync(src, dest); }
          catch (e) {
            if (e.code === 'EEXIST')
              die(`'${slug}' already exists in brain/__source/ — recover lost a concurrent create race and refused to overwrite it. Inspect: brain get ${slug}; the archive remains at brain/__forgotten/${base}.md`);
            if (e.code === 'ENOENT')
              die(`archive brain/__forgotten/${base}.md changed before recover could place it — nothing restored`);
            throw e;
          }
          fsyncDir(path.dirname(dest));
          try {
            fs.unlinkSync(src);
            fsyncDir(archiveDir);
          } catch (e) {
            // A link succeeded but the archive unlink failed. Roll the destination back
            // while the slug lock is held; if even rollback fails, retain the dirty claim so
            // the live copy is reconciled rather than silently serving stale derived state.
            try { fs.unlinkSync(dest); fsyncDir(path.dirname(dest)); }
            catch { die(`recovered bytes reached brain/__source/${slug}.md but archive cleanup and rollback both failed (${e.message}) — bytes were not deleted; dirty recovery remains pending`); }
            die(`could not remove brain/__forgotten/${base}.md after placing the recovery (${e.message}) — recovery rolled back; archive left intact`);
          }
        } catch (e) {
          // Cleanup happens while both publication locks are still held, so a claim this
          // process added cannot be mistaken for a same-slug successor's later claim.
          if (dirtyAdded.includes(slug) && !fs.existsSync(dest)) clearDirty(root, [slug]);
          throw e;
        }
    }));
    let indexed = false;
    let indexResult = null;
    if (ctx.regState.parseError || ctx.regState.futureFormat != null || ctx.regState.rewriteProblems?.length) {
      console.error(ctx.regState.parseError
        ? `⚠ file restored byte-identically, index pending because registry.md is unparseable (${ctx.regState.parseError})`
        : ctx.regState.futureFormat != null
          ? `⚠ file restored byte-identically, index pending because registry format ${ctx.regState.futureFormat} is newer than this engine — upgrade first`
          : `⚠ file restored byte-identically, index pending because registry.md needs hand repair (${ctx.regState.rewriteProblems[0]})`);
      out(`recovered ${slug} ← brain/__forgotten/${base}.md${base !== slug ? ` (canonical identity '${slug}' restored from collision archive '${base}')` : ''} (index pending)`);
      return;
    }
    try {
      requireDb(ctx); // bootstrap/rebuild before taking index.lock (reindex → index order)
      withIndexLock(root, () => {
        closeDb(ctx);
        const db = openDb(ctx);
        indexResult = withBusyRetry(db, () => indexNode(ctx, db, slug));
        clearDirty(root, [slug]);
        indexed = true;
      });
    } catch (e) { console.error(`⚠ file restored, index pending (${e.message}) — reconciles on next open, or run: brain sync --slug ${slug}`); }
    const indexTruth = indexResult?.quarantined
      ? ` (quarantined — run doctor; file restored byte-identically but is not gettable until repaired)`
      : indexResult?.demoted
        ? ` (demoted to body-only — run doctor; file restored byte-identically)`
        : indexed ? '' : ' (index pending)';
    out(`recovered ${slug} ← brain/__forgotten/${base}.md${base !== slug ? ` (canonical identity '${slug}' restored from collision archive '${base}')` : ''}${indexTruth}`);
}

// ---------- roll (deterministic obligation roll) ----------
function rollStepDue(due, cadence, k) {
  return cadence.unit === 'days' ? addDaysISO(due, cadence.n * k)
    : cadence.unit === 'months' ? addMonthsISO(due, cadence.n * k)
    : addYearsISO(due, cadence.n * k);
}
// late-roll-elapsed-cycles: elapsed cycles still owed AFTER a roll — the count of cadence
// anchors from the new due through today inclusive. Deterministic arithmetic for the
// late-roll disclosure; each owed cycle takes its own roll, so nothing is ever skipped.
function rollOwedThroughToday(newDue, cadence, today) {
  let k = 0, anchor = newDue;
  while (anchor <= today && k <= 100000) { k++; anchor = rollStepDue(newDue, cadence, k); }
  return k;
}
// fork-doctrine §3.2 evidence procedure (read-only, bounded): the cycle stamps of an obligation's
// filed_by filings. `stamped` = profile.cycle anchor dates that resolve which cycles are settled;
// `unstamped` = filings without a stamp (evidence-neutral — listed, attribute nothing). Mirrors the
// entity guard's read-only-handle pattern; a missing/stale index → skipped (bootstrap fallback).
function obligationSettledSet(ctx, obligationSlug) {
  const p = path.join(ctx.root, '.brain', 'index.sqlite');
  if (!fs.existsSync(p)) return { stamped: new Set(), unstamped: [], skipped: true };
  const probe = { root: ctx.root, readerLease: null };
  let db = null;
  try {
    acquireIndexReader(probe);
    if (!fs.existsSync(p)) return { stamped: new Set(), unstamped: [], skipped: true };
    db = new DatabaseSync(p, { readOnly: true });
    db.exec('PRAGMA busy_timeout=2000');
    if (schemaVersion(db) !== SCHEMA_VERSION) return { stamped: new Set(), unstamped: [], skipped: true };
    const rows = db.prepare(`SELECT n.slug, n.profile_json, n.occurred FROM edges e JOIN nodes n ON n.slug=e.from_slug WHERE e.verb='filed_by' AND e.to_slug=?`).all(obligationSlug);
    const stamped = new Set(), unstamped = [];
    for (const r of rows) {
      let cycle = null;
      try { cycle = JSON.parse(r.profile_json || '{}').cycle; } catch { /* unreadable profile — treat as unstamped */ }
      if (typeof cycle === 'string' && isIsoDate(String(cycle).slice(0, 10))) stamped.add(String(cycle).slice(0, 10));
      else unstamped.push(r.occurred || r.slug);
    }
    return { stamped, unstamped, skipped: false };
  } catch { return { stamped: new Set(), unstamped: [], skipped: true }; }
  finally { try { db?.close(); } catch { /* malformed handle */ } releaseIndexReader(probe); }
}
// Validate the roll and build its constituent apply ops (filing record + filed_by edge, then —
// unless filing-only — the obligation's due set + updated[] push). Throws a teaching refusal on
// anything unparseable, or (the cycle-ambiguity fork, roll-verb §1.3) a BLOCKING roll-cycle ask
// via refuseWithAsk. Returns { ops, meta } for the caller to commit through the apply batch.
function rollPlan(ctx, op) {
  const allowed = new Set(['op', 'id', 'slug', 'occurred', 'why', 'cycle', 'ask']);
  const extra = Object.keys(op).filter(k => !allowed.has(k));
  if (extra.length) die(`roll op has unknown key(s): ${extra.join(', ')} (allowed: slug, occurred, why, cycle, ask)`);
  const slug = op.slug;
  if (typeof slug !== 'string' || slugLint(slug)) die(`roll requires a valid <slug> — got ${JSON.stringify(slug)}`);
  if (op.occurred == null || op.occurred === '') die(`roll requires --occurred <date> (the date the cycle was filed) — e.g. brain roll ${slug} --occurred ${ctx.today()}`);
  assertIsoDate('occurred', op.occurred); // date-only, exactly like freeze --occurred
  const occurred = String(op.occurred);
  const cycle = op.cycle != null ? String(op.cycle) : null;
  if (cycle != null && cycle !== 'current' && cycle !== 'next') die(`roll --cycle must be 'current' or 'next' (got ${JSON.stringify(op.cycle)})`);
  const askId = op.ask != null ? String(op.ask) : null; // ask-ledger: the id being answered
  if (askId != null && cycle == null) die(`--ask ${askId} names the ask to answer — also pass --cycle current|next to choose which cycle it settles.`);
  if (op.why != null && (typeof op.why !== 'string' || op.why.trim() === '')) die(`roll --why must be non-empty text when present`);
  const node = readNode(ctx.root, slug);
  if (!node) die(missingNodeMsg(ctx, ctx.db, slug));
  const fm = node.fm;
  if (fm.entity !== 'obligation')
    die(`'${slug}' is ${fm.entity ? `a ${fm.entity}` : 'not an obligation'}, not an obligation — roll advances a recurring obligation. A one-off? freeze it. A record? it needs nothing.`);
  const klass = deriveClass(ctx.reg, fm);
  if (klass !== 'future' || !isOpen(fm.status))
    die(`'${slug}' is not an OPEN obligation (${klass}${fm.status ? `/${fm.status}` : ''}) — roll advances an open recurring obligation; a filed/closed cycle needs nothing (freeze to end the series).`);
  const cadenceRaw = fm.profile ? (fm.profile.cadence ?? fm.profile.period) : undefined;
  if (cadenceRaw == null || String(cadenceRaw).trim() === '')
    die(`'${slug}' has no cadence to roll — set profile.cadence (e.g. brain set ${slug} --field profile.cadence --to monthly), or roll by hand (§7.5: filing record + set due + push).`);
  const cadence = parseRollCadence(cadenceRaw);
  if (!cadence)
    die(`'${slug}' cadence '${String(cadenceRaw)}' is not a recognized form — accepted: ${ROLL_CADENCE_FORMS}. Fix profile.cadence, or roll by hand (§7.5: filing record + set due + push). Never guessed.`);
  const due = fm.due == null ? '' : String(fm.due).slice(0, 10); // anchor on the date part
  if (due === '' || !isIsoDate(due)) // isIsoDate('') is true (empty = no problem), so reject empty explicitly
    die(`'${slug}' has no dated due to anchor the roll — set one first (brain set ${slug} --field due --to <YYYY-MM-DD>), then roll.`);
  // roll-cycle detector (fork-doctrine LAW · map: obligation-roll, already-enforced appendix):
  // ENUMERATE the cycles this payment could settle = {owed anchor (prior, due stays), current due
  //   (paid early, due advances)} over the cadence anchor sequence [closed arithmetic].
  // FILTER by evidence = the obligation's cycle-stamped filed_by filings (settled set): if the prior
  //   anchor is already settled, the payment can only be the current cycle → 1 survivor. occurred ≥ due
  //   also leaves only the owed anchor by arithmetic. Unstamped filings resolve nothing (listed, neutral).
  // COUNT: 1 → act (no ask); 2 (bootstrap: prior unknown AND occurred < due) → refuse with the ask,
  //   the survivors ARE the two --cycle options. The answered roll STAMPS profile.cycle so it never recurs.
  // DIVERGE: the two survivors leave different `due` (reminder stays vs advances) — observably distinct.
  const filingSlug = `${occurred}-${slug}`;
  // Pre-check the filing collision BEFORE any ledger side effect, so rollPlan passing ⇒ the commit
  // succeeds (a clearer refusal than a batch rollback, and it keeps the answer/withdraw ledger flip
  // — which accompanies a SUCCESSFUL roll — from landing while the roll itself can't).
  if (readNode(ctx.root, filingSlug))
    die(`'${filingSlug}' already exists — this cycle looks filed for ${occurred} already. Roll a different --occurred, or inspect: brain get ${filingSlug}.`);
  const prior = rollStepDue(due, cadence, -1); // the anchor immediately before the current due
  const ifNext = rollStepDue(due, cadence, 1);
  let settledCycle, newDue;
  if (occurred >= due) {
    if (cycle != null) die(`roll --cycle only applies to the ambiguous fork (filed before the current due). '${slug}' filed ${occurred} rolls unambiguously — drop --cycle.`);
    askLedgerWithdraw(ctx, slug, 'roll-cycle', `roll filed ${occurred} on/after due ${due} — unambiguous`); // §1.5: evidence resolves any stale open ask
    settledCycle = due; newDue = ifNext; // pay the owed cycle on/after its date → due advances exactly ONE step from the OLD due (never catch-up past occurred — an elapsed cycle is never skipped; the arrears stay in the outbox until each is rolled)
  } else {
    const settled = obligationSettledSet(ctx, slug);
    const evFound = [];
    if (settled.stamped.size) evFound.push(`cycles already settled: ${[...settled.stamped].sort().join(', ')}`);
    if (settled.unstamped.length) evFound.push(`${settled.unstamped.length} filing(s) with no cycle stamp (not attributable): ${[...settled.unstamped].sort().slice(0, 5).join(', ')}`);
    if (settled.skipped) evFound.push('no index — filing history unread');
    if (!evFound.length) evFound.push('nothing recorded');
    const evidence = { checked: [`'${slug}' filed_by filings and their cycle stamps`], found: evFound };
    const candidates = [
      { cycle: prior, dueAfter: due },   // settle the owed prior cycle — reminder stays
      { cycle: due, dueAfter: ifNext },  // current cycle paid early — reminder advances
    ];
    const options = [
      { id: 'cycle-current', label: `settle ${prior} (still owed)`, effect: `file for cycle ${prior}; due stays ${due}` },
      { id: 'cycle-next', label: `settle ${due} (paid early)`, effect: `file for cycle ${due}; due advances to ${ifNext}` },
    ];
    const buildRollAsk = () => buildAsk('roll-cycle', {
      slug, field: null, value: null,
      question: `You paid '${slug}' on ${occurred}, before its ${due} due date — was that the ${prior} payment (still owed, next reminder stays ${due}), or paying ${due} early (next reminder ${ifNext})?`,
      options, context: { evidence, candidates },
    });
    if (settled.stamped.has(prior)) { // history resolves it: prior already filed → this pays the current cycle early
      if (cycle != null) die(`roll --cycle only applies to the ambiguous fork — history already resolves '${slug}' (cycle ${prior} settled), so this roll is unambiguous; drop --cycle.`);
      askLedgerWithdraw(ctx, slug, 'roll-cycle', `history resolved: cycle ${prior} already settled`); // §1.5 auto-withdraw
      settledCycle = due; newDue = ifNext;
    } else if (cycle == null) { // bootstrap: 2 candidates → raise (ledger it) + refuse (the survivors ARE the options)
      const ask = buildRollAsk();
      refuseWithAsk(ctx, ask, (id) => `roll '${slug}': filed ${occurred} is before its due ${due} — ambiguous, not guessed.${askEvidenceClause(evidence)} Rerun citing the ask: --ask ${id} --cycle current (settle ${prior}; due stays ${due}) or --ask ${id} --cycle next (paid early; due → ${ifNext}). Your answer is stamped so it never asks again.`);
    } else { // cycle is 'current' | 'next' → ANSWER the fork
      const optionId = cycle === 'current' ? 'cycle-current' : 'cycle-next';
      const open = openAsksFor(ctx.root, slug, 'roll-cycle');
      if (askId != null) {
        askLedgerAnswer(ctx, { id: askId, slug, kind: 'roll-cycle', optionId }); // validate exists/open/slug+kind/option → flip to answered
      } else if (open.length) {
        die(`'${slug}' has an open ask ${open[0].id} — answer it by citing it: brain roll ${slug} --occurred ${occurred} --cycle ${cycle} --ask ${open[0].id} (answering blind would leave the ledger ask open).`); // §1.4 teaching refusal
      } else {
        askLedgerMintAnswered(ctx, buildRollAsk(), optionId); // §1.4 same-invocation: mint + answer, answered_at == raised_at
      }
      settledCycle = cycle === 'current' ? prior : due;
      newDue = cycle === 'current' ? due : ifNext;
    }
  }
  const id = op.id ?? null;
  const ops = [
    { op: 'new', id, slug: filingSlug, entity: 'filing', description: `${fm.description || slug} — cycle filed`, occurred, profile: { cycle: settledCycle } }, // §3.1 provenance stamp
    { op: 'link', id, slug: filingSlug, verb: 'filed_by', to: slug },
  ];
  if (newDue !== due) { // settling the prior owed cycle ('current') leaves due untouched — no set/push
    const why = op.why != null && String(op.why).trim() !== '' ? String(op.why) : `rolled: cycle ${settledCycle} filed ${occurred}, due ${due} → ${newDue}`;
    ops.push({ op: 'set', id, slug, field: 'due', to: newDue });
    ops.push({ op: 'push', id, slug, x: 'due', y: newDue, record: filingSlug, why }); // from: auto-filled by the batch (old due)
  }
  return { ops, meta: { filingSlug, oldDue: due, newDue, occurred, filedOnly: newDue === due, settledCycle, owedThroughToday: newDue === due ? 0 : rollOwedThroughToday(newDue, cadence, ctx.today()) } };
}

function cmdRoll(ctx, [slug], flags, deps) {
  const { out } = ctx.io;
  if (!slug) die(`roll requires a slug: brain roll <slug> --occurred <date> [--cycle current|next] [--why "…"]`);
  const plan = rollPlan(ctx, { op: 'roll', slug, occurred: flags.occurred, why: flags.why, cycle: flags.cycle, ask: flags.ask }); // refusal → main prints it
  // ONE write transaction: the filing record + obligation change commit atomically through the
  // apply batch machinery (no parallel path). Capture its JSON frames; render human output.
  const captured = [];
  const priorOut = ctx.io.out;
  ctx.io.out = (s) => captured.push(String(s));
  try { cmdApply(ctx, [], {}, { ...deps, ops: plan.ops }); }
  finally { ctx.io.out = priorOut; }
  const failed = captured.map(l => JSON.parse(l)).find(o => !o.summary && o.ok === false);
  if (failed) die(failed.error); // surface a commit-time failure as a clean CLI refusal (nothing landed)
  const m = plan.meta;
  out(`rolled ${slug}: filed ${m.filingSlug} for cycle ${m.settledCycle} (occurred ${m.occurred})${m.filedOnly ? `; due kept ${m.oldDue}` : `; due ${m.oldDue} → ${m.newDue}`}.`);
  if (m.owedThroughToday) // late roll: elapsed cycles remain — deterministic disclosure, no ask; the outbox keeps counting them
    out(`⚠ next cycle ${m.newDue} is ALSO already passed — ${m.owedThroughToday} more cycle${m.owedThroughToday === 1 ? '' : 's'} owed through today; each roll files one (use each cycle's own --occurred date).`);
}

function cmdApply(ctx, _args, flags, deps) {
    const { out } = ctx.io; const { root } = ctx;
    let db = null;
    const ops = []; const frames = [];
    if (Array.isArray(deps?.ops)) {
      // Pre-parsed injected ops (cmdRoll routes its constituent ops through the batch, not stdin).
      for (const op of deps.ops) ops.push(op);
    } else {
      let input = '';
      try { input = fs.readFileSync(0, 'utf8'); } catch { /* empty */ }
      for (const line of input.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const op = parseJsonExactNumbers(line);
          if (!op || typeof op !== 'object' || Array.isArray(op)) frames.push({ id: null, ok: false, error: `op must be a JSON object — got ${jsonType(op)}` }); // bug #71
          else {
            const boolError = normalizeOpBools(op); // A3
            if (boolError) frames.push(applyPreGroupFrame(op, { ok: false, error: boolError }));
            else ops.push(op);
          }
        } catch (e) { frames.push({ id: null, ok: false, error: e instanceof BrainError ? e.message : `bad json: ${e.message}` }); } // bug #71 + exact-number intake
      }
    }
    // roll-verb: expand each {op:'roll'} into its constituent ops (filing record + filed_by edge,
    // then the obligation's due set + push) BEFORE grouping, so the whole roll rides ONE apply
    // transaction. A refusal — bad target/cadence/due, or the blocking cycle-ambiguity ask —
    // becomes this op's failure frame, carrying e.asks so the roll-cycle ask reaches the surface.
    if (ops.some(o => o && o.op === 'roll')) {
      const expanded = [];
      for (const op of ops) {
        if (op && op.op === 'roll') {
          try { expanded.push(...rollPlan(ctx, op).ops); }
          catch (e) {
            const frame = { id: op.id ?? null, ok: false, error: e instanceof BrainError ? e.message : String(e.message || e) };
            if (e && Array.isArray(e.asks)) frame.asks = e.asks;
            frames.push(frame);
          }
        } else expanded.push(op);
      }
      ops.splice(0, ops.length, ...expanded);
    }
    // bug #5c: an empty/all-blank stdin used to emit only a 0-op summary — silently.
    if (!ops.length && !frames.length && !Array.isArray(deps?.ops)) console.error(`⚠ apply: 0 ops read from stdin — pipe NDJSON (one JSON op per line) or check your input`);
    // embedded reads are limited to an ALLOW-LIST (H14/V5): no reindex/sync/apply/batch
    // inside apply (a rebuild mid-batch is a footgun; those are top-level verbs).
    // Read-only apply executes normally. In a mixed batch, actual reads wait until the
    // file/index phase succeeds, so a later lock-time CAS refusal cannot rebuild/migrate/
    // recover a pen for a batch that wrote nothing. Writes group by slug so each file is
    // written ONCE with all its mutations, then indexed in ONE transaction.
    // Detect raw per-slug contradictions before alias normalization. Write aliases now
    // resolve from authored source/registry truth (no SQLite), but an impossible group is
    // still best taught in the operator's original spelling.
    const rawGroups = new Map();
    for (const op of ops) if (APPLY_WRITE_OPS.has(op.op) && typeof op.slug === 'string' && op.slug) {
      if (!rawGroups.has(op.slug)) rawGroups.set(op.slug, []);
      rawGroups.get(op.slug).push(op);
    }
    const rawContradictions = new Map();
    for (const [slug, raw] of rawGroups) {
      const newOps = raw.filter(o => o.op === 'new');
      const forget = raw.some(o => o.op === 'forget');
      const mutations = raw.filter(o => o.op !== 'forget' && o.op !== 'new');
      const occurred = raw.filter(o => o.op === 'set' && o.field === 'occurred');
      const occurredSets = occurred.filter(o => !o.del && o.to != null);
      const lastOccurred = occurred.at(-1);
      const foldable = lastOccurred && !lastOccurred.del && lastOccurred.to != null ? lastOccurred : null;
      const freezes = raw.filter(o => o.op === 'freeze');
      const explicitConflict = foldable && freezes.some(o => o.occurred != null && String(o.occurred) !== String(foldable.to));
      let error = null;
      if (newOps.length > 1)
        error = `'${slug}': a group has ${newOps.length} new ops for one slug — identity can be created exactly once; merge their fields into one new op`;
      else if (newOps.length && forget)
        error = `'${slug}': a group can't both new and forget the same slug`;
      else if (forget && mutations.length) {
        const names = [...new Set(mutations.map(o => o.op))].join('/');
        error = `'${slug}': the group forgets the slug — the ${names} op(s) would be silently discarded (forget archives the file as-is); apply them in a prior batch or drop them`;
      } else if (freezes.length && (occurredSets.length > 1 || explicitConflict)) {
        const values = occurredSets.map(o => JSON.stringify(o.to)).join(', ');
        const freezeValues = freezes.filter(o => o.occurred != null).map(o => JSON.stringify(o.occurred)).join(', ');
        error = occurredSets.length > 1
          ? `'${slug}': the group has ${occurredSets.length} non-delete set occurred ops (${values}) plus freeze — freeze can fold exactly one occurred value, so choosing one would silently discard another; keep one set occurred or put occurred directly on freeze`
          : `'${slug}': set occurred ${values} conflicts with freeze occurred ${freezeValues} — choosing either value would silently discard the other; keep one occurrence value`;
      }
      if (error) raw.forEach(op => rawContradictions.set(op, error));
    }
    // Validate the WHOLE stream's pure envelopes before the first alias lookup or
    // embedded read can open SQLite. A valid link at line 1 followed by a malformed
    // set/read at line 2 used to rebuild the index, migrate registry syntax, and heal
    // dirty state before the later failure atomically aborted every write. That breaks
    // the refusal boundary: line order must not decide whether invalid input mutates a
    // pen. Keep the failures keyed by their original op so --continue can still apply
    // independent valid work after this all-stream validation pass.
    const intakeFailures = new Map(rawContradictions);
    const plannedCreates = new Set(ops
      .filter(op => op?.op === 'new' && typeof op.slug === 'string' && !slugLint(op.slug))
      .map(op => applyCanonicalSlugGroup(ctx, op))
      .filter(Boolean));
    const embeddedEnvelopes = new Map();
    for (const op of ops) {
      if (intakeFailures.has(op)) continue;
      try {
        // context-retrieval §4: the focus WRITE op is retired — teach the sugar, not "unknown".
        if (op.op === 'focus')
          die(`the focus op is retired — focus is membership: {"op":"link","slug":"…","verb":"in_context","to":"focus","why":"…"} (or unlink to leave); CLI sugar: brain focus add <slug> --why "…" / brain focus remove <slug>`);
        if (APPLY_WRITE_OPS.has(op.op)) {
          if (!Object.prototype.hasOwnProperty.call(op, 'slug') || op.slug === '')
            die(`${op.op} needs a slug`);
          if (typeof op.slug !== 'string')
            die(`slug must be a string (got ${jsonType(op.slug)})`);
          const lint = slugLint(op.slug); if (lint) die(lint);
          assertApplyWriteEnvelope(ctx, op, { quiet: true });
          continue;
        }
        const embedded = embeddedArgsFlags(op, 'apply');
        const read = deps.runRead(ctx, op.op, embedded.args, embedded.flags, 'apply', true);
        if (read.kind === 'unknown') die(`unknown op '${op.op}'`);
        if (read.kind === 'disallowed') die(`'${op.op}' not allowed inside apply (embedded reads: ${read.allowed})`);
        if (read.kind !== 'read') die(`unknown op '${op.op}'`);
        if (!read.ok) die(read.error);
        preflightEmbeddedReadSource(ctx, op.op, embedded.args, embedded.flags, { plannedCreates });
        embeddedEnvelopes.set(op, embedded);
      } catch (e) {
        intakeFailures.set(op, e instanceof BrainError ? e.message : String(e.message || e));
      }
    }
    // Intake can reject one line before grouping (unknown key, bad bool/date/CAS, bad
    // relation target, and so on). Under --continue that failure still poisons its
    // ENTIRE canonical slug-group: otherwise a sibling can commit after the rejected
    // line silently dropped the group's only base_hash. Keep the first causal failure
    // for stable blame; all sibling frames will name it below.
    const failedGroups = new Map();
    const rememberFailedGroup = (op, error, frame = null) => {
      const slug = applyCanonicalSlugGroup(ctx, op);
      if (!slug) return null;
      if (frame && frame.failedSlug !== slug)
        Object.defineProperty(frame, 'failedSlug', { value: slug, configurable: true });
      if (!failedGroups.has(slug)) failedGroups.set(slug, { op, error: String(error), slug });
      return slug;
    };
    for (const frame of frames) if (!frame.ok && frame.failedOp)
      rememberFailedGroup(frame.failedOp, frame.error || 'operation failed', frame);
    for (const [op, error] of intakeFailures)
      rememberFailedGroup(op, error);
    const groupRollbackError = (slug, failure) => {
      const failedOp = failure?.op;
      const cause = failedOp
        ? (failedOp.id != null ? `op ${failedOp.id} ('${failedOp.op}')` : `a '${failedOp.op || 'write'}' op`)
        : 'an operation';
      return `rolled back with slug-group '${slug}' — ${cause} failed: ${failure?.error || 'operation failed'}`;
    };
    // Without --continue, a pure intake failure aborts before ANY derived-state
    // consumer runs. Emit one truthful frame per parsed op; parse/bool failures already
    // live in `frames`, while otherwise-valid ops are explicitly marked aborted.
    if (!flags.continue && (frames.some(f => !f.ok) || intakeFailures.size)) {
      for (const op of ops) {
        const error = intakeFailures.get(op);
        if (error) {
          frames.push(applyFailureFrame(ctx, op, { ok: false, error }));
          continue;
        }
        // Preserve slug-group blame even though the new all-stream pass aborts before
        // grouping. A valid sibling did not merely lose to some batch-wide error: it
        // rolled back because a specific op for the same authored node failed.
        const groupSlug = applyCanonicalSlugGroup(ctx, op);
        const localFrame = frames.find(f => !f.ok && groupSlug && f.failedSlug === groupSlug);
        const localEntry = [...intakeFailures].find(([failedOp]) => failedOp !== op &&
          groupSlug && applyCanonicalSlugGroup(ctx, failedOp) === groupSlug);
        const failedOp = localFrame?.failedOp || localEntry?.[0];
        const failed = localFrame?.error || localEntry?.[1];
        const cause = failedOp
          ? (failedOp.id != null ? `op ${failedOp.id} ('${failedOp.op}')` : `a '${failedOp.op || 'write'}' op`)
          : null;
        frames.push({ id: op.id ?? null, ok: false, error: failed
          ? `rolled back with slug-group '${groupSlug || op.slug}' — ${cause} failed: ${failed}`
          : 'aborted (batch rolled back — another operation failed during pure intake; pass --continue to apply the rest)' });
      }
      frames.forEach(f => { assertApplyFrame(f); out(JSON.stringify(f)); });
      const failedBySlug = new Map();
      for (const f of frames) if (!f.ok && f.failedSlug)
        failedBySlug.set(f.failedSlug, String(f.error || 'operation failed').split('\n')[0]);
      out(JSON.stringify({ summary: { ops: frames.length, ok: 0, failed: frames.length, written: 0,
        failed_slugs: [...failedBySlug].map(([slug, error]) => ({ slug, error })) } }));
      process.exitCode = 1;
      return;
    }
    const groups = new Map(); const order = []; const pendingReads = []; const normalizedWrites = [];
    const failBeforeGrouping = (op, error) => {
      const frame = applyFailureFrame(ctx, op, { ok: false, error });
      frames.push(frame);
      rememberFailedGroup(op, error, frame);
    };
    for (const op of ops) {
      if (intakeFailures.has(op)) {
        frames.push(applyFailureFrame(ctx, op, { ok: false, error: intakeFailures.get(op) }));
        continue;
      }
      let embedded;
      try {
        // Write op fields are validated by the strict write envelope below. Only a known
        // embedded READ owns args/flags and the four-key read envelope.
        embedded = APPLY_WRITE_OPS.has(op.op) ? { args: [], flags: {} } : embeddedEnvelopes.get(op);
      }
      catch (e) { failBeforeGrouping(op, e instanceof BrainError ? e.message : String(e.message || e)); continue; }
      const read = deps.runRead(ctx, op.op, embedded.args, embedded.flags, 'apply', true);
      if (read.kind === 'unknown') { failBeforeGrouping(op, `unknown op '${op.op}'`); continue; }
      if (read.kind === 'disallowed') { failBeforeGrouping(op, `'${op.op}' not allowed inside apply (embedded reads: ${read.allowed})`); continue; }
      if (read.kind === 'read') {
        pendingReads.push({ op, embedded });
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(op, 'slug') || op.slug === '') { failBeforeGrouping(op, `${op.op} needs a slug`); continue; }
      if (typeof op.slug !== 'string') { failBeforeGrouping(op, `slug must be a string (got ${jsonType(op.slug)})`); continue; }
      let normalized;
      try {
        const lint = slugLint(op.slug); if (lint) die(lint);
        // The whole-stream pass already validated this exact public envelope. Alias
        // canonicalization is source/registry-pure, so even later source-dependent plan
        // failures cannot rebuild/migrate/recover derived state on the way to refusal.
        normalized = normalizeApplyWriteOp(ctx, op);
      }
      catch (e) {
        failBeforeGrouping(op, e instanceof BrainError ? e.message : String(e.message || e));
        continue;
      }
      const slug = applyCanonicalSlugGroup(ctx, normalized);
      if (slug && slug !== normalized.slug) normalized = { ...normalized, slug };
      normalizedWrites.push({ op, normalized, slug: slug || normalized.slug });
    }
    // Normalization itself can discover a failure after an earlier sibling was already
    // seen. Form groups only after the full pass, then quarantine every successful
    // candidate whose canonical identity has any pre-group failure.
    for (const item of normalizedWrites) {
      const failure = failedGroups.get(item.slug);
      if (failure) {
        frames.push(applyFailureFrame(ctx, item.op, { ok: false, error: groupRollbackError(item.slug, failure) }));
        continue;
      }
      if (!groups.has(item.slug)) { groups.set(item.slug, []); order.push(item.slug); }
      groups.get(item.slug).push(item.normalized);
    }
    // build each group in memory (validation, no disk); collect per-op frames.
    // ORDER within a group (H21): new FIRST (create before touching), additive next,
    // class-flips (freeze), forget LAST — so set-before-new resolves and a torn/re-run
    // batch is sound (H3/V3). Stable within each bucket.
    const bucket = (op) => op.op === 'new' ? 0 : op.op === 'forget' ? 3 : op.op === 'freeze' ? 2 : 1;
    const built = []; let buildFailed = false;
    for (const slug of order) {
      const raw = groups.get(slug);
      const g = raw.map((op, i) => ({ op, i })).sort((a, b) => bucket(a.op) - bucket(b.op) || a.i - b.i).map(x => x.op);
      // Identity can be minted exactly once. `g.find(new)` plus filtering every new out of
      // writeOps used to report duplicate new ops ok:true while silently discarding all
      // but the first payload.
      const newOps = raw.filter(o => o.op === 'new');
      const duplicateNew = newOps.length > 1;
      // new + forget in one group is contradictory (create then archive the same slug)
      const contradiction = newOps.length > 0 && raw.some(o => o.op === 'forget');
      const forgetMutationOps = raw.filter(o => o.op !== 'forget' && o.op !== 'new');
      const forgetContradiction = raw.some(o => o.op === 'forget') && forgetMutationOps.length > 0;
      const occurredMutations = raw.filter(o => o.op === 'set' && o.field === 'occurred');
      const setOccurredOps = raw.filter(o => o.op === 'set' && o.field === 'occurred' && !o.del && o.to != null);
      const lastOccurredMutation = occurredMutations.at(-1) || null;
      const foldableOccurred = lastOccurredMutation && !lastOccurredMutation.del && lastOccurredMutation.to != null ? lastOccurredMutation : null;
      const freezeOps = raw.filter(o => o.op === 'freeze');
      const explicitFreezeConflict = foldableOccurred && freezeOps.some(o => o.occurred != null && String(o.occurred) !== String(foldableOccurred.to));
      const occurredFreezeContradiction = freezeOps.length > 0 && (setOccurredOps.length > 1 || explicitFreezeConflict);
      const gframes = []; let failed = null, causeLabel = null, plan = null, kind = null;
      let planWarnings = [];
      let frameRefs = new Map();
      if (duplicateNew) {
        failed = `'${slug}': a group has ${newOps.length} new ops for one slug — identity can be created exactly once; merge their fields into one new op`;
        causeLabel = 'the duplicate-new contradiction'; buildFailed = true;
        raw.forEach(op => gframes.push({ id: op.id ?? null, ok: false, error: failed }));
      }
      if (contradiction && !failed) {
        failed = `'${slug}': a group can't both new and forget the same slug`;
        causeLabel = 'the new+forget contradiction'; buildFailed = true;
        raw.forEach(op => gframes.push({ id: op.id ?? null, ok: false, error: failed }));
      }
      if (forgetContradiction && !failed) {
        const names = [...new Set(forgetMutationOps.map(o => o.op))].join('/');
        failed = `'${slug}': the group forgets the slug — the ${names} op(s) would be silently discarded (forget archives the file as-is); apply them in a prior batch or drop them`; // GAP-B
        causeLabel = 'the forget+mutation contradiction';
        buildFailed = true;
        raw.forEach(op => gframes.push({ id: op.id ?? null, ok: false, error: failed }));
      }
      if (occurredFreezeContradiction && !failed) {
        const values = setOccurredOps.map(o => JSON.stringify(o.to)).join(', ');
        const freezeValues = freezeOps.filter(o => o.occurred != null).map(o => JSON.stringify(o.occurred)).join(', ');
        failed = setOccurredOps.length > 1
          ? `'${slug}': the group has ${setOccurredOps.length} non-delete set occurred ops (${values}) plus freeze — freeze can fold exactly one occurred value, so choosing one would silently discard another; keep one set occurred or put occurred directly on freeze`
          : `'${slug}': set occurred ${values} conflicts with freeze occurred ${freezeValues} — choosing either value would silently discard the other; keep one occurrence value`;
        causeLabel = 'the multiple-occurred+freeze contradiction';
        buildFailed = true;
        raw.forEach(op => gframes.push({ id: op.id ?? null, ok: false, error: failed }));
      }
      if (!failed) {
        try {
          const newOp = g.find(o => o.op === 'new') || null;
          const isForget = g.some(o => o.op === 'forget');
          kind = newOp ? 'create' : isForget ? 'forget' : 'mutate';
          let writeOps = g.filter(o => o.op !== 'new' && o.op !== 'forget');
          if (newOp?.body != null) {
            const bodyOp = { id: newOp.id, op: 'body', body: newOp.body, force: newOp.force === true || flags.force };
            Object.defineProperty(bodyOp, 'sourceOp', { value: newOp }); // non-enumerable: validation still sees only the shipped body envelope
            writeOps.unshift(bodyOp);
          } // bug #83
          // Folding is source-order aware. A later `set occurred --del` cancels an earlier
          // candidate, while delete→set leaves the final set eligible. Using find() picked
          // the first value and could resurrect a date the batch explicitly deleted.
          const setOccurred = foldableOccurred && writeOps.includes(foldableOccurred) ? foldableOccurred : null;
          let foldedOccurred = null;
          if (setOccurred) {
            let folded = false;
            writeOps = writeOps.filter(o => {
              if (o === setOccurred && writeOps.some(p => p.op === 'freeze' && p.occurred == null)) { folded = true; return false; }
              return true;
            }).map(o => o.op === 'freeze' && o.occurred == null ? { ...o, occurred: setOccurred.to } : o);
            if (folded) foldedOccurred = setOccurred;
          }
          // M2 rider (a): fold a push's `x` against the set fields it provenances (V5 casefold-fold), so a
          // near-miss field path (profile.Amount vs profile.amount, trailing space, punctuation) still pairs
          // for autoFrom instead of silently dying — rewrite x to the canonical set field. Exact-fold only.
          const setFieldList = [...new Set(writeOps.filter(o => o.op === 'set' && typeof o.field === 'string').map(o => o.field))];
          for (const o of writeOps) {
            if (o.op !== 'push' || typeof o.x !== 'string' || o.x === '' || setFieldList.includes(o.x)) continue;
            const fk = variantFold(o.x); const hits = setFieldList.filter(f => variantFold(f) === fk);
            if (hits.length === 1) o.x = hits[0]; // canonicalize the near-miss field path to the set field it records provenance for
          }
          const setFields = new Set(writeOps.filter(o => o.op === 'set' && o.field != null).map(o => o.field));
          const autoFields = new Set(writeOps.filter(o => o.op === 'push' && o.x != null && o.from === undefined && setFields.has(o.x)).map(o => o.x));
          const baseOps = g.filter(o => o.base_hash != null);
          const baseOp = baseOps.length ? baseOps[0] : null;
          const baseHash = baseOp ? { hash: baseOp.base_hash, op: baseOp } : null; // bug #83
          const permits = new Set(flags.force ? ['edit-record'] : []);
          const req = { slug, kind, newOp: newOp ? { ...newOp, slug } : null, ops: writeOps, baseHash, force: !!flags.force, permits, index: { defer: () => {} }, autoFrom: [...autoFields], batchOps: ops }; // A9 (batchOps: whole-batch view for the batch-aware ref guard, M2 rider b)
          const priorConsoleError = console.error;
          console.error = (...parts) => planWarnings.push(parts.map(String).join(' '));
          try { plan = prepareWrite(ctx, req); }
          finally { console.error = priorConsoleError; }
          for (const op of baseOps.slice(1)) withWriteOpContext(op, () => casGuard({ hash: plan.readHash }, slug, { 'base-hash': op.base_hash, force: !!flags.force || op.force === true, signals: plan.signals })); // bug #83
          for (const op of g) {
            const frame = { id: op.id ?? null, ok: true };
            if (op === foldedOccurred) frame.warn = `set occurred folded into freeze for '${slug}'`;
            gframes.push(frame);
            frameRefs.set(op, frame);
          }
          const firstOk = gframes.find(f => f.ok);
          if (firstOk && plan.signals.length) firstOk.warn = [firstOk.warn, ...plan.signals].filter(Boolean).join(' | ');
          if (firstOk && plan.asks) firstOk.asks = plan.asks; // asks-contract: non-blocking asks ride the op's successful result
        } catch (e) {
          failed = e instanceof BrainError ? e.message : String(e.message || e);
          const failedAsks = e && Array.isArray(e.asks) ? e.asks : null; // asks-contract: a blocking-ask refusal carries its ask on the error surface
          const tagged = e && typeof e === 'object' ? e.writeOp : null;
          const taggedCulprit = tagged && (g.find(o => o === tagged.sourceOp) || g.find(o => o === tagged) ||
            (tagged.id != null ? g.find(o => o.id === tagged.id && o.op === tagged.op) : null) ||
            (g.filter(o => o.op === tagged.op).length === 1 ? g.find(o => o.op === tagged.op) : null));
          const culprit = taggedCulprit || g.find(o => o.op !== 'new' || /exists|base_hash|entity|slug|new/.test(failed)) || g[0];
          causeLabel = culprit?.id != null ? `op ${culprit.id} ('${culprit.op}')` : `a '${culprit?.op || 'write'}' op`; // bug #20
          buildFailed = true;
          for (const op of g) gframes.push(op === culprit
            ? { id: op.id ?? null, ok: false, error: failed, ...(failedAsks ? { asks: failedAsks } : {}) }
            : { id: op.id ?? null, ok: false, error: `rolled back with slug-group '${slug}' — ${causeLabel} failed: ${failed}` });
        }
      }
      built.push({ slug, kind, plan, planWarnings, gframes, frameRefs, failed, causeLabel, raw: g, phaseAFailed: false, skippedAfterPhaseA: false });
    }
    // Mixed-batch reads observe the committed batch state. Detect the only planned
    // identity removal that would make a source-preflighted read predictably fail after
    // Phase A; without --continue this remains a pure planning refusal.
    const plannedForgets = new Set(built.filter(b => !b.failed && b.kind === 'forget').map(b => b.slug));
    for (const item of pendingReads) {
      const { op, embedded } = item;
      const identityArgs = op.op === 'get' || op.op === 'peek' || op.op === 'check' || op.op === 'relations' || op.op === 'context'
        ? embedded.args || []
        : (op.op === 'files' || op.op === 'tools' || op.op === 'skills') && embedded.flags?.for != null ? [embedded.flags.for] : [];
      const forgotten = identityArgs.map(raw => resolveWriteSlug(ctx, raw)).find(slug => plannedForgets.has(slug));
      if (!forgotten) continue;
      item.done = true;
      frames.push(applyPreGroupFrame(op, { ok: false, error: `embedded ${op.op} targets '${forgotten}', which this batch forgets before mixed reads execute` }));
    }
    const executePendingReads = () => {
      for (const item of pendingReads) {
        if (item.done) continue;
        item.done = true;
        const { op, embedded } = item;
        const read = deps.runRead(ctx, op.op, embedded.args, embedded.flags, 'apply');
        frames.push(read.ok
          ? { id: op.id ?? null, ok: true, output: read.output }
          : applyPreGroupFrame(op, { ok: false, error: read.error }));
      }
    };
    const abortPendingReads = (error) => {
      for (const item of pendingReads) {
        if (item.done) continue;
        item.done = true;
        frames.push({ id: item.op.id ?? null, ok: false, error });
      }
    };
    const planningAbort = (buildFailed || frames.some(f => !f.ok)) && !flags.continue;
    if (planningAbort)
      abortPendingReads('aborted (batch rolled back — another operation failed before embedded reads executed; pass --continue to run independent ops)');
    const wouldAbort = (buildFailed || frames.some(f => !f.ok)) && !flags.continue;
    const committable = built.some(b => !b.failed && b.plan);
    if (!wouldAbort && committable) {
      const createSet = new Set(built.filter(b => !b.failed && b.kind === 'create').map(b => b.slug));
      const forgetSet = new Set(built.filter(b => !b.failed && b.kind === 'forget').map(b => b.slug));
      for (const b of built) if (!b.failed) {
        for (const op of b.raw) {
          const frame = b.frameRefs.get(op);
          if (!frame) continue;
          for (const target of relationTargetsFromOp(op)) {
            let targetLive = false;
            try {
              const text = fs.readFileSync(nodePath(root, target), 'utf8');
              targetLive = sourceIndexState(ctx, target, text).live;
            } catch (e) { if (e.code !== 'ENOENT') throw e; }
            if ((!targetLive || forgetSet.has(target)) && !createSet.has(target))
              appendFrameWarn(frame, `⚠ warning: link target '${target}' is not a node (dangling edge — fine if intentional)`); // bug #37 / A1
          }
        }
      }
    }
    // H21: emit per-op frames, then a summary frame with counts; any failure → exit 1.
    const emit = (fs2, wrote = 0) => {
      fs2.forEach(f => { assertApplyFrame(f); out(JSON.stringify(f)); });
      const failed = fs2.filter(f => !f.ok).length;
      const index_pending = fs2.filter(f => f.ok && f.index_pending).length;
      const failedBySlug = new Map();
      for (const b of built) if (b.failed)
        failedBySlug.set(b.slug, String(b.failed).split('\n')[0]);
      for (const f of fs2) if (!f.ok && f.failedSlug && !failedBySlug.has(f.failedSlug))
        failedBySlug.set(f.failedSlug, String(f.error || 'operation failed').split('\n')[0]);
      const failed_slugs = [...failedBySlug].map(([slug, error]) => ({ slug, error }));
      out(JSON.stringify({ summary: { ops: fs2.length, ok: fs2.length - failed, failed, written: wrote, ...(index_pending ? { index_pending } : {}), failed_slugs } }));
      if (failed) process.exitCode = 1;
    };
    // bug #20: a slug-group that FAILED in the build never reaches disk — it rolls back WHOLE
    // (skipped in Phase A). So EVERY op in it must read ok:false, including an earlier op that
    // validated ok:true in memory but never landed; the group-rollback error names the op that
    // sank the group. summary.ok then counts only ops whose writes actually survived.
    const rollbackFrames = (b) => b.gframes.map(f => f.ok ? ({
      id: f.id, ok: false,
      error: `rolled back with slug-group '${b.slug}' — ${b.causeLabel} failed: ${b.failed}`,
    }) : f);
    // Intake/read/normalization failures are failures of the SAME transaction, not a
    // side channel. Without --continue, no valid slug group may commit beside a bad
    // JSON/bool/unknown/read/target frame.
    const abort = (buildFailed || frames.some(f => !f.ok)) && !flags.continue;
    if (abort) { // nothing written to disk yet (build is in-memory) — clean rollback
      for (const b of built) {
        const localFailure = frames.find(f => !f.ok && f.failedSlug === b.slug);
        const failedOp = localFailure?.failedOp;
        const localCause = failedOp
          ? (failedOp.id != null ? `op ${failedOp.id} ('${failedOp.op}')` : `a '${failedOp.op || 'write'}' op`)
          : null;
        for (const f of b.gframes) frames.push(f.ok ? {
          id: f.id, ok: false,
          error: localFailure
            ? `rolled back with slug-group '${b.slug}' — ${localCause} failed: ${localFailure.error}`
            : 'aborted (batch rolled back — another operation failed; pass --continue to apply the rest)',
        } : f);
      }
      emit(frames); return;
    }
    if (!committable) {
      executePendingReads();
      for (const b of built) rollbackFrames(b).forEach(f => frames.push(f));
      emit(frames); return;
    }
    // Phase A: write files (file-first), behind the crash sentinel. Phase B: index txn.
    const written = [];
    let phaseAFailed = null;
    for (const b of built) {
      if (b.failed) continue;
      // Default mode stops at the first file-time failure: later plans never cross the
      // write boundary. `--continue` has the same canonical slug-group contract here as
      // at intake/planning, so a busy lock/CAS/file error quarantines only this group and
      // independent groups still get their own commit attempt.
      if (phaseAFailed && !flags.continue) { b.skippedAfterPhaseA = true; continue; }
      try {
        commitPlan(ctx, { ...b.plan, index: { defer: (slug2) => { written.push(slug2); } } }); // bug #66
        for (const warning of b.planWarnings) console.error(warning);
      } catch (e) {
        b.failed = e instanceof BrainError ? e.message : String(e.message || e);
        b.phaseAFailed = true;
        b.causeLabel = `the file write`;
        phaseAFailed ||= b;
      }
    }
    const writtenSet = new Set(written);
    if (written.length) {
      // first-use auto-registration for any link verbs that actually landed (one save)
      const verbEntries = [];
      for (const b of built) if (!b.failed && writtenSet.has(b.slug))
        for (const op of b.raw) if (op.op === 'link' && op.verb && !isKnownVerb(ctx.reg, op.verb))
          verbEntries.push({ verb: op.verb, example: 'via apply' });
      registerVerbsBestEffort(ctx, verbEntries); // bug #79
      try {
        withIndexLock(root, () => {
          closeDb(ctx);
          db = openDb(ctx); // Phase A's commitPlan already required/current-checked it
          // bug #14(a): retry the index txn under a concurrent-writer lock, the same politeness
          // sync got in W2 (apply had none — the lock loser reported the whole batch failed).
          withBusyRetry(db, () => { db.exec('BEGIN'); for (const slug of written) reindexRows(root, db, slug, ctx.reg); db.exec('COMMIT'); });
          clearDirty(root, written); // remove only OUR slugs — a concurrent writer's pending slug stays
        });
      } catch (e) {
        try { db?.exec('ROLLBACK'); } catch { /* already rolled */ }
        // bug #14(b): retries exhausted (or a real index error). The FILES are on disk — this
        // is NOT data loss. Leave the written slugs in the dirty sentinel (do NOT clear) so the
        // next CLI open's recoverDirty reconciles them for real, and tell the truth in the
        // frames: file-written-index-pending, distinct from an op that never landed.
        writeDirty(root, written); // re-assert the sentinel (idempotent merge) in case a peer cleared around us
        abortPendingReads(`aborted (file committed but index pending: ${e.message} — embedded reads did not execute)`);
        const writtenSet2 = new Set(written);
        for (const b of built) {
          if (b.failed) { rollbackFrames(b).forEach(f => frames.push(f)); continue; } // bug #20: a rolled-back group never wrote — never ok/index_pending
          for (const f of b.gframes) frames.push(writtenSet2.has(b.slug) && f.ok ? { id: f.id, ok: true, index_pending: true, warn: `file written, index pending (${e.message}) — reconciles on next open, or run: brain sync` } : f); // bug #54 / A3
        }
        emit(frames, written.length); return;
      }
    }
    if (phaseAFailed && !flags.continue)
      abortPendingReads('aborted (a file write failed before embedded reads executed; pass --continue to run independent reads)');
    else executePendingReads();
    // bug #20: committed groups keep their real frames; a failed group (present only under
    // --continue) rolls back whole — all its ops read ok:false, never a stale ok:true.
    for (const b of built) {
      if (b.phaseAFailed) b.gframes.forEach(f => frames.push({ id: f.id, ok: false, error: b.failed }));
      else if (b.skippedAfterPhaseA) b.gframes.forEach(f => frames.push({ id: f.id, ok: false, error: `aborted — a prior slug's write failed after ${written.length} slug(s) were already committed to disk` })); // bug #63
      else if (b.failed) rollbackFrames(b).forEach(f => frames.push(f));
      else b.gframes.forEach(f => frames.push(f));
    }
    emit(frames, written.length);
}

// entity-ref-fields: validate the --entities restriction for a register --field --type ref.
// Returns the entity list (or null when unrestricted); teaches on misuse (non-ref field,
// empty/duplicate members, or an unregistered entity). Shared by both register --field paths.
function refEntitiesSpec(ctx, flags, type) {
  if (flags.entities == null) return null;
  if (type !== 'ref') die(`--entities is only valid on 'ref' fields (this field is '${type}') — refusing to ignore an authored modifier; nothing written`);
  const members = String(flags.entities).split('|').map(s => s.trim());
  if (members.some(v => v === '')) die(`--entities needs nonempty entity names separated by single '|' characters (no leading/trailing/doubled separators); nothing written`);
  if (!members.length) die(`--entities needs at least one entity name (or omit it to allow any card entity)`);
  const duplicate = members.find((v, i) => members.indexOf(v) !== i);
  if (duplicate != null) die(`--entities repeats '${duplicate}' — each entity must be unique; nothing written`);
  for (const m of members) if (!ownValue(ctx.reg.entities, m)) die(`--entities member '${m}' is not a registered entity — register it first or fix the typo; nothing written`);
  return members;
}

function cmdRegister(ctx, _args, flags) {
    const { out } = ctx.io; const { root } = ctx;
    // register into brain/__meta/registry.md via parse→mutate→serialize→atomic write.
    // unregister (H5): tombstone a CUSTOM row. Prebuilt seed rows re-materialize on the
    // next load (the seed always survives) — warn rather than pretend it stuck.
    const modes = [];
    if (flags.field) modes.push('--field');
    else {
      if (flags.entity) modes.push('--entity');
    }
    if (flags.verb) modes.push('--verb'); // bug #80: --field legitimately pairs only with --entity, never --verb.
    if (flags.alias) modes.push('--alias');
    const unregisterModes = ['unregister-entity', 'unregister-verb', 'unregister-alias'].filter(f => flags[f]);
    unregisterModes.forEach(mode => modes.push('--' + mode));
    if (modes.length > 1)
      die(`register does ONE registration per invocation — got ${modes[0]} and ${modes[1]}; run them as two commands (--field is the exception: it pairs with --entity)`);
    const mode = modes[0] || 'stats';
    const allowedByMode = mode === '--field'
      ? new Set(['entity', 'field', 'type', 'required', 'enum', 'entities', 'currency', 'query', 'lint', 'budget'])
      : mode === '--entity'
        ? new Set(['entity', 'tenses', 'force'])
        : mode === '--verb'
          ? new Set(['verb', 'conjugate', 'inverse', 'example'])
          : mode === '--alias'
            ? new Set(['alias', 'to', 'verb-alias'])
            : mode === '--unregister-entity'
              ? new Set(['unregister-entity', 'force'])
              : mode === '--unregister-verb'
                ? new Set(['unregister-verb', 'force'])
                : mode === '--unregister-alias'
                  ? new Set(['unregister-alias'])
                  : new Set();
    const irrelevant = Object.keys(flags).filter(key => key !== 'root' && key !== 'help' && !allowedByMode.has(key));
    if (irrelevant.length)
      die(`register ${mode === 'stats' ? 'stats mode (no registration identity)' : mode} does not use ${irrelevant.map(k => '--' + k).join(', ')} — choose the matching --entity/--field/--verb/--alias/--unregister-* mode; nothing executed`);
    if (flags.entity) {
      assertRegCell('--entity', flags.entity, { isName: true });
      if (String(flags.entity).includes('.')) die(`--entity '${flags.entity}' cannot contain '.' — profile registry rows split on the first dot, so dotted entity names are ambiguous; nothing written`);
    }
    if (flags.field) { assertKeyShape('--field', flags.field); assertRegCell('--field', flags.field, { isName: true }); }
    if (flags.alias) assertRegCell('--alias', flags.alias, { isName: true });
    if (flags.verb) { assertRelationVerb('--verb', flags.verb); assertRegCell('--verb', flags.verb, { isName: true }); }
    if (flags['unregister-entity']) assertRegCell('--unregister-entity', flags['unregister-entity'], { isName: true });
    if (flags['unregister-verb']) assertRegCell('--unregister-verb', flags['unregister-verb'], { isName: true });
    if (flags['unregister-alias']) assertRegCell('--unregister-alias', flags['unregister-alias'], { isName: true });
    if (flags.tenses != null) String(flags.tenses).split(',').map(s => s.trim()).filter(Boolean).forEach(t => assertRegCell('--tenses', t));
    if (flags.type != null) assertRegCell('--type', flags.type);
    if (flags.enum != null) String(flags.enum).split('|').map(s => s.trim()).filter(Boolean).forEach(v => assertRegCell('--enum', v, { isEnum: true }));
    if (flags.entities != null) String(flags.entities).split('|').map(s => s.trim()).filter(Boolean).forEach(v => assertRegCell('--entities', v, { isEnum: true }));
    if (flags.currency != null) assertRegCell('--currency', flags.currency);
    if (flags.currency != null && !/^[A-Z]{3}$/.test(String(flags.currency))) // V3: a currency= modifier must be a 3-letter ISO 4217 code (was: any string)
      die(`--currency '${flags.currency}' is not a 3-letter ISO 4217 code (e.g. EUR/USD/GBP) — a denomination is exactly three uppercase letters; nothing written`);
    if (flags.query != null) assertRegCell('--query', flags.query);
    if (flags.lint != null) assertRegCell('--lint', flags.lint);
    if (flags.to != null) {
      if (flags['verb-alias']) assertRelationVerb('--to verb-alias target', flags.to);
      assertRegCell('--to', flags.to, { isName: !!flags['verb-alias'] });
    }
    if (flags.conjugate != null) {
      if (flags.conjugate !== 'drop' && flags.conjugate !== '') assertRelationVerb('--conjugate target', flags.conjugate);
      assertRegCell('--conjugate', flags.conjugate);
    }
    if (flags.inverse != null) { if (flags.inverse !== '') assertRelationVerb('--inverse target', flags.inverse); assertRegCell('--inverse', flags.inverse); }
    if (flags.example != null) assertRegCell('--example', flags.example);
    // Validate the selected mode's required arguments before the registry-health door,
    // so a malformed command still gets its own teaching. Then fail BEFORE any DB lookup
    // or in-memory mutation: verb-alias registration used to requireDb/auto-rebuild and
    // create a 0-byte index even though saveRegistry would later refuse the unsafe file.
    if (flags.field && !flags.entity) die(`register --field <name> requires --entity <entity>`);
    if (flags.field && !flags.type) die(`register --field <name> requires --type <type> (valid: ${PROFILE_TYPE_LIST})`);
    if (flags.alias && flags.to == null) die(`register --alias <name> --to <target> [--verb-alias]`);
    // ontology-cleanup §8 refusal point 1 — the schema lock covers ENTITY TYPES ONLY.
    // Fields are need-driven and free (any session may type a new field on an existing
    // entity); verbs and aliases stay free too (free minting on first link is load-bearing).
    // The teaching names the PROPOSAL path only (a note card — the asks ledger is
    // machine-authored and read-only): a mid-task model must never be handed the unlock
    // recipe at the moment of temptation (the bypass lives in INSTALL §Admin).
    if (ctx.schemaLock && !ctx.adminMode && mode === '--entity')
      die(`schema is locked — a schema change is an admin-mode act; record the proposal as a note ("schema proposal: <what and why>") for the next admin session`);
    if (ctx.adminMode && mode === '--entity') out(`⚠ admin mode: schema write`);
    if (ctx.regState.futureFormat != null)
      die(`refusing to write brain/__meta/registry.md — format ${ctx.regState.futureFormat} is newer than this engine supports (format ${REG_FORMAT}). Upgrade the engine first; nothing executed and no derived index was opened`);
    if (ctx.regState.parseError) {
      // Preserve the long-standing recovery artifact for the two registration shapes
      // that can be represented without consulting SQLite. The attempted seed+edit is
      // written beside the corrupt authored file, never over it, and saveRegistry emits
      // the established HAND-REPAIR teaching. Crucially, verb-alias no longer opens or
      // bootstraps the derived index before reaching this latch.
      if (flags.field) {
        const type = String(flags.type);
        if (!PROFILE_TYPES.has(type)) die(`unknown profile field type '${type}' — valid types: ${PROFILE_TYPE_LIST}`);
        const enumVals = flags.enum != null ? String(flags.enum).split('|').map(s => s.trim()) : [];
        if (flags.enum != null && enumVals.some(v => v === ''))
          die(`--enum needs nonempty members separated by single '|' characters (no leading/trailing/doubled separators); nothing written`);
        const duplicateEnum = enumVals.find((v, i) => enumVals.indexOf(v) !== i);
        if (duplicateEnum != null) die(`--enum repeats '${duplicateEnum}' — each member must be unique; nothing written`);
        { // V6 (deterministic-checks §8): reject case-twin members — they split one vocabulary into two cohorts and make V4's fold ambiguous
          const twin = enumVals.find((v, i) => enumVals.findIndex(w => w.toLowerCase() === v.toLowerCase()) !== i);
          if (twin != null) die(`--enum members differ only by case ('${enumVals.find(w => w.toLowerCase() === twin.toLowerCase())}' vs '${twin}') — case-twins split one vocabulary into two cohorts; pick a single spelling; nothing written`);
        }
        if ((type === 'select' || type === 'multi') && !enumVals.length)
          die(`select/multi need an --enum value set, e.g. --enum "a|b|c"`);
        if (flags.enum != null && type !== 'select' && type !== 'multi')
          die(`--enum is only valid on 'select' or 'multi' fields (this field is '${type}') — refusing to ignore an authored modifier; nothing written`);
        if (flags.currency != null && type !== 'number')
          die(`--currency is only valid on 'number' fields (this field is '${type}') — refusing to ignore an authored modifier; nothing written`);
        if (flags.budget != null && (!Number.isInteger(Number(flags.budget)) || Number(flags.budget) <= 0))
          die(`--budget must be a positive integer`);
        if (flags.budget != null && type !== 'list') die(`--budget is only valid on 'list' fields (this field is '${type}')`);
        const refEntities = refEntitiesSpec(ctx, flags, type);
        const entity = ownValue(ctx.reg.entities, flags.entity) || { tenses: ['card'], profile: {} };
        entity.profile = entity.profile || {};
        const spec = { type };
        if (flags.required) spec.required = true;
        if (enumVals.length) spec.enum = enumVals;
        if (refEntities) spec.entities = refEntities;
        if (flags.currency != null) spec.currency = String(flags.currency);
        if (flags.query != null) spec.query = String(flags.query);
        if (flags.lint != null) spec.lint = String(flags.lint);
        if (flags.budget != null) spec.budget = Number(flags.budget);
        setOwn(entity.profile, flags.field, spec);
        setOwn(ctx.reg.entities, flags.entity, entity);
        saveRegistry(ctx);
      }
      if (flags.entity) {
        const tenses = String(flags.tenses || 'card').split(',').map(s => s.trim());
        if (tenses.some(t => t === '')) die(`register --tenses needs a nonempty comma-separated subset of card, future, record (no leading/trailing/doubled commas)`);
        const duplicate = tenses.find((t, i) => tenses.indexOf(t) !== i);
        if (duplicate) die(`register --tenses repeats '${duplicate}' — each of card, future, record may appear at most once`);
        const bad = tenses.find(t => !ENTITY_TENSES.has(t));
        if (bad) die(`register --tenses: '${bad}' is not a valid tense — allowed: card, future, record`);
        setOwn(ctx.reg.entities, flags.entity, { tenses, profile: ownValue(ctx.reg.entities, flags.entity)?.profile || {} });
        saveRegistry(ctx);
      }
      if (flags['unregister-entity'] || flags['unregister-verb'] || flags['unregister-alias']) {
        if (flags['unregister-entity']) delete ctx.reg.entities[flags['unregister-entity']];
        if (flags['unregister-verb']) {
          const v = flags['unregister-verb'];
          delete ctx.reg.verbs[v]; delete ctx.reg.conjugate[v]; delete ctx.reg.inverses[v];
          ctx.reg.weakVerbs = (ctx.reg.weakVerbs || []).filter(x => x !== v);
        }
        if (flags['unregister-alias']) delete ctx.reg.aliases[flags['unregister-alias']];
        saveRegistry(ctx);
      }
      if (flags.verb) {
        if (String(flags.verb).trim() === '' || String(flags.verb) === 'true')
          die(`register --verb requires a real verb name, not '${String(flags.verb)}' — for a verb alias use: brain register --alias <name> --to <verb> --verb-alias`);
        ctx.reg.verbs = ctx.reg.verbs || {};
        if (!hasOwnKey(ctx.reg.verbs, flags.verb)) setOwn(ctx.reg.verbs, flags.verb, {});
        if (flags.conjugate != null) setOwn(ctx.reg.conjugate, flags.verb, flags.conjugate === 'drop' ? null : flags.conjugate);
        if (flags.inverse != null) setOwn(ctx.reg.inverses, flags.verb, flags.inverse);
        if (flags.example != null) ctx.reg.verbs[flags.verb].example = flags.example;
        saveRegistry(ctx); // always refuses parseError after writing registry.md.rejected
      }
      if (flags.alias) {
        setOwn(ctx.reg.aliases, flags.alias, { to: flags.to, kind: flags['verb-alias'] ? 'verb' : 'slug' });
        saveRegistry(ctx); // same recovery artifact, still zero-DB
      }
      die(`refusing to write brain/__meta/registry.md — it is unparseable (${ctx.regState.parseError}); fix it first. Nothing executed and no derived index was opened`);
    }
    if (ctx.regState.rewriteProblems?.length)
      die(`refusing to write brain/__meta/registry.md — authored truth needs hand repair (${ctx.regState.rewriteProblems[0]}); duplicate/unknown/newer syntax cannot be canonicalized safely. Nothing executed and no derived index was opened`);
    // Registry-dependent cross-reference checks belong AFTER the health latch. On a
    // future/corrupt/ambiguous file, seed fallback is not authoritative and must never
    // produce a misleading "unknown target" verdict before the true unsafe refusal.
    if (flags.conjugate != null && flags.conjugate !== 'drop')
      assertRelationVerbTarget(ctx.reg, '--conjugate target', flags.conjugate, { allowEmpty: true });
    if (flags.inverse != null) assertInverseTarget(ctx.reg, '--inverse target', flags.inverse, { allowEmpty: true });
    if (flags['unregister-entity'] || flags['unregister-verb'] || flags['unregister-alias']) {
      // F2/unregister-race: the recoverable-source scan AND the tombstone are one
      // index-serialized critical section against source publication (commitPlan publishes
      // under the same index lock and revalidates the registry generation there). Either
      // this scan sees a raced committed source, or the raced write sees this tombstone —
      // no "planned under the old registry" window.
      withIndexLock(ctx.root, () => {
        const remove = { entities: [], verbs: [], aliases: [], weak: [] };
        const seedHas = (k, n) => hasOwnKey(REGISTRY[k], n);
        // bug #28: refuse to unregister a verb that live edges still use — they would be left
        // with no registry row (no definition/conjugation/inverse). Warn + refuse without
        // --force, naming the edge count and a sample; --force is the deliberate override.
        if (flags['unregister-verb'] && !flags.force) {
          const v = flags['unregister-verb'];
          const use = sourceRegistryUse(ctx, 'verb', v);
          if (use.count > 0) {
            const d = registryUseDescription('verb', use);
            die(`'${v}' is used by ${d.summary} — unregistering would leave ${use.count === 1 ? 'it' : 'them'} with no registry row (no definition/conjugation/inverse). ${d.guidance}, or pass --force to unregister anyway.`);
          }
        }
        if (flags['unregister-entity'] && !flags.force) {
          const entity = flags['unregister-entity'];
          const use = sourceRegistryUse(ctx, 'entity', entity);
          if (use.count > 0) {
            const d = registryUseDescription('entity', use);
            die(`'${entity}' is used by ${d.summary} — unregistering would make ${use.count === 1 ? 'it' : 'them'} fall back to seed/default classification on reindex. ${d.guidance}, or pass --force to unregister anyway.`); // bug #80
          }
        }
        if (flags['unregister-verb']) {
          const v = flags['unregister-verb'];
          if (!(v in (ctx.reg.verbs || {})) && !(v in (ctx.reg.conjugate || {})) && !(v in (ctx.reg.inverses || {})) && !(ctx.reg.weakVerbs || []).includes(v))
            die(`verb '${v}' is not registered — nothing to unregister`); // bug #80
        }
        if (flags['unregister-entity']) { remove.entities.push(flags['unregister-entity']); delete ctx.reg.entities[flags['unregister-entity']]; if (seedHas('entities', flags['unregister-entity'])) out(`⚠ '${flags['unregister-entity']}' is a prebuilt entity — it re-seeds on next load`); }
        if (flags['unregister-verb']) {
          const v = flags['unregister-verb'];
          const isWeak = (ctx.reg.weakVerbs || []).includes(v);
          if (isWeak) { remove.weak.push(v); ctx.reg.weakVerbs = (ctx.reg.weakVerbs || []).filter(w => w !== v); } // bug #80
          else { remove.verbs.push(v); delete ctx.reg.verbs[v]; delete ctx.reg.conjugate[v]; delete ctx.reg.inverses[v]; }
          if (v in (REGISTRY.conjugate || {}) || v in (REGISTRY.inverses || {}) || (REGISTRY.weakVerbs || []).includes(v)) out(`⚠ '${v}' is a prebuilt verb — it re-seeds on next load`);
        }
        if (flags['unregister-alias']) { remove.aliases.push(flags['unregister-alias']); delete ctx.reg.aliases[flags['unregister-alias']]; }
        saveRegistry(ctx, { remove });
        out(`unregistered ${[...remove.entities, ...remove.verbs, ...remove.weak, ...remove.aliases].join(', ')}`);
        // brain-teaching §1.4: unregister erases authored truth — the reversible sibling for
        // entities is the config disable (stops new writes, keeps the type readable).
        if (remove.entities.length)
          out(`note: unregister erases the type from authored truth — to stop new writes but keep existing cards classified, list it in __meta/config.json disabled_entities`);
      });
      return;
    }
    if (flags.field) {
      if (!flags.entity) die(`register --field <name> requires --entity <entity>`);
      if (!ownValue(ctx.reg.entities, flags.entity))
        die(`entity '${flags.entity}' is not registered — register it first: brain register --entity ${flags.entity} --tenses <card|record|future,…>`);
      if (!flags.type) die(`register --field <name> requires --type <type> (valid: ${PROFILE_TYPE_LIST})`);
      const type = String(flags.type);
      if (!PROFILE_TYPES.has(type)) die(`unknown profile field type '${type}' — valid types: ${PROFILE_TYPE_LIST}`);
      const enumVals = flags.enum != null ? String(flags.enum).split('|').map(s => s.trim()) : [];
      if (flags.enum != null && enumVals.some(v => v === ''))
        die(`--enum needs nonempty members separated by single '|' characters (no leading/trailing/doubled separators); nothing written`);
      const duplicateEnum = enumVals.find((v, i) => enumVals.indexOf(v) !== i);
      if (duplicateEnum != null) die(`--enum repeats '${duplicateEnum}' — each member must be unique; nothing written`);
      { // V6 (deterministic-checks §8): reject case-twin members — they split one vocabulary into two cohorts and make V4's fold ambiguous
        const twin = enumVals.find((v, i) => enumVals.findIndex(w => w.toLowerCase() === v.toLowerCase()) !== i);
        if (twin != null) die(`--enum members differ only by case ('${enumVals.find(w => w.toLowerCase() === twin.toLowerCase())}' vs '${twin}') — case-twins split one vocabulary into two cohorts; pick a single spelling; nothing written`);
      }
      if ((type === 'select' || type === 'multi') && !enumVals.length)
        die(`select/multi need an --enum value set, e.g. --enum "a|b|c"`);
      if (flags.enum != null && type !== 'select' && type !== 'multi')
        die(`--enum is only valid on 'select' or 'multi' fields (this field is '${type}') — refusing to ignore an authored modifier; nothing written`);
      if (flags.currency != null && type !== 'number')
        die(`--currency is only valid on 'number' fields (this field is '${type}') — refusing to ignore an authored modifier; nothing written`);
      const refEntities = refEntitiesSpec(ctx, flags, type);
      const spec = { type };
      if (flags.required) spec.required = true;
      if ((type === 'select' || type === 'multi') && enumVals.length) spec.enum = enumVals;
      if (refEntities) spec.entities = refEntities;
      if (type === 'number' && flags.currency != null) spec.currency = String(flags.currency);
      if (flags.query != null) spec.query = String(flags.query);
      if (flags.lint != null) spec.lint = String(flags.lint);
      if (flags.budget != null) {
        const n = Number(flags.budget);
        if (!Number.isInteger(n) || n <= 0) die(`--budget must be a positive integer`);
        if (type !== 'list') die(`--budget is only valid on 'list' fields (this field is '${type}')`);
        spec.budget = n;
      }
      ctx.reg.entities[flags.entity].profile = ctx.reg.entities[flags.entity].profile || {};
      setOwn(ctx.reg.entities[flags.entity].profile, flags.field, spec);
      saveRegistry(ctx);
      out(`registered field '${flags.field}' on '${flags.entity}' (type ${type}${spec.enum ? `; enum=${spec.enum.join('|')}` : ''}${spec.entities ? `; entities=${spec.entities.join('|')}` : type === 'ref' ? '; entities=any' : ''})`);
    } else if (flags.entity) {
      const tenses = String(flags.tenses || 'card').split(',').map(s => s.trim());
      if (tenses.some(t => t === '')) die(`register --tenses needs a nonempty comma-separated subset of card, future, record (no leading/trailing/doubled commas)`);
      const duplicateTense = tenses.find((t, i) => tenses.indexOf(t) !== i);
      if (duplicateTense) die(`register --tenses repeats '${duplicateTense}' — each of card, future, record may appear at most once`);
      const badTense = tenses.find(t => !ENTITY_TENSES.has(t));
      if (badTense) die(`register --tenses: '${badTense}' is not a valid tense — allowed: card, future, record`);
      const prior = ownValue(ctx.reg.entities, flags.entity);
      // H15/glm B8: silently re-tensing an entity reclassifies its whole corpus on the
      // next reindex — require --force when the tenses actually change.
      if (prior && JSON.stringify(prior.tenses) !== JSON.stringify(tenses) && !flags.force)
        die(`entity '${flags.entity}' already registered with tenses [${prior.tenses.join(', ')}]; re-tensing to [${tenses.join(', ')}] would reclassify existing ${flags.entity} nodes on reindex — pass --force`);
      setOwn(ctx.reg.entities, flags.entity, { tenses, profile: prior?.profile || {} });
      saveRegistry(ctx); out(`registered entity '${flags.entity}' (tenses: ${tenses.join(', ')})`);
    } else if (flags.alias) {
      if (flags.to == null) die(`register --alias <name> --to <target> [--verb-alias]`);
      const kind = flags['verb-alias'] ? 'verb' : 'slug';
      if (!flags['verb-alias']) { const sl = slugLint(flags.alias); if (sl) die(sl); } // H11: a slug alias must obey slug rules (reconcile item 5)
      if (!flags['verb-alias']) { const sl = slugLint(flags.to); if (sl) die(sl); } // A1: slug alias targets obey the same slug grammar as alias names.
      // H6 alias rules: a real slug always wins, so an alias may not shadow a node;
      // and resolution is single-hop, so an alias may not point at another alias.
      if (!flags['verb-alias'] && fs.existsSync(nodePath(root, flags.alias)))
        die(`'${flags.alias}' is already a real node slug — an alias can't shadow it (real slug always wins)`);
      if (flags['verb-alias']) {
        if (isKnownVerb(ctx.reg, flags.alias) || sourceAuthoredVerbs(ctx).has(flags.alias))
          die(`verb-alias source '${flags.alias}' is already a real/known verb — real verbs win and an alias of the same name would be ambiguous. Rename the alias (or remove/re-point the real edges) before registering it; nothing written`);
      }
      if (ownValue(ctx.reg.aliases, flags.to)) die(`alias target '${flags.to}' is itself an alias — point at the real ${kind}, not another alias (single-hop only)`);
      // dangling target is a WARN (the target may be created later), doctor reports it
      if (!flags['verb-alias'] && !fs.existsSync(nodePath(root, flags.to)))
        out(`⚠ alias target '${flags.to}' is not a node yet (dangling — doctor will report it until it exists)`);
      if (flags['verb-alias'] && !isKnownVerb(ctx.reg, flags.to)) out(`⚠ alias target verb '${flags.to}' is not a known verb yet (dangling)`);
      setOwn(ctx.reg.aliases, flags.alias, { to: flags.to, kind });
      saveRegistry(ctx); out(`registered alias '${flags.alias}' → ${flags.to} (${kind}, resolves at query time)`);
    } else if (flags.verb) {
      if (String(flags.verb).trim() === '' || String(flags.verb) === 'true')
        die(`register --verb requires a real verb name, not '${String(flags.verb)}' — for a verb alias use: brain register --alias <name> --to <verb> --verb-alias`);
      if (ownValue(ctx.reg.aliases, flags.verb)?.kind === 'verb')
        die(`verb '${flags.verb}' is already a verb-alias source — unregister/rename that alias before making the same spelling a real verb; nothing written`);
      ctx.reg.verbs = ctx.reg.verbs || {}; if (!hasOwnKey(ctx.reg.verbs, flags.verb)) setOwn(ctx.reg.verbs, flags.verb, {});
      if (flags.conjugate != null) setOwn(ctx.reg.conjugate, flags.verb, flags.conjugate === 'drop' ? null : flags.conjugate);
      if (flags.inverse != null) setOwn(ctx.reg.inverses, flags.verb, flags.inverse);
      if (flags.example != null) ctx.reg.verbs[flags.verb].example = flags.example;
      saveRegistry(ctx); out(`registered verb '${flags.verb}'${flags.conjugate != null ? (flags.conjugate === '' ? ' (conjugation cleared)' : ` (freezes → ${flags.conjugate})`) : ''}${flags.inverse != null ? (flags.inverse === '' ? ' (inverse cleared)' : ` (inverse ${flags.inverse})`) : ''}`);
    } else {
      // show the registry
      out(`registry (${registryPath(root)}):`);
      out(`  entities: ${Object.keys(ctx.reg.entities).length} · verbs registered: ${Object.keys(ctx.reg.verbs || {}).length} · aliases: ${Object.keys(ctx.reg.aliases || {}).length} · conjugations: ${Object.keys(ctx.reg.conjugate).length}`);
    }
}

function cmdSync(ctx, _args, flags) {
    const { out } = ctx.io; const { root } = ctx;
    assertExclusiveModes('sync', flags, ['slug', 'deep']);
    // reconcile item 7: loadRegistry's corrupt-registry warning claims "reindex/sync
    // REFUSE" — make sync honor it. Reindexing rows against the seed-fallback would
    // misclassify custom-entity nodes just as a full rebuild would.
    if (ctx.regState.parseError) die(`refusing to sync — brain/__meta/registry.md is unparseable (${ctx.regState.parseError}); fix it first (reindexing on the seed-fallback would misclassify custom-entity nodes)`);
    if (ctx.regState.futureFormat != null)
      die(`refusing to sync — brain/__meta/registry.md format ${ctx.regState.futureFormat} is newer than this engine supports (format ${REG_FORMAT}); upgrade the engine first so newer authored truth is not misclassified`);
    if (ctx.regState.rewriteProblems?.length)
      die(`refusing to sync — brain/__meta/registry.md needs hand repair (${ctx.regState.rewriteProblems[0]}); indexing against ambiguous/invalid semantics could misclassify authored nodes`);
    if (flags.slug != null) {
      const slug = String(flags.slug);
      if (/[\\/]/.test(slug) || slug.includes('..'))
        die(`sync --slug '${slug}' looks like a path — slugs are plain filenames (no '/', '\\', or '..')`);
      const p = nodePath(root, slug);
      if (path.dirname(path.resolve(p)) !== path.resolve(root, 'brain', '__source'))
        die(`sync --slug '${slug}' resolves outside brain/__source/ — slugs are plain filenames, never paths`);
      if (!fs.existsSync(p) && !schemaCurrent(root))
        die(`no node '${slug}' (source file absent and there is no current index row to remove) — refusing to rebuild/migrate the whole pen for a missing targeted slug; nothing executed`);
    }
    // Mark-and-sweep is an index writer, so serialize it against the rebuild's live swap.
    // Re-open after acquiring the barrier: a cached handle may name the retired inode.
    requireDb(ctx); // bootstrap/rebuild first: global order is reindex.lock → index.lock
    return withIndexLock(root, () => {
    closeDb(ctx);
    // stat fast-path (mtime+size unchanged ⇒ skip) then content_hash confirms. Open the
    // disposable index only after the authored-registry gates above.
    const db = openDb(ctx);
    const dir = path.join(root, 'brain', '__source');
    const foldIndexResult = (counts, r) => {
      if (r?.demoted) counts.demoted++;
      if (r?.quarantined) counts.quarantined++;
      return r;
    };
    const indexResultSuffix = (r) => `${r?.demoted ? ' (demoted to body-only — run doctor)' : ''}${r?.quarantined ? ' — quarantined (bad slug / index failure), run doctor' : ''}`;
    const quarantineIndexFailure = (p, e, counts) => {
      db.prepare(`INSERT INTO errors VALUES(?,?)`).run(p, `index failure: ${e.message} — file quarantined (brain doctor)`);
      counts.quarantined++;
    };
    if (flags.slug) {
      const p = nodePath(root, flags.slug);
      const s = db.prepare(`SELECT content_hash, path FROM nodes WHERE slug=?`).get(flags.slug);
      const exists = fs.existsSync(p);
      if (!exists && !s) die(`no node '${flags.slug}' (no file, not in index)`);
      // Existence is the final semantic precondition for targeted sync. Only a real
      // reconciliation attempt may migrate stale authored registry syntax.
      migrateRegistryIfStale(ctx);
      let action = 'unchanged';
      let result = null;
      const counts = { demoted: 0, quarantined: 0 };
      const runIndexNode = () => {
        try { return foldIndexResult(counts, indexNode(ctx, db, flags.slug)); }
        catch (e) {
          try { db.exec('ROLLBACK'); } catch { /* ok */ }
          db.exec('BEGIN');
          quarantineIndexFailure(p, e, counts);
          db.exec('COMMIT');
          out(`sync ${flags.slug}: index failure (${e.message}) — file quarantined (brain doctor)`); // bug #84
          process.exitCode = 1;
          return null;
        }
      };
      if (!exists) { result = runIndexNode(); if (!result) return; action = 'removed'; }
      else {
        const h = contentHash(fs.readFileSync(p, 'utf8'));
        if (!s) { result = runIndexNode(); if (!result) return; action = result.live ? 'added' : 'not indexed'; }
        else if (s.content_hash !== h) { result = runIndexNode(); if (!result) return; action = 'updated'; }
        else if (s.path !== p) { db.prepare(`UPDATE nodes SET path=? WHERE slug=?`).run(p, flags.slug); action = 'touched'; }
      }
      out(`sync ${flags.slug}: ${action}${indexResultSuffix(result)}`); // bug #84
      return;
    }
    // Full sync has no later refusal-only precondition: the sweep below is its commit
    // boundary, so stale registry reconciliation is now legitimate.
    migrateRegistryIfStale(ctx);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(); // deterministic order
    const t0 = performance.now();
    // bug #10-lite: self-retry the whole sweep on a concurrent-writer lock — it is
    // idempotent (mark-and-sweep from the CURRENT file state), so a rolled-back attempt
    // re-runs cleanly. CHUNKED transactions (H8/Opus-A #20): a single txn over the whole
    // corpus holds a write lock past busy_timeout and starves the operator's concurrent writes.
    // Commit every CHUNK. --deep hash-verifies EVERY file (no mtime/size fast path).
    const { added, updated, removed, touched, unchanged, gone, demoted, quarantined, badFilenameSignals } = withBusyRetry(db, () => {
      const stored = new Map();
      for (const r of db.prepare(`SELECT slug, content_hash, mtime, size, path FROM nodes`).all()) stored.set(r.slug, r);
      let added = 0, updated = 0, removed = 0, touched = 0, unchanged = 0, gone = 0;
      const counts = { demoted: 0, quarantined: 0 };
      // Per-attempt diagnostics are transaction-local just like the counters. A busy
      // rollback must not leave warning entries for the retry to append a second time.
      const badFilenameSignals = [];
      const seen = new Set();
      const CHUNK = 2000; let inChunk = 0;
      db.exec('BEGIN');
      for (const f of files) {
        const slug = f.replace(/\.md$/, ''); seen.add(slug);
        const s = stored.get(slug);
        const p = nodePath(root, slug);
        const lint = slugLint(slug);
        if (lint) {
          badFilenameSignals.push(`${slug}: ${lint}`);
          if (s && !db.prepare(`SELECT 1 FROM errors WHERE path=? AND problem=?`).get(p, lint))
            db.prepare(`INSERT INTO errors VALUES(?,?)`).run(p, lint);
        }
        let st, text;
        try { st = fs.statSync(p); }
        catch (e) { if (e.code === 'ENOENT') { gone++; continue; } throw e; } // file vanished mid-sweep — skip
        if (!flags.deep && s && s.mtime === st.mtimeMs && s.size === st.size) {
          if (s.path !== p) { db.prepare(`UPDATE nodes SET path=? WHERE slug=?`).run(p, slug); touched++; if (++inChunk >= CHUNK) { db.exec('COMMIT'); db.exec('BEGIN'); inChunk = 0; } }
          else unchanged++;
          continue;
        } // FAST PATH (skipped by --deep)
        try { text = fs.readFileSync(p, 'utf8'); }
        catch (e) { if (e.code === 'ENOENT') { gone++; continue; } throw e; }
        const h = contentHash(text);
        if (!s) {
          let result = null;
          try { result = foldIndexResult(counts, reindexRows(root, db, slug, ctx.reg)); } catch (e) { quarantineIndexFailure(p, e, counts); }
          // A quarantined file deliberately has no nodes row. Counting it as "added"
          // on every sweep made sync claim the same addition forever. Its quarantine
          // count is the truthful classification; only a live/demoted row is added.
          if (result?.live) added++;
        }
        else if (s.content_hash !== h) {
          try { foldIndexResult(counts, reindexRows(root, db, slug, ctx.reg)); } catch (e) { quarantineIndexFailure(p, e, counts); }
          updated++;
        }
        else if (s.mtime !== st.mtimeMs || s.size !== st.size || s.path !== p) { db.prepare(`UPDATE nodes SET mtime=?, size=?, path=? WHERE slug=?`).run(st.mtimeMs, st.size, p, slug); touched++; } // same bytes, stat/path drifted
        else { unchanged++; continue; } // --deep confirmed hash-identical, stat already matches
        if (++inChunk >= CHUNK) { db.exec('COMMIT'); db.exec('BEGIN'); inChunk = 0; } // release the write lock periodically
      }
      for (const slug of stored.keys()) if (!seen.has(slug)) {
        const p = nodePath(root, slug);
        try { foldIndexResult(counts, reindexRows(root, db, slug, ctx.reg)); } catch (e) { quarantineIndexFailure(p, e, counts); }
        removed++;
        if (++inChunk >= CHUNK) { db.exec('COMMIT'); db.exec('BEGIN'); inChunk = 0; }
      }
      db.exec('COMMIT');
      return { added, updated, removed, touched, unchanged, gone, demoted: counts.demoted, quarantined: counts.quarantined, badFilenameSignals };
    });
    // This sweep proves only the directory snapshot it consumed. The Set<slug> ledger
    // cannot distinguish an older reconciled entry from a same-slug writer that landed
    // after the scan, so retain it conservatively for the next requireDb() replay.
    if (badFilenameSignals.length)
      console.error(`⚠ ${badFilenameSignals.length} filename(s) fail slug rules: ${badFilenameSignals.slice(0, 5).join(' | ')}${badFilenameSignals.length > 5 ? ' | …' : ''}`);
    out(`sync${flags.deep ? ' --deep' : ''}: ${files.length} files in ${(performance.now() - t0).toFixed(0)}ms — ${added} added, ${updated} updated, ${removed} removed, ${touched} touched, ${unchanged} unchanged${gone ? `, ${gone} vanished mid-sweep` : ''}${demoted ? `, ${demoted} demoted to body-only — run doctor` : ''}${quarantined ? `, ${quarantined} quarantined (bad slug / index failure) — run doctor` : ''}${flags.deep ? ' (hash-verified every file)' : ' (stat fast-path)'}`);
    });
}

function cmdBatch(ctx, _args, _flags, deps) {
    const { out } = ctx.io;
    // one process, one DB handle, NDJSON in → framed NDJSON out. A bad op emits an
    // error frame and does NOT abort the stream (die() throws, caught per-op).
    let input = '';
    try { input = fs.readFileSync(0, 'utf8'); } catch { /* empty stdin */ }
    for (const line of input.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let op;
      try { op = parseJsonExactNumbers(line); } catch (e) { out(JSON.stringify({ id: null, ok: false, error: e instanceof BrainError ? e.message : `bad json: ${e.message}` })); continue; }
      if (!op || typeof op !== 'object' || Array.isArray(op)) { out(JSON.stringify({ id: null, ok: false, error: `op must be a JSON object — got ${jsonType(op)}` })); continue; } // bug #71
      const id = op.id ?? null;
      // batch is READ-ONLY (H14/V5): its contract says so, but it used to run write
      // verbs too. Writes must go through `apply` (transactional, framed, sentinel).
      let embedded;
      try { embedded = embeddedArgsFlags(op, 'batch'); }
      catch (e) { out(JSON.stringify({ id, ok: false, error: e instanceof BrainError ? e.message : String(e.message || e) })); continue; }
      const read = deps.runRead(ctx, op.verb, embedded.args, embedded.flags, 'batch');
      if (read.kind === 'unknown') { out(JSON.stringify({ id, ok: false, error: `unknown verb '${op.verb}'` })); continue; }
      if (read.kind === 'write') { out(JSON.stringify({ id, ok: false, error: `'${op.verb}' is a write verb — batch is read-only; use apply for writes` })); continue; }
      if (read.kind === 'disallowed') { out(JSON.stringify({ id, ok: false, error: `'${op.verb}' is not embeddable — batch runs the apply-embeddable read set (${read.allowed}); run maintenance verbs top-level` })); continue; }
      out(JSON.stringify({ id, ok: read.ok, ...(read.ok ? { output: read.output } : { error: read.error }) }));
    }
}

// ===== SECTION: GENERATED TABLES =====
// Command dispatch tables are null-prototype records. A user-supplied command is data,
// never an Object.prototype lookup: names such as `constructor`, `toString`, and
// `__proto__` must take the same unknown-command path as any other unregistered verb.
const VERBS = Object.assign(Object.create(null), {
  reindex: { impl: cmdReindex, kind: 'write', flags: {}, desc: 'rebuild the whole index from brain/__source/', help: `reindex — rebuild the index from brain/__source/ (single-flight; safe under a live reader).\n  usage: brain reindex` },
  now: { impl: cmdNow, kind: 'read', applyRead: true, flags: {}, desc: 'print the owner-local date + time stamp (zero-DB)', help: `now — print the owner-local date + time stamp for grounding before a date-bearing write.\n  usage: brain now` },
  get: { impl: cmdGet, kind: 'read', applyRead: true, flags: { field: 'str', body: 'bool', raw: 'bool' }, desc: 'print full node(s) (or one --field / --raw source)', help: `get — print node(s). Bodyless node → whole file; with a body → frontmatter +\n  size hint, --body opts into the prose.\n  usage: brain get <slug> [<slug>...] [--field <path>] [--body] [--raw]\n  --field profile.name   one field only (bare value for one slug; slug<TAB>value for many)\n  --raw                  the exact source bytes only — no hash line, no diagnostics (machine channel)\n  e.g. brain get <slug>  ·  brain get <slug> --body  ·  brain get <slug> <slug2> --field due` },
  peek: { impl: cmdPeek, kind: 'read', applyRead: true, flags: {}, desc: 'one-line summary + profile + workability', help: `peek — one-line summary + profile + (for futures) workability.\n  usage: brain peek <slug>\n  e.g. brain peek <slug>` },
  list: { impl: cmdList, kind: 'read', applyRead: true, flags: COHORT_VERB_FLAGS, desc: 'cohort query: filter/project/count nodes', help: `list — cohort query over nodes (filter, project, count).\n  usage: brain list [filters] [--fields a,b] [--count] [--limit N] [--all]\n  filters: --entity E --class C --status S --important --occurred-from/-to D --due-from/-to D\n           --created-from/-to D --profile key=value --edge verb[:target]   (unknown filter = error)\n  --fields slug,description,occurred,due,status,profile.<k>,rel.<verb>   projection (TSV)\n  --count  print just the number\n  e.g. brain list --entity conversation --occurred-from 2026-06-01 --fields slug,rel.was_with` },
  search: { impl: cmdSearch, kind: 'read', applyRead: true, flags: { entity: 'str', class: 'str', for: 'str', within: 'str', from: 'str', to: 'str', all: 'bool', deep: 'bool' }, desc: 'full-text hunt (descriptions, edge whys, profile values)', help: `search — full-text over descriptions, edge whys, profile values.\n  usage: brain search "<terms>" [--entity E] [--class C] [--for <slug>] [--from/--to D] [--all] [--deep]\n  caps at 60 hits; narrowers filter the hit set; same-name hits are grouped with a "which one?" prompt; "" is an error\n  --entity/--class/--for <slug>/--within <slug>/--from/--to   narrow the results (also REQUIRED by --deep)\n  --deep  search node BODIES (separate index); needs one of the narrowers above or --all\n  e.g. brain search "vintage tractors" --entity company  ·  brain search "exclusivity" --deep --for jimbob-caramel-partnership` },
  relations: { impl: cmdRelations, kind: 'read', applyRead: true, flags: { verb: 'str', depth: 'int' }, desc: 'edges + whys + updated stack + latest record for a slug', help: `relations — edges (both directions) + whys + updated stack + latest record.\n  usage: brain relations <slug> [--verb <verb>] [--depth 1-3]\n  --verb   filter to one verb (lists every matching edge; the above-50 hub collapse applies only without --verb)\n  --depth  opt-in multi-hop (bounded narrow walk), appended after the depth-1 body\n  slug + verb aliases resolve at query time.\n  e.g. brain relations <slug>  ·  brain relations <slug> --verb was_with  ·  brain relations <slug> --depth 2` },
  futures: { impl: cmdFutures, kind: 'read', applyRead: true, flags: { for: 'str', window: 'str', all: 'bool' }, desc: 'the cockpit: open futures, blocked last', help: `futures — the cockpit: open futures, workable first, blocked last.\n  usage: brain futures [--for <slug>] [--window day|week|month|year] [--all]\n  e.g. brain futures --for <slug>  ·  brain futures --window week` },
  outbox: { impl: cmdOutbox, kind: 'read', applyRead: true, flags: {}, desc: 'passed-but-unprocessed futures', help: `outbox — futures whose due date passed but were never processed.\n  usage: brain outbox` },
  asks: { impl: cmdAsks, kind: 'read', flags: { open: 'bool' }, desc: 'the durable blocking-ask ledger (id · answer · provenance)', help: `asks — the durable blocking-ask ledger (brain/__meta/asks.md): every blocking ask with its id,\n  answer, and provenance. Reads the file directly (works with no index).\n  usage: brain asks [--open]\n  --open  only asks still awaiting an answer\n  answer a roll-cycle ask by CITING its id: brain roll <slug> --occurred <D> --cycle current|next --ask <id>` },
  focus: { impl: cmdFocus, kind: 'write', flags: { why: 'str' }, desc: 'the always-active context (show|add|remove — sugar over in_context → focus)', help: `focus — the bubble of happening: a reserved, ALWAYS-ACTIVE context (slug 'focus').\n  Anything can enter and leave it freely; members rank tier-0 in default search/list.\n  add/remove are sugar over membership edges (in_context → focus); the since-stamp folds\n  into the edge why at add time, and a re-add updates the why preserving the original since.\n  usage: brain focus [show] | brain focus add <slug> --why "<why>" | brain focus remove <slug>\n  focus show = the context-focus roster plus each member's why (since) line.\n  the apply op form is the membership edge: {"op":"link","slug":"…","verb":"in_context","to":"focus","why":"…"}` },
  freeze: { impl: cmdFreeze, kind: 'write', applyWriteOp: true, flags: { occurred: 'str', outcome: 'str' }, desc: 'turn a future (or record-tense card) into a frozen record', help: `freeze — turn an open future into a frozen record; conjugates its edges.\n  usage: brain freeze <slug> [--occurred YYYY-MM-DD] [--outcome done|dropped|superseded]\n  --outcome  done (default) conjugates the edges and leaves the record STATUSLESS (records\n             carry no completion status); dropped/superseded keep prospective verbs and\n             stamp that status — visible history that says so on the row.\n  a CARD whose entity registers the record tense (memory, event) also freezes card→record:\n             --occurred is REQUIRED; ONLY a memory card derives it (dated slug memory-YYYY-MM-DD /\n             YYYY-MM-DD- prefix, else date_created) — every other entity must pass --occurred.\n  refuses an obligation without --force (recurring — roll the next instance with brain roll, §7.5).` },
  roll: { impl: (ctx, a, f) => cmdRoll(ctx, a, f, { runRead: embeddedRead }), kind: 'write', flags: { occurred: 'str', cycle: 'str', why: 'str', ask: 'str' }, desc: 'roll an obligation: file the cycle + advance due (engine computes the date)', help: `roll — the §7.5 obligation roll as ONE atomic act; the engine does the date math.\n  usage: brain roll <slug> --occurred <YYYY-MM-DD> [--cycle current|next] [--ask <id>] [--why "…"]\n  files the cycle (record '<occurred>-<slug>' + filed_by edge), then advances due exactly ONE cadence\n  step from the old due and pushes the change — an elapsed cycle is never skipped: rolling late leaves\n  the remaining owed cycles in the outbox (one roll per owed cycle; the roll says how many remain).\n  cadence: reads profile.cadence then profile.period — ${ROLL_CADENCE_FORMS}; anything else refuses (never guessed).\n  ambiguous fork (filed BEFORE the current due — settle-owed vs paid-early): refuses with a roll-cycle\n  ask recorded in the ledger (brain asks) with an id; answer by CITING it: --cycle current|next --ask <id>\n  (--cycle current = settle the owed prior cycle, due stays; --cycle next = paid early, due advances one cadence).\n  answering blind (--cycle with no --ask) while that ask is open refuses and names the id; with no open ask it\n  mints+answers a same-invocation row (audit-visible). each filing stamps profile.cycle, so once history is\n  recorded the fork resolves from evidence and the open ask auto-withdraws — it never asks again for that obligation.\n  also an apply op: {"op":"roll","slug":"…","occurred":"…"[,"cycle":"…","ask":"…","why":"…"]}. One transaction: any failure rolls the filing back too.` },
  new: { impl: cmdNew, kind: 'write', applyWriteOp: true, flags: { entity: 'str', slug: 'str', description: 'str', class: 'str', due: 'str', occurred: 'str', date_created: 'str', status: 'str' }, desc: 'create a node', help: `new — create a node.\n  usage: brain new --entity <entity> --slug <slug> --description "<text>" [--class C] [--due D] [--occurred D] [--date_created D] [--status S]\n  a status-less effective future is written status:open; an explicit status wins; cards/records stay unstamped\n  e.g. brain new --entity person --slug <slug> --description "..."` },
  set: { impl: cmdSet, kind: 'write', applyWriteOp: true, flags: { field: 'str', to: 'str', del: 'bool' }, desc: 'set/remove a field (description/status/due/profile.*)', help: `set — set or remove one scalar field (parse→mutate→serialize; body untouched).\n  usage: brain set <slug> --field <dot.path> --to <value> | --del\n  settable: description, status, due, occurred, important (+ expires/renews/visibility/superseded_by), profile.<key>\n  (block fields have their own verbs: link/unlink · push · body; class/entity are identity — new/register).\n  on a record: warns + needs --force (frozen past); class/occurred on a record: refused.\n  [--base-hash <h> [--force]]   CAS: refuse if the file changed since your read\n  e.g. brain set <slug> --field profile.country --to the owner locale` },
  link: { impl: cmdLink, kind: 'write', applyWriteOp: true, flags: { verb: 'str', to: 'str', why: 'str' }, desc: 'add an edge (verb + why)', help: `link — add an edge <slug> → verb → <target> (warns on a dangling target, never blocks).\n  usage: brain link <slug> --verb <v> --to <slug> [--why "…"] [--base-hash <h> [--force]]\n  e.g. brain link <slug> --verb works_at --to acme-inc --why "since 2024"` },
  unlink: { impl: cmdUnlink, kind: 'write', applyWriteOp: true, flags: { verb: 'str', to: 'str' }, desc: 'remove an edge', help: `unlink — remove an edge.\n  usage: brain unlink <slug> --verb <v> --to <slug> [--base-hash <h> [--force]]` },
  push: { impl: cmdPush, kind: 'write', applyWriteOp: true, flags: { x: 'str', y: 'str', why: 'str', record: 'str' }, desc: 'prepend an updated[] entry (FILO)', help: `push — prepend an updated[] entry (FILO, newest first).\n  usage: brain push <slug> --x <what> --y <date> [--why "…"] [--record <slug>]\n  capped at 200; a push at capacity drops the oldest with a structured warning (longer history belongs in records)\n  e.g. brain push <slug> --x profile.city --y 2026-03-14 --why "moved" --record <record-slug>` },
  body: { impl: cmdBody, kind: 'write', applyWriteOp: true, flags: { append: 'bool', clear: 'bool' }, desc: 'write the node body from stdin', help: `body — write the node's distilled-tier body from stdin.\n  usage: echo "prose" | brain body <slug> [--append] [--clear] [--force]\n  --append  add non-empty bytes to the existing body · --clear  blank it (empty stdin alone won't wipe)\n  warns >64KB, refuses >1MB without --force (raw content belongs in files/, §9.1).` },
  vote: { impl: cmdVote, kind: 'write', applyWriteOp: true, flags: { up: 'bool', down: 'bool', why: 'str' }, desc: 'move a card\'s vote score ±1 (score-only; why prints, never stored)', help: `vote — move a node's vote score by exactly one (brain-profiles §5). Score-only: the\n  votes scalar moves; --why (REQUIRED) prints in the transcript and is NOT stored, so a\n  voted card/memory still freezes cleanly. Any tense is votable — frozen records included.\n  usage: brain vote <slug> --up|--down --why "<earned by real work>"\n  search order on votes-enabled stores: context → votes → relevance.\n  refuses when the store's config sets "votes": false (scores still display).\n  the taught basis (docs/support/agent-memory-discipline.md): upvote what proved useful in\n  practice; downvote what caused harm, wasted time, or is no longer useful.` },
  forget: { impl: cmdForget, kind: 'write', applyWriteOp: true, flags: {}, desc: 'archive a node to __forgotten/ (never deletes) + drop index rows', help: `forget — archive a node, never delete it. Moves its md file byte-untouched to\n  brain/__forgotten/ (the forgotten brain) and drops all its index rows.\n  usage: brain forget <slug>\n  invisible to every verb afterward. recover: brain recover <archive> [--as <slug>]\n  (the printed recipe names the exact archive file). collision in __forgotten/ →\n  date-prefixed name; recover --as <original-slug> restores the canonical identity.` },
  recover: { impl: cmdRecover, kind: 'write', flags: { as: 'str' }, desc: 'restore an archived node from brain/__forgotten/', help: `recover — restore an archived node: moves brain/__forgotten/<archive>.md back into\n  brain/__source/ (byte-preserving) and reindexes that slug.\n  usage: brain recover <archive[.md]> [--as <slug>]\n  --as   the canonical slug to restore AS — required when the archive name is not the\n         slug (a collision archive is date-prefixed: 2026-07-11-<slug>.md).\n  refuses to overwrite a live node; inbound edges reconnect once the slug is back.` },
  apply: { impl: (ctx, a, f) => cmdApply(ctx, a, f, { runRead: embeddedRead }), kind: 'write', flags: { continue: 'bool' }, desc: 'transactional multi-op write (NDJSON stdin)', help: `apply — transactional multi-op write; ops grouped by slug, one file write per\n  slug, one index transaction. A failed op rolls the WHOLE batch back unless --continue.\n  usage: cat ops.ndjson | brain apply [--continue] [--force]\n  op: {"id":..,"op":"new|set|link|unlink|push|body|vote|freeze|forget","slug":"..",...}\n  embedded reads use the shared read set: get, peek, list, search, relations, futures, outbox, check, files, tools, skills, context, contexts, count, now.\n  within a slug, ops auto-order: new → additive → freeze → forget (set-before-new resolves);\n  new+forget on one slug is rejected. new carries ${NEW_OP_INLINE_HELP} inline (date_created/updated preserve import history).\n  per-op {"base_hash":".."} = CAS. Emits a per-op frame + a final {"summary":{..counts..}};\n  any failure exits non-zero. --continue applies the rest per-slug (fragments a metabolism —\n  leave OFF for freeze batches).\n  e.g. {"op":"new","slug":"<slug>","entity":"person","description":"…","profile":{"country":"PT"}}` },
  check: { impl: cmdCheck, kind: 'read', applyRead: true, flags: { all: 'bool' }, desc: 'signal-only lint on a node', help: `check — signal-only lint (never gates).\n  usage: brain check <slug> | brain check --all` },
  doctor: { impl: cmdDoctor, kind: 'read', flags: { orphans: 'bool', verify: 'bool', vacuum: 'bool', merge: 'bool' }, desc: 'dangling edges + histogram (--orphans/--vacuum/--merge)', help: `doctor — index health + maintenance.\n  usage: brain doctor [--orphans] [--verify] [--vacuum] [--merge]\n  (bare) dangling edges + entity histogram + index errors + registry/capacity advisories + forgotten count/age\n  --orphans  dangling edges BOTH directions (missing target / missing source)\n  --verify   BIDIRECTIONAL file↔index sweep (drift, phantom, source-only) + class∈tenses\n             lint on CURRENT frontmatter + reap stale .brain/tmp / next / lock files\n  --vacuum   VACUUM the index file · --merge  optimize (merge) FTS segments (incl. fts_body)` },
  register: { impl: cmdRegister, kind: 'write', flags: { entity: 'str', tenses: 'str', field: 'str', type: 'str', required: 'bool', enum: 'str', entities: 'str', currency: 'str', query: 'str', lint: 'str', budget: 'int', verb: 'str', 'verb-alias': 'bool', conjugate: 'str', inverse: 'str', example: 'str', alias: 'str', to: 'str', 'unregister-entity': 'str', 'unregister-verb': 'str', 'unregister-alias': 'str' }, desc: 'register a custom entity/verb/alias (authored truth)', help: `register — write authored truth to brain/__meta/registry.md (survives index loss).\n  usage: brain register --entity <name> --tenses card,record [--force]\n         brain register --entity <name> --field <field> --type <text|select|multi|list|date|number|bool|ref> [--required] [--enum "a|b|c"] [--entities "place|company"] [--currency CODE] [--query "…"] [--lint "…"] [--budget <int>]\n         (ref = a plain-string field naming a card; optional --entities restricts which card entities satisfy it — omit for any)\n         brain register --verb <name> [--conjugate <past>|drop] [--inverse <verb>] [--example "…"]\n         brain register --alias <name> --to <target> [--verb-alias]   (alias resolves at query time, no file rewrite)\n         brain register --unregister-entity|--unregister-verb|--unregister-alias <name>\n  re-tensing an existing entity needs --force (would reclassify its whole corpus on reindex); re-registering a profile field overwrites that field.\n  aliases: a real slug always wins (an alias can't shadow a node); single-hop only\n  (target can't be another alias); a dangling target warns and doctor reports it.\n  saves merge under a lock (concurrent registrations union, never last-wins).\n  bare 'register' prints registry stats. Verbs also auto-register on first use via link/apply.` },
  lint: { impl: cmdLint, kind: 'read', flags: { slug: 'str' }, desc: 'migration pre-linter: is a candidate file import-ready?', help: `lint — migration pre-linter: is a candidate node file import-ready? (needs no index)\n  usage: brain lint <path.md>   |   cat node.md | brain lint [--slug <name>]\n  checks the frontmatter subset, entity/description, class∈tenses, slug rules; updated[] capacity is advisory\n  exits non-zero if not import-ready — run it before dropping files into brain/__source/.` },
  files: { impl: cmdFiles, kind: 'read', applyRead: true, flags: { for: 'str' }, desc: 'list files/ artifacts linked to a slug', help: `files — list files/ artifacts (profile.file/url) linked to a slug's neighborhood.\n  usage: brain files --for <slug>` },
  tools: { impl: cmdTools, kind: 'read', applyRead: true, flags: { for: 'str' }, desc: 'list tool cards that serve a slug', help: `tools — list tool cards linked to a slug by a serves edge.\n  usage: brain tools --for <slug>` },
  skills: { impl: cmdSkills, kind: 'read', applyRead: true, flags: { for: 'str' },
    desc: 'list skill cards attached to a slug (serves|part_of)',
    help: `skills — skill cards attached to a slug: a thing's available skills (serves), or a\n  skill/tool's sub-skills/tasks (part_of). Descriptions + cadence/last_verified.\n  usage: brain skills --for <slug>` },
  context: { impl: cmdContext, kind: 'read', applyRead: true, flags: { drop: 'bool', all: 'bool' },
    desc: 'load a context (records it active); --drop unloads',
    help: `context — sit down at the desk: the card's body (free-form, optional), then everything with a live in_context\n  edge into it, grouped by entity, ONE roster line each (rosters, never bodies). Loading RECORDS the desk\n  as active (.brain/active.json — operational state): members rank first in default search/list, and their\n  skills/tools unshade. Idempotent; loaded desks persist until dropped.\n  usage: brain context <slug> [<slug>…]   (each slug renders as its own section)\n         brain context --drop <slug> [<slug>…]   |   brain context --drop --all\n  focus is always active and cannot be dropped. Pull a member's full entry: brain get <slug> --body.\n  Refuses non-context cards (use relations <slug>). e.g. brain context wolf-network` },
  contexts: { impl: cmdContexts, kind: 'read', applyRead: true, flags: {},
    desc: 'the roster of contexts (worlds of relevance; ● marks active)',
    help: `contexts — every context card: slug — name: mission, with active desks marked ●. The\n  session-start read; load one or more with brain context <slug> [<slug>…].\n  usage: brain contexts` },
  sync: { impl: cmdSync, kind: 'write', flags: { slug: 'str', deep: 'bool' }, desc: 'reconcile the index with hand-edited files', help: `sync — reconcile the index with hand-edited md files (mark-and-sweep).\n  usage: brain sync [--slug <slug>] [--deep]\n  stat fast-path (mtime+size) then content_hash; adds/updates/removes as needed.\n  --deep   hash-verify EVERY file (no fast path) — after bulk external ops / restores.\n  chunked transactions (won't starve concurrent writers); the endorsed hand-edit path.` },
  count: { impl: cmdCount, kind: 'read', applyRead: true, flags: COUNT_VERB_FLAGS, desc: 'class breakdown, or a filtered cohort count', help: `count — class breakdown (bare, spans every status), or a filtered cohort count.\n  usage: brain count [filters] [--all]\n  filters: --entity E --class C --status S --important --occurred-from/-to D --due-from/-to D --created-from/-to D --profile key=value --edge verb[:target]\n  --all   with filters: include the archive (status archived — the only default-hidden status)\n  count prints numbers only — list's --fields/--count/--limit are list flags, rejected here.` },
  batch: { impl: (ctx, a, f) => cmdBatch(ctx, a, f, { runRead: embeddedRead }), kind: 'read', neverEmbedded: true, flags: {}, desc: 'run many read ops in one process (NDJSON stdin)', help: `batch — run many embedded read ops in ONE process (NDJSON stdin).\n  shared read set: get, peek, list, search, relations, futures, outbox, check, files, tools, skills, context, contexts, count, now.\n  usage: echo '{"id":1,"verb":"get","args":["<slug>"]}' | brain batch\n  each op: {"id":..,"verb":"..","args":[..],"flags":{..}} → {"id":..,"ok":..,"output"|"error":..}` },
});

const nullRecord = entries => Object.assign(Object.create(null), Object.fromEntries(entries));
const cmds = nullRecord(Object.entries(VERBS).map(([k, v]) => [k, v.impl]));

const DESC = nullRecord(Object.entries(VERBS).map(([k, v]) => [k, v.desc]));
const HELP = nullRecord(Object.entries(VERBS).map(([k, v]) => [k, v.help]));
const WRITE_VERB_FLAGS = nullRecord(Object.entries(VERBS).filter(([, v]) => v.kind !== 'read').map(([k, v]) => [k, Object.keys(v.flags)]));
const WRITE_VERBS = new Set(Object.entries(VERBS).filter(([, v]) => v.kind !== 'read').map(([k]) => k));
const WRITE = new Set(Object.entries(VERBS).filter(([, v]) => v.applyWriteOp).map(([k]) => k));
const READ_OK = new Set(Object.entries(VERBS).filter(([, v]) => v.applyRead).map(([k]) => k));

// Commands that destructure one positional used to silently discard extras (for
// example `forget alice bob` archived only alice and exited 0). Validate arity before
// opening the store so a typo cannot partially execute. Search/get are deliberately
// variadic; focus has show|add/remove shapes and performs its finer validation itself.
const POSITIONAL_MAX = Object.assign(Object.create(null), {
  reindex: 0, now: 0, get: Infinity, peek: 1, list: 0, search: Infinity,
  relations: 1, futures: 0, outbox: 0, focus: 2, freeze: 1, new: 0,
  set: 1, link: 1, unlink: 1, push: 1, body: 1, vote: 1, forget: 1, recover: 1,
  apply: 0, check: 1, doctor: 0, register: 0, lint: 1, files: 0, tools: 0, skills: 0,
  context: Infinity, contexts: 0, sync: 0, count: 0, batch: 0,
});

function assertPositionalArity(cmd, pos) {
  const max = ownValue(POSITIONAL_MAX, cmd);
  if (max != null && pos.length > max)
    die(`${cmd} received unexpected positional argument '${pos[max]}' — ${max === 0 ? 'it takes no positional arguments' : `it takes at most ${max}`}; nothing executed`);
}

// Validate every filesystem/DB-independent command envelope BEFORE openBrain(), crash
// recovery, stale-registry migration, or requireDb(). A rejected command promises
// "nothing executed"; it must not heal a dirty row, rewrite format 1→2, or bootstrap the
// disposable index merely because its handler historically opened SQLite first. The
// same preflight is reused by embedded reads so batch/apply cannot bypass the contract.
function preflightCommand(cmd, pos, flags, ctx = null) {
  if (hasOwnKey(flags, 'base-hash')) flags['base-hash'] = assertBaseHash(flags['base-hash'], '--base-hash');
  const requiredSlug = (raw, message, where) => {
    if (!raw) die(message);
    assertReadSlug(raw, where);
  };
  switch (cmd) {
    case 'get': {
      assertExclusiveModes('get', flags, ['field', 'body', 'raw']);
      if (!pos.length) die(`get requires a slug (brain get <slug> [<slug>...])`);
      pos.forEach(slug => assertReadSlug(slug, 'get slug'));
      if (hasOwnKey(flags, 'field')) assertGetFieldPath(flags.field);
      break;
    }
    case 'peek':
      requiredSlug(pos[0], `peek requires a slug`, 'peek slug');
      break;
    case 'list': {
      assertExclusiveModes('list', flags, ['count', 'fields']);
      if (flags.count && hasOwnKey(flags, 'limit'))
        die(`list --count cannot combine with --limit — an aggregate count has no limited page`);
      checkCohortFlags('list', flags);
      assertReadDateFlags(flags);
      assertCohortFilterShapes(flags, ctx?.reg || null);
      if (flags.fields != null) {
        const fields = String(flags.fields).split(',').map(s => s.trim()).filter(Boolean);
        if (!fields.length) die(`list --fields needs at least one projectable field`);
        fields.forEach(assertListProjectionField);
      }
      break;
    }
    case 'search': {
      const raw = pos.join(' ').trim();
      if (!raw) die(`search needs a query (e.g. brain search "vintage tractors")`);
      const tokens = parseQueryTokens(raw);
      if (!tokens.length)
        die(`search '${raw}' has no searchable term (an empty quoted phrase?) — give at least one word or symbol: brain search "<words>"`);
      assertExclusiveModes('search scope', flags, ['for', 'within']);
      assertReadDateFlags(flags);
      if (flags.for) assertReadSlug(flags.for, 'search --for');
      if (flags.within) assertReadSlug(flags.within, 'search --within');
      if (flags.deep) {
        if (!['entity', 'class', 'for', 'within', 'from', 'to', 'all'].some(k => flags[k]))
          die(`--deep needs a narrower (--entity/--class/--for <slug>/--within <slug>/--from/--to) or --all — deep body search is a narrow walk, not a sweep`);
        if (!tokens.some(t => hasLexical(t.text) && !isSingletonCjk(t.text)))
          die(`--deep needs at least one word with letters or digits — bodies index lexically`);
      }
      break;
    }
    case 'relations':
      requiredSlug(pos[0], `relations requires a slug`, 'relations slug');
      if (flags.verb != null) assertRelationVerbInput(ctx?.reg || null, 'relations --verb', flags.verb, { deferAlias: !ctx });
      break;
    case 'futures':
      if (flags.for) assertReadSlug(flags.for, 'futures --for');
      if (flags.window != null && !['day', 'week', 'month', 'year'].includes(flags.window))
        die(`unknown futures --window '${flags.window}' — valid values: day,week,month,year`);
      break;
    case 'files':
      if (!flags.for) die(`files --for <slug>`);
      assertReadSlug(flags.for, 'files --for');
      break;
    case 'tools':
      if (!flags.for) die(`tools --for <slug>`);
      assertReadSlug(flags.for, 'tools --for');
      break;
    case 'skills':
      if (!flags.for) die(`skills --for <slug>`);
      assertReadSlug(flags.for, 'skills --for');
      break;
    case 'context':
      if (flags.all && !flags.drop)
        die(`context --all applies only to --drop — brain context --drop --all clears every desk; nothing executed`);
      if (flags.drop && flags.all) {
        if (pos.length) die(`context --drop --all takes no slugs (it clears every desk); nothing executed`);
        break;
      }
      if (!pos.length) die(flags.drop
        ? `context --drop requires a slug (brain context --drop <slug> [<slug>…] | --drop --all)`
        : `context requires a slug (brain context <slug> [<slug>…])`);
      pos.forEach(slug => assertReadSlug(slug, flags.drop ? 'context --drop' : 'context'));
      break;
    case 'check':
      if (pos[0] && flags.all) die(`check takes either <slug> or --all, not both`);
      if (pos[0]) assertReadFilename(pos[0], 'check slug');
      break;
    case 'count': {
      assertReadDateFlags(flags);
      assertCohortFilterShapes(flags, ctx?.reg || null);
      const cohort = COHORT_FILTER_FLAGS.some(k => flags[k] != null);
      if (flags.all === true && !cohort)
        die(`count --all needs at least one cohort filter — bare count already prints the class breakdown across every status, so --all alone changes nothing; add a filter or drop --all. Nothing executed`);
      break;
    }
    case 'doctor':
      assertExclusiveModes('doctor', flags, ['orphans', 'verify', 'vacuum', 'merge']);
      break;
    case 'sync':
      assertExclusiveModes('sync', flags, ['slug', 'deep']);
      if (flags.slug != null) {
        const slug = String(flags.slug);
        if (/[\\/]/.test(slug) || slug.includes('..'))
          die(`sync --slug '${slug}' looks like a path — slugs are plain filenames (no '/', '\\', or '..')`);
      }
      break;
    case 'focus': {
      const [sub, slug] = pos;
      if (!sub || sub === 'show') {
        const unused = ['why', 'force', 'base-hash'].filter(k => hasOwnKey(flags, k));
        if (unused.length)
          die(`focus show does not use ${unused.map(k => '--' + k).join(', ')} — --why is add-only and write controls apply only to add/remove; nothing executed`);
        if (slug) die(`focus show takes no slug (got '${slug}')`);
        break;
      }
      if (sub !== 'add' && sub !== 'remove') die(`focus: show|add|remove`);
      if (sub === 'remove' && hasOwnKey(flags, 'why'))
        die(`focus remove can't combine with --why — removal has no stored why; nothing written`);
      requiredSlug(slug, `focus ${sub} requires a slug`, 'focus slug');
      if (sub === 'add' && (typeof flags.why !== 'string' || flags.why.trim() === ''))
        die(`focus add requires a non-empty text why (exit-testable)`);
      if (sub === 'add') assertScalarSize('focus why', flags.why, { quiet: true });
      break;
    }
    case 'freeze':
      requiredSlug(pos[0], `freeze requires a slug`, 'freeze slug');
      if (flags.outcome != null && !['done', 'dropped', 'superseded'].includes(flags.outcome))
        die(`freeze --outcome must be done|dropped|superseded (got ${JSON.stringify(flags.outcome)})`);
      if (flags.occurred != null) assertIsoDate('occurred', flags.occurred);
      break;
    case 'new': {
      if (!flags.entity || !flags.slug || !flags.description) die(`new requires entity, slug, description`);
      if (typeof flags.entity !== 'string') die(`entity must be a string — got ${jsonType(flags.entity)}; nothing written`);
      assertReadSlug(flags.slug, 'new slug');
      if (typeof flags.description !== 'string' || flags.description.trim() === '')
        die(`description is required (THE search surface) and must contain non-whitespace text — nothing written`);
      assertScalarSize('description', flags.description, { quiet: true });
      if (flags.due != null) assertIsoDate('due', flags.due, 'datetime-or-date');
      if (flags.occurred != null) assertIsoDate('occurred', flags.occurred);
      if (flags.date_created != null) assertIsoDate('date_created', flags.date_created);
      if (flags.status != null) assertStatus('status', flags.status);
      if (flags.class != null && typeof flags.class !== 'string')
        die(`class must be a string when provided — got ${jsonType(flags.class)}; nothing written`);
      if (flags.due != null && flags.occurred != null)
        die(`a fresh node can't carry both due and occurred — due marks a future, occurred marks a record; pick one (freeze a future to a record later if it happens).`);
      break;
    }
    case 'set':
      requiredSlug(pos[0], `set requires a slug`, 'set slug');
      if (!flags.field) die(`set requires --field <dot.path> (--to <value> or --del)`);
      if (!flags.del && flags.to == null) die(`set requires --to <value> (or --del to remove)`);
      if (flags.del && flags.to !== undefined)
        die(`set op can't combine 'del':true with 'to' — choose removal or replacement; nothing written`);
      break;
    case 'link':
    case 'unlink':
      requiredSlug(pos[0], `${cmd} requires a slug`, `${cmd} slug`);
      if (!flags.verb || flags.to == null) die(`${cmd} requires --verb <v> --to <slug>`);
      assertRelationVerbInput(ctx?.reg || null, 'relation verb', flags.verb, { deferAlias: !ctx });
      assertRelationTarget('relation target', flags.to);
      if (cmd === 'link' && flags.why != null && (typeof flags.why !== 'string' || flags.why.trim() === ''))
        die(`relation why must be non-empty text — nothing written`);
      if (cmd === 'link' && flags.why != null) assertScalarSize('why', flags.why, { quiet: true });
      break;
    case 'push':
      requiredSlug(pos[0], `push requires a slug`, 'push slug');
      if (!flags.x || !flags.y) die(`push requires --x <what> --y <date> [--why …] [--record <slug>]`);
      assertScalarSize('push x', flags.x, { quiet: true });
      assertIsoDate('y', flags.y);
      if (flags.record != null) assertRelationTarget('push --record', flags.record);
      if (flags.why != null && (typeof flags.why !== 'string' || flags.why.trim() === ''))
        die(`push why must be non-empty text when present — nothing written`);
      if (flags.why != null) assertScalarSize('push why', flags.why, { quiet: true });
      break;
    case 'body':
      requiredSlug(pos[0], `body requires a slug`, 'body slug');
      if (flags.append && flags.clear) die(`body op can't combine append and clear — choose exactly one mode; nothing written`);
      break;
    case 'vote':
      requiredSlug(pos[0], `vote requires a slug: brain vote <slug> --up|--down --why "…"`, 'vote slug');
      if (flags.up === true && flags.down === true) die(`vote needs exactly one of --up | --down — got both; nothing written`);
      if (flags.up !== true && flags.down !== true) die(`vote needs exactly one of --up | --down — got neither; nothing written`);
      if (typeof flags.why !== 'string' || flags.why.trim() === '')
        die(`vote requires a non-empty --why (it prints in the transcript, not the card); nothing written`);
      assertScalarSize('vote why', flags.why, { quiet: true });
      break;
    case 'forget':
      requiredSlug(pos[0], `forget requires a slug`, 'forget slug');
      break;
    case 'recover': {
      if (!pos[0]) die(`recover requires an archive name — brain recover <archive[.md]> [--as <slug>] (archives live in brain/__forgotten/)`);
      const base = String(pos[0]).replace(/\.md$/, '');
      if (base !== base.normalize('NFC') || !/^[a-z0-9][a-z0-9-]*$/.test(base) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base))
        die(`bad archive name '${base}' — recover reads one .md file directly inside brain/__forgotten/ (letters, digits, hyphens; no paths)`);
      if (flags.as != null) assertReadSlug(String(flags.as), 'recover --as');
      break;
    }
    case 'lint':
      if (pos[0] && hasOwnKey(flags, 'slug'))
        die(`lint path mode does not use --slug — the filename supplies the candidate slug; --slug is only for piped stdin. Nothing executed`);
      break;
  }
}

function checkEmbeddedFlags(verb, flags) {
  const got = flags || {};
  if (Object.prototype.hasOwnProperty.call(got, 'root') || Object.prototype.hasOwnProperty.call(got, 'help'))
    die(`--root is process-level — run a separate brain invocation for another pen`); // bug #87
  const spec = ownValue(VERBS, verb)?.flags || {};
  const known = new Set(Object.keys(spec));
  const unknown = Object.keys(got).filter(k => !known.has(k));
  if (unknown.length) {
    const takes = known.size ? [...known].map(k => '--' + k).join('/') : '(no embedded flags)';
    die(`unknown embedded ${verb} flag${unknown.length > 1 ? 's' : ''}: ${unknown.map(k => '--' + k).join(', ')} — ${verb} takes: ${takes}`); // bug #87
  }
  for (const [key, type] of Object.entries(spec)) {
    if (!Object.prototype.hasOwnProperty.call(got, key)) continue;
    const v = got[key];
    if (type === 'bool') {
      if (typeof v !== 'boolean') die(`--${key} must be a JSON boolean true/false — got ${JSON.stringify(v)} (${jsonType(v)})`); // bug #87
      continue;
    }
    if (type === 'int') {
      if (!Number.isSafeInteger(v) || Object.is(v, -0)) die(`--${key} must be a JSON integer in canonical safe range — got ${JSON.stringify(v)} (${jsonType(v)})`); // bug #87
      if (key === 'limit' && v < 0) die(`--limit must be a non-negative integer (got '${v}')`); // bug #87
      if (key === 'depth' && (v < 1 || v > 3)) die(`--depth must be an integer from 1 to 3 (got '${v}')`); // bug #87
      continue;
    }
    if (type === 'str') {
      if (typeof v !== 'string' && typeof v !== 'number') die(`--${key} must be a JSON string or number — got ${JSON.stringify(v)} (${jsonType(v)})`); // bug #87
      if (typeof v === 'number') got[key] = String(v);
      if (got[key] === '') die(`--${key} needs a non-empty value`);
      continue;
    }
    die(`internal: unknown embedded flag type '${type}' for --${key}`);
  }
}

function embeddedRead(ctx, verb, args, flags, mode, validateOnly = false) {
  const spec = ownValue(VERBS, verb);
  if (mode === 'apply') {
    if (!verb || (!WRITE.has(verb) && !spec)) return { kind: 'unknown' };
    if (WRITE.has(verb)) return { kind: 'write' };
    if (spec.neverEmbedded) return { kind: 'disallowed', allowed: [...READ_OK].join(', ') };
    if (!READ_OK.has(verb)) return { kind: 'disallowed', allowed: [...READ_OK].join(', ') };
  }
  if (mode === 'batch') {
    if (!verb || !spec) return { kind: 'unknown' };
    if (spec.neverEmbedded) return { kind: 'disallowed', allowed: [...READ_OK].join(', ') };
    if (!READ_OK.has(verb)) return { kind: 'disallowed', allowed: [...READ_OK].join(', ') };
  }
  const opCtx = childCtx(ctx, mkBuffer());
  opCtx.embeddedRead = true; // a read inside a write envelope must not carry side-state (active.json)
  try {
    assertPositionalArity(verb, args || []);
    checkEmbeddedFlags(verb, flags || {});
    checkFlags(verb, flags || {}, spec.flags, spec.kind);
    preflightCommand(verb, args || [], flags || {}, ctx);
    if (validateOnly) return { kind: 'read', ok: true };
    ownValue(cmds, verb)(opCtx, args || [], flags || {});
    return { kind: 'read', ok: true, output: opCtx.io.text() };
  }
  catch (e) { return { kind: 'read', ok: false, error: e instanceof BrainError ? e.message : String(e.message || e) }; }
};

// ===== SECTION: MAIN =====

// ---------- main ----------
function openBrain(root) {
  const loaded = loadRegistry(root);
  const p = metaConfigPath(root);
  let tz = null;
  let workingMemory = null;
  let schemaLock = false;
  // brain-profiles §2/§6: the config primitives — no named profiles, no shipped presets
  // (operator ruling 2026-08-04: one brain, one config; every store's owner authors its
  // own). Malformed values tolerate (config-read precedent): absent/malformed = default-full.
  let disabledEntities = [];
  let votesEnabled = true;
  let whoCreated = true;
  let group = false;
  if (fs.existsSync(p)) {
    let c;
    try { c = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.error(`⚠ registry/config: brain/__meta/config.json is malformed (${e.message}) — using process timezone`); }
    if (c && c.timezone) {
      try { new Date().toLocaleString('en-US', { timeZone: c.timezone }); tz = c.timezone; } // validate the IANA name
      catch { console.error(`⚠ config: invalid IANA timezone '${c.timezone}' in config.json — using process timezone`); }
    }
    // brain-convergence §3: user_card is DELETED, not renamed — the engine locates the
    // subject by entity='me' (doctor warns on a stale key).
    // working-memory §4: the config-pointer pattern — string slug, no load-time
    // validation (doctor's job); absent key = feature off.
    if (c && Object.prototype.hasOwnProperty.call(c, 'working_memory') && typeof c.working_memory === 'string') workingMemory = c.working_memory;
    if (c && Array.isArray(c.disabled_entities))
      disabledEntities = [...new Set(c.disabled_entities.filter(e => typeof e === 'string' && e !== ''))];
    if (c && c.votes === false) votesEnabled = false;
    if (c && c.who_created === false) whoCreated = false;
    if (c && c.group === true) group = true;
    // ontology-cleanup §8: the standing lock. Only a real boolean true locks — a malformed
    // or absent config leaves the store unlocked (and doctor says so, loudly).
    if (c && Object.prototype.hasOwnProperty.call(c, 'schema_lock') && c.schema_lock === true) schemaLock = true;
  }
  const ctx = {
    root,
    reg: loaded.reg,
    regState: loaded.regState,
    tz,
    workingMemory,
    schemaLock,
    // brain-profiles §2/§6: note/context can never be disabled (shipped teachings depend
    // on them — a list entry naming them is ignored; doctor warns).
    disabledEntities: disabledEntities.filter(e => e !== 'note' && e !== 'context'),
    disabledEntitiesIgnored: disabledEntities.filter(e => e === 'note' || e === 'context'),
    votesEnabled,
    whoCreated,
    group,
    // The name source is env, not config: a GROUP store has many writers — one store,
    // one config, many BRAIN_WHOs. Unset ⇒ no stamp, silently (§6 ruling).
    who: process.env.BRAIN_WHO != null && process.env.BRAIN_WHO !== '' ? String(process.env.BRAIN_WHO) : null,
    // Admin mode is a per-SESSION unlock set at launch by the human (or the harness that
    // starts an admin agent) — never a flag a mid-task model can reach for. Read once.
    adminMode: process.env.BRAIN_ADMIN != null && process.env.BRAIN_ADMIN !== '' && process.env.BRAIN_ADMIN !== '0',
    today: () => localDate(ctx.tz),
    io: { out: s => console.log(s), raw: s => process.stdout.write(String(s)) }, // raw = exact bytes (C-9 get --raw)
    db: null,
    readerLease: null,
    dirtyChecked: false,
  };
  return ctx;
}

// Empty strings are authored data only on scalar assignment and the three registry verb
// annotations where an empty value explicitly clears a prior annotation. Every other CLI
// string flag is a selector, identity, bound, or required value; accepting empty there can
// silently widen/switch the requested operation.
const CLI_EMPTY_STRING_FLAGS = new Set(['set:to', 'register:conjugate', 'register:inverse', 'register:example']);
const cliStringAllowsEmpty = (cmd, key) => CLI_EMPTY_STRING_FLAGS.has(`${cmd}:${key}`);

function parseFlagToken(argv, i, flags, spec, key, inline, hasInline, cmd = null) {
  const type = spec[key];
  if (type === 'bool') {
    if (!hasInline) { flags[key] = true; return i; }
    if (inline === 'true') { flags[key] = true; return i; }
    if (inline === 'false') { flags[key] = false; return i; }
    die(`--${key} expects true or false (got '${inline}')`);
  }
  let value = inline;
  if (!hasInline) {
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--'))
      die(`--${key} needs a value; use --${key}=value for values that begin with --`);
    value = argv[++i];
  }
  if (type === 'str') {
    // Most empty strings mean a required selector was omitted and can silently change
    // modes (`sync --slug=`, `register --verb=`) or redirect root discovery (`--root=`).
    // The small allowlist above preserves actual empty-scalar/annotation-clear semantics.
    if (value === '' && !cliStringAllowsEmpty(cmd, key)) {
      if (key === 'root') die(`--root needs a non-empty path; omit --root to use discovery`);
      die(`--${key} needs a non-empty value`);
    }
    flags[key] = value;
    return i;
  }
  if (type === 'int') {
    // Full-token canonical integer grammar: no parseInt-style suffixes/decimals, leading
    // zeroes, plus signs, or negative zero. Stay in JS's safe range so embedded JSON and
    // argv cannot disagree after numeric rounding.
    const integerError = key === 'budget'
      ? `--budget must be a positive integer`
      : `--${key} must be an integer (got '${value}')`;
    if (!/^(?:0|-?[1-9]\d*)$/.test(value)) die(integerError);
    const n = Number(value);
    if (!Number.isSafeInteger(n)) die(key === 'budget' ? integerError : `--${key} must be an integer in the safe range (got '${value}')`);
    if (key === 'budget' && n <= 0) die(integerError);
    if (key === 'limit' && n < 0) die(`--limit must be a non-negative integer (got '${value}')`);
    if (key === 'depth' && (n < 1 || n > 3)) die(`--depth must be an integer from 1 to 3 (got '${value}')`);
    flags[key] = n;
    return i;
  }
  die(`internal: unknown argv flag type '${type}' for --${key}`);
}

function parseArgv(argv) {
  const flags = {};
  const pos = [];
  let cmd = null;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      if (cmd == null) cmd = token;
      else pos.push(token);
      continue;
    }
    const arg = token.slice(2);
    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(0, eq) : arg;
    const inline = eq >= 0 ? arg.slice(eq + 1) : null;
    if (Object.prototype.hasOwnProperty.call(flags, key))
      die(`duplicate flag --${key} — pass each flag once; nothing executed`);
    if (cmd == null) {
      if (!hasOwnKey(PRE_VERB_FLAGS, key)) die(`unknown flag before the verb: --${key}`);
      i = parseFlagToken(argv, i, flags, PRE_VERB_FLAGS, key, inline, eq >= 0, null);
      continue;
    }
    const verbSpec = ownValue(VERBS, cmd);
    if (!verbSpec) { pos.push(token); continue; }
    const spec = { ...UNIVERSAL_FLAGS, ...commandControlFlags(cmd), ...verbSpec.flags };
    if (!hasOwnKey(spec, key)) die(unknownFlagMessage(cmd, [key], Object.keys(verbSpec.flags), verbSpec.kind));
    i = parseFlagToken(argv, i, flags, spec, key, inline, eq >= 0, cmd);
  }
  return { cmd, pos, flags };
}

function main() {
  let ctx = null;
  try {
    const { cmd, pos, flags } = parseArgv(process.argv.slice(2));
    const impl = cmd ? ownValue(cmds, cmd) : null;
    const verbSpec = cmd ? ownValue(VERBS, cmd) : null;
    if (!cmd) {
      const orphanControls = ['force', 'base-hash'].filter(k => hasOwnKey(flags, k));
      if (orphanControls.length)
        die(`${orphanControls.map(k => '--' + k).join(', ')} ${orphanControls.length === 1 ? 'requires' : 'require'} a verb that consumes it — root/help are the only commandless flags; nothing executed`);
    }
    // Scope deferred pre-verb controls before help or store opening. `--force now` and
    // `--base-hash x doctor` must not turn into successful ignored-flag invocations just
    // because their flag appeared before the verb (or beside --help).
    if (impl) checkFlags(cmd, flags, verbSpec.flags, verbSpec.kind);
    if (impl && flags.help) { console.log(ownValue(HELP, cmd) || `${cmd}: no help`); process.exit(0); }
    if (!cmd || !impl) {
      console.log(`brain — your PA's memory.\n` +
        Object.keys(cmds).map(k => `  ${k.padEnd(9)} ${ownValue(DESC, k) || ''}`).join('\n') +
        `\n(brain <verb> --help for details)`);
      process.exit(cmd ? 1 : 0);
    }
    assertPositionalArity(cmd, pos);
    preflightCommand(cmd, pos, flags);
    const root = hasOwnKey(flags, 'root') ? path.resolve(flags.root) : findRoot();
    ctx = openBrain(root); // registry = authored truth, loaded once before any verb runs
    // Repeat the pure envelope check with authored aliases available. The first pass
    // rejects every unambiguous malformed input before even reading the pen; this pass
    // distinguishes a friendly verb-alias source from an invalid authored relation key,
    // still before SQLite, dirty recovery, or any registry migration can run.
    preflightCommand(cmd, pos, flags, ctx);
    const registryUnsafe = ctx.regState.parseError
      ? `registry.md is unparseable (${ctx.regState.parseError})`
      : ctx.regState.futureFormat != null
        ? `registry.md format ${ctx.regState.futureFormat} is newer than this engine supports (format ${REG_FORMAT})`
        : ctx.regState.rewriteProblems?.length
          ? `registry.md needs hand repair (${ctx.regState.rewriteProblems[0]})`
          : null;
    const registerMutation = cmd === 'register' && ['entity', 'field', 'verb', 'alias', 'unregister-entity', 'unregister-verb', 'unregister-alias']
      .some(key => hasOwnKey(flags, key));
    const registryInspection = cmd === 'doctor' || cmd === 'lint' || cmd === 'recover' || cmd === 'forget'
      || cmd === 'now' || cmd === 'reindex' || cmd === 'sync'
      || registerMutation
      || (cmd === 'get' && flags.raw === true);
    if (registryUnsafe && !registryInspection)
      die(`refusing '${cmd}' — ${registryUnsafe}; this command depends on registry semantics and must not choose a last duplicate/fallback interpretation. Repair or upgrade the registry first. Safe inspection/recovery: doctor, lint, get <canonical-slug> --raw, recover, forget, now`);
    // No eager crash recovery or stale-registry rewrite here. preflight above is pure;
    // requireDb() heals dirty derived state only for a command that actually needs it,
    // and commitPlan()/reindex()/valid sync migrate only at their commit boundary.
    impl(ctx, pos, flags);
    closeBrain(ctx);
  } catch (e) {
    closeBrain(ctx);
    if (e instanceof BrainError) { console.error(`error: ${e.message}`); process.exit(1); }
    // bug #10-lite: a concurrent-writer lock surfaces as a polite teaching line, not a raw
    // ERR_SQLITE_ERROR stack. sync/reindex already self-retry; anything reaching here waited
    // out the timeout AND the retries.
    if (isBusyErr(e)) { console.error(`error: the brain index is busy — another session is writing. Retry in a moment (sync/reindex self-retry; if it persists, reduce concurrent writers — deep concurrency hardening is pending, stress round 2).`); process.exit(1); }
    throw e;
  }
}


// realpath both sides — the dev pen runs this via a symlink (argv[1] = symlink,
// import.meta.url = resolved real path); a naive compare would skip main().
function isMain() {
  try { return process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

export { REGISTRY, FM_KEY_RE, COHORT_FILTER_FLAGS, VERBS, cmds, DESC, HELP, WRITE_VERB_FLAGS, WRITE_VERBS, READ_OK, childCtx, openBrain, closeBrain, parseFrontmatter, serializeFrontmatter, buildNewFm, applyOp, commitWrite, prepareWrite, commitPlan, recoverDirty, contentHash, parseRegistry, serializeRegistry, validateRegistry, unionReg, profileSignals, addDaysISO, addMonthsISO, addYearsISO, windowBoundsExclusive, withLock, lockIsStale, buildAsk, refuseWithAsk, parseAsksLedger, serializeAsksLedger, readAsksLedger };

if (isMain()) main();
