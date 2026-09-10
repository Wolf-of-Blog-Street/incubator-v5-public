# Incubator v5 Documentation (`docs/`)

Welcome to the **Incubator v5 Documentation Repository**.

This repository is the central source of truth for **Incubator v5 itself**—our system architecture, CLI manuals, active design blueprints, and operational runbooks.

---

## Documentation Structure (3 Tiers)

```
docs/
├── system/                 # Tier 1: Living System Truth (Architecture & CLI Manuals)
│   ├── ARCHITECTURE.md     # Master system architecture & component blueprints
│   ├── MANUAL.md           # CLI tools reference, commands & workflows
│   └── INDEX.md            # Catalog of system manuals
│
├── design/                 # Tier 2: Transitional Blueprints (Active Stages & Epics)
│   ├── templates/          # Standard Google-style epic blueprint (epic.template.md)
│   ├── INDEX.md            # Active & in-progress design specs table
│   └── archive/            # Landed/completed epics preserved for history
│
└── support/                # Tier 3: Operations & Troubleshooting
    ├── RUNBOOK.md          # Operational runbooks & incident recovery
    └── INDEX.md            # Catalog of operational docs
```

---

## For Agents & Developers

- Read [system/ARCHITECTURE.md](system/ARCHITECTURE.md) to understand the Incubator v5 component suite and topology.
- Read [system/MANUAL.md](system/MANUAL.md) for CLI commands, tools, and usage references.
- To start a new stage or feature, instantiate [design/templates/epic.template.md](design/templates/epic.template.md) into `design/<slug>.md`.
