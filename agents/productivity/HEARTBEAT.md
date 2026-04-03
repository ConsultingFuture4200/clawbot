# Productivity Heartbeat Configuration

## Schedule

| Time | Timezone | Task | Model |
|------|----------|------|-------|
| 7:00 AM | America/Los_Angeles | morning-briefing | ollama/qwen2.5:7b |
| 9:00 PM | America/Los_Angeles | evening-summary | ollama/qwen2.5:7b |

## Morning Briefing (7:00 AM Pacific)

1. Check Google Calendar for today's events
2. Scan priority emails (via comms agent handoff)
3. List pending tasks from yesterday
4. Format as concise Telegram message
5. Send to user via Telegram

## Evening Summary (9:00 PM Pacific)

1. Summarize completed items from today
2. List any carried-over/pending items
3. Preview tomorrow's calendar
4. Format as concise Telegram message
5. Send to user via Telegram

## Model Policy

- Heartbeat scheduling and triggers: **ollama/qwen2.5:7b** (local only)
- Content generation for briefings: **google/gemini-3-flash** (needs calendar/email access)
- NEVER use Codex quota for heartbeats

## Failure Handling

- If Ollama is down: skip heartbeat, log failure, do NOT fall back to cloud
- If Gemini is down during content generation: send abbreviated briefing with available data
- All failures produce a Telegram notification
