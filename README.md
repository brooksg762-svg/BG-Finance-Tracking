# 2027 Finance Internship Tracker

A static site that auto-updates daily with finance internship postings for
2027 (investment banking, sales & trading, equity research, capital markets,
private credit, corporate finance, asset management, and more), pulled from:

- Company career pages directly, via their applicant tracking system (ATS)
  API ([config/firms.json](config/firms.json)) — Greenhouse and Lever boards.
  This is how postings from small/boutique firms get caught.
- Broad job-board search via the [Adzuna](https://developer.adzuna.com/) API
  ([config/search_queries.json](config/search_queries.json)).

## How it works

1. `scripts/scrape.mjs` (Node 18+) fetches postings from every firm in
   `config/firms.json` plus the Adzuna search queries, filters for titles
   containing "intern"/"internship"/"summer analyst" that don't mention
   2024-2026 (so generic "2025/2026 internship" listings get excluded, while
   2027 or year-unspecified listings are kept), and writes the merged result
   to `data/postings.json`.
2. `index.html` + `assets/app.js` read `data/postings.json` and render a
   searchable, sortable table.
3. A GitHub Actions workflow (`.github/workflows/daily-update.yml`) runs the
   scraper every day, commits the updated `data/postings.json`, and deploys
   the site to GitHub Pages.

## One-time setup

### 1. Push this folder to a new GitHub repo

```
git init
git add .
git commit -m "Initial commit: finance internship tracker"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

### 2. Enable GitHub Pages

In the repo: **Settings → Pages → Build and deployment → Source → GitHub
Actions**. The included workflow will deploy automatically.

### 3. (Recommended) Add Adzuna API credentials

1. Sign up for a free account at https://developer.adzuna.com/ and create an
   app to get an **App ID** and **App Key**.
2. In the repo: **Settings → Secrets and variables → Actions → New repository
   secret**. Add:
   - `ADZUNA_APP_ID`
   - `ADZUNA_APP_KEY`

Without these, the daily job still runs and scrapes all firms in
`config/firms.json` directly — it just skips the broad Adzuna search step.

### 4. Run it the first time

Go to **Actions → Daily internship scrape → Run workflow** to trigger it
manually (instead of waiting for the daily 11:00 UTC schedule). After it
finishes, your GitHub Pages URL (shown in **Settings → Pages**) will show the
populated tracker.

## Expanding coverage

- **Add more firms**: edit [config/firms.json](config/firms.json). For
  Greenhouse, find the company's job board at
  `https://boards.greenhouse.io/<token>` — `<token>` is what you put in the
  `token` field with `"type": "greenhouse"`. For Lever, the board is at
  `https://jobs.lever.co/<token>`, with `"type": "lever"`.
- **Workday-based firms** (many large asset managers/PE firms use Workday)
  aren't supported out of the box because each tenant's API subdomain
  differs — this can be added later if needed.
- **Add/adjust search terms**: edit
  [config/search_queries.json](config/search_queries.json) to widen or
  narrow the Adzuna search (e.g. add other countries, role types, etc).
- The scraper drops any posting not seen again within 30 days, so stale
  listings fall off automatically.

## Local testing

Requires Node.js 18+ (for built-in `fetch`):

```
node scripts/scrape.mjs
```

Then open `index.html` in a browser (or run a simple local server, e.g.
`npx serve .`, since `fetch` of `data/postings.json` may be blocked by
`file://` restrictions in some browsers).
