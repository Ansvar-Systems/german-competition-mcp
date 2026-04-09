# Tools Reference

All tools use the prefix `de_comp_`. Tool responses include a `_meta` block on every response and a `_citation` block on single-record retrieval responses.

---

## de_comp_search_decisions

Full-text search across Bundeskartellamt enforcement decisions (abuse of dominance, cartel, sector inquiries).

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search query (e.g., `Marktmissbrauch`, `Facebook Nutzerdaten`, `Preisabsprache`) |
| `type` | enum | no | Filter by decision type: `abuse_of_dominance`, `cartel`, `merger`, `sector_inquiry` |
| `sector` | string | no | Filter by sector ID (e.g., `digital_economy`, `energy`, `food_retail`) |
| `outcome` | enum | no | Filter by outcome: `prohibited`, `cleared`, `cleared_with_conditions`, `fine` |
| `limit` | number | no | Maximum results to return (default 20, max 100) |

**Returns** `{ results: Decision[], count: number, _meta: Meta }`

---

## de_comp_get_decision

Retrieve a specific Bundeskartellamt enforcement decision by case number.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `case_number` | string | yes | Bundeskartellamt case number (e.g., `B6-22/16`, `B2-94/12`) |

**Returns** `Decision & { _citation: CitationMetadata, _meta: Meta }`

---

## de_comp_search_mergers

Search Bundeskartellamt merger control decisions (Fusionskontrolle).

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search query (e.g., `Vonovia Deutsche Wohnen`, `Energieversorgung`) |
| `sector` | string | no | Filter by sector ID |
| `outcome` | enum | no | Filter by outcome: `cleared`, `cleared_phase1`, `cleared_with_conditions`, `prohibited` |
| `limit` | number | no | Maximum results to return (default 20, max 100) |

**Returns** `{ results: Merger[], count: number, _meta: Meta }`

---

## de_comp_get_merger

Retrieve a specific merger control decision by case number.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `case_number` | string | yes | Merger case number (e.g., `B1-35/21`, `B8-101/18`) |

**Returns** `Merger & { _citation: CitationMetadata, _meta: Meta }`

---

## de_comp_list_sectors

List all sectors with Bundeskartellamt enforcement activity, including decision and merger counts.

**Parameters** — none

**Returns** `{ sectors: Sector[], count: number, _meta: Meta }`

---

## de_comp_about

Return metadata about this MCP server: version, data source, coverage summary, and tool list.

**Parameters** — none

**Returns** `{ name, version, description, data_source, coverage, tools, _meta: Meta }`

---

## de_comp_list_sources

List the primary data sources used by this MCP, including authority name, official URL, coverage notes, and exclusions.

**Parameters** — none

**Returns** `{ sources: Source[], _meta: Meta }`

---

## de_comp_check_data_freshness

Check the freshness of the underlying data: latest decision/merger dates, record counts per table, and the check timestamp.

**Parameters** — none

**Returns** `{ decisions_latest_date, mergers_latest_date, decisions_count, mergers_count, sectors_count, checked_at, _meta: Meta }`

---

## Shared response blocks

### `_meta` block

Present on **every** tool response.

```json
{
  "_meta": {
    "disclaimer": "This data is sourced from publicly available Bundeskartellamt publications...",
    "copyright": "© Bundeskartellamt. Data reproduced for research and informational purposes.",
    "source_url": "https://www.bundeskartellamt.de/",
    "data_note": "Covers enforcement decisions ... Excludes Landeskartellbehörden, court appeals, and EU Commission decisions."
  }
}
```

### `_citation` block

Present on **single-record retrieval** responses (`de_comp_get_decision`, `de_comp_get_merger`).

```json
{
  "_citation": {
    "canonical_ref": "B6-22/16",
    "display_text": "B6-22/16 – Facebook / Nutzerdaten",
    "source_url": "https://www.bundeskartellamt.de/...",
    "lookup": {
      "tool": "de_comp_get_decision",
      "args": { "case_number": "B6-22/16" }
    }
  }
}
```
