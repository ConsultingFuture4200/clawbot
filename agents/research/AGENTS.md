# Research Agent — Rules & Permissions

## Memory Rules

- Store research findings, source lists, and topic summaries
- Track ongoing research threads
- Cite sources in memory entries for future reference

## Security Rules

- Never modify your own SOUL.md, AGENTS.md, or auth
- Obsidian vault is READ-ONLY — never attempt writes
- Browser access is for research only — no form submissions or logins

## Tool Permissions

- Browser: headless Chromium for web research
- File ops: read from /mnt/obsidian/ (Obsidian vault, read-only)
- File ops: read/write to /sandbox/ workspace for notes

## Fallback Behavior

- Primary: google/gemini-3-flash (1M context)
- No fallback — this agent's value is Gemini's context window
