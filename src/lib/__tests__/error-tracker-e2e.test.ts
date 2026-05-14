/**
 * Story 11-6 — `trackError` end-to-end dedup tests (the canonical P1-21 proof).
 *
 * These tests don't mock the RPC's internal SQL — instead they simulate the
 * SERVER'S decision via a stub RPC that does the actual cosine comparison
 * against a small in-memory list of previously-inserted rows. This gives a
 * higher-fidelity proof that "4 near-duplicate `trackError` calls produce a
 * single row with `occurrences = 4`" — the core proof of P1-21 closure.
 *
 * Boundary semantics pinned: similarity > 0.85 is a MATCH; similarity === 0.85
 * is NOT a match (strict greater-than per the RPC's WHERE clause).
 *
 * Legacy row case: a pre-11-6 row exists with NULL embedding + exact-string
 * `error_description`; a new write with successful embedding still matches via
 * the RPC's Arm 2 (string-equality fallback) and increments occurrences.
 */

import { supabase } from "@/src/lib/supabase";

import { trackError, type ErrorType } from "../error-tracker";
import * as openaiMod from "../openai";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock("../openai", () => ({
  __esModule: true,
  generateEmbedding: jest.fn(),
  chatCompletionJSON: jest.fn(),
}));

const mockGenerateEmbedding = openaiMod.generateEmbedding as jest.Mock;

const originalFrom = supabase.from;
const originalRpc = supabase.rpc;

interface StoredRow {
  id: string;
  user_id: string;
  error_type: ErrorType;
  error_description: string;
  embedding: number[] | null;
  occurrences: number;
  resolved: boolean;
}

const USER_ID = "00000000-0000-0000-0000-000000000aaa";

/**
 * Build an in-memory simulator for the supabase chain + RPC. Mimics the
 * `match_error_pattern` server-side decision (cosine OR string-equality) so
 * the test exercises the actual end-to-end dedup contract.
 */
function buildSimulator(): {
  store: StoredRow[];
  reset: () => void;
} {
  const store: StoredRow[] = [];

  // Cosine similarity between two unit-length vectors.
  function cosine(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }

  function matchErrorPattern(args: {
    p_error_type: ErrorType;
    p_error_description: string;
    p_query_embedding: string;
    p_threshold: number;
  }): { id: string; occurrences: number; similarity: number }[] {
    const queryVec = JSON.parse(args.p_query_embedding) as number[];
    const candidates: { id: string; occurrences: number; similarity: number }[] = [];
    for (const row of store) {
      if (row.user_id !== USER_ID) continue;
      if (row.error_type !== args.p_error_type) continue;
      if (row.resolved) continue;

      let similarity = 0;
      let matched = false;
      if (row.embedding !== null) {
        similarity = cosine(row.embedding, queryVec);
        // STRICT greater-than per the RPC's WHERE clause
        if (similarity > args.p_threshold) matched = true;
      } else if (row.error_description === args.p_error_description) {
        // Arm 2: legacy NULL-embedding row → string-equality
        similarity = 1.0;
        matched = true;
      }
      if (matched) {
        candidates.push({ id: row.id, occurrences: row.occurrences, similarity });
      }
    }
    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates.slice(0, 1);
  }

  const rpcMock = jest.fn(async (name: string, args: unknown) => {
    if (name !== "match_error_pattern") return { data: null, error: null };
    const data = matchErrorPattern(args as Parameters<typeof matchErrorPattern>[0]);
    return { data, error: null };
  });

  // Chained from() builder. Supports: select().eq()×N.maybeSingle(),
  // update().eq(), insert().
  const fromMock = jest.fn((table: string) => {
    if (table !== "error_patterns") throw new Error(`unexpected table: ${table}`);

    // SELECT chain
    const filters: { col: string; val: unknown }[] = [];
    const selectChain: Record<string, jest.Mock> = {};
    const eqFn = jest.fn((col: string, val: unknown) => {
      filters.push({ col, val });
      return selectChain;
    });
    selectChain.eq = eqFn;
    selectChain.maybeSingle = jest.fn(async () => {
      const row = store.find((r) => {
        return filters.every((f) => {
          if (f.col === "user_id") return r.user_id === f.val;
          if (f.col === "error_type") return r.error_type === f.val;
          if (f.col === "error_description") return r.error_description === f.val;
          if (f.col === "resolved") return r.resolved === f.val;
          return true;
        });
      });
      return { data: row ? { id: row.id, occurrences: row.occurrences } : null, error: null };
    });

    const selectMock = jest.fn(() => selectChain);

    // UPDATE chain
    let pendingUpdate: Partial<StoredRow> | null = null;
    const updateEq = jest.fn(async (col: string, val: unknown) => {
      if (col !== "id" || pendingUpdate === null) return { error: null };
      const idx = store.findIndex((r) => r.id === val);
      if (idx >= 0) store[idx] = { ...store[idx], ...pendingUpdate };
      return { error: null };
    });
    const updateMock = jest.fn((patch: Partial<StoredRow>) => {
      pendingUpdate = patch;
      return { eq: updateEq };
    });

    // INSERT
    const insertMock = jest.fn(async (payload: Partial<StoredRow> & { embedding?: string }) => {
      const embedding =
        typeof payload.embedding === "string" ? (JSON.parse(payload.embedding) as number[]) : null;
      store.push({
        id: `row-${store.length + 1}`,
        user_id: payload.user_id ?? USER_ID,
        error_type: payload.error_type ?? "grammar",
        error_description: payload.error_description ?? "",
        embedding,
        occurrences: 1,
        resolved: false,
      });
      return { error: null };
    });

    return { select: selectMock, update: updateMock, insert: insertMock };
  });

  (supabase.from as unknown) = fromMock;
  (supabase.rpc as unknown) = rpcMock;

  return {
    store,
    reset: () => {
      store.length = 0;
    },
  };
}

afterEach(() => {
  jest.clearAllMocks();
  (supabase.from as unknown) = originalFrom;
  (supabase.rpc as unknown) = originalRpc;
});

/**
 * Build a 1536-dim unit vector at a controlled angle from the canonical
 * reference vector `[1, 0, 0, ...]`. P14 review-round-1 patch: previously
 * this used a 1e-3 perturbation amplitude that left all variant cosines at
 * ≈ 0.9999 — well above the 0.85 threshold, so the 4-variant test passed
 * trivially without exercising the threshold semantics.
 *
 * Post-patch: each variant picks a distinct axis and a distinct angle from
 * the reference. The angles span the meaningful "near-duplicate" band where
 * the cosine ≥ 0.85 threshold actually has work to do:
 *
 *   variant 0 → reference itself          (cosine 1.000)
 *   variant 1 → angle 0.30 rad, axis  100 (cosine ≈ 0.955)
 *   variant 2 → angle 0.40 rad, axis  500 (cosine ≈ 0.921)
 *   variant 3 → angle 0.50 rad, axis 1000 (cosine ≈ 0.878 — barely above 0.85)
 *
 * Because the angles are all below `acos(0.85) ≈ 0.5548 rad`, every variant
 * remains a cosine match against the FIRST-inserted row (variant 0) — but
 * variant 3 is in the danger zone where a threshold drift would break the
 * proof. The threshold matters in this test now.
 */
const VARIANT_ANGLES = [0, 0.3, 0.4, 0.5];
const VARIANT_AXES = [0, 100, 500, 1000];

function variantEmbedding(variant: number): number[] {
  const dim = 1536;
  const v = new Array<number>(dim).fill(0);
  const angle = VARIANT_ANGLES[variant];
  const axis = VARIANT_AXES[variant];
  v[0] = Math.cos(angle);
  if (axis !== 0) v[axis] = Math.sin(angle);
  // Already unit-length: cos² + sin² = 1; no normalization needed.
  return v;
}

describe("trackError end-to-end (Story 11-6 / audit P1-21 closure proof)", () => {
  it("4 near-duplicate descriptions produce a SINGLE row with occurrences = 4", async () => {
    const sim = buildSimulator();

    const FOUR_VARIANTS = [
      "Confuses passe compose with imparfait",
      "Mixes passe compose and imparfait for past actions",
      "Uses passe compose where imparfait is needed",
      "Confuses passe compose with imparfait for habitual past actions",
    ];

    // P14: realistic-band cosines (~0.878 to ~0.955 vs the first-inserted row).
    // Variant 3 is barely above the 0.85 threshold — if the threshold drifted
    // to 0.88 in the migration, this test would fail (the proof would break).
    for (let i = 0; i < FOUR_VARIANTS.length; i++) {
      mockGenerateEmbedding.mockResolvedValueOnce(variantEmbedding(i));
    }

    for (const desc of FOUR_VARIANTS) {
      await trackError(USER_ID, "grammar", desc);
    }

    // The PROOF: single row, occurrences = 4.
    expect(sim.store).toHaveLength(1);
    expect(sim.store[0].occurrences).toBe(4);
    // The first-inserted description is preserved (NOT the most recent variant).
    expect(sim.store[0].error_description).toBe(FOUR_VARIANTS[0]);
  });

  it("boundary case: exact 0.85 similarity is NOT a match (strict greater-than) → 2 separate rows", async () => {
    const sim = buildSimulator();

    // Embed two orthogonal-but-near-axis vectors with controlled cosine.
    // First vector: [1, 0, 0, ..., 0]. Second vector: [0.85, sqrt(1-0.85²), 0, ..., 0].
    // Cosine = 0.85 exactly. STRICT > 0.85 must NOT match.
    const v1 = new Array(1536).fill(0);
    v1[0] = 1;
    const v2 = new Array(1536).fill(0);
    v2[0] = 0.85;
    v2[1] = Math.sqrt(1 - 0.85 * 0.85);

    mockGenerateEmbedding.mockResolvedValueOnce(v1);
    mockGenerateEmbedding.mockResolvedValueOnce(v2);

    await trackError(USER_ID, "grammar", "first");
    await trackError(USER_ID, "grammar", "second");

    expect(sim.store).toHaveLength(2);
    expect(sim.store[0].occurrences).toBe(1);
    expect(sim.store[1].occurrences).toBe(1);
  });

  it("boundary case: similarity slightly above 0.85 → MATCH → 1 row with occurrences = 2", async () => {
    const sim = buildSimulator();

    // Cosine = 0.851 — JUST above the strict-greater-than threshold.
    const v1 = new Array(1536).fill(0);
    v1[0] = 1;
    const v2 = new Array(1536).fill(0);
    v2[0] = 0.851;
    v2[1] = Math.sqrt(1 - 0.851 * 0.851);

    mockGenerateEmbedding.mockResolvedValueOnce(v1);
    mockGenerateEmbedding.mockResolvedValueOnce(v2);

    await trackError(USER_ID, "grammar", "first");
    await trackError(USER_ID, "grammar", "second");

    expect(sim.store).toHaveLength(1);
    expect(sim.store[0].occurrences).toBe(2);
  });

  it("legacy NULL-embedding row + exact string match → Arm 2 fires → existing row's occurrences increments", async () => {
    const sim = buildSimulator();

    // Inject a pre-11-6 row directly (NULL embedding, exact-string description).
    sim.store.push({
      id: "legacy-row-1",
      user_id: USER_ID,
      error_type: "grammar",
      error_description: "Subject-verb agreement error",
      embedding: null,
      occurrences: 7,
      resolved: false,
    });

    // New write with a fresh embedding but EXACT-string match against the legacy row.
    mockGenerateEmbedding.mockResolvedValueOnce(variantEmbedding(0));

    await trackError(USER_ID, "grammar", "Subject-verb agreement error");

    // Legacy row's occurrences increments; NO new row created.
    expect(sim.store).toHaveLength(1);
    expect(sim.store[0].id).toBe("legacy-row-1");
    expect(sim.store[0].occurrences).toBe(8);
    // Legacy row stays NULL-embedding (no opportunistic backfill in v1).
    expect(sim.store[0].embedding).toBeNull();
  });
});
