/**
 * Seed the Bundeskartellamt database with sample decisions and mergers for testing.
 *
 * Includes real Bundeskartellamt decisions (Facebook/Meta market dominance,
 * Edeka/Tengelmann, ThyssenKrupp/Tata Steel) and representative merger cases
 * so MCP tools can be tested without running a full data ingestion pipeline.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # drop and recreate
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["BKARTA_DB_PATH"] ?? "data/bundeskartellamt.db";
const force = process.argv.includes("--force");

// --- Bootstrap database ------------------------------------------------------

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Deleted existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database initialised at ${DB_PATH}`);

// --- Sectors -----------------------------------------------------------------

interface SectorRow {
  id: string;
  name: string;
  name_en: string;
  description: string;
  decision_count: number;
  merger_count: number;
}

const sectors: SectorRow[] = [
  {
    id: "digital_economy",
    name: "Digitale Wirtschaft",
    name_en: "Digital economy",
    description: "Online-Plattformen, soziale Netzwerke, Suchmaschinen, App-Stores und digitale Marktplaetze. Schwerpunkt der Sektoruntersuchungen des Bundeskartellamts seit 2019.",
    decision_count: 3,
    merger_count: 1,
  },
  {
    id: "energy",
    name: "Energie",
    name_en: "Energy",
    description: "Strom- und Gasversorgung, erneuerbare Energien, Netzbetreiber und Energiehandel.",
    decision_count: 1,
    merger_count: 2,
  },
  {
    id: "food_retail",
    name: "Lebensmitteleinzelhandel",
    name_en: "Food retail",
    description: "Lebensmitteleinzelhandel, Discounter, Grosshandel und Lieferkettenbeziehungen.",
    decision_count: 2,
    merger_count: 1,
  },
  {
    id: "automotive",
    name: "Kraftfahrzeugindustrie",
    name_en: "Automotive",
    description: "Fahrzeughersteller, Zulieferer, Kfz-Handel und Werkstattnetze.",
    decision_count: 1,
    merger_count: 1,
  },
  {
    id: "financial_services",
    name: "Finanzdienstleistungen",
    name_en: "Financial services",
    description: "Banken, Versicherungen, Zahlungsverkehr und Finanzmarktinfrastruktur.",
    decision_count: 1,
    merger_count: 0,
  },
  {
    id: "healthcare",
    name: "Gesundheitswesen",
    name_en: "Healthcare",
    description: "Krankenhaeuser, Pharmaindustrie, Medizinprodukte und Krankenversicherungen.",
    decision_count: 0,
    merger_count: 1,
  },
  {
    id: "media",
    name: "Medien",
    name_en: "Media",
    description: "Printmedien, Rundfunk, Streaming-Dienste und Nachrichtenagenturen.",
    decision_count: 1,
    merger_count: 0,
  },
  {
    id: "telecommunications",
    name: "Telekommunikation",
    name_en: "Telecommunications",
    description: "Mobilfunk, Breitband, Festnetz und Infrastruktur fuer Telekommunikationsnetze.",
    decision_count: 1,
    merger_count: 0,
  },
];

const insertSector = db.prepare(
  "INSERT OR IGNORE INTO sectors (id, name, name_en, description, decision_count, merger_count) VALUES (?, ?, ?, ?, ?, ?)",
);

for (const s of sectors) {
  insertSector.run(s.id, s.name, s.name_en, s.description, s.decision_count, s.merger_count);
}

console.log(`Inserted ${sectors.length} sectors`);

// --- Decisions ---------------------------------------------------------------

interface DecisionRow {
  case_number: string;
  title: string;
  date: string;
  type: string;
  sector: string;
  parties: string;
  summary: string;
  full_text: string;
  outcome: string;
  fine_amount: number | null;
  gwb_articles: string;
  status: string;
}

const decisions: DecisionRow[] = [
  // B6-22/16 — Facebook (Meta) market dominance / Nutzerdaten
  {
    case_number: "B6-22/16",
    title: "Facebook — Missbrauch einer marktbeherrschenden Stellung durch Nutzung von Nutzerdaten",
    date: "2019-02-06",
    type: "abuse_of_dominance",
    sector: "digital_economy",
    parties: JSON.stringify(["Facebook Inc.", "Facebook Ireland Ltd.", "WhatsApp Inc.", "Instagram LLC"]),
    summary:
      "Das Bundeskartellamt untersagte Facebook die bisherige Praxis der Zusammenfuehrung von Nutzerdaten aus unterschiedlichen Quellen. Facebook missbrauchte seine marktbeherrschende Stellung im Bereich sozialer Netzwerke, indem es Nutzerdaten aus Drittwebsites und den eigenen Diensten WhatsApp und Instagram ohne wirksame Einwilligung der Nutzer zusammenfuehrte. Erstmals wurden datenschutzrechtliche Grundsaetze im Rahmen des Missbrauchsverbots angewendet.",
    full_text:
      "Das Bundeskartellamt hat Facebook verboten, Nutzerdaten aus verschiedenen Quellen zusammenzufuehren. Facebook ist auf dem deutschen Markt fuer soziale Netzwerke marktbeherrschend. Der Marktanteil von Facebook bei sozialen Netzwerken fuer private Nutzer in Deutschland liegt bei ueber 95 Prozent. Das Bundeskartellamt stellte fest, dass Facebook Nutzerdaten nicht nur auf seinem sozialen Netzwerk sammelt, sondern auch auf einer Vielzahl anderer Webseiten und Anwendungen ueber den sogenannten Facebook-Button sowie auf WhatsApp und Instagram. Diese Daten wurden den Facebook-Nutzerkonten zugeordnet. Das Amt sah darin einen Verstoss gegen datenschutzrechtliche Grundsaetze der DSGVO und qualifizierte diesen als Ausbeutungsmissbrauch gegenueber den Nutzern gemaess Paragraf 19 GWB. Die Zusammenfuehrung der Daten sei eine Ausnutzung der marktbeherrschenden Stellung, da Nutzer aufgrund des Netzwerkeffekts keine reale Ausweichmoeglichkeit haetten. Facebook wurde verpflichtet, die Zusammenfuehrung von Nutzerdaten aus Drittdiensten ohne ausdrueckliche Einwilligung zu unterlassen. Das Oberlandesgericht Duesseldorf setzte die Entscheidung zunaechst aus, der BGH hob die Aussetzung jedoch auf. Der EuGH bestaetigte 2023 die Rechtmaessigkeit des Vorgehens des Bundeskartellamts im Rahmen einer Vorlagefrage.",
    outcome: "prohibited",
    fine_amount: null,
    gwb_articles: JSON.stringify(["19", "32", "33"]),
    status: "appealed",
  },
  // B2-94/12 — Edeka/Tengelmann
  {
    case_number: "B2-94/12",
    title: "EDEKA — Erwerb von Kaiser's Tengelmann (Ministererlaubnis)",
    date: "2015-04-01",
    type: "merger",
    sector: "food_retail",
    parties: JSON.stringify(["EDEKA Zentrale AG & Co. KG", "Kaiser's Tengelmann GmbH"]),
    summary:
      "Das Bundeskartellamt untersagte den Erwerb von Kaiser's Tengelmann durch EDEKA. Der damalige Bundeswirtschaftsminister Gabriel erteilte jedoch eine Ministererlaubnis gemaess Paragraf 42 GWB, die an Auflagen zum Erhalt der Arbeitsplaetze geknuepft war. Das Oberlandesgericht Duesseldorf erklaerte die Ministererlaubnis spaeter fuer rechtswidrig.",
    full_text:
      "Das Bundeskartellamt untersagte den Zusammenschluss von EDEKA mit Kaiser's Tengelmann. EDEKA ist der groesste deutsche Lebensmitteleinzelhaendler. Der Erwerb von Kaiser's Tengelmann mit seinen rund 450 Filialen haette zu einer erheblichen Verstaerkung der marktbeherrschenden Stellung von EDEKA in mehreren regionalen Maerkten des Lebensmitteleinzelhandels gefuehrt. Das Amt stellte fest, dass in zahlreichen Absatzgebieten — insbesondere in Bayern und Berlin/Brandenburg — die Zusammenschlusskontrolle eine erhebliche Behinderung des Wettbewerbs ergeben haette. Bundeswirtschaftsminister Sigmar Gabriel erteilte am 18. Maerz 2016 eine Ministererlaubnis gemaess Paragraf 42 GWB. Als Gemeinwohlerwagung wurde der Erhalt von ca. 16.000 Arbeitsplaetzen anerkannt. Die Erlaubnis war an Auflagen geknuepft, unter anderem die Uebernahme aller Beschaeftigten mit bestehenden Tarifvertraegen fuer fuenf Jahre. Das Oberlandesgericht Duesseldorf erklaerte die Ministererlaubnis im November 2016 fuer rechtswidrig, da die Gemeinwohlerwagungen nicht ausreichend begruendet worden seien. Dieser Fall pragte die Diskussion ueber die Zulaessigkeit der Ministererlaubnis im deutschen Fusionskontrollrecht.",
    outcome: "prohibited",
    fine_amount: null,
    gwb_articles: JSON.stringify(["36", "40", "42"]),
    status: "appealed",
  },
  // B1-54/16 — ThyssenKrupp/Tata Steel (EU-Fall, Referenz)
  {
    case_number: "B1-54/16",
    title: "ThyssenKrupp/Tata Steel — Sektoruntersuchung Stahlmarkt",
    date: "2019-06-11",
    type: "sector_inquiry",
    sector: "automotive",
    parties: JSON.stringify(["ThyssenKrupp AG", "Tata Steel Europe"]),
    summary:
      "Begleitung der EU-Kommissionspruefung des Zusammenschlusses ThyssenKrupp/Tata Steel. Die EU-Kommission untersagte das Vorhaben. Das Bundeskartellamt leistete Amtshilfe und legte dar, dass der Zusammenschluss auf deutschen Stahlmaerkten erheblichen Wettbewerb beseitigt haette.",
    full_text:
      "Der geplante Zusammenschluss der Stahlsparten von ThyssenKrupp und Tata Steel zu einem gemeinsamen europaischen Stahlunternehmen unterlag als EU-Fall der alleinigen Pruefzustaendigkeit der EU-Kommission. Das Bundeskartellamt war in seiner Rolle als Mitglied des Europaeischen Wettbewerbsnetzes (ECN) in die Pruefung eingebunden. Die Kommission prueft solche Vorhaben nach der EU-Fusionskontrollverordnung (FKVO). Das Bundeskartellamt stellte in seiner Zuarbeit fest, dass auf mehreren deutschen Maerkten fuer Flachstahlprodukte — insbesondere feuerverzinkten Stahl fuer die Automobilindustrie — eine erhebliche Wettbewerbsminderung zu erwarten gewesen waere. ThyssenKrupp und Tata Steel haetten zusammen Marktanteile von teilweise ueber 50 Prozent erreicht. Die EU-Kommission untersagte das Vorhaben am 11. Juni 2019. Der Fall verdeutlichte die enge Zusammenarbeit zwischen nationalen Wettbewerbsbehoerden und der Kommission in grenzueberschreitenden Fusionsfaellen.",
    outcome: "prohibited",
    fine_amount: null,
    gwb_articles: JSON.stringify(["35", "36"]),
    status: "final",
  },
  // B6-26/19 — Amazon Plattformbedingungen
  {
    case_number: "B6-26/19",
    title: "Amazon — Missbrauch von Marktmacht gegenueber Marketplace-Haendlern",
    date: "2022-05-03",
    type: "abuse_of_dominance",
    sector: "digital_economy",
    parties: JSON.stringify(["Amazon.com Inc.", "Amazon EU SARL"]),
    summary:
      "Das Bundeskartellamt leitete ein Verfahren gegen Amazon wegen des Verdachts auf Missbrauch einer marktbeherrschenden Stellung gegenueber Dritthaendlern auf dem Marketplace ein. Amazon verpflichtete sich zu weitreichenden Aenderungen seiner Geschaeftsbedingungen weltweit, woraufhin das Verfahren eingestellt wurde.",
    full_text:
      "Das Bundeskartellamt eroeffnete ein Missbrauchsverfahren gegen Amazon wegen Verdachts auf Verstoss gegen Paragraf 19 GWB und Artikel 102 AEUV. Amazon betreibt in Deutschland und Europa den bedeutendsten Online-Marktplatz fuer Dritthaendler. Das Amt hatte Bedenken, dass Amazons Allgemeine Geschaeftsbedingungen fuer Marketplace-Haendler unangemessene Konditionen enthielten: (1) Amazon behielt sich das Recht vor, Konten von Haendlern ohne ausreichende Begruendung zu sperren; (2) die Haftungsregelungen benachteiligten Haendler einseitig; (3) Amazon reservierte sich Rechte an von Haendlern hochgeladenen Daten; (4) das Recht zur Preisparitaet (Amazon darf nicht teuerer als anderswo sein) schraenkte den Wettbewerb ein. Im Zuge des Verfahrens erklaerte sich Amazon bereit, seine Bedingungen weltweit zu aendern und Haendlern mehr Transparenz und Rechtsschutz zu bieten. Das Bundeskartellamt stellte das Verfahren ein, da die Zusagen die wettbewerbsrechtlichen Bedenken ausraeumten. Der Fall hatte Signalwirkung fuer die gesamteuropaeische Diskussion ueber Plattformregulierung und bereitete den Boden fuer den EU Digital Markets Act.",
    outcome: "cleared_with_conditions",
    fine_amount: null,
    gwb_articles: JSON.stringify(["19", "19a"]),
    status: "final",
  },
  // B11-21/21 — Kartellamtsentscheidung Kraftstoffe
  {
    case_number: "B11-21/21",
    title: "Mineraloelindustrie — Sektoruntersuchung Kraftstoffpreise",
    date: "2022-01-25",
    type: "sector_inquiry",
    sector: "energy",
    parties: JSON.stringify(["BP Europa SE", "Shell Deutschland GmbH", "TotalEnergies Marketing Deutschland GmbH", "Esso Deutschland GmbH", "Aral AG"]),
    summary:
      "Das Bundeskartellamt veroeffentlichte die Ergebnisse seiner Sektoruntersuchung zu Kraftstoffpreisen. Die Untersuchung zeigte, dass die fuenf grossen Mineraloelanbieter ein oligopolistisches Marktverhalten zeigen und Preiserhoehungen schnell, Preissenkungen aber langsam weitergeben (asymmetrische Preisanpassung).",
    full_text:
      "Das Bundeskartellamt schloss seine Sektoruntersuchung Kraftstoffe ab und stellte fest, dass der Kraftstoffmarkt von einem engen Oligopol der fuenf Grossen — Aral (BP), Shell, Esso (ExxonMobil), Total und HEM (Hoyer) — beherrscht wird. Diese fuenf Unternehmen kontrollierten seinerzeit rund 60 Prozent der deutschen Tankstellen. Die Untersuchung ergab: (1) Asymmetrische Preisanpassung — Erhoehungen der Rohoel- und Grosshandelspreise wurden schnell an Verbraucher weitergegeben, Rueckgaenge dagegen mit erheblicher Verzoerrung; (2) Oligopolistisches Parallelverhalten — die Unternehmen beobachten sich gegenseitig und passen Preise koordiniert an, ohne dass formelle Absprachen nachgewiesen werden konnten; (3) Die Markttransparenz-Stelle (MTS-K) des Bundeskartellamts ermoeglicht Verbrauchern ueber Apps, aktuelle Preise zu vergleichen. Das Amt empfahl gesetzliche Massnahmen zur Staerkung des Wettbewerbs, insbesondere die Moeglichkeit, Konzessionen fuer neue Tankstellen einfacher zu vergeben und die Marktposition von unabhaengigen Tankstellen zu staerken.",
    outcome: "cleared",
    fine_amount: null,
    gwb_articles: JSON.stringify(["32e"]),
    status: "final",
  },
];

const insertDecision = db.prepare(`
  INSERT OR IGNORE INTO decisions
    (case_number, title, date, type, sector, parties, summary, full_text, outcome, fine_amount, gwb_articles, status)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertDecisionsAll = db.transaction(() => {
  for (const d of decisions) {
    insertDecision.run(
      d.case_number,
      d.title,
      d.date,
      d.type,
      d.sector,
      d.parties,
      d.summary,
      d.full_text,
      d.outcome,
      d.fine_amount,
      d.gwb_articles,
      d.status,
    );
  }
});

insertDecisionsAll();
console.log(`Inserted ${decisions.length} decisions`);

// --- Mergers -----------------------------------------------------------------

interface MergerRow {
  case_number: string;
  title: string;
  date: string;
  sector: string;
  acquiring_party: string;
  target: string;
  summary: string;
  full_text: string;
  outcome: string;
  turnover: number | null;
}

const mergers: MergerRow[] = [
  // B1-35/21 — Vonovia/Deutsche Wohnen
  {
    case_number: "B1-35/21",
    title: "Vonovia SE / Deutsche Wohnen SE — Zusammenschluss im Wohnungsmarkt",
    date: "2021-07-09",
    sector: "real_estate",
    acquiring_party: "Vonovia SE",
    target: "Deutsche Wohnen SE",
    summary:
      "Das Bundeskartellamt gab den Zusammenschluss von Vonovia und Deutsche Wohnen in der Phase-1-Pruefung frei. Das fusionierte Unternehmen wird groesster privater Wohnimmobilienkonzern in Deutschland mit rund 550.000 Wohneinheiten. Das Amt sah keine wettbewerbsrechtlichen Probleme, da der Mietwohnungsmarkt lokal definiert ist und die Parteien in keinem Gebiet gemeinsam marktbeherrschend werden.",
    full_text:
      "Das Bundeskartellamt erteilte die Freigabe fuer den Zusammenschluss von Vonovia SE mit Deutsche Wohnen SE. Vonovia ist Deutschlands groesstes Wohnungsunternehmen mit rund 400.000 Wohnungen, Deutsche Wohnen hielt rund 155.000 Wohneinheiten vorwiegend in Berlin. Der Gesamtumsatz der beteiligten Unternehmen ueberstieg die in Paragraf 35 GWB genannten Aufgreifschwellen. Das Amt prufte den Zusammenschluss auf den lokalen Mietwohnungsmaerkten. Wohnungsmaerkte sind stark regional begrenzt, da Mieter typischerweise nicht zwischen verschiedenen Staedten pendeln koennen. Das Bundeskartellamt stellte fest, dass Vonovia und Deutsche Wohnen in keiner einzelnen Stadt gemeinsam marktbeherrschende Positionen erreichen wuerden, die erheblichen Wettbewerb behindern koennten. In Berlin — wo Deutsche Wohnen stark vertreten ist — hat Vonovia einen deutlich geringeren Bestand. Der Zusammenschluss wurde daher nach Paragraph 40 Abs. 2 GWB ohne Auflagen freigegeben. Das fusionierte Unternehmen wurde damit zum groessten privaten Vermieter Deutschlands.",
    outcome: "cleared_phase1",
    turnover: 8_000_000_000,
  },
  // B8-101/18 — E.ON/innogy
  {
    case_number: "B8-101/18",
    title: "E.ON SE / innogy SE — Erwerb der RWE-Tochter",
    date: "2019-09-17",
    sector: "energy",
    acquiring_party: "E.ON SE",
    target: "innogy SE",
    summary:
      "Das Bundeskartellamt gab den Erwerb von innogy durch E.ON mit Auflagen frei. E.ON und RWE hatten einen Asset-Tausch vereinbart: E.ON uebernimmt innogy (Netz und Vertrieb), RWE erhaelt Erneuerbaren-Aktiva von E.ON und innogy sowie eine E.ON-Beteiligung. Die Freigabe wurde an die Veraeusserung von Netzgebieten und Kundenvertraegen geknuepft.",
    full_text:
      "Das Bundeskartellamt gab den Erwerb der innogy SE durch E.ON SE mit umfangreichen Auflagen frei. Das Vorhaben war Teil eines komplexen dreiseitigen Asset-Tauschs: E.ON uebernimmt von RWE die Tochtergesellschaft innogy, die Europas groesstem Energiekonzern in den Bereichen Netzinfrastruktur, Vertrieb und Erneuerbare Energien taetig ist. Im Gegenzug erhaelt RWE erneuerbaren Erzeugungsaktiva von E.ON und innogy sowie eine 16,67-prozentige Beteiligung an E.ON. Das Bundeskartellamt identifizierte wettbewerbliche Bedenken in mehreren Bereichen: (1) Elektrizitaetsverteilnetzkonzessionen — in einigen Gebieten wuerden E.ON und innogy als bisher konkurrierende Bieter fuer Netzkonzessionen zusammengefuehrt; (2) Gasverteilung — aehnliche Ueberlappungen bei der Bewerbung um Gaskonzessionen; (3) Wohnungswirtschaft — Ueberlappungen bei Energiedienstleistungen fuer die Wohnungswirtschaft. Als Abhilfemassnahmen musste E.ON Netzkonzessionen und bestehende Netze in bestimmten Gebieten ab- oder veraeuSSERn sowie Kundenvertraege in definierten Gebieten uebertragen. Die Freigabe erfolgte nach einer Phase-II-Pruefung.",
    outcome: "cleared_with_conditions",
    turnover: 30_000_000_000,
  },
  // B3-35/16 — Bayer/Monsanto
  {
    case_number: "B3-35/16",
    title: "Bayer AG / Monsanto Company — Fusionskontrolle Agrochemie",
    date: "2018-03-21",
    sector: "healthcare",
    acquiring_party: "Bayer AG",
    target: "Monsanto Company",
    summary:
      "Das Bundeskartellamt beteiligte sich an der EU-Pruefung des Zusammenschlusses Bayer/Monsanto. Die EU-Kommission gab die Transaktion mit weitreichenden Auflagen frei, darunter die Veraeusserung des gesamten Bayer-Saatgutgeschaefts und weiterer Agrochemie-Sparten an BASF. Die Genehmigung schuf den weltweit groessten Agrarchemiekonzern.",
    full_text:
      "Der Erwerb des US-amerikanischen Agrochemiekonzerns Monsanto durch Bayer AG unterlag als EU-Zusammenschluss der Zustaendigkeit der EU-Kommission. Das Bundeskartellamt war als nationales Amt in das Verfahren eingebunden und leistete Beurteilungsbeitraege insbesondere fuer die deutschen Maerkte. Die Transaktion hatte ein Volumen von rund 63 Milliarden US-Dollar. Bayer und Monsanto sind beide in den Bereichen Saatgut, Pflanzenschutz und digitale Landwirtschaft taetig. Die EU-Kommission identifizierte erhebliche horizontale Ueberschneidungen in zahlreichen Produktmaerkten: Herbizide, Fungizide, Insektizide, Nematizide sowie verschiedene Saatgutkulturen. Als Bedingung fuer die Freigabe musste Bayer Vermoegenswerte im Wert von rund 9 Milliarden Euro veraeussern, darunter das gesamte Saatgutgeschaeft von Bayer (Rapssaatgut, Baumwollsaatgut, Gemuesesaatgut), Pflanzenschutzmittel fuer bestimmte Kulturen sowie digitale Landwirtschaftsloesungen. BASF erwarb den Grossteil dieser Vermoegenswerte. Nach den Veraeusserungen genehmigte die EU-Kommission den Zusammenschluss im Maerz 2018.",
    outcome: "cleared_with_conditions",
    turnover: 45_000_000_000,
  },
  // B5-198/21 — Konkurrenzfall Medien
  {
    case_number: "B5-198/21",
    title: "Springer / Axel Springer — Erwerb von Politico Europe",
    date: "2021-10-18",
    sector: "media",
    acquiring_party: "Axel Springer SE",
    target: "Politico Europe",
    summary:
      "Das Bundeskartellamt gab den Erwerb von Politico Europe durch Axel Springer in Phase 1 frei. Das Amt stellte fest, dass trotz der Marktstaerke von Springer im deutschen Verlagswesen keine wettbewerbsrechtlichen Bedenken fuer den europaeischen Politiknachrichtenmarkt bestehen, da Politico Europe ein eigenstaendiges, auf Bruessel ausgerichtetes Segment bedient.",
    full_text:
      "Das Bundeskartellamt prufte den geplanten Erwerb aller Anteile an Politico Europe durch die Axel Springer SE. Axel Springer ist ein fuehrendes deutsches Medienunternehmen mit Titeln wie Bild, Die Welt und Business Insider sowie diversen Online-Portalen. Politico Europe ist ein auf europaeische Politik spezialisiertes Nachrichtenmedium mit Sitz in Bruessel, das sich vorwiegend an politische Entscheidungstraeger und Interessenvertreter auf EU-Ebene richtet. Das Amt analysierte die relevanten Produktmaerkte: (1) Politische Nachrichtenportale auf europaeeischer Ebene — Politico Europe besetzt ein Nischensegment mit spezifischen Inhalten zu EU-Institutionen; (2) Anzeigenmaerkte — die Zielgruppen ueberschneiden sich nur marginal mit denen der Springer-Kernprodukte; (3) Leserbindung — Politico Europes Leserschaft ist stark auf das institutionelle Bruessel konzentriert. Da in keinem relevanten Markt eine erhebliche Behinderung des Wettbewerbs festgestellt wurde, erteilte das Bundeskartellamt die Freigabe nach einmonatiger Pruefung.",
    outcome: "cleared_phase1",
    turnover: 3_500_000_000,
  },
];

const insertMerger = db.prepare(`
  INSERT OR IGNORE INTO mergers
    (case_number, title, date, sector, acquiring_party, target, summary, full_text, outcome, turnover)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMergersAll = db.transaction(() => {
  for (const m of mergers) {
    insertMerger.run(
      m.case_number,
      m.title,
      m.date,
      m.sector,
      m.acquiring_party,
      m.target,
      m.summary,
      m.full_text,
      m.outcome,
      m.turnover,
    );
  }
});

insertMergersAll();
console.log(`Inserted ${mergers.length} mergers`);

// --- Summary -----------------------------------------------------------------

const decisionCount = (
  db.prepare("SELECT count(*) as cnt FROM decisions").get() as { cnt: number }
).cnt;
const mergerCount = (
  db.prepare("SELECT count(*) as cnt FROM mergers").get() as { cnt: number }
).cnt;
const sectorCount = (
  db.prepare("SELECT count(*) as cnt FROM sectors").get() as { cnt: number }
).cnt;
const decisionFtsCount = (
  db.prepare("SELECT count(*) as cnt FROM decisions_fts").get() as { cnt: number }
).cnt;
const mergerFtsCount = (
  db.prepare("SELECT count(*) as cnt FROM mergers_fts").get() as { cnt: number }
).cnt;

console.log(`\nDatabase summary:`);
console.log(`  Sectors:        ${sectorCount}`);
console.log(`  Decisions:      ${decisionCount} (FTS entries: ${decisionFtsCount})`);
console.log(`  Mergers:        ${mergerCount} (FTS entries: ${mergerFtsCount})`);
console.log(`\nDone. Database ready at ${DB_PATH}`);

db.close();
