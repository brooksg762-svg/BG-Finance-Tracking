// Daily scraper for the 2027 Finance Internship Tracker.
// Pulls postings from company ATS APIs (Greenhouse/Lever) plus the Adzuna
// job-search API, filters for relevant finance internships, merges with
// the existing dataset, and writes data/postings.json.
//
// Run with: node scripts/scrape.mjs
// Requires env vars ADZUNA_APP_ID and ADZUNA_APP_KEY for Adzuna search
// (Adzuna step is skipped silently if these are not set).

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const FIRMS_PATH = path.join(ROOT, "config", "firms.json");
const QUERIES_PATH = path.join(ROOT, "config", "search_queries.json");
const OUTPUT_PATH = path.join(ROOT, "data", "postings.json");

const TARGET_YEAR = "2027";
const OLD_YEARS = ["2024", "2025", "2026"];
const STALE_AFTER_DAYS = 30;

// Roles at finance firms that are clearly not finance-track (tech/research
// internships posted by trading firms etc.) and should be excluded even
// though they contain "intern".
const NON_FINANCE_KEYWORDS = [
  "software", "hardware", "firmware", "devops", "infrastructure engineer",
  "site reliability", "network engineer", "security engineer",
  "machine learning", "data scientist", "data engineer", "phd", "ph.d",
  "research scientist", "quant developer", "quantitative developer",
  "it support", "it intern", "systems administrator",
  // Law-firm "summer associate" postings (caught by broad search queries)
  "1l", "2l", "3l", "j.d.", "jd candidate", "esq.", "esquire", "attorney",
  "litigation", "paralegal", "law clerk", "patent agent", "law student",
];

// Law firms whose generic "Summer Associate" postings get picked up by
// finance-related Adzuna searches (Adzuna isn't strict exact-phrase match).
// Add more firm names here (lowercase, substring match) as they show up.
const EXCLUDED_COMPANIES = [
  "jackson lewis", "squire patton boggs", "relman colfax", "banner witcoff",
  "bondurant mixson", "fagen friedman", "cole, scott", "shumaker",
  "chisholm chisholm", "konare law", "weintraub tobin", "morgan & morgan",
];

function isRelevantTitle(title) {
  const t = title.toLowerCase();
  const mentionsIntern = /\b(intern|interns|internship|internships|summer analyst|summer associate)\b/.test(t);
  if (!mentionsIntern) return false;
  const mentionsOldYear = OLD_YEARS.some((y) => t.includes(y));
  if (mentionsOldYear) return false;
  if (NON_FINANCE_KEYWORDS.some((k) => t.includes(k))) return false;
  return true;
}

function isRelevantPosting(company, title) {
  if (!isRelevantTitle(title)) return false;
  const c = (company || "").toLowerCase();
  if (EXCLUDED_COMPANIES.some((k) => c.includes(k))) return false;
  return true;
}

async function fetchJson(url, opts) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) {
      console.warn(`  skip (${res.status}): ${url}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`  error fetching ${url}: ${err.message}`);
    return null;
  }
}

async function scrapeGreenhouse(firm) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${firm.token}/jobs?content=true`;
  const data = await fetchJson(url);
  if (!data || !Array.isArray(data.jobs)) return [];
  const out = [];
  for (const job of data.jobs) {
    if (!isRelevantTitle(job.title)) continue;
    out.push({
      company: firm.name,
      title: job.title,
      location: job.location?.name || "Unspecified",
      url: job.absolute_url,
      source: "Greenhouse",
      datePosted: job.updated_at || job.created_at || null,
    });
  }
  return out;
}

async function scrapeLever(firm) {
  const url = `https://api.lever.co/v0/postings/${firm.token}?mode=json`;
  const data = await fetchJson(url);
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const job of data) {
    const title = job.text || "";
    if (!isRelevantTitle(title)) continue;
    out.push({
      company: firm.name,
      title,
      location: job.categories?.location || "Unspecified",
      url: job.hostedUrl,
      source: "Lever",
      datePosted: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    });
  }
  return out;
}

async function scrapeWorkday(firm) {
  // firm: { name, type: "workday", wdHost (e.g. "wd1"), tenant, site }
  // Career page URL pattern: https://<tenant>.<wdHost>.myworkdayjobs.com/<site>
  const url = `https://${firm.tenant}.${firm.wdHost}.myworkdayjobs.com/wday/cxs/${firm.tenant}/${firm.site}/jobs`;
  const data = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "intern" }),
  });
  if (!data || !Array.isArray(data.jobPostings)) return [];
  const out = [];
  for (const job of data.jobPostings) {
    if (!isRelevantTitle(job.title)) continue;
    out.push({
      company: firm.name,
      title: job.title,
      location: job.locationsText || "Unspecified",
      url: `https://${firm.tenant}.${firm.wdHost}.myworkdayjobs.com/${firm.site}${job.externalPath}`,
      source: "Workday",
      datePosted: null,
    });
  }
  return out;
}

async function runAdzunaQuery(country, appId, appKey, what, where) {
  let url =
    `https://api.adzuna.com/v1/api/jobs/${country}/search/1` +
    `?app_id=${encodeURIComponent(appId)}` +
    `&app_key=${encodeURIComponent(appKey)}` +
    `&results_per_page=50` +
    `&what=${encodeURIComponent(what)}` +
    `&content-type=application/json`;
  if (where) url += `&where=${encodeURIComponent(where)}`;

  const data = await fetchJson(url);
  if (!data || !Array.isArray(data.results)) return [];
  const out = [];
  for (const job of data.results) {
    const companyName = job.company?.display_name || "Unknown";
    if (!isRelevantPosting(companyName, job.title)) continue;
    out.push({
      company: companyName,
      title: job.title,
      location: job.location?.display_name || "Unspecified",
      url: job.redirect_url,
      source: "Adzuna",
      datePosted: job.created || null,
    });
  }
  return out;
}

async function scrapeAdzuna(queries) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    console.log("Adzuna credentials not set, skipping Adzuna search.");
    return [];
  }
  const country = queries.country || "us";
  const out = [];

  for (const q of queries.queries) {
    out.push(...(await runAdzunaQuery(country, appId, appKey, q, null)));
  }

  const loc = queries.locationQueries;
  if (loc?.what && loc?.where) {
    for (const what of loc.what) {
      for (const where of loc.where) {
        out.push(...(await runAdzunaQuery(country, appId, appKey, what, where)));
      }
    }
  }

  return out;
}

function normalizeUrl(url) {
  return url.split("?")[0].replace(/\/$/, "");
}

async function main() {
  const firmsCfg = JSON.parse(await readFile(FIRMS_PATH, "utf-8"));
  const queriesCfg = JSON.parse(await readFile(QUERIES_PATH, "utf-8"));

  let existing = { lastUpdated: null, postings: [] };
  try {
    existing = JSON.parse(await readFile(OUTPUT_PATH, "utf-8"));
  } catch {
    // no existing file yet, that's fine
  }
  const existingByUrl = new Map(
    existing.postings.map((p) => [normalizeUrl(p.url), p])
  );

  const found = [];

  console.log(`Scraping ${firmsCfg.firms.length} company career pages...`);
  for (const firm of firmsCfg.firms) {
    console.log(`- ${firm.name} (${firm.type})`);
    let jobs = [];
    if (firm.type === "greenhouse") jobs = await scrapeGreenhouse(firm);
    else if (firm.type === "lever") jobs = await scrapeLever(firm);
    else if (firm.type === "workday") jobs = await scrapeWorkday(firm);
    found.push(...jobs);
  }

  console.log("Scraping Adzuna for broad job-board coverage...");
  found.push(...(await scrapeAdzuna(queriesCfg)));

  const now = new Date().toISOString();
  const merged = new Map();

  // Carry over existing postings that still pass the current filter
  // (drops stale entries that matched an older, looser filter).
  for (const [key, p] of existingByUrl) {
    if (isRelevantPosting(p.company, p.title)) merged.set(key, p);
  }

  // Add/update with freshly found postings.
  for (const job of found) {
    const key = normalizeUrl(job.url);
    const prev = merged.get(key);
    merged.set(key, {
      ...job,
      dateFound: prev?.dateFound || now,
      lastSeen: now,
    });
  }

  // Drop postings not seen recently (likely expired/removed).
  const cutoff = Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const finalPostings = [...merged.values()].filter((p) => {
    const lastSeen = p.lastSeen ? new Date(p.lastSeen).getTime() : 0;
    return lastSeen >= cutoff;
  });

  // Newest finds first.
  finalPostings.sort(
    (a, b) => new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime()
  );

  const output = {
    lastUpdated: now,
    targetYear: TARGET_YEAR,
    count: finalPostings.length,
    postings: finalPostings,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${finalPostings.length} postings to ${OUTPUT_PATH}`);
}

main();
