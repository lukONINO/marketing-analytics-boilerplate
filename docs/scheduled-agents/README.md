# Scheduled Claude Code Agents — Setup Guide

Three cron-scheduled Claude Code agent invocations that run the
marketing-analytics workflow autonomously. Each corresponds to one
routine from the `marketing-analytics` skill.

| Prompt | Schedule (your local TZ) | What it does | Typical runtime |
|---|---|---|---|
| [`daily-prompt.md`](./daily-prompt.md) | **Daily, 07:00** | Pulls GSC + GA4 + Peec + LLM referrers for yesterday, aggregates, writes a daily Notion page | 8-12 min |
| [`weekly-prompt.md`](./weekly-prompt.md) | **Sunday, 22:00** | Rolls up the previous full ISO week into a deep-dive Notion page with trends + opportunity gaps | 12-18 min |
| [`knowledge-refresh-prompt.md`](./knowledge-refresh-prompt.md) | **Wednesday, 03:00** | Scrapes Peec blog + docs, diffs against seen, updates skill files as new capabilities ship | 5-15 min (0 if nothing new) |

---

## What "scheduled Claude Code agent" means here

Any system that can invoke a fresh Claude Code session with:

1. A **working directory** containing the `marketing-analytics` repo
2. **Environment variables** for Google APIs (see [env-template.md](./env-template.md))
3. **MCPs installed**: Peec AI MCP + Notion MCP
4. A **prompt** — one of the three in this folder
5. The ability to **receive Claude's final reply** (log, Slack webhook, email)

Concrete candidates:

- **Anthropic's Scheduled Triggers** (if you have access — works directly with Claude Code)
- **GitHub Actions** with the Claude Code CLI step
- **macOS `launchd`** (local; laptop must be awake on trigger times — fine for the daily)
- **A small cloud VM** with `cron` + Claude Code installed

The prompts themselves don't depend on which scheduler you use — they're
just instruction text. Pick whichever matches your operational comfort.

---

## One-time setup

### 1 · Clone the repo to the agent's workspace

```zsh
# On the host running the scheduler:
git clone git@github.com:<you>/marketing-analytics.git
cd marketing-analytics
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q   # sanity check — should be all green
```

### 2 · Drop in the secrets

The agent needs `.env` populated with the same values your local
environment uses. **Do NOT commit `.env`.** If the scheduler platform
has a secret store (GitHub Actions secrets, AWS Parameter Store,
Doppler, 1Password CLI, etc.), inject at runtime:

```zsh
# GitHub Actions example (.github/workflows/marketing-daily.yml step):
- name: Assemble .env
  run: |
    cat <<EOF > .env
    GSC_SERVICE_ACCOUNT_JSON_B64=${{ secrets.GSC_SA_B64 }}
    GSC_SITE_URL=sc-domain:acme.io
    GA4_PROPERTY_ID=${{ secrets.GA4_PROPERTY_ID }}
    SITE_CANONICAL_ORIGIN=https://acme.io
    TIMEZONE=Europe/Berlin
    LOG_LEVEL=INFO
    EOF
    chmod 600 .env
```

Full list of required vars: [`env-template.md`](./env-template.md).

### 3 · Install + authenticate the MCPs

**Peec AI MCP** and **Notion MCP** both need to be pre-installed and
authenticated in whichever Claude Code environment the agent runs in.

- **Peec MCP**: follow Peec's cloud-install flow. The `project_id` is
  resolved at runtime via `list_projects` — no hardcoded IDs anywhere.
- **Notion MCP**: install + authorize to the same Notion workspace as
  local. The integration must have **edit access** to the parent page
  (where the Marketing Reports database lives). Verify in Notion: page
  → `...` → Connections.

### 4 · Verify the agent can reach everything

Run a dry test once manually before scheduling:

```zsh
cd marketing-analytics
source .venv/bin/activate
# Simulate what the cron will do:
python scripts/pull_gsc.py --date $(date -v-2d +%Y-%m-%d)  # macOS
# or:  python scripts/pull_gsc.py --date $(date -d "2 days ago" +%Y-%m-%d)  # Linux
ls -la data/raw/gsc/
```

If that writes a JSON file successfully, credentials are good.

### 5 · Test the MCP connections (Peec + Notion)

In an interactive Claude Code session on the agent's host:

```
> Call the Peec MCP list_projects tool and the Notion MCP notion-search tool with query "Marketing Reports"
```

Both should return without errors. If either fails, fix the MCP install
before scheduling.

### 6 · Schedule the three cron jobs

Pick your scheduler. Example schedules (Europe/Berlin):

| Prompt | Cron (Europe/Berlin) | UTC equivalent (winter) | UTC (summer) |
|---|---|---|---|
| Daily | `0 7 * * *` | `0 6 * * *` | `0 5 * * *` |
| Weekly | `0 22 * * 0` (Sun) | `0 21 * * 0` | `0 20 * * 0` |
| Knowledge refresh | `0 3 * * 3` (Wed) | `0 2 * * 3` | `0 1 * * 3` |

**Daylight savings matters.** If your scheduler runs in UTC, it will
drift ±1 hour twice a year relative to local time. For most use-cases
this is fine; if you need tight timing, configure the scheduler to
run in your local TZ directly (GitHub Actions supports this via
`TZ`; most cron daemons via `/etc/localtime`).

### 7 · Configure how Claude's reply reaches you

Each prompt ends with an explicit verification step:

> *"Reply with: the Notion page URL, the three headline numbers, any
> data-quality flags, and one sentence on the top insight."*

How that reply reaches you depends on the scheduler:

- **Anthropic Scheduled Triggers** — reply goes to the trigger dashboard
- **GitHub Actions** — reply appears in the Actions job log; pipe to
  Slack via `slack-notifier-action`
- **launchd / cron on macOS** — capture stdout to a log file you
  review daily
- **Cloud VM with cron** — same as above, or pipe through `mail` /
  `curl` to a Slack webhook

See [the setup block in each prompt file](./daily-prompt.md) for the
exact reply format.

---

## Testing a scheduled prompt before go-live

**Highly recommended: run each prompt once manually first.**

1. Copy the prompt text from `daily-prompt.md` (or the other two).
2. Paste it as the first message of an interactive Claude Code session
   on the agent's host (same working directory, same env, same MCPs).
3. Watch it run end-to-end.
4. Verify the Notion page looks right.
5. Only then wire it into the scheduler.

A broken prompt that fails silently in a cron run is worse than no
prompt at all. The 10-minute manual test is cheap.

---

## Operational hygiene

- **Log retention**: keep at least 30 days of agent run logs. The
  weekly report's 28-day baseline anomaly detection depends on it.
- **Failure alerts**: set up a simple "notify if last run was >28h ago"
  check — whatever your scheduler supports. A silently-stopped daily
  agent is the most dangerous failure mode.
- **Manual override**: you should always be able to re-run a day
  manually. Same prompts work when pasted into an interactive session —
  no scheduler-specific syntax in them.
- **Date drift**: the daily prompt defaults to "yesterday" based on
  the agent's local clock. If the host's timezone is wrong, you'll
  pull the wrong day. Always set `TZ` explicitly in the scheduler's
  env (e.g. `TZ=Europe/Berlin`).

---

## Troubleshooting quick-reference

| Symptom | Likely cause | Fix |
|---|---|---|
| `GSC_SERVICE_ACCOUNT_JSON_B64 is not valid base64` | Secret pasted as multi-line | Re-encode with `base64 -i sa.json \| tr -d '\n'` |
| `GA4_PROPERTY_ID must be numeric` | Used Measurement ID (G-…) | Replace with numeric Property ID from GA4 Admin |
| Peec MCP `list_projects` empty | MCP not authenticated on cloud host | Re-auth the Peec MCP on the agent's host |
| Notion MCP "parent not found" | Integration not shared with the page | Notion → page → Connections → add integration |
| Scheduled run fires but no Notion page | Skill not loaded | Confirm `.claude/skills/marketing-analytics/` is present on the host |
| Different output between manual and scheduled | Different `TZ` or `PATH` | Make the cron env match the interactive env explicitly |

---

## File map in this folder

- **[README.md](./README.md)** — this file (setup guide)
- **[env-template.md](./env-template.md)** — full list of env vars each agent needs
- **[daily-prompt.md](./daily-prompt.md)** — copy-pasteable prompt for the daily 07:00 run
- **[weekly-prompt.md](./weekly-prompt.md)** — copy-pasteable prompt for the Sunday 22:00 run
- **[knowledge-refresh-prompt.md](./knowledge-refresh-prompt.md)** — copy-pasteable prompt for the Wednesday 03:00 run
