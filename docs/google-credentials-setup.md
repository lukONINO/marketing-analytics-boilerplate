# Google Credentials Setup — GSC + GA4

**Goal:** give this pipeline read-only access to Search Console and GA4
using credentials that (1) are auditable, (2) can be revoked without
disrupting human accounts, (3) never leak into git, (4) never leak into
backups, and (5) rotate cleanly.

**TL;DR:**
1. Create a **dedicated service account** in Google Cloud (not user creds).
2. Grant it **property-level Viewer** on GSC + GA4 (not project-level).
3. Download its JSON key, base64-encode, drop into `.env` with `chmod 600`.
4. Rotate keys every 90 days.
5. For scheduled cloud runs, store the base64 blob in your platform's
   secret manager — never in a committed file.

---

## 1. Create a dedicated service account

**Why dedicated:** a service account is a non-human identity. If it
leaks, you revoke one key and nothing else breaks. If your personal
account leaks, your whole Google identity is at risk.

1. Go to Google Cloud Console → **IAM & Admin → Service Accounts**.
   If you don't have a project yet, create one — e.g. `acme-analytics`.
2. Click **Create Service Account**:
   - **Name:** `marketing-analytics-readonly`
   - **ID:** auto-populated, e.g.
     `marketing-analytics-readonly@acme-analytics.iam.gserviceaccount.com`
   - **Description:** "Read-only GSC + GA4 access for the
     marketing-analytics pipeline."
3. **Do not grant any project-level roles.** Click *Continue* and
   *Done* — leaving the "Grant this service account access to project"
   section empty. GSC and GA4 permissions are granted at the property
   level, not the project level. Adding a project-wide role would be
   over-privileged.
4. In the service-account list, click your new account → **Keys** →
   **Add Key → Create new key → JSON**. The file downloads
   immediately. **This is the one chance to download it** — Google
   never shows the private key again.
5. Save the JSON to a **temporary** location, e.g.
   `~/Downloads/acme-analytics-<rand>.json`. We will delete it after
   encoding (step 3 below).

---

## 2. Grant minimum permissions at the property level

### GSC (Search Console)

1. Go to [search.google.com/search-console](https://search.google.com/search-console).
2. Select your site property (e.g. `acme.io`).
3. **Settings → Users and permissions → Add user**.
4. Paste the service account email
   (`marketing-analytics-readonly@…gserviceaccount.com`).
5. Set permission level to **Restricted** (not "Full"). Restricted
   can query performance data and inspect URLs — that's all we need.
6. Click *Add*.

### GA4

1. Go to [analytics.google.com](https://analytics.google.com).
2. **Admin (gear) → Property Access Management** for your site
   property. (Do NOT use Account Access Management — that's too broad.)
3. Click the `+` → **Add users**.
4. Paste the service account email.
5. Set role to **Viewer**. Uncheck "Notify new users by email"
   (service accounts don't have inboxes).
6. Click *Add*.

### Enable the APIs

In Google Cloud Console for the same project where you created the SA:

1. **APIs & Services → Library**.
2. Enable:
   - **Google Search Console API**
   - **Google Analytics Data API** (for GA4)

---

## 3. Encode the key and drop it into `.env`

Never commit the raw JSON. The pipeline reads a base64-encoded version
from the env var `GSC_SERVICE_ACCOUNT_JSON_B64` so the file itself
doesn't need to live on disk after this step.

```zsh
cd /path/to/marketing-analytics

# 1. Encode the JSON to a single base64 line (no wrapping)
#    -i = input file (macOS base64 syntax)
B64=$(base64 -i ~/Downloads/acme-analytics-*.json | tr -d '\n')

# 2. Put it in .env. If .env doesn't exist yet, copy the template:
[ ! -f .env ] && cp .env.example .env

# 3. Append / replace the key line
#    (manually edit .env if you'd rather — just paste after the `=`)
grep -q '^GSC_SERVICE_ACCOUNT_JSON_B64=' .env \
  && sed -i '' "s|^GSC_SERVICE_ACCOUNT_JSON_B64=.*|GSC_SERVICE_ACCOUNT_JSON_B64=$B64|" .env \
  || echo "GSC_SERVICE_ACCOUNT_JSON_B64=$B64" >> .env

# 4. Lock the file so only your user can read it
chmod 600 .env

# 5. Delete the downloaded JSON now that it's encoded in .env
#    (keep a backup in your password manager if you want — see §5 below)
rm ~/Downloads/acme-analytics-*.json

# 6. Confirm .env is gitignored — should print "yes, ignored"
git check-ignore -v .env && echo "yes, ignored" || echo "NOT ignored — STOP and fix .gitignore"
```

Also fill in, by hand:
- `GA4_PROPERTY_ID` — GA4 → Admin → Property Settings → Property ID (numeric).
- `GSC_SITE_URL` — already defaulted to `sc-domain:acme.io`. If your
  GSC property is a **URL-prefix** property (not domain), replace with
  the full URL, e.g. `https://www.acme.io/`.

---

## 4. Verify access

After Phase 2 scripts exist you can run:

```zsh
source .venv/bin/activate
python scripts/pull_gsc.py --date $(date -v-2d +%Y-%m-%d)    # two days ago
python scripts/pull_ga4.py --date $(date -v-2d +%Y-%m-%d)
```

and confirm `data/raw/gsc/<date>.json` and `data/raw/ga4/<date>.json`
are populated with non-empty query / page / referrer arrays.

**Common errors:**
- `403 permission denied` on GSC → service account not added to the
  property, or permission level set to "Associate" (not enough).
- `404 property not found` on GA4 → `GA4_PROPERTY_ID` is wrong (you
  may have used the Measurement ID `G-…` instead of the numeric
  Property ID).
- `API not enabled` → step 2's "Enable the APIs" was skipped.

---

## 5. Storage hygiene

### Minimum (current setup)

- `.env` is gitignored.
- `.env` has `chmod 600` so only your local user can read it.
- Downloaded JSON key is deleted after encoding.

### Better (recommended)

Keep an encrypted backup of the **original JSON file** in your
password manager (1Password / Bitwarden / Keychain). Rationale: if
your laptop dies or `.env` is lost, you don't have to regenerate the
key from scratch (which means re-granting permissions and invalidating
any outstanding uses). Store it as an attachment under an item called
something like "Acme analytics service account key".

### Best (if you use 1Password CLI)

Skip `.env` entirely. Store the base64 string as a 1Password item
field and inject at run time:

```zsh
# once:
op item create --category=api-credential \
  --title='Acme GSC/GA4 SA (base64)' \
  'notes=one-line base64 of the service-account JSON' \
  'password[concealed]=<PASTE_BASE64_HERE>'

# at run time (instead of loading .env):
export GSC_SERVICE_ACCOUNT_JSON_B64="$(op read 'op://Private/Acme GSC-GA4 SA (base64)/password')"
python scripts/pull_gsc.py --date 2026-04-20
```

The secret never lands on disk. The cost is one `op` call per session
plus a 1Password Touch-ID prompt. Comfortable tradeoff for a daily
analytics pipeline; probably not worth it for an hourly cron.

---

## 6. Key rotation (every 90 days)

Service-account JSON keys do not expire by default — Google's own
guidance is to rotate them. Calendar it.

```
1. Google Cloud Console → IAM → Service Accounts → [your SA] → Keys
2. Add Key → Create new key → JSON. Download it.
3. Re-run the encode-and-drop-in-.env block from §3 with the new file.
4. Run `python scripts/pull_gsc.py` once to verify the new key works.
5. In the same Keys UI, DELETE the old key. Confirm it's gone.
```

If a key is suspected compromised, do steps 2-5 immediately — the
delete step in #5 is what actually revokes the old one.

---

## 7. Scheduled cloud Claude Code runs

Do **not** commit `.env` anywhere, even to a "private" repo. For the
scheduled cloud agent:

- If the agent platform has a **secret store** (most do), paste the
  base64 blob there as `GSC_SERVICE_ACCOUNT_JSON_B64`. The platform
  injects it into the agent's env at start; nothing touches disk.
- If you must use a file, mount it via the platform's equivalent of
  Kubernetes secrets / AWS Parameter Store / Google Secret Manager.
  Do not scp the file directly.
- Rotate the key the first time you set up the cloud run, and use a
  **different** key from your laptop. Then you can revoke the laptop
  key without breaking the cloud run (and vice versa). This is worth
  the 5-minute overhead.

---

## 8. Audit checklist (sanity pass)

Run through this before you call the setup "done":

- [ ] Service account has **no project-level IAM role**.
- [ ] Service account is granted **Restricted** (not Full) on GSC.
- [ ] Service account is granted **Viewer at the property level**
      on GA4 (not account level).
- [ ] `GSC_Search Console API` and `Google Analytics Data API` are
      both enabled in the Cloud project.
- [ ] `.env` has `chmod 600`.
- [ ] `.env` is in `.gitignore` — `git check-ignore -v .env` confirms.
- [ ] Downloaded JSON file has been deleted (or moved to 1Password
      as encrypted attachment).
- [ ] Key rotation date is in your calendar (90 days out).
- [ ] You know how to disable the key if it leaks (IAM → Keys → delete).
