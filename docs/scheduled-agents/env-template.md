# Environment Variables — Scheduled Agent Reference

Every scheduled run needs these in `.env` (or injected via your
scheduler's secret store). Cloud deployments: **inject at runtime, do
not commit any `.env` file to any repo, even a private one.**

## Required

| Variable | Where it comes from | Example |
|---|---|---|
| `GSC_SITE_URL` | Search Console property identifier | `sc-domain:acme.io` |
| `GSC_SERVICE_ACCOUNT_JSON_B64` | Base64 of the SA JSON (single line — no wrapping) | `eyJ0eXBlIjoi...` |
| `GA4_PROPERTY_ID` | GA4 Admin → Property Settings → Property ID (numeric) | `384729016` |
| `SITE_CANONICAL_ORIGIN` | Base URL for URL normalization | `https://acme.io` |
| `TIMEZONE` | Used only for log-line timestamps | `Europe/Berlin` |

## Optional (path-based alternative to B64)

For local dev where you prefer a file over a base64 env var:

| Variable | What it does |
|---|---|
| `GSC_SERVICE_ACCOUNT_JSON_PATH` | Absolute path to the SA JSON on disk. **Wins over `_B64` if both are set.** Ideal for local dev (`~/.secrets/acme-analytics-sa.json`). |

**Do NOT use the PATH variant in cloud agents** — file paths aren't
stable across scheduler environments. Use `_B64` for anything
scheduled.

## Optional (logging / misc)

| Variable | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `INFO` | Set to `DEBUG` when investigating a failure |
| `NOTION_INTEGRATION_TOKEN` | (unset) | Only needed if a Python script ever calls Notion directly; the MCP doesn't need it |
| `NOTION_MARKETING_REPORTS_DB_ID` | (unset) | Mirror of `config/notion_schema.yaml`; the skill reads the YAML directly, this is a convenience duplicate |

## Not needed (these come from elsewhere)

- Peec AI project ID / API key → auth lives **inside the Peec MCP
  config**, not in env. Install the Peec MCP on the agent's host and
  it handles auth itself.
- Notion workspace / page IDs → stored in `config/notion_schema.yaml`
  after the first-run bootstrap. Committed to the repo.

---

## Scheduler-specific injection examples

### GitHub Actions

Stored in repo Settings → Secrets and variables → Actions.

```yaml
env:
  GSC_SITE_URL: sc-domain:acme.io
  GSC_SERVICE_ACCOUNT_JSON_B64: ${{ secrets.GSC_SA_B64 }}
  GA4_PROPERTY_ID: ${{ secrets.GA4_PROPERTY_ID }}
  SITE_CANONICAL_ORIGIN: https://acme.io
  TIMEZONE: Europe/Berlin
  TZ: Europe/Berlin
  LOG_LEVEL: INFO
```

### macOS launchd

Add an `<EnvironmentVariables>` block to the `.plist`:

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>GSC_SERVICE_ACCOUNT_JSON_PATH</key>
  <string>/path/to/your/secrets/acme-analytics-sa.json</string>
  <key>GA4_PROPERTY_ID</key>
  <string>384729016</string>
  <key>TZ</key>
  <string>Europe/Berlin</string>
</dict>
```

### Linux cron + Doppler

```cron
0 7 * * * cd /srv/marketing-analytics && doppler run -- claude-code --prompt-file docs/scheduled-agents/daily-prompt.md
```

Doppler pulls the secrets and injects them into the process env; no
`.env` file on disk.

---

## Credential lifecycle

- **Rotate the GSC/GA4 service-account key every 90 days.** Keep the
  old key active during the rotation window (add new key, verify, then
  delete old key in Google Cloud IAM).
- **Use a separate SA key for laptop vs. scheduled agent.** That way
  revoking one doesn't break the other. Add both to the same service
  account — Google allows multiple active keys per SA.
- **Audit MCP access quarterly**: Notion Admin → Connections; Peec
  Project → Members. Anyone who no longer needs access should be
  removed.
