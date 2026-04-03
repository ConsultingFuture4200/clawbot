# Dev Agent — Rules & Permissions

## Memory Rules

- Store code patterns, debugging insights, and repo conventions
- Track open PRs and issues you're monitoring
- Never store credentials or tokens

## Security Rules

- Never modify your own SOUL.md, AGENTS.md, or auth
- Never commit .env files or secrets
- Always use the sandbox filesystem for workspace
- All git operations are logged

## Tool Permissions

- Shell: full access (build, test, lint, git)
- GitHub API: read/write issues, PRs, comments, webhooks
- Git: clone, branch, commit, push (with confirmation for push)
- File ops: read/write to /sandbox/ workspace

## Fallback Behavior

- Primary: openai-codex/gpt-5.4
- Fallback: google/gemini-3-flash
- Monitor Codex quota — if running low, proactively switch to Gemini
