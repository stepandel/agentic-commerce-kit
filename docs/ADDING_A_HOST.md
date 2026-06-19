# Adding support for another agent (host)

Skills in this kit are plain `SKILL.md` folders with no agent-specific code, so
supporting a new agent is just teaching the installer where that agent looks for
skills. Two edits in `./setup`, no code changes elsewhere.

1. **Add the host name** to `KNOWN_HOSTS`:

   ```sh
   KNOWN_HOSTS="claude codex cursor opencode factory <your-host>"
   ```

2. **Add two cases** — where its skills live, and how to detect it:

   ```sh
   host_skills_dir() {
     case "$1" in
       ...
       <your-host>) echo "$HOME/.<your-host>/skills" ;;
     esac
   }

   host_detected() {
     case "$1" in
       ...
       <your-host>) [ -d "$HOME/.<your-host>" ] ;;
     esac
   }
   ```

Then `./setup --host <your-host>` (or plain `./setup` once detected) symlinks each
skill into that directory.

## What a host must support

The only requirement is that the agent loads skills from a directory of
`<name>/SKILL.md` folders. If an agent instead reads a single instructions file
(e.g. `AGENTS.md`, `GEMINI.md`, `.cursorrules`), point that file at the installed
skill folder rather than adding a host entry — for example:

> For agentic-commerce tasks, follow the skill at
> `~/.config/<agent>/skills/enable-agentic-shopping/SKILL.md`.

## Current hosts

| Host | `--host` | Skills directory |
|------|----------|------------------|
| Claude Code | `claude` (default) | `~/.claude/skills` |
| Codex CLI | `codex` | `~/.codex/skills` |
| Cursor | `cursor` | `~/.cursor/skills` |
| OpenCode | `opencode` | `${XDG_CONFIG_HOME:-~/.config}/opencode/skills` |
| Factory Droid | `factory` | `~/.factory/skills` |

Claude Code users can alternatively install via the bundled plugin/marketplace —
see the README.
