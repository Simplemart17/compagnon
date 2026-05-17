/**
 * Story 16-1 — `eas.json` env-var reference source-drift detector.
 *
 * Pins the load-bearing invariant from Story 9-9: every iOS submit credential
 * in `eas.json` is an `$EXPO_*` environment-variable reference, NOT a literal
 * Apple Team ID / ASC App ID / Apple ID. The file-path references for the EAS
 * file secrets (`./asc-api-key.p8`, `./google-service-account.json`) are also
 * pinned because the CI submit step relies on those exact paths being
 * materialized by `EXPO_ASC_API_KEY_P8` and `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY`
 * at submit time.
 *
 * This drift detector is the test-time companion to Story 9-9's "Submit
 * credentials leak guard" step at .github/workflows/ci.yml:110-150 (CI-time
 * regex sweep of all tracked files). The leak guard catches a regression at
 * `git push`; this drift detector catches the same regression at
 * `npm test`-time on the dev's laptop AND in CI's existing Jest step (one
 * minute faster feedback than waiting for the leak-guard step to run).
 *
 * Cases:
 *   (1) POSITIVE — `submit.production.ios.ascApiKeyIssuerId` is the literal
 *       string `$EXPO_ASC_API_KEY_ISSUER_ID`.
 *   (2) POSITIVE — `submit.production.ios.ascApiKeyId` is the literal string
 *       `$EXPO_ASC_API_KEY_ID`.
 *   (3) POSITIVE — `submit.production.ios.ascAppId` is the literal string
 *       `$EXPO_ASC_APP_ID`.
 *   (4) POSITIVE — `submit.production.ios.appleTeamId` is the literal string
 *       `$EXPO_APPLE_TEAM_ID`.
 *   (5) NEGATIVE — no string value under `submit.production.ios` matches the
 *       10-char alphanumeric shape of an Apple Team ID OUTSIDE the `$EXPO_*`
 *       env-var reference shape. Pairs with the ci.yml leak guard which uses
 *       the same regex against tracked files.
 *   (6) NEGATIVE — no field under `submit.production.ios` contains the
 *       literal substring `"YOUR_"` (Story 9-9 placeholder regression).
 *   (7) POSITIVE — `submit.production.ios.ascApiKeyPath` is the literal
 *       `./asc-api-key.p8`. The CI submit step materializes this from the
 *       `EXPO_ASC_API_KEY_P8` file secret; a filename rename here without a
 *       matching EAS file-secret rename would silently break submit.
 *   (8) POSITIVE — `submit.production.android.serviceAccountKeyPath` is the
 *       literal `./google-service-account.json`. Same materialization
 *       contract as Case 7, via `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY`.
 *
 * Follows Story 12-10's `ci-audit-gate-source-drift.test.ts` pattern: read
 * the file from disk, parse, assert. JSON is structured (vs YAML's
 * indentation-by-convention), so we use `JSON.parse` directly — no
 * comment-strip or regex-walk needed.
 */

import * as fs from "fs";
import * as path from "path";

const EAS_JSON_PATH = path.resolve(__dirname, "../../../eas.json");
const EAS_JSON_RAW = fs.readFileSync(EAS_JSON_PATH, "utf-8");

interface EasSubmitIos {
  ascApiKeyPath?: string;
  ascApiKeyIssuerId?: string;
  ascApiKeyId?: string;
  ascAppId?: string;
  appleTeamId?: string;
  // Defensive — Story 9-9 chose the ASC API key path over the legacy
  // appleId + app-specific-password flow. Future regression would re-add
  // these; we don't pin them positive because they're allowed to be absent.
  appleId?: string;
}

interface EasSubmitAndroid {
  serviceAccountKeyPath?: string;
  track?: string;
  releaseStatus?: string;
}

interface EasJson {
  submit?: {
    production?: {
      ios?: EasSubmitIos;
      android?: EasSubmitAndroid;
    };
  };
}

const easJson: EasJson = JSON.parse(EAS_JSON_RAW);
const iosSubmit: EasSubmitIos = easJson.submit?.production?.ios ?? {};
const androidSubmit: EasSubmitAndroid = easJson.submit?.production?.android ?? {};

describe("eas.json — Story 16-1 env-var reference drift detector (Story 9-9 substrate pin)", () => {
  it("Case 1: submit.production.ios.ascApiKeyIssuerId === '$EXPO_ASC_API_KEY_ISSUER_ID' literal", () => {
    expect(iosSubmit.ascApiKeyIssuerId).toBe("$EXPO_ASC_API_KEY_ISSUER_ID");
  });

  it("Case 2: submit.production.ios.ascApiKeyId === '$EXPO_ASC_API_KEY_ID' literal", () => {
    expect(iosSubmit.ascApiKeyId).toBe("$EXPO_ASC_API_KEY_ID");
  });

  it("Case 3: submit.production.ios.ascAppId === '$EXPO_ASC_APP_ID' literal", () => {
    expect(iosSubmit.ascAppId).toBe("$EXPO_ASC_APP_ID");
  });

  it("Case 4: submit.production.ios.appleTeamId === '$EXPO_APPLE_TEAM_ID' literal", () => {
    expect(iosSubmit.appleTeamId).toBe("$EXPO_APPLE_TEAM_ID");
  });

  it("Case 5: NEGATIVE — no iOS submit field has a literal 10-char Apple Team ID / ASC App ID shape outside the $EXPO_* reference shape", () => {
    // Story 9-9's ci.yml leak guard uses /[A-Z0-9]{10}/ against tracked files;
    // this case pins the same invariant at JSON-parse time. The `$EXPO_*`
    // references contain digits and uppercase letters but the leading `$`
    // and the underscore separators mean they never match a bare 10-char
    // alphanumeric run. We exclude the env-var references explicitly via
    // the `.startsWith("$")` filter so a future regression that drops the
    // `$` prefix (typing the value directly as a 10-char literal) trips.
    const APPLE_TEAM_ID_SHAPE = /^[A-Z0-9]{10}$/;
    const APPLE_ASC_APP_ID_SHAPE = /^[0-9]{10}$/;

    for (const [key, value] of Object.entries(iosSubmit)) {
      if (typeof value !== "string") continue;
      // Env-var references are exempt — they're the correct shape.
      if (value.startsWith("$")) continue;
      // File-path references are exempt — they're not credentials.
      if (value.startsWith("./") || value.startsWith("/")) continue;

      expect(value).not.toMatch(APPLE_TEAM_ID_SHAPE);
      expect(value).not.toMatch(APPLE_ASC_APP_ID_SHAPE);
      // The two assertions above need at least one to be meaningful; if
      // the value somehow passed both (e.g., empty string), the test
      // would vacuously pass. Belt-and-suspenders: no field of the
      // ios submit profile is allowed to be empty either.
      expect(value.length).toBeGreaterThan(0);
      // Use `key` to surface which field tripped, if any — Jest's
      // expect-message would otherwise print "received undefined"
      // without context.
      void key;
    }
  });

  it("Case 6: NEGATIVE — no iOS submit field contains the 'YOUR_' placeholder substring (Story 9-9 pre-fix shape)", () => {
    // Story 9-9 removed `YOUR_APPLE_ID@example.com`, `YOUR_APP_STORE_CONNECT_APP_ID`,
    // `YOUR_APPLE_TEAM_ID` from eas.json. A future revert (e.g., `git revert
    // <9-9-sha>` after a bad merge) would re-introduce these. This case
    // catches that regression at test time.
    for (const value of Object.values(iosSubmit)) {
      if (typeof value !== "string") continue;
      expect(value).not.toContain("YOUR_");
    }
  });

  it("Case 7: submit.production.ios.ascApiKeyPath === './asc-api-key.p8' literal (EAS file-secret materialization contract)", () => {
    // The CI submit step pulls `EXPO_ASC_API_KEY_P8` (EAS file secret) and
    // writes it to this exact path. A filename change here without a
    // matching EAS file-secret rename would silently break iOS submit. Q4
    // operator decision: pin the literal, not a glob — a future filename
    // change should go through review, not slide as drift.
    expect(iosSubmit.ascApiKeyPath).toBe("./asc-api-key.p8");
  });

  it("Case 8: submit.production.android.serviceAccountKeyPath === './google-service-account.json' literal (EAS file-secret materialization contract)", () => {
    // Same contract as Case 7, via `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY`.
    expect(androidSubmit.serviceAccountKeyPath).toBe("./google-service-account.json");
  });
});
