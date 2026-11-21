# Product Brief: Bulk Invoice Export (CSV) — Implementation Plan

## Goal
Create a one-page product brief that justifies and communicates the bulk invoice export feature for our billing app. The brief must present customer pain, feature value, compliance constraints, and launch targets using supporting data, a direct customer quote, and links to normative standards.

## Scope
- **Deliverable**: A single-page markdown or HTML document, approximately 500–750 words
- **Audience**: Product team, stakeholders, potential implementers
- **Content sources**: Provided notes (demand data, compliance rules, format spec) and customer testimony
- **Format constraints**: One page, quotes Dana (finance lead) directly, links RFC 4180 and Wikipedia reference
- **Success measure**: Brief is complete, accurate, persuasive, and fits on one page without overflow

## Acceptance Criteria
1. Opens with the customer problem and quantified impact (Q3 ticket data: 38% of support requests)
2. Quotes Dana's exact frustration: "I spend two hours every month copying invoices into a spreadsheet"
3. Specifies the solution: bulk export in CSV format, RFC 4180 compliant
4. Links to both RFC 4180 (https://www.rfc-editor.org/rfc/rfc4180) and CSV reference (Wikipedia)
5. Lists the seven data fields: invoice number, date, customer name, net amount, VAT amount, VAT rate, currency
6. Addresses compliance: German tax law (GoBD) requires 10-year retention; feature ensures immutable export
7. States launch target: 500 customers within 90 days
8. Fits on one page when printed or rendered
9. Uses professional tone appropriate for stakeholder communication

## Steps & Contracts

### Step 1 · Document structure and content outline
**Purpose**: Define sections and content blocks before drafting.

**Contract**: Create a content outline (not prose; bullet points of what each section contains):
- **Hook / Problem** (2–3 sentences): Q3 data (38% of tickets), pain point
- **Customer voice** (1–2 sentences): Dana's quote verbatim
- **Solution** (2–3 sentences): CSV export, 7 fields, RFC 4180
- **Compliance & trust** (1–2 sentences): GoBD 10-year rule, immutability guarantee
- **Impact & launch** (1–2 sentences): 500-customer target, timeline
- **Call-to-action / next steps** (1 sentence): Link to roadmap or implementation docs

**Invariants**:
- Dana's quote is exact and in quotation marks
- RFC 4180 link is correct (https://www.rfc-editor.org/rfc/rfc4180)
- All seven fields are listed in the same order as source notes
- GoBD rule is stated accurately (10 years, German tax law)

**Files touched**: Outline lives in scratchpad; not in final output.

---

### Step 2 · Draft the brief text
**Purpose**: Write the one-page content, integrating all required elements.

**Contract**:
- **Input**: Content outline from Step 1, notes.md data, customer quote
- **Output**: One markdown or HTML file (file name: `invoice-export-brief.md` or `.html`)
- **Word count**: 500–750 words (must fit on one printed page, single-spaced, standard margins)
- **Format**: Markdown with clear sections; headings (H2), paragraphs, inline links, bullet lists where needed
- **Links**: 
  - RFC 4180: `[RFC 4180](https://www.rfc-editor.org/rfc/rfc4180)`
  - Wikipedia CSV: `[CSV format guide](https://en.wikipedia.org/wiki/Comma-separated_values)` (or similar)
- **Errors / refusal**: If word count exceeds 1 page print (est. 800 words at 10pt), truncate lowest-priority section (call-to-action first) rather than split to page 2.

**Invariants**:
- Dana's exact quote appears verbatim in quotation marks
- Both links are live and inline (not footnotes)
- All seven CSV fields are enumerated
- GoBD reference appears in brief
- 38% statistic and 90-day target are present and accurate

**Files touched**:
- Create: `work/invoice-export-brief.md` (the final deliverable)

---

### Step 3 · Validate layout and length
**Purpose**: Confirm the brief fits one page and reads well.

**Contract**:
- **Test**: Render the markdown to HTML or print to PDF
- **Check**: 
  - Total rendered length ≤ 1 page (8.5" × 11" or A4, 1" margins, 10–12pt font)
  - All links are clickable and correct
  - Dana's quote is visible and properly attributed
  - All seven fields appear
  - Headings are clear and scannable
- **Failure mode**: If too long, re-draft Step 2 (cut lowest-priority content; e.g., compliance detail → 1 sentence instead of 2)
- **Success**: Brief is complete, one-page, and all acceptance criteria met

**Invariants**:
- If brief exceeds one page, NO new content is added; only cutting is done
- Links remain functional after any edit

---

## Invariants (Across All Steps)

1. **Accuracy**: All data (Q3 ticket %, field list, compliance rule, URL) must match source notes exactly
2. **Customer fidelity**: Dana's quote is never paraphrased; exact text is used
3. **Link integrity**: Both RFC 4180 and CSV reference URLs are correct and live
4. **Length**: Document must fit on one page; never split to page 2
5. **No additions**: Brief uses only the provided notes; no made-up features, timelines, or compliance rules are introduced

## Risks & Edge Cases

| Risk | Mitigation | Handled by |
|------|-----------|-----------|
| Quote is paraphrased instead of quoted verbatim | Store Dana's exact words in outline (Step 1); copy–paste into draft (Step 2); verify in validation (Step 3) | Step 1 invariant check; Step 3 test |
| Links go dead or are malformed | Verify RFC 4180 URL before drafting; test links in rendered output | Step 1 outline; Step 3 validation |
| Brief is too long for one page | Cut content in priority order (call-to-action → compliance detail → examples) before retyping | Step 3 failure mode; re-draft Step 2 |
| Compliance rule is stated incorrectly (10 years, GoBD, German law) | Copy exact phrasing from notes.md; validate against source before submission | Step 1 outline; Step 3 test |
| Field list is incomplete or in wrong order | Enumerate in order from notes.md; verify count = 7 in final brief | Step 1 contract; Step 3 validation |

## Tests

| Test name | Location / type | Red-first expectation | Passes when |
|-----------|-----------------|----------------------|-------------|
| **Link validity** | Manual browser test | Links in raw markdown are placeholder slugs, not live URLs | Both URLs resolve (RFC 4180 and CSV reference) and return 200 OK |
| **Page length** | Rendered PDF or print preview | Brief renders to 2+ pages (too long) | Brief fits entirely on 1 page at 10–12pt font, 1" margins |
| **Dana quote present** | Grep/text search | Exact quote not found in brief | Exact string found: "I spend two hours every month copying invoices into a spreadsheet." |
| **Field enumeration** | Checklist against notes.md | One or more fields missing or misordered | All 7 fields present in correct order: invoice #, date, customer name, net, VAT amount, VAT rate, currency |
| **GoBD compliance rule** | Text search | Rule is absent or stated as "<n> years" with wrong n | Rule states: "10 years under German tax law (GoBD)" or equivalent |
| **Q3 ticket stat** | Text search | Stat is absent or misstated | Brief states or implies: "38% of support tickets in Q3 were export requests" |
| **90-day target** | Text search | Target is absent or wrong | Brief states or implies: "500 customers within 90 days" |

## Success Verification

Run the following checks (no automated suite required; manual):
1. Open the rendered brief (PDF or HTML)
2. Verify it occupies exactly 1 page (no page overflow)
3. Click both links; confirm both resolve and display the expected content
4. Search the brief for all 7 field names; confirm all are present
5. Search for Dana's quote; confirm exact string appears
6. Search for "38%", "90 days", "GoBD", "10 years"; confirm all present
7. Read the brief end-to-end; confirm tone is professional and persuasive

## Handoff

This plan describes how to create `work/invoice-export-brief.md`: a one-page product brief in markdown that integrates customer pain (quote), quantified impact (Q3 data), solution details (CSV fields, RFC 4180), compliance context (GoBD), and launch target (500 customers / 90 days). The implementer will follow Steps 1–3 above, honoring all invariants and passing all listed tests. Once rendered and validated, the brief is ready for stakeholder distribution.

---

## Clarifications (Q&A)

- No clarifications were required; the task was unambiguous.
