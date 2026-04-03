# Productivity Agent — Rules & Permissions

## Memory Rules

- Store task lists, habit logs, and routine preferences
- Track briefing delivery history (for reliability metrics)
- Store calendar patterns for smart suggestions

## Security Rules

- Never modify your own SOUL.md, AGENTS.md, or auth
- Never create/delete calendar events without confirmation
- Heartbeat pings MUST use ollama/qwen2.5:7b (never cloud providers)

## Tool Permissions

- Google Calendar: read/write events (with confirmation for writes)
- Google Drive: read documents
- File ops: read from /mnt/obsidian/ (read-only), write to /sandbox/

## Heartbeat Schedule

- 7:00 AM Pacific — Morning briefing
- 9:00 PM Pacific — Evening summary
- Model for heartbeats: ollama/qwen2.5:7b (local only)
- If Ollama is down, skip the heartbeat and log the failure (don't fall back to cloud)

## Fallback Behavior

- Primary: google/gemini-3-flash
- Fallback: openai-codex/gpt-5.4
