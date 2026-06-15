let allPostings = [];
let sortKey = "dateFound";
let sortDir = -1;

function formatDate(iso) {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function render() {
  const search = document.getElementById("search").value.toLowerCase().trim();
  const sourceFilter = document.getElementById("source-filter").value;

  let rows = allPostings.filter((p) => {
    if (sourceFilter && p.source !== sourceFilter) return false;
    if (!search) return true;
    const haystack = `${p.company} ${p.title} ${p.location}`.toLowerCase();
    return haystack.includes(search);
  });

  rows.sort((a, b) => {
    let av = a[sortKey] ?? "";
    let bv = b[sortKey] ?? "";
    if (sortKey === "dateFound" || sortKey === "datePosted") {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    } else {
      av = String(av).toLowerCase();
      bv = String(bv).toLowerCase();
    }
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return 0;
  });

  const tbody = document.getElementById("postings-body");
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No postings match your filters yet. Check back tomorrow &mdash; the tracker updates daily.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (p) => `
    <tr>
      <td>${escapeHtml(p.company)}</td>
      <td>${escapeHtml(p.title)}</td>
      <td>${escapeHtml(p.location)}</td>
      <td><span class="tag">${escapeHtml(p.source)}</span></td>
      <td>${formatDate(p.dateFound)}</td>
      <td><a class="apply-link" href="${escapeAttr(p.url)}" target="_blank" rel="noopener noreferrer">View &amp; Apply</a></td>
    </tr>`
    )
    .join("");
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

function populateSourceFilter() {
  const select = document.getElementById("source-filter");
  const sources = [...new Set(allPostings.map((p) => p.source))].sort();
  for (const s of sources) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  }
}

async function init() {
  try {
    const res = await fetch("data/postings.json", { cache: "no-store" });
    const data = await res.json();
    allPostings = data.postings || [];

    const lastUpdatedEl = document.getElementById("last-updated");
    lastUpdatedEl.textContent = data.lastUpdated
      ? `Last updated: ${formatDate(data.lastUpdated)}`
      : "Last updated: not yet run";

    document.getElementById("count-pill").textContent = `${allPostings.length} postings`;

    const adzunaPill = document.getElementById("adzuna-status-pill");
    const adzunaMessages = {
      rate_limited: "Adzuna search limit reached today — broad search results may be incomplete",
      error: "Adzuna search had errors today — broad search results may be incomplete",
      not_configured: "Adzuna search not configured — only direct company career pages are tracked",
    };
    const msg = adzunaMessages[data.adzunaStatus];
    if (msg) {
      adzunaPill.textContent = msg;
      adzunaPill.hidden = false;
    } else {
      adzunaPill.hidden = true;
    }

    populateSourceFilter();
    render();
  } catch (err) {
    document.getElementById("postings-body").innerHTML =
      `<tr><td colspan="6" class="empty">Could not load posting data.</td></tr>`;
    console.error(err);
  }
}

async function initBoutiqueList() {
  try {
    const res = await fetch("config/boutique_firms.json", { cache: "no-store" });
    const data = await res.json();
    const firms = data.firms || [];
    const tbody = document.getElementById("boutique-body");
    if (firms.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty">No boutique firms listed.</td></tr>`;
      return;
    }
    tbody.innerHTML = firms
      .map(
        (f) => `
      <tr>
        <td>${escapeHtml(f.name)}</td>
        <td>${escapeHtml(f.note)}</td>
        <td><a class="apply-link" href="${escapeAttr(f.url)}" target="_blank" rel="noopener noreferrer">Visit</a></td>
      </tr>`
      )
      .join("");
  } catch (err) {
    document.getElementById("boutique-body").innerHTML =
      `<tr><td colspan="3" class="empty">Could not load boutique firm list.</td></tr>`;
    console.error(err);
  }
}

document.getElementById("search").addEventListener("input", render);
document.getElementById("source-filter").addEventListener("change", render);
document.querySelectorAll("th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortDir *= -1;
    else { sortKey = key; sortDir = 1; }
    render();
  });
});

init();
initBoutiqueList();
