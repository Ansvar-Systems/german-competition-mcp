#!/usr/bin/env npx tsx
/**
 * Ingestion crawler for the Bundeskartellamt (German Federal Cartel Office).
 *
 * Fetches decisions, merger control rulings, and sector inquiry reports from
 * bundeskartellamt.de, extracts metadata and full text via HTML parsing, and
 * writes records into the local SQLite database.
 *
 * The Bundeskartellamt website relies heavily on server-side rendering with
 * CMS-generated URLs (Government Site Builder / GSB). Dynamic JS tables are
 * unreliable for automated access, so this crawler uses curated year-based
 * URL generation and the known SharedDocs URL pattern:
 *
 *   https://www.bundeskartellamt.de/SharedDocs/Entscheidung/DE/{type}/{year}/{id}.html
 *
 * Decision types on the site:
 *   - Kartellverbot        (cartel prohibition)
 *   - Fusionskontrolle     (merger control)
 *   - Missbrauchsaufsicht  (abuse of dominance)
 *   - Vergaberecht         (public procurement)
 *   - Sektoruntersuchung   (sector inquiry)
 *
 * Usage:
 *   npx tsx scripts/ingest-bundeskartellamt.ts
 *   npx tsx scripts/ingest-bundeskartellamt.ts --dry-run      # parse but don't write
 *   npx tsx scripts/ingest-bundeskartellamt.ts --resume        # skip existing case numbers
 *   npx tsx scripts/ingest-bundeskartellamt.ts --force         # overwrite existing records
 *   npx tsx scripts/ingest-bundeskartellamt.ts --year 2023     # single year only
 *   npx tsx scripts/ingest-bundeskartellamt.ts --type Fusionskontrolle
 */

import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_PATH = process.env["BKARTA_DB_PATH"] ?? "data/bundeskartellamt.db";
const BASE_URL = "https://www.bundeskartellamt.de";
const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 3000;
const REQUEST_TIMEOUT_MS = 30_000;

const USER_AGENT =
  "AnsvarBot/1.0 (Bundeskartellamt-Ingestion; +https://ansvar.eu/bot)";

/** Decision type paths on the Bundeskartellamt GSB CMS. */
const DECISION_TYPES = [
  "Kartellverbot",
  "Fusionskontrolle",
  "Missbrauchsaufsicht",
  "Vergaberecht",
  "Sektoruntersuchung",
] as const;

type DecisionType = (typeof DECISION_TYPES)[number];

/** Map CMS type names to our DB type column values. */
const TYPE_MAP: Record<DecisionType, string> = {
  Kartellverbot: "cartel",
  Fusionskontrolle: "merger",
  Missbrauchsaufsicht: "abuse_of_dominance",
  Vergaberecht: "public_procurement",
  Sektoruntersuchung: "sector_inquiry",
};

/** Year range to crawl. BKartA decisions online go back to roughly 2000. */
const YEAR_START = 2000;
const YEAR_END = new Date().getFullYear();

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function getFlagValue(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const DRY_RUN = hasFlag("dry-run");
const RESUME = hasFlag("resume");
const FORCE = hasFlag("force");
const SINGLE_YEAR = getFlagValue("year") ? Number(getFlagValue("year")) : null;
const SINGLE_TYPE = getFlagValue("type") as DecisionType | undefined;

if (SINGLE_TYPE && !DECISION_TYPES.includes(SINGLE_TYPE)) {
  console.error(
    `Unknown type: ${SINGLE_TYPE}. Valid: ${DECISION_TYPES.join(", ")}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

// Prepared statements
const existsDecision = db.prepare(
  "SELECT 1 FROM decisions WHERE case_number = ? LIMIT 1",
);
const existsMerger = db.prepare(
  "SELECT 1 FROM mergers WHERE case_number = ? LIMIT 1",
);

const upsertDecision = db.prepare(`
  INSERT INTO decisions
    (case_number, title, date, type, sector, parties, summary, full_text, outcome, fine_amount, gwb_articles, status)
  VALUES
    (@case_number, @title, @date, @type, @sector, @parties, @summary, @full_text, @outcome, @fine_amount, @gwb_articles, @status)
  ON CONFLICT(case_number) DO UPDATE SET
    title       = excluded.title,
    date        = excluded.date,
    type        = excluded.type,
    sector      = excluded.sector,
    parties     = excluded.parties,
    summary     = excluded.summary,
    full_text   = excluded.full_text,
    outcome     = excluded.outcome,
    fine_amount = excluded.fine_amount,
    gwb_articles= excluded.gwb_articles,
    status      = excluded.status
`);

const insertDecision = db.prepare(`
  INSERT OR IGNORE INTO decisions
    (case_number, title, date, type, sector, parties, summary, full_text, outcome, fine_amount, gwb_articles, status)
  VALUES
    (@case_number, @title, @date, @type, @sector, @parties, @summary, @full_text, @outcome, @fine_amount, @gwb_articles, @status)
`);

const upsertMerger = db.prepare(`
  INSERT INTO mergers
    (case_number, title, date, sector, acquiring_party, target, summary, full_text, outcome, turnover)
  VALUES
    (@case_number, @title, @date, @sector, @acquiring_party, @target, @summary, @full_text, @outcome, @turnover)
  ON CONFLICT(case_number) DO UPDATE SET
    title           = excluded.title,
    date            = excluded.date,
    sector          = excluded.sector,
    acquiring_party = excluded.acquiring_party,
    target          = excluded.target,
    summary         = excluded.summary,
    full_text       = excluded.full_text,
    outcome         = excluded.outcome,
    turnover        = excluded.turnover
`);

const insertMerger = db.prepare(`
  INSERT OR IGNORE INTO mergers
    (case_number, title, date, sector, acquiring_party, target, summary, full_text, outcome, turnover)
  VALUES
    (@case_number, @title, @date, @sector, @acquiring_party, @target, @summary, @full_text, @outcome, @turnover)
`);

const upsertSector = db.prepare(`
  INSERT INTO sectors (id, name, name_en, description, decision_count, merger_count)
  VALUES (@id, @name, @name_en, @description, @decision_count, @merger_count)
  ON CONFLICT(id) DO UPDATE SET
    decision_count = excluded.decision_count,
    merger_count   = excluded.merger_count
`);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES,
): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
        },
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeout);

      if (res.status === 404) {
        return null; // page does not exist — not an error
      }

      if (!res.ok) {
        console.warn(
          `  HTTP ${res.status} for ${url} (attempt ${attempt}/${retries})`,
        );
        if (attempt < retries) {
          await sleep(RETRY_BACKOFF_MS * attempt);
          continue;
        }
        return null;
      }

      return await res.text();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `  Fetch error for ${url}: ${message} (attempt ${attempt}/${retries})`,
      );
      if (attempt < retries) {
        await sleep(RETRY_BACKOFF_MS * attempt);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// URL generation
// ---------------------------------------------------------------------------

/**
 * Generate listing page URLs for the Bundeskartellamt decision search.
 *
 * The GSB CMS exposes decision listing pages per type. The search form posts
 * to a results URL with query parameters. We generate paginated URLs.
 */
function buildSearchUrl(
  type: DecisionType,
  year: number,
  page: number,
): string {
  // The BKartA search uses these GET parameters on the Entscheidungssuche results page:
  //   templateQueryString  — free text
  //   cl2Categories_Typ    — decision type filter
  //   year_dt              — year filter
  //   gtp                  — pagination offset ("{page_id}_{offset}", e.g. "3590138_list%23telemediengesetz_10")
  //
  // Simpler paginated listing URL pattern:
  const offset = page * 10;
  const params = new URLSearchParams({
    cl2Categories_Typ: type,
    year_dt: String(year),
    "gtp": `3590138_list%23anchor_${offset}`,
  });
  return `${BASE_URL}/SiteGlobals/Forms/Suche/Entscheidungssuche_Formular.html?${params.toString()}`;
}

/**
 * Generate direct SharedDocs URLs for known decision ID patterns.
 *
 * BKartA SharedDocs follow:
 *   /SharedDocs/Entscheidung/DE/{Type}/{Year_or_Subdir}/{CaseRef}.html
 *
 * We also try the alternative pattern with case number in the filename.
 */
function buildDecisionUrl(
  type: DecisionType,
  caseRef: string,
): string {
  return `${BASE_URL}/SharedDocs/Entscheidung/DE/${type}/${encodeURIComponent(caseRef)}.html`;
}

// ---------------------------------------------------------------------------
// HTML parsing — listing pages
// ---------------------------------------------------------------------------

interface ListingEntry {
  url: string;
  title: string;
  date: string | null;
  caseNumber: string | null;
}

/**
 * Parse a BKartA search results / listing page and extract decision links.
 *
 * The GSB CMS typically renders results as either:
 *   - <div class="resultList"> with <h3><a href="...">title</a></h3>
 *   - <ul class="searchResultList"> with <li> items
 *   - <table> based listing
 *
 * We handle all three patterns.
 */
function parseListingPage(html: string): ListingEntry[] {
  const $ = cheerio.load(html);
  const entries: ListingEntry[] = [];
  const seen = new Set<string>();

  // Strategy 1: Links inside result list containers
  const resultSelectors = [
    ".resultList h3 a",
    ".searchResultList a",
    "#content a[href*='SharedDocs/Entscheidung']",
    "#content a[href*='SharedDocs/Publikation']",
    "a[href*='/Entscheidung/DE/']",
    ".RichTextList a",
    "#main a[href*='Entscheidung']",
  ];

  for (const selector of resultSelectors) {
    $(selector).each((_i, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().trim();
      if (!href || !title || seen.has(href)) return;
      seen.add(href);

      const fullUrl = href.startsWith("http")
        ? href
        : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;

      // Attempt to extract case number from title (pattern: B{digit}-{digits}/{digits})
      const caseMatch = title.match(/\b(B\d+-\d+\/\d{2,4})\b/);

      // Attempt to extract date from surrounding text
      const parentText = $(el).parent().text();
      const dateMatch = parentText.match(
        /(\d{2})\.(\d{2})\.(\d{4})/,
      );
      const date = dateMatch
        ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
        : null;

      entries.push({
        url: fullUrl,
        title,
        date,
        caseNumber: caseMatch?.[1] ?? null,
      });
    });
  }

  // Strategy 2: Table rows (some BKartA pages list decisions in tables)
  $("table tbody tr, table tr").each((_i, row) => {
    const link = $(row).find("a[href*='Entscheidung'], a[href*='SharedDocs']");
    if (!link.length) return;

    const href = link.attr("href");
    const title = link.text().trim();
    if (!href || !title || seen.has(href)) return;
    seen.add(href);

    const fullUrl = href.startsWith("http")
      ? href
      : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;

    const cells = $(row).find("td");
    let date: string | null = null;
    let caseNumber: string | null = null;

    cells.each((_j, cell) => {
      const text = $(cell).text().trim();
      const dm = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (dm) date = `${dm[3]}-${dm[2]}-${dm[1]}`;
      const cm = text.match(/^(B\d+-\d+\/\d{2,4})$/);
      if (cm) caseNumber = cm[1]!;
    });

    if (!caseNumber) {
      const cm2 = title.match(/\b(B\d+-\d+\/\d{2,4})\b/);
      caseNumber = cm2?.[1] ?? null;
    }

    entries.push({ url: fullUrl, title, date, caseNumber });
  });

  return entries;
}

/**
 * Check if a listing page has a "next" pagination link.
 */
function hasNextPage(html: string): boolean {
  const $ = cheerio.load(html);
  return (
    $("a.forward, a.next, a[title='naechste Seite'], a[title='Vor']").length > 0
  );
}

// ---------------------------------------------------------------------------
// HTML parsing — individual decision pages
// ---------------------------------------------------------------------------

interface ParsedDecision {
  caseNumber: string;
  title: string;
  date: string | null;
  type: string;
  sector: string | null;
  parties: string[];
  summary: string | null;
  fullText: string;
  outcome: string | null;
  fineAmount: number | null;
  gwbArticles: string[];
  status: string;
  pdfUrl: string | null;
  isMerger: boolean;
  acquiringParty: string | null;
  target: string | null;
  turnover: number | null;
}

/**
 * Parse an individual BKartA decision page.
 *
 * GSB pages typically have:
 *   - <h1> or <h2> with case title
 *   - <div class="abstract"> or <div class="einleitung"> with summary
 *   - <div class="text"> or <div class="RichText"> with full text
 *   - Metadata in <dl> / <div class="docInfo"> blocks
 *   - PDF link in <a href="...blob=publicationFile">
 */
function parseDecisionPage(
  html: string,
  url: string,
  typeHint: DecisionType,
): ParsedDecision | null {
  const $ = cheerio.load(html);

  // --- Title ---
  const title =
    $("h1.headline, h1.isFirstInSlot, h1").first().text().trim() ||
    $("h2").first().text().trim() ||
    $("title").text().trim();

  if (!title) {
    console.warn(`  No title found at ${url}, skipping`);
    return null;
  }

  // --- Case number ---
  // Look in metadata blocks, the title, or the URL itself
  let caseNumber: string | null = null;

  // From metadata table
  $("dt, th, .label, .docInfo span").each((_i, el) => {
    const label = $(el).text().trim().toLowerCase();
    if (
      label.includes("aktenzeichen") ||
      label.includes("az.") ||
      label.includes("geschaeftszeichen")
    ) {
      const value =
        $(el).next("dd, td").text().trim() ||
        $(el).parent().find(".value, dd").text().trim();
      const m = value.match(/(B\d+-\d+\/\d{2,4})/);
      if (m) caseNumber = m[1]!;
    }
  });

  // From title
  if (!caseNumber) {
    const m = title.match(/(B\d+-\d+\/\d{2,4})/);
    if (m) caseNumber = m[1]!;
  }

  // From URL path
  if (!caseNumber) {
    const urlMatch = url.match(/(B\d+-\d+(?:_|%2F|\/)\d{2,4})/i);
    if (urlMatch) {
      caseNumber = urlMatch[1]!.replace(/_|%2F/gi, "/");
    }
  }

  // Generate a synthetic case number from URL slug as last resort
  if (!caseNumber) {
    const slugMatch = url.match(/\/([^/]+)\.html/);
    caseNumber = slugMatch
      ? `BKARTA-${slugMatch[1]!.substring(0, 40)}`
      : `BKARTA-${Date.now()}`;
  }

  // --- Date ---
  let date: string | null = null;
  $("dt, th, .label, .docInfo span").each((_i, el) => {
    const label = $(el).text().trim().toLowerCase();
    if (
      label.includes("datum") ||
      label.includes("entscheidungsdatum") ||
      label.includes("date")
    ) {
      const value =
        $(el).next("dd, td").text().trim() ||
        $(el).parent().find(".value, dd").text().trim();
      const dm = value.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (dm) date = `${dm[3]}-${dm[2]}-${dm[1]}`;
    }
  });

  // Fallback: find any German date in first 500 chars of page
  if (!date) {
    const bodyText = $("body").text().substring(0, 500);
    const dm = bodyText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dm) date = `${dm[3]}-${dm[2]}-${dm[1]}`;
  }

  // --- Summary ---
  const summaryEl =
    $(".abstract, .einleitung, .intro, .teaser, .summary").first();
  const summary = summaryEl.text().trim() || null;

  // --- Full text ---
  // Collect from all text content areas
  const textParts: string[] = [];

  const textSelectors = [
    ".text",
    ".RichText",
    ".RichTextModul",
    "#content .body",
    ".article-body",
    "article .content",
    ".main-content",
  ];

  for (const sel of textSelectors) {
    $(sel).each((_i, el) => {
      const t = $(el).text().trim();
      if (t.length > 50) textParts.push(t);
    });
  }

  // Fallback: main content area
  if (textParts.length === 0) {
    const mainText = (
      $("#content, main, article, .content").first().text() || ""
    ).trim();
    if (mainText.length > 100) textParts.push(mainText);
  }

  const fullText = textParts.join("\n\n").trim();
  if (!fullText || fullText.length < 50) {
    console.warn(`  Insufficient text at ${url} (${fullText.length} chars), skipping`);
    return null;
  }

  // --- Parties ---
  const parties: string[] = [];
  $("dt, th, .label").each((_i, el) => {
    const label = $(el).text().trim().toLowerCase();
    if (
      label.includes("beteiligte") ||
      label.includes("unternehmen") ||
      label.includes("parteien") ||
      label.includes("betroffene")
    ) {
      const value =
        $(el).next("dd, td").text().trim() ||
        $(el).parent().find(".value, dd").text().trim();
      if (value) {
        // Split on common delimiters
        const parts = value
          .split(/[,;\/]|\bund\b|\bvs\.?\b/gi)
          .map((p) => p.trim())
          .filter((p) => p.length > 2);
        parties.push(...parts);
      }
    }
  });

  // --- Sector detection ---
  const sector = detectSector(title, fullText);

  // --- Outcome detection ---
  const outcome = detectOutcome(title, fullText, summary);

  // --- GWB articles ---
  const gwbArticles = extractGwbArticles(fullText);

  // --- Fine amount ---
  const fineAmount = extractFineAmount(fullText);

  // --- PDF URL ---
  let pdfUrl: string | null = null;
  const pdfLink = $(
    "a[href*='blob=publicationFile'], a[href$='.pdf'], a[href*='__blob=']",
  ).first();
  if (pdfLink.length) {
    const pdfHref = pdfLink.attr("href")!;
    pdfUrl = pdfHref.startsWith("http")
      ? pdfHref
      : `${BASE_URL}${pdfHref.startsWith("/") ? "" : "/"}${pdfHref}`;
  }

  // --- Merger-specific fields ---
  const isMerger = typeHint === "Fusionskontrolle";
  let acquiringParty: string | null = null;
  let target: string | null = null;
  let turnover: number | null = null;

  if (isMerger) {
    // Try to extract from title: "X / Y" or "X — Erwerb von Y"
    const slashMatch = title.match(/^(.+?)\s*[\/—–-]\s*(.+?)(?:\s*[—–-]|$)/);
    if (slashMatch) {
      acquiringParty = slashMatch[1]!.trim();
      target = slashMatch[2]!.trim();
    } else if (parties.length >= 2) {
      acquiringParty = parties[0]!;
      target = parties[1]!;
    }

    // Try to extract turnover from text
    const turnoverMatch = fullText.match(
      /(?:Umsatz|Gesamtumsatz|Transaktionsvolumen|Volumen)[^.]*?(\d[\d.,]+)\s*(?:Mrd\.?|Milliarden)\s*(?:Euro|EUR|US-Dollar|USD)/i,
    );
    if (turnoverMatch) {
      const raw = turnoverMatch[1]!.replace(/\./g, "").replace(",", ".");
      turnover = parseFloat(raw) * 1_000_000_000;
    } else {
      const millionMatch = fullText.match(
        /(?:Umsatz|Gesamtumsatz|Transaktionsvolumen)[^.]*?(\d[\d.,]+)\s*(?:Mio\.?|Millionen)\s*(?:Euro|EUR)/i,
      );
      if (millionMatch) {
        const raw = millionMatch[1]!.replace(/\./g, "").replace(",", ".");
        turnover = parseFloat(raw) * 1_000_000;
      }
    }
  }

  // --- Status ---
  const status = detectStatus(fullText);

  return {
    caseNumber,
    title: cleanText(title),
    date,
    type: TYPE_MAP[typeHint] ?? typeHint,
    sector,
    parties,
    summary: summary ? cleanText(summary) : null,
    fullText: cleanText(fullText),
    outcome,
    fineAmount,
    gwbArticles,
    status,
    pdfUrl,
    isMerger,
    acquiringParty,
    target,
    turnover,
  };
}

// ---------------------------------------------------------------------------
// Text analysis helpers
// ---------------------------------------------------------------------------

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Map keywords in title/text to sector IDs matching the sectors table. */
function detectSector(title: string, text: string): string | null {
  const combined = `${title} ${text}`.toLowerCase();

  const sectorKeywords: [string, string[]][] = [
    ["digital_economy", ["digital", "plattform", "online", "internet", "app-store", "suchmaschine", "soziale netzwerke", "e-commerce", "marketplace"]],
    ["energy", ["energie", "strom", "gas", "kraftstoff", "mineraloel", "tankstelle", "netzbetreiber", "erneuerbare"]],
    ["food_retail", ["lebensmittel", "einzelhandel", "discounter", "supermarkt", "edeka", "rewe", "aldi", "lidl", "tengelmann"]],
    ["automotive", ["automobil", "fahrzeug", "kfz", "kraftfahrzeug", "zulieferer", "stahl", "automobilindustrie"]],
    ["financial_services", ["bank", "versicherung", "zahlungsverkehr", "finanz", "kreditinstitut", "boerse"]],
    ["healthcare", ["gesundheit", "krankenhaus", "pharma", "medizinprodukt", "arzneimittel", "krankenkasse", "klinik"]],
    ["media", ["medien", "verlag", "rundfunk", "streaming", "nachrichtenagentur", "zeitung", "fernsehen"]],
    ["telecommunications", ["telekommunikation", "mobilfunk", "breitband", "festnetz", "telefon"]],
    ["construction", ["bau", "bauindustrie", "zement", "beton", "immobilien", "wohnungsbau"]],
    ["transport", ["transport", "logistik", "eisenbahn", "luftfahrt", "schifffahrt", "spedition"]],
    ["chemicals", ["chemie", "chemikalien", "kunststoff", "lacke", "farben"]],
    ["agriculture", ["landwirtschaft", "agrar", "saatgut", "pflanzenschutz", "duengemittel"]],
  ];

  for (const [sectorId, keywords] of sectorKeywords) {
    for (const kw of keywords) {
      if (combined.includes(kw)) return sectorId;
    }
  }

  return null;
}

/** Detect outcome from text content. */
function detectOutcome(
  title: string,
  text: string,
  summary: string | null,
): string | null {
  const combined = `${title} ${summary ?? ""} ${text}`.toLowerCase();

  if (combined.includes("untersagt") || combined.includes("verboten"))
    return "prohibited";
  if (
    combined.includes("freigabe mit auflagen") ||
    combined.includes("mit auflagen freigegeben") ||
    combined.includes("unter auflagen") ||
    combined.includes("cleared_with_conditions") ||
    combined.includes("mit bedingungen") ||
    combined.includes("zusagen")
  )
    return "cleared_with_conditions";
  if (
    combined.includes("freigegeben") ||
    combined.includes("freigabe") ||
    combined.includes("keine bedenken") ||
    combined.includes("phase 1") ||
    combined.includes("phase-1")
  )
    return "cleared_phase1";
  if (combined.includes("phase 2") || combined.includes("phase-2") || combined.includes("hauptpruefverfahren"))
    return "cleared_phase2";
  if (
    combined.includes("eingestellt") ||
    combined.includes("verfahren beendet")
  )
    return "closed";
  if (combined.includes("bussgeld") || combined.includes("geldbusse"))
    return "fined";
  if (combined.includes("verpflichtungszusagen"))
    return "commitments_accepted";
  if (combined.includes("sektoruntersuchung") || combined.includes("abschlussbericht"))
    return "report_published";

  return null;
}

/** Extract GWB (Gesetz gegen Wettbewerbsbeschraenkungen) article references. */
function extractGwbArticles(text: string): string[] {
  const articles = new Set<string>();

  // Pattern: § 19 GWB, §§ 1, 2 GWB, Paragraf 36 GWB
  const patterns = [
    /(?:§§?\s*|Paragraf\s+|Paragraph\s+)(\d+[a-z]?)(?:\s*(?:Abs\.\s*\d+)?)?\s*(?:GWB|des?\s+GWB)/gi,
    /(?:§§?\s*)(\d+[a-z]?)(?:\s*,\s*(\d+[a-z]?))*\s*GWB/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      // Capture all numbered groups
      for (let i = 1; i < match.length; i++) {
        const group = match[i];
        if (group) articles.add(group);
      }
    }
  }

  // Also find "Art. 101 AEUV" / "Art. 102 AEUV" style references
  const aeuvPattern = /Art(?:ikel)?\.?\s*(\d+)\s*AEUV/gi;
  let aeuvMatch;
  while ((aeuvMatch = aeuvPattern.exec(text)) !== null) {
    if (aeuvMatch[1]) articles.add(`Art.${aeuvMatch[1]}AEUV`);
  }

  return Array.from(articles).sort();
}

/** Extract fine amounts from German text. */
function extractFineAmount(text: string): number | null {
  // Pattern: "Bussgeld von X Euro/Millionen Euro"
  const patterns = [
    /(?:Bussgeld|Geldbusse|Bußgeld|Geldbuße)[^.]{0,60}?(\d[\d.,]+)\s*(?:Mrd\.?|Milliarden)\s*Euro/i,
    /(?:Bussgeld|Geldbusse|Bußgeld|Geldbuße)[^.]{0,60}?(\d[\d.,]+)\s*(?:Mio\.?|Millionen)\s*Euro/i,
    /(?:Bussgeld|Geldbusse|Bußgeld|Geldbuße)[^.]{0,60}?(\d[\d.,]+)\s*Euro/i,
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) {
      const raw = m[1].replace(/\./g, "").replace(",", ".");
      const val = parseFloat(raw);
      if (pattern.source.includes("Mrd")) return val * 1_000_000_000;
      if (pattern.source.includes("Mio")) return val * 1_000_000;
      return val;
    }
  }

  return null;
}

/** Detect decision status (final, appealed, pending). */
function detectStatus(text: string): string {
  const lower = text.toLowerCase();
  if (
    lower.includes("beschwerde eingelegt") ||
    lower.includes("oberlandesgericht") ||
    lower.includes("bgh") ||
    lower.includes("bundesgerichtshof") ||
    lower.includes("rechtsmittel") ||
    lower.includes("angefochten")
  )
    return "appealed";
  if (
    lower.includes("anhängig") ||
    lower.includes("anhaengig") ||
    lower.includes("laufend") ||
    lower.includes("vorlaueufig")
  )
    return "pending";
  return "final";
}

// ---------------------------------------------------------------------------
// Crawl orchestration
// ---------------------------------------------------------------------------

interface CrawlStats {
  pagesScanned: number;
  decisionsFound: number;
  decisionsInserted: number;
  decisionsUpdated: number;
  decisionsSkipped: number;
  mergersInserted: number;
  mergersUpdated: number;
  mergersSkipped: number;
  errors: number;
}

const stats: CrawlStats = {
  pagesScanned: 0,
  decisionsFound: 0,
  decisionsInserted: 0,
  decisionsUpdated: 0,
  decisionsSkipped: 0,
  mergersInserted: 0,
  mergersUpdated: 0,
  mergersSkipped: 0,
  errors: 0,
};

/**
 * Save a parsed decision to the database.
 */
function saveDecision(parsed: ParsedDecision): void {
  if (DRY_RUN) {
    console.log(
      `  [DRY-RUN] Would save: ${parsed.caseNumber} — ${parsed.title.substring(0, 60)}`,
    );
    return;
  }

  if (parsed.isMerger) {
    const exists = existsMerger.get(parsed.caseNumber);
    if (exists && RESUME) {
      stats.mergersSkipped++;
      return;
    }

    const stmt = FORCE || !exists ? upsertMerger : insertMerger;
    stmt.run({
      case_number: parsed.caseNumber,
      title: parsed.title,
      date: parsed.date,
      sector: parsed.sector,
      acquiring_party: parsed.acquiringParty,
      target: parsed.target,
      summary: parsed.summary,
      full_text: parsed.fullText,
      outcome: parsed.outcome,
      turnover: parsed.turnover,
    });

    if (exists && FORCE) {
      stats.mergersUpdated++;
    } else {
      stats.mergersInserted++;
    }
  } else {
    const exists = existsDecision.get(parsed.caseNumber);
    if (exists && RESUME) {
      stats.decisionsSkipped++;
      return;
    }

    const stmt = FORCE || !exists ? upsertDecision : insertDecision;
    stmt.run({
      case_number: parsed.caseNumber,
      title: parsed.title,
      date: parsed.date,
      type: parsed.type,
      sector: parsed.sector,
      parties: parsed.parties.length > 0 ? JSON.stringify(parsed.parties) : null,
      summary: parsed.summary,
      full_text: parsed.fullText,
      outcome: parsed.outcome,
      fine_amount: parsed.fineAmount,
      gwb_articles:
        parsed.gwbArticles.length > 0
          ? JSON.stringify(parsed.gwbArticles)
          : null,
      status: parsed.status,
    });

    if (exists && FORCE) {
      stats.decisionsUpdated++;
    } else {
      stats.decisionsInserted++;
    }
  }
}

/**
 * Crawl a single decision detail page.
 */
async function crawlDecisionPage(
  url: string,
  typeHint: DecisionType,
  caseNumberHint: string | null,
): Promise<void> {
  // Pre-check: skip if we already have this case number and --resume is set
  if (RESUME && caseNumberHint) {
    const inDecisions = existsDecision.get(caseNumberHint);
    const inMergers = existsMerger.get(caseNumberHint);
    if (inDecisions || inMergers) {
      stats.decisionsSkipped++;
      return;
    }
  }

  await sleep(RATE_LIMIT_MS);
  const html = await fetchWithRetry(url);
  if (!html) {
    stats.errors++;
    return;
  }

  const parsed = parseDecisionPage(html, url, typeHint);
  if (!parsed) {
    stats.errors++;
    return;
  }

  stats.decisionsFound++;
  saveDecision(parsed);

  console.log(
    `  ${DRY_RUN ? "[DRY-RUN] " : ""}${parsed.caseNumber} | ${parsed.date ?? "no-date"} | ${parsed.type} | ${parsed.title.substring(0, 55)}...`,
  );
}

/**
 * Crawl listing pages for a given type and year, following pagination.
 */
async function crawlListingPages(
  type: DecisionType,
  year: number,
): Promise<void> {
  let page = 0;
  const maxPages = 50; // safety cap

  while (page < maxPages) {
    const url = buildSearchUrl(type, year, page);
    await sleep(RATE_LIMIT_MS);

    const html = await fetchWithRetry(url);
    if (!html) break;

    stats.pagesScanned++;
    const entries = parseListingPage(html);

    if (entries.length === 0) break;

    console.log(
      `  ${type}/${year} page ${page}: ${entries.length} entries found`,
    );

    for (const entry of entries) {
      await crawlDecisionPage(entry.url, type, entry.caseNumber);
    }

    if (!hasNextPage(html)) break;
    page++;
  }
}

/**
 * Generate and crawl direct SharedDocs URLs.
 *
 * The BKartA CMS structures decisions under type/year subdirectories.
 * We probe well-known section landing pages to discover links.
 */
async function crawlSectionPages(): Promise<void> {
  // Known section landing pages that list decisions
  const sectionUrls = [
    // Main decision categories
    "/DE/Entscheidungen/Kartellverbot/kartellverbot_node.html",
    "/DE/Entscheidungen/Fusionskontrolle/fusionskontrolle_node.html",
    "/DE/Entscheidungen/Missbrauchsaufsicht/missbrauchsaufsicht_node.html",
    "/DE/Entscheidungen/Vergaberecht/vergaberecht_node.html",
    "/DE/Entscheidungen/Sektoruntersuchungen/sektoruntersuchungen_node.html",
    // Alternative URL patterns
    "/DE/Kartellverbot/kartellverbot_node.html",
    "/DE/Fusionskontrolle/fusionskontrolle_node.html",
    "/DE/Missbrauchsaufsicht/missbrauchsaufsicht_node.html",
    "/DE/Sektoruntersuchungen/sektoruntersuchungen_node.html",
    // Fallback listing pages
    "/DE/Entscheidungen/entscheidungen_node.html",
  ];

  for (const path of sectionUrls) {
    const url = `${BASE_URL}${path}`;
    console.log(`Scanning section: ${path}`);

    await sleep(RATE_LIMIT_MS);
    const html = await fetchWithRetry(url);
    if (!html) {
      console.log(`  Not available, skipping`);
      continue;
    }

    stats.pagesScanned++;
    const entries = parseListingPage(html);
    console.log(`  Found ${entries.length} decision links`);

    // Determine type from URL path
    let typeHint: DecisionType = "Missbrauchsaufsicht";
    if (path.toLowerCase().includes("kartellverbot")) typeHint = "Kartellverbot";
    else if (path.toLowerCase().includes("fusionskontrolle"))
      typeHint = "Fusionskontrolle";
    else if (path.toLowerCase().includes("vergabe")) typeHint = "Vergaberecht";
    else if (path.toLowerCase().includes("sektor"))
      typeHint = "Sektoruntersuchung";

    for (const entry of entries) {
      await crawlDecisionPage(entry.url, typeHint, entry.caseNumber);
    }
  }
}

/**
 * Crawl the publications / press releases page for additional decisions.
 *
 * BKartA publishes decisions as SharedDocs/Publikation or via press releases
 * that link to decision documents.
 */
async function crawlPublicationsPage(): Promise<void> {
  // The BKartA has a publications search with case decisions linked
  const pubUrls = [
    "/SharedDocs/Publikation/DE/Berichte/berichte_node.html",
    "/DE/Presse/presse_node.html",
  ];

  for (const path of pubUrls) {
    const url = `${BASE_URL}${path}`;
    console.log(`Scanning publications: ${path}`);

    await sleep(RATE_LIMIT_MS);
    const html = await fetchWithRetry(url);
    if (!html) {
      console.log(`  Not available, skipping`);
      continue;
    }

    stats.pagesScanned++;
    const entries = parseListingPage(html);
    console.log(`  Found ${entries.length} links`);

    for (const entry of entries) {
      // Only follow links that look like decisions
      if (
        entry.url.includes("Entscheidung") ||
        entry.url.includes("SharedDocs")
      ) {
        await crawlDecisionPage(
          entry.url,
          "Missbrauchsaufsicht",
          entry.caseNumber,
        );
      }
    }
  }
}

/**
 * Update sector statistics based on current DB contents.
 */
function updateSectorStats(): void {
  if (DRY_RUN) return;

  // Gather distinct sectors from decisions and mergers
  const decisionSectors = db
    .prepare(
      "SELECT sector, COUNT(*) as cnt FROM decisions WHERE sector IS NOT NULL GROUP BY sector",
    )
    .all() as { sector: string; cnt: number }[];

  const mergerSectors = db
    .prepare(
      "SELECT sector, COUNT(*) as cnt FROM mergers WHERE sector IS NOT NULL GROUP BY sector",
    )
    .all() as { sector: string; cnt: number }[];

  const sectorMap = new Map<string, { decisions: number; mergers: number }>();

  for (const row of decisionSectors) {
    const existing = sectorMap.get(row.sector) ?? { decisions: 0, mergers: 0 };
    existing.decisions = row.cnt;
    sectorMap.set(row.sector, existing);
  }

  for (const row of mergerSectors) {
    const existing = sectorMap.get(row.sector) ?? { decisions: 0, mergers: 0 };
    existing.mergers = row.cnt;
    sectorMap.set(row.sector, existing);
  }

  // Sector name mapping for display
  const sectorNames: Record<string, { de: string; en: string }> = {
    digital_economy: { de: "Digitale Wirtschaft", en: "Digital economy" },
    energy: { de: "Energie", en: "Energy" },
    food_retail: { de: "Lebensmitteleinzelhandel", en: "Food retail" },
    automotive: { de: "Kraftfahrzeugindustrie", en: "Automotive" },
    financial_services: { de: "Finanzdienstleistungen", en: "Financial services" },
    healthcare: { de: "Gesundheitswesen", en: "Healthcare" },
    media: { de: "Medien", en: "Media" },
    telecommunications: { de: "Telekommunikation", en: "Telecommunications" },
    construction: { de: "Bauwirtschaft", en: "Construction" },
    transport: { de: "Transport und Logistik", en: "Transport and logistics" },
    chemicals: { de: "Chemische Industrie", en: "Chemicals" },
    agriculture: { de: "Landwirtschaft und Agrochemie", en: "Agriculture" },
  };

  for (const [sectorId, counts] of sectorMap.entries()) {
    const names = sectorNames[sectorId] ?? {
      de: sectorId.replace(/_/g, " "),
      en: sectorId.replace(/_/g, " "),
    };
    upsertSector.run({
      id: sectorId,
      name: names.de,
      name_en: names.en,
      description: null,
      decision_count: counts.decisions,
      merger_count: counts.mergers,
    });
  }

  console.log(`Updated ${sectorMap.size} sector statistics`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Bundeskartellamt Ingestion Crawler ===");
  console.log(`Database: ${DB_PATH}`);
  console.log(
    `Flags: ${DRY_RUN ? "--dry-run " : ""}${RESUME ? "--resume " : ""}${FORCE ? "--force " : ""}${SINGLE_YEAR ? `--year ${SINGLE_YEAR} ` : ""}${SINGLE_TYPE ? `--type ${SINGLE_TYPE} ` : ""}`,
  );
  console.log();

  const startTime = Date.now();
  const types = SINGLE_TYPE ? [SINGLE_TYPE] : [...DECISION_TYPES];
  const yearStart = SINGLE_YEAR ?? YEAR_START;
  const yearEnd = SINGLE_YEAR ?? YEAR_END;

  // Phase 1: Crawl section landing pages (most reliable for link discovery)
  console.log("--- Phase 1: Section landing pages ---");
  await crawlSectionPages();

  // Phase 2: Crawl search form results by type and year
  console.log("\n--- Phase 2: Search form results (type x year) ---");
  for (const type of types) {
    for (let year = yearEnd; year >= yearStart; year--) {
      console.log(`\nCrawling ${type} / ${year}:`);
      await crawlListingPages(type, year);
    }
  }

  // Phase 3: Scan publications / press releases for additional decisions
  console.log("\n--- Phase 3: Publications and press releases ---");
  await crawlPublicationsPage();

  // Phase 4: Update sector statistics
  console.log("\n--- Phase 4: Updating sector statistics ---");
  updateSectorStats();

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== Ingestion Complete ===");
  console.log(`Duration:           ${elapsed}s`);
  console.log(`Pages scanned:      ${stats.pagesScanned}`);
  console.log(`Decisions found:    ${stats.decisionsFound}`);
  console.log(`Decisions inserted: ${stats.decisionsInserted}`);
  console.log(`Decisions updated:  ${stats.decisionsUpdated}`);
  console.log(`Decisions skipped:  ${stats.decisionsSkipped}`);
  console.log(`Mergers inserted:   ${stats.mergersInserted}`);
  console.log(`Mergers updated:    ${stats.mergersUpdated}`);
  console.log(`Mergers skipped:    ${stats.mergersSkipped}`);
  console.log(`Errors:             ${stats.errors}`);

  if (!DRY_RUN) {
    const totalDecisions = (
      db.prepare("SELECT count(*) as cnt FROM decisions").get() as {
        cnt: number;
      }
    ).cnt;
    const totalMergers = (
      db.prepare("SELECT count(*) as cnt FROM mergers").get() as {
        cnt: number;
      }
    ).cnt;
    const totalSectors = (
      db.prepare("SELECT count(*) as cnt FROM sectors").get() as {
        cnt: number;
      }
    ).cnt;
    console.log(`\nDatabase totals:`);
    console.log(`  Decisions: ${totalDecisions}`);
    console.log(`  Mergers:   ${totalMergers}`);
    console.log(`  Sectors:   ${totalSectors}`);
  }

  db.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  db.close();
  process.exit(1);
});
