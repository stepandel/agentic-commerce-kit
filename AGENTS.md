# AGENTS.md

Guidance for any AI coding agent working in this repository.

## What this repo is

`agentic-commerce-kit` is a collection of **host-agnostic skills** for adding
agentic shopping (AI-agent checkout) to stores. Skills live in `skills/<name>/` as
`SKILL.md` folders with bundled `references/` and `templates/`. They are plain
markdown + code with no agent-specific dependencies, so any agent that can read a
skill folder can use them.

## Using a skill here

To enable agentic shopping in a store, follow the skill at
`skills/enable-agentic-shopping/SKILL.md` and its bundled resources. Read SKILL.md
first; it drives the workflow and tells you when to load each reference.

## Conventions when editing

- Keep skills host-agnostic. Do not hard-code one agent's paths or env vars into a
  skill body; reference bundled resources relative to the skill's own directory.
- `setup` is the universal installer (POSIX bash, no deps, macOS bash 3.2 compatible).
  To support a new agent, edit only `setup` — see `docs/ADDING_A_HOST.md`.
- The `.claude-plugin/` manifests package the kit for Claude Code specifically; keep
  them in sync with `skills/` but don't make the skill content depend on them.
- TypeScript templates under `skills/*/templates/` are copied into user stores. They
  target `mppx` + `stripe`; typecheck changes against those types before committing.
- Never commit secrets. `.env*` files are gitignored.

## Install (for end users)

```bash
./setup            # auto-detect agents and install
./setup --list     # see supported/detected agents
```
