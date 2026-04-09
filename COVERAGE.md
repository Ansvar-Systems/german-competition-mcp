# Coverage

This document describes the corpus scope of the German Competition MCP server.

## Authority

**Bundeskartellamt** (German Federal Cartel Office)
- Official site: <https://www.bundeskartellamt.de/>
- Jurisdiction: Federal Germany (Bund)
- Legal basis: Gesetz gegen Wettbewerbsbeschränkungen (GWB)

## Included Categories

| Category | German term | GWB basis |
|---|---|---|
| Abuse of dominance | Marktmissbrauch | §§ 19, 20, 21 GWB |
| Cartel enforcement | Kartellverfolgung | §§ 1, 2 GWB; Art. 101 TFEU |
| Sector inquiries | Sektoruntersuchungen | § 32e GWB |
| Merger control — Phase I | Fusionskontrolle Phase I | §§ 35 ff. GWB |
| Merger control — Phase II | Fusionskontrolle Phase II | § 40 GWB |

## Sectors

The following sectors have enforcement activity indexed:

- `digital_economy` — Digital platforms and data-driven markets
- `energy` — Electricity and gas markets
- `food_retail` — Lebensmitteleinzelhandel and food supply chain
- `automotive` — Automotive manufacturing and components
- `financial_services` — Banking, insurance, and payments
- `healthcare` — Pharmaceutical, medical devices, and hospital markets
- `media` — Press, broadcasting, and streaming
- `telecommunications` — Mobile, fixed-line, and broadband

## Exclusions

The following are **not** covered by this MCP:

- **Landeskartellbehörden** — State-level cartel authorities (separate from Bundeskartellamt)
- **Court appeals** — Beschwerdeverfahren before the OLG Düsseldorf or Bundesgerichtshof (BGH)
- **EU Commission decisions** — DG COMP enforcement actions
- **Private damages litigation** — Cartel damages claims before civil courts

## Data Notes

Data is sourced from publicly available Bundeskartellamt publications. Coverage may be incomplete; the dataset is updated periodically via the ingestion pipeline in `scripts/ingest-bundeskartellamt.ts`.

All responses include a `_meta` block with a disclaimer, copyright notice, source URL, and data note.
