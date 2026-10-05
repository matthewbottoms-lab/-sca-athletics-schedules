import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";
import makeFetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";

const SOURCES = {
  facilities: {
    label: "Field & Gym Schedule",
    url: "https://scaprep-my.sharepoint.com/:x:/g/personal/mbottoms_scamail_org/IQCs_OUf0OO3Rr4AJ6lO_mEQAY9CV0OnY1NW-INE-MeMuXU?e=iMFVb9"
  },
  transportation: {
    label: "Transportation Schedule",
    url: "https://scaprep-my.sharepoint.com/:x:/g/personal/mbottoms_scamail_org/IQBcqgmx_NFNRIUSNvYdVM-GAfIVzHECeVWoun-_tfZzNuM?e=9Kgi9S"
  }
};

const browserHeaders = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/octet-stream,text/html;q=0.9,*/*;q=0.8",
  "cache-control": "no-cache"
};

function withDownload(urlString) {
  const u = new URL(urlString);
  u.searchParams.set("download", "1");
  return u.toString();
}

function looksLikeZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchWorkbook(sourceUrl) {
  const jar = new CookieJar();
  const cookieFetch = makeFetchCookie(fetch, jar);

  const landing = await cookieFetch(sourceUrl, {
    headers: { ...browserHeaders, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    redirect: "follow"
  });

  const response = await cookieFetch(withDownload(sourceUrl), {
    headers: { ...browserHeaders, referer: landing.url || sourceUrl },
    redirect: "follow"
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!looksLikeZip(buffer)) {
    const type = response.headers.get("content-type") || "unknown content-type";
    const preview = buffer.toString("utf8", 0, Math.min(buffer.length, 500)).replace(/\s+/g, " ");
    throw new Error(`Expected .xlsx but received ${type}. Final URL: ${response.url}. Preview: ${preview.slice(0, 220)}`);
  }
  return { buffer, finalUrl: response.url };
}

function workbookToData(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      defval: "",
      raw: false,
      dateNF: "m/d/yyyy h:mm AM/PM"
    })
  }));
  return { sheetNames: workbook.SheetNames, sheets };
}

function scheduleHtml(label, data, fetchedAt) {
  const sections = data.sheets.map((sheet) => {
    const maxCols = Math.max(0, ...sheet.rows.map((r) => r.length));
    const rows = sheet.rows.map((row) => {
      const cells = Array.from({ length: maxCols }, (_, i) => `<td>${escapeHtml(row[i] ?? "")}</td>`).join("");
      return `<tr>${cells}</tr>`;
    }).join("\n");
    return `<section><h2>${escapeHtml(sheet.name)}</h2><div class="scroll"><table><tbody>${rows}</tbody></table></div></section>`;
  }).join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SCA ${escapeHtml(label)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:24px;line-height:1.35}nav a{margin-right:16px}.scroll{overflow:auto;margin-bottom:28px}table{border-collapse:collapse;font-size:14px;white-space:nowrap}td{border:1px solid #ccc;padding:5px 8px}h1{margin-bottom:6px}.meta{color:#555;font-size:13px}</style></head><body><nav><a href="./">Home</a><a href="./facilities.html">Facilities</a><a href="./transportation.html">Transportation</a></nav><h1>${escapeHtml(label)}</h1><p class="meta">Last refreshed: ${escapeHtml(fetchedAt)} Â· Sheets: ${data.sheetNames.map(escapeHtml).join(", ")}</p>${sections}</body></html>`;
}

function indexHtml(statuses, fetchedAt) {
  const rows = statuses.map((s) => `<li><strong>${escapeHtml(s.label)}:</strong> ${s.ok ? `ready â <a href="./${s.key}.html">view</a> Â· <a href="./${s.key}.json">JSON</a>` : `ERROR â ${escapeHtml(s.error)}`}</li>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SCA Athletics Schedules</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:28px;line-height:1.5;max-width:900px}.meta{color:#555}</style></head><body><h1>SCA Athletics Schedules</h1><p class="meta">Automated mirror refreshed ${escapeHtml(fetchedAt)}.</p><ul>${rows}</ul></body></html>`;
}

const siteDir = path.resolve("_site");
const dataDir = path.resolve("data");

await fs.rm(siteDir, { recursive: true, force: true });
await fs.mkdir(siteDir, { recursive: true });
await fs.mkdir(dataDir, { recursive: true });

const fetchedAt = new Date().toISOString();
const statuses = [];

for (const [key, source] of Object.entries(SOURCES)) {
  try {
    const { buffer, finalUrl } = await fetchWorkbook(source.url);
    const data = workbookToData(buffer);

    const payload = {
      ok: true,
      source: key,
      label: source.label,
      fetchedAt,
      finalUrl,
      sheetNames: data.sheetNames,
      sheets: data.sheets
    };

    const json = JSON.stringify(payload, null, 2);

    // Publish for the existing GitHub Pages mirror.
    await fs.writeFile(path.join(siteDir, `${key}.json`), json);
    await fs.writeFile(path.join(siteDir, `${key}.html`), scheduleHtml(source.label, data, fetchedAt));

    // Also save the latest GOOD copy in the repository for ChatGPT/GitHub access.
    // If a later SharePoint refresh fails, this file is left untouched rather than
    // replacing good schedule data with an error payload.
    await fs.writeFile(path.join(dataDir, `${key}.json`), json);

    statuses.push({
      key,
      label: source.label,
      ok: true,
      fetchedAt,
      sheetNames: data.sheetNames
    });

    console.log(`${key}: fetched ${data.sheets.length} sheet(s)`);
  } catch (error) {
    const message = error?.message || String(error);

    // The public diagnostic site shows the error...
    const errorPayload = {
      ok: false,
      source: key,
      label: source.label,
      fetchedAt,
      error: message
    };
    await fs.writeFile(path.join(siteDir, `${key}.json`), JSON.stringify(errorPayload, null, 2));

    // ...but data/<schedule>.json remains the last known good copy.
    statuses.push({
      key,
      label: source.label,
      ok: false,
      fetchedAt,
      error: message
    });

    console.error(`${key}: ${message}`);
  }
}

const statusPayload = {
  fetchedAt,
  schedules: statuses,
  note: "Schedule JSON files in data/ contain the most recent successful fetch. Check this status file to confirm freshness before relying on them."
};

await fs.writeFile(path.join(siteDir, "index.html"), indexHtml(statuses, fetchedAt));
await fs.writeFile(path.join(siteDir, "status.json"), JSON.stringify(statusPayload, null, 2));
await fs.writeFile(path.join(siteDir, ".nojekyll"), "");

// This one is committed to the repository every run so ChatGPT can tell whether
// the latest refresh succeeded and when it happened.
await fs.writeFile(path.join(dataDir, "status.json"), JSON.stringify(statusPayload, null, 2));
