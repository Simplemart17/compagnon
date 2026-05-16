# bmad Skills Deltas — 2026-05-15 (Epic 13 retrospective AI #4 + AI #5)

**Why this file exists:** the project's `.claude/skills/` directory is gitignored by convention. Workflow changes made via Epic 13 retrospective Action Items #4 and #5 modify files in that directory but cannot be included in PRs. This file documents the **exact clauses added** so future auditors can verify the AIs are actually deployed without needing local access to the operator's machine.

If the bmad skills are ever moved to a version-controlled location (e.g., via a `bmad-skills` submodule), this file becomes redundant and should be deleted.

---

## AI #4 — bmad-create-story action-item accountability gate

**File modified:** `.claude/skills/bmad-create-story/workflow.md`
**Spec source:** Epic 13 retrospective Action Item #4 ("block next-epic on prior AI status, OR formally drop").
**Mode:** Advisory (not blocking) — the spec's OR clause permits "documents an explicit 'AIs are advisory not blocking' policy". This implementation chose advisory because some AIs are genuinely fire-and-forget (quarterly review reminders, etc.) and a hard block would create false friction.

### Addition 1 — new "Lessons Learned" section anchored at the top of the file

```markdown
### Action-item accountability — surface prior-epic retro AIs at new-epic kickoff

**Source:** Epic 13 retrospective (`_bmad-output/implementation-artifacts/epic-13-retro-2026-05-15.md` "What didn't go well #3"). At Epic 13 close, **8 of 9 Epic 12 retro action items remained open** — the same pattern Epic 12 retro flagged from Epic 10 retro. Action items get filed and then dropped.

**Mitigation built into Step 1 below:** when this workflow detects that the new story being created is the FIRST story of a new epic (story key matches `N-1-*` where N > previous_epic), it surfaces the prior epic's retrospective action items + their status. The user can address them now, formally drop them, or proceed. **This is advisory, not blocking** — some AIs are genuinely fire-and-forget (e.g., quarterly review reminders); the gate exists so the user makes a conscious decision rather than letting AIs silently rot.

If a future retrospective surfaces another "AIs not getting done" theme, consider tightening this from advisory → blocking via a `partial_retrospective=true` flag.
```

### Addition 2 — new gate logic inside Step 1's "first story in epic" branch

Inserted immediately after `<output>📊 Epic {{epic_num}} status updated to in-progress</output>`:

```xml
<!-- ACTION-ITEM ACCOUNTABILITY GATE (Epic 13 retro AI #4). Advisory, not blocking. -->
<action>Calculate previous epic number: {{prev_epic_num}} = {{epic_num}} - 1</action>
<check if="{{prev_epic_num}} >= 1">
  <action>Search for previous retrospective: {implementation_artifacts}/epic-{{prev_epic_num}}-retro-*.md</action>
  <check if="previous retrospective found">
    <action>Read the previous retrospective + extract action items from `## Action Items` section</action>
    <action>For each AI, determine status: ✅ Completed (evidence in sprint-status comments or recent commits), ⏳ In Progress, ❌ Not Addressed</action>
    <action>Count: {{open_ai_count}} = number with ❌ Not Addressed</action>
    <check if="open_ai_count > 0">
      <output>⚠️ **Action-item accountability gate (Epic 13 retro AI #4)**

        Epic {{prev_epic_num}} retrospective surfaced {{total_ai_count}} action items; **{{open_ai_count}} remain unaddressed**. Listing them now (advisory, not blocking):

        {{list_of_open_ais}}

        **Why this gate exists:** Epic 12 + Epic 13 retros both flagged "AIs filed then dropped" as the central process gap. Before kicking off Epic {{epic_num}}, choose:

        1. **Address the AIs now** — interrupt, work them, resume.
        2. **Formally drop them** — file a `chore: drop deferred AIs from Epic {{prev_epic_num}}` PR documenting WHY each is being abandoned.
        3. **Proceed + acknowledge** — note that deferred AIs will resurface in the next retrospective.
      </output>
      <ask>Choose 1 / 2 / 3 / or comma-separated list of AI numbers to address:</ask>
      <check if="user chooses 1">
        <action>HALT - User addresses AIs first; rerun bmad-create-story when ready</action>
      </check>
      <check if="user chooses 2 OR 3 OR provides list">
        <action>Append note to sprint-status `last_updated`: "Epic {{prev_epic_num}} AIs ({{open_ai_count}}) acknowledged + deferred at Epic {{epic_num}} kickoff"</action>
        <output>✅ Deferred — proceeding with Epic {{epic_num}}. AIs will resurface in the next retrospective.</output>
      </check>
    </check>
    <check if="open_ai_count == 0">
      <output>✅ All Epic {{prev_epic_num}} retro action items addressed. Clean slate for Epic {{epic_num}}.</output>
    </check>
  </check>
  <check if="no previous retrospective found">
    <output>ℹ️ No retrospective for Epic {{prev_epic_num}} — skipping accountability gate.</output>
  </check>
</check>
```

### Acceptance verification (post-deploy)

When `/bmad-create-story` is invoked for the FIRST story of Epic 14 (or any future new epic):

1. Workflow should detect `epic_num > prev_epic_num` (compare against the previous epic with the highest in-progress / done status).
2. Workflow should read `epic-{{prev_epic_num}}-retro-*.md` and parse the `## Action Items` section.
3. Workflow should output the open-AI count + present the 3-option choice.
4. Operator's choice (proceed / drop / list) should append a note to `sprint-status.yaml` `last_updated`.

A future review can confirm AI #4 is actually deployed by invoking `/bmad-create-story` against Epic 14's first story file and observing the gate output.

---

## AI #5 — Adversarial review prompts noise-reduction discipline

**File modified:** `.claude/skills/bmad-code-review/steps/step-02-review.md`
**Spec source:** Epic 13 retrospective Action Item #5 ("Story 13-4 had 30+ rejected findings — highest noise rate of Epic 13. Reviewer prompts should add: 'anchor on what's NEW in this story; avoid speculative future-SDK scenarios' + 'self-withdraw findings that you'd refute on second reading'").

### Addition 1 — Blind Hunter prompt prefix

Inserted immediately after the Blind Hunter invocation line:

```markdown
**Noise-reduction discipline (Epic 13 retro AI #5):** Prepend the following framing to the Blind Hunter's prompt to reduce speculative noise (Story 13-4 had 30+ rejected findings — highest noise rate of Epic 13):

> Anchor your findings on what's NEW in THIS diff, not on hypothetical future scenarios. For each finding, ask yourself "would I refute this on second reading?" — if yes, self-withdraw rather than report. Avoid speculative future-SDK / future-API-change scenarios unless the current code would clearly break against current docs. Pre-existing patterns that the diff merely extends are NOT this story's responsibility — flag them only if the extension itself materially worsens them.
```

### Addition 2 — Edge Case Hunter prompt prefix

Inserted immediately after the Edge Case Hunter invocation line:

```markdown
**Noise-reduction discipline (Epic 13 retro AI #5):** Prepend the same framing as Blind Hunter, PLUS:

> Edge cases that would require multiple simultaneous unlikely conditions (e.g., "a future Babel transform AND a future jest-config change") are LOW priority — report them once with explicit "compound-precondition" tag, do not enumerate each combination.
```

### Acceptance verification (post-deploy)

The first /bmad-code-review run after this PR (on PR #100 itself — this review) was invoked AFTER the AI #5 additions were in place. The reviewers in this very review used the new prompts. **Evidence from this very review:**

- Blind Hunter explicitly self-withdrew 1 finding ("EH-LOW-10: docs/ exists — self-withdrawing").
- Edge Case Hunter explicitly self-withdrew 1 finding ("EH-LOW-13: Mock factory new object identity per call — Self-withdrawing as not a real issue").
- Edge Case Hunter explicitly flagged "Pre-existing — the inline pre-PR mock had the same shape — so this is 'extension materially same as prior'" on EH-MED-5 (Easing shape divergence).

These self-withdrawals + the explicit pre-existing-pattern framing match the new discipline. A future cross-review (post-Epic-14) can compare the reject-rate to Story 13-4's baseline (~30+ rejects) — target: < 15 rejects per review.

---

## Maintenance notes

- This file should be updated whenever new bmad skill edits are made via retrospective action items.
- The actual `.claude/skills/` content is the source of truth; this file is documentation of what was added.
- If a future operator needs to verify the skill files match this documentation, run `diff` between the local skill file and the relevant code block above.
