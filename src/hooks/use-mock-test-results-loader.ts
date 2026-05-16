/**
 * Story 14-7 — on-tap results loader for past-results rows.
 *
 * Used by the landing screen: when a user taps a past-result row, this hook's
 * `loadAndNavigate(mockTestId)` fires:
 *   1. Fetch the full `mock_tests` row by id.
 *   2. Call `reconstructTestResultsFromMockTestRow` to validate + transform
 *      the `section_scores` JSONB into the `TestResults` shape consumed by
 *      `app/(tabs)/mock-test/results.tsx`.
 *   3. On success → `router.push({pathname:"/(tabs)/mock-test/results",
 *      params:{data: JSON.stringify(reconstructed)}})`.
 *   4. On failure → fire `captureError` + show Alert (caller surfaces it).
 *
 * This intentionally keeps the past-results landing query lightweight
 * (only the 5 columns needed for the row preview) — full `section_scores`
 * is loaded ON DEMAND when the user actually wants to see the breakdown.
 */

import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";

import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import {
  reconstructTestResultsFromMockTestRow,
  type MockTestRow,
} from "@/src/lib/mock-test-results";

export interface UseMockTestResultsLoaderReturn {
  /** True while the fetch + navigate roundtrip is in flight. */
  loading: boolean;
  /**
   * Fetch the `mock_tests` row by id, reconstruct the results payload,
   * and navigate to the results screen. On failure surfaces a French-free
   * (Story 14-1 chrome rule) Alert + captures the error.
   */
  loadAndNavigate: (mockTestId: string) => Promise<void>;
}

export function useMockTestResultsLoader(): UseMockTestResultsLoaderReturn {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const loadAndNavigate = useCallback(
    async (mockTestId: string) => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("mock_tests")
          .select(
            "id, user_id, test_type, total_score, section_scores, cefr_result, duration_seconds, questions, status, created_at, completed_at"
          )
          .eq("id", mockTestId)
          .maybeSingle();

        if (error) throw error;
        if (data === null) {
          Alert.alert(
            "Couldn't load result",
            "This past result is no longer available. It may have been deleted."
          );
          return;
        }

        const reconstructed = reconstructTestResultsFromMockTestRow(data as MockTestRow);
        if (reconstructed === null) {
          Alert.alert(
            "Couldn't load result",
            "This past result has a malformed score record and can't be displayed."
          );
          return;
        }

        router.push({
          pathname: "/(tabs)/mock-test/results",
          params: { data: JSON.stringify(reconstructed) },
        });
      } catch (err) {
        captureError(err, "mock-test-results-loader");
        Alert.alert(
          "Couldn't load result",
          "Something went wrong while loading this past result. Please try again."
        );
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  return { loading, loadAndNavigate };
}
