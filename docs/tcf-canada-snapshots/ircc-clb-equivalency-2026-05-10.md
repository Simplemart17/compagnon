---
source_url_official: https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/standard-requirements/language-requirements/test-equivalency-charts.html
source_url_transcribed: https://www.settler.ca/english/clb-tcf-nclc-table/
retrieved_at: 2026-05-10T00:00:00Z
retrieved_by: Claude Code agent (WebFetch tool)
sha256: 1e4ac2605067f1e7c47e16583c545b338e4e69cccf46e4a6af21a7f82848e566
---

# IRCC TCF Canada → CLB / NCLC Equivalency Snapshot

**Authoritative source:** Immigration, Refugees and Citizenship Canada (IRCC) — `test-equivalency-charts.html` on canada.ca.

**⚠️ CAVEAT:** WebFetch returned `HTTP 403 Forbidden` for every canada.ca URL during retrieval (anti-bot protection). The table below is **transcribed from a third-party source** (settler.ca) that explicitly cites the canada.ca URL. The third-party page carries this disclaimer:

> "While I have done my best to avoid any mistakes, this table is not the official conversion table."

**Operator action required:** verify the table below against the official IRCC URL by manually opening it in a browser. Update the snapshot if discrepancies are found and re-compute SHA-256.

---

## TCF Canada → CLB / NCLC Equivalency Table

**Scales used by IRCC for TCF Canada (per published documentation):**

- **Listening (Compréhension orale)** and **Reading (Compréhension écrite):** raw TCF score on a **331–699 scale**
- **Writing (Expression écrite)** and **Speaking (Expression orale):** **4–20 scale** (per-criterion sum, not the 0–699 scale)

| CLB / NCLC Level | TCF Reading (CE) | TCF Writing (EE) | TCF Listening (CO) | TCF Speaking (EO) |
| ---------------- | ---------------- | ---------------- | ------------------ | ----------------- |
| 1–3              | < 342            | < 4              | < 331              | < 4               |
| 4                | 342–374          | 4–5              | 331–368            | 4–5               |
| 5                | 375–405          | 6                | 369–397            | 6                 |
| 6                | 406–452          | 7–9              | 398–457            | 7–9               |
| 7                | 453–498          | 10–11            | 458–502            | 10–11             |
| 8                | 499–523          | 12–13            | 503–522            | 12–13             |
| 9                | 524–548          | 14–15            | 523–548            | 14–15             |
| 10–12            | 549–699          | 16–20            | 549–699            | 16–20             |

---

## Critical Observations for the Codebase

1. **TCF Canada has no composite score.** Each of the 4 skills is reported and equivalency-mapped INDEPENDENTLY against CLB. There is no single "overall" TCF Canada number that maps to CLB. This contradicts the codebase's `calculateCompositeScore` ([src/lib/scoring.ts:70-89](src/lib/scoring.ts#L70)) which produces an averaged single TCF score across skills. **Owner: Epic 10.2** (P1-2).

2. **Two scales, not one.** The codebase's [src/lib/scoring.ts:7-35](src/lib/scoring.ts#L7) `rawToTCFScore` produces a 0–699 score from a raw percentage for ALL skills — but the publisher uses 0–699 only for Listening/Reading. Writing and Speaking use 4–20 per the publisher's grading rubric (which the codebase implements as 0–80 sum × 1.25 → 0–100 in the Speaking pipeline; see story 9-8 `speakingTaskEvaluationSchema`). **Owner: Epic 10.2** + **Epic 10.6**.

3. **CLB equivalency thresholds are NOT linear.** Note CLB 6's Listening range is 398–457 (60-point band) while CLB 7's is 458–502 (44-point band). The publisher's bands are empirically anchored, not linearly distributed. The codebase's current 7-band linear interpolation is a poor approximation. **Owner: Epic 10.2** (P1-1).

4. **CLB 7 is the typical Express Entry threshold.** This is the most-asked-about row by users in the IRCC personas (Sofia, Marc per PRD). UI should consider surfacing CLB 7 thresholds visibly.

5. **The codebase's `CEFR_LEVELS.tcfScoreMin/Max` round-number bands** ([src/types/cefr.ts:27-69](src/types/cefr.ts#L27): A1=100-199, A2=200-299, ...) do **not** correspond to CLB bands. CEFR ↔ CLB ↔ TCF are three separate mappings; the codebase conflates CEFR-band-by-round-number with CLB equivalency. **Owner: Epic 10.2** to align.

---

## Re-Verification (Manual)

The IRCC equivalency chart is updated periodically. To re-verify:

1. Open https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/standard-requirements/language-requirements/test-equivalency-charts.html in a browser (WebFetch cannot reach this URL due to anti-bot).
2. Locate the "Test de connaissance du français pour le Canada (TCF Canada)" table.
3. Compare each row to the table above.
4. If any row differs: update this snapshot file, re-compute SHA-256, and file a tech-debt issue tagged with `tcf-spec-drift`.
