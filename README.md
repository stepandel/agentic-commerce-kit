# agentic-commerce-kit

Tools for converting or building stores that AI agents can shop, packaged as a
[Claude Code](https://claude.com/claude-code) plugin marketplace.

Agents can't fill in a browser checkout form. To buy from a store, an agent needs a
way to **discover** what's for sale and how to pay, and a **machine payment** path it
can complete on its own. This repo collects the tooling to add that to any store.

## Install

```
/plugin marketplace add stepandel/agentic-commerce-kit
/plugin install agentic-commerce@agentic-commerce-kit
```

(Replace `stepandel/agentic-commerce-kit` with this repo's GitHub path if it differs.)

Then, in any project, ask Claude to **"enable agentic shopping in `<path-to-store>`"** —
or invoke the skill directly: `/agentic-commerce:enable-agentic-shopping <path>`.

## What's inside

A marketplace (`.claude-plugin/marketplace.json`) listing one plugin:

- **`agentic-commerce`** (`plugins/agentic-commerce/`) — bundles the
  **`enable-agentic-shopping`** skill. It verifies Stripe prerequisites, wires up MPP
  (Machine Payments Protocol) checkout over Stripe Shared Payment Tokens plus the agent
  discovery layer (`llms.txt`, `agent-storefront.json`, `openapi.json`), writes the
  code into the target store, and confirms the `402` payment flow works — pausing for
  the user at every store-specific fork. Framework-agnostic; Stripe-SPT-only for now.

```
agentic-commerce-kit/
├── .claude-plugin/marketplace.json
└── plugins/agentic-commerce/
    ├── .claude-plugin/plugin.json
    └── skills/enable-agentic-shopping/
        ├── SKILL.md
        ├── references/   # MPP/SPT protocol, Stripe prerequisites, framework adapters
        ├── templates/    # the code copied into the store
        └── scripts/      # preflight prerequisite check
```

## Local development

Validate the plugin and marketplace before pushing:

```
claude plugin validate ./plugins/agentic-commerce
claude plugin validate . --strict
```

To test without publishing, add the local checkout as a marketplace:

```
/plugin marketplace add ./
/plugin install agentic-commerce@agentic-commerce-kit
```

## Background

The patterns here are distilled from a reference implementation: a working agentic
storefront built on the [`mppx`](https://github.com/wevm/mppx) SDK and Stripe Shared
Payment Tokens.

## License

MIT
