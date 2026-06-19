# agentic-commerce-kit

Tools for converting or building stores that AI agents can shop.

Agents can't fill in a browser checkout form. To buy from a store, an agent needs a
way to **discover** what's for sale and how to pay, and a **machine payment** path it
can complete on its own. This repo collects the tooling to add that to any store.

The tools ship as **host-agnostic skills** (`SKILL.md` folders — plain markdown,
code, and scripts) that work with any AI coding agent that loads skills, plus a
universal installer and a Claude Code plugin.

## Install

Clone the repo and run the installer. It auto-detects which agents you have and
symlinks the skills into each one's skills directory:

```bash
git clone https://github.com/stepandel/agentic-commerce-kit
cd agentic-commerce-kit
./setup                 # install for every detected agent
```

Target or inspect specific agents:

```bash
./setup --list          # show known agents and which are detected
./setup --host codex    # install for one agent
./setup --all           # install for every known agent (create dirs as needed)
./setup --copy          # copy instead of symlink (Windows / no symlink support)
./setup --uninstall     # remove the kit's skills
```

Supported agents: Claude Code, Codex CLI, Cursor, OpenCode, Factory Droid. Adding
another is two lines — see [`docs/ADDING_A_HOST.md`](docs/ADDING_A_HOST.md).

Re-run `./setup` after `git pull` (symlinks track the repo; `--copy` installs do not).

### Claude Code: install as a plugin (alternative)

```
/plugin marketplace add stepandel/agentic-commerce-kit
/plugin install agentic-commerce@agentic-commerce-kit
```

## Use

In any project, ask your agent to **"enable agentic shopping in `<path-to-store>`"**.
On Claude Code you can also invoke it directly:
`/agentic-commerce:enable-agentic-shopping <path>`.

## What's inside

```
agentic-commerce-kit/
├── setup                          # universal multi-agent installer
├── skills/
│   └── enable-agentic-shopping/   # the skill (host-agnostic)
│       ├── SKILL.md
│       ├── references/            # MPP/SPT protocol, Stripe prerequisites, adapters
│       ├── templates/             # the code copied into the store
│       └── scripts/               # preflight prerequisite check
├── .claude-plugin/                # Claude Code plugin + marketplace manifests
└── docs/ADDING_A_HOST.md
```

- **`enable-agentic-shopping`** — adds agentic shopping to an existing store. It
  verifies Stripe prerequisites, wires up MPP (Machine Payments Protocol) checkout
  over Stripe Shared Payment Tokens plus the agent discovery layer (`llms.txt`,
  `agent-storefront.json`, `openapi.json`), writes the code into the target store,
  and confirms the `402` payment flow works — pausing for the user at every
  store-specific fork. Works against any store language — MPP is HTTP-native with
  official SDKs in TypeScript, Python, Rust, Go, and Ruby (bundled templates are
  TypeScript; other languages use their SDK). Stripe-SPT-only for now.

## Local development

Validate the Claude plugin/marketplace manifests:

```bash
claude plugin validate . --strict
```

Test the installer against a throwaway HOME without touching your real config:

```bash
TMP=$(mktemp -d); mkdir -p "$TMP/.codex"; HOME="$TMP" ./setup --host codex; ls "$TMP/.codex/skills"
```

## Background

The patterns here are distilled from a reference implementation: a working agentic
storefront built on the [`mppx`](https://github.com/wevm/mppx) SDK and Stripe Shared
Payment Tokens.

## License

MIT
