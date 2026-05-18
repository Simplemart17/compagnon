import * as Sentry from "@sentry/react-native";

import { captureError } from "../sentry";

type MockScope = { setTag: jest.Mock; setExtras: jest.Mock };

jest.mock("@sentry/react-native", () => {
  const captureException = jest.fn();
  const setTag = jest.fn();
  const setExtras = jest.fn();
  const mockScope: { setTag: typeof setTag; setExtras: typeof setExtras } = {
    setTag,
    setExtras,
  };
  return {
    __esModule: true,
    captureException,
    withScope: jest.fn((cb: (scope: typeof mockScope) => void) => cb(mockScope)),
    addBreadcrumb: jest.fn(),
  };
});

const mockedCaptureException = Sentry.captureException as jest.MockedFunction<
  typeof Sentry.captureException
>;

beforeEach(() => {
  mockedCaptureException.mockClear();
});

/**
 * Story 13-4 R1-P21 introduced a `toError` helper to normalize Supabase
 * `PostgrestError`-shape objects (which carry `.message` but are not `Error`
 * subclasses) so Sentry stops showing `"[object Object]"`. The current
 * implementation bakes that normalization into `captureError` itself in
 * `sentry.ts` so every call site is safe by construction.
 *
 * These tests pin the new contract.
 */
describe("captureError — toError normalization", () => {
  it("passes a real Error instance through unchanged", () => {
    const original = new Error("boom");
    captureError(original, "test");
    expect(mockedCaptureException).toHaveBeenCalledTimes(1);
    expect(mockedCaptureException.mock.calls[0][0]).toBe(original);
  });

  it("normalizes a PostgrestError-shape object to an Error preserving .message", () => {
    const postgrestError = {
      message: "violates check constraint",
      code: "23514",
      hint: null,
      details: null,
    };
    captureError(postgrestError, "test");
    expect(mockedCaptureException).toHaveBeenCalledTimes(1);
    const received = mockedCaptureException.mock.calls[0][0] as Error;
    expect(received).toBeInstanceOf(Error);
    expect(received.message).toBe("violates check constraint");
    // Pre-Story 13-4 regression guard: must NOT be the literal "[object Object]".
    expect(received.message).not.toBe("[object Object]");
  });

  it("normalizes a plain object without .message via JSON.stringify", () => {
    captureError({ code: 42883 }, "test");
    const received = mockedCaptureException.mock.calls[0][0] as Error;
    expect(received).toBeInstanceOf(Error);
    expect(received.message).toBe('{"code":42883}');
    expect(received.message).not.toBe("[object Object]");
  });

  it("normalizes a string via JSON.stringify quoting", () => {
    captureError("naked string", "test");
    const received = mockedCaptureException.mock.calls[0][0] as Error;
    expect(received).toBeInstanceOf(Error);
    expect(received.message).toBe('"naked string"');
  });

  it("falls back to String() for non-serializable values (circular ref)", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    captureError(circular, "test");
    const received = mockedCaptureException.mock.calls[0][0] as Error;
    expect(received).toBeInstanceOf(Error);
    // JSON.stringify on circular throws → String() fallback returns
    // "[object Object]" — but that's the unavoidable v8 representation of a
    // bare object; the important thing is that captureException still
    // receives an Error instance (not a raw object).
    expect(typeof received.message).toBe("string");
  });

  it("ignores .message that isn't a string", () => {
    // A buggy upstream might return { message: { error: "x" } }. The helper
    // must NOT take that branch (it'd yield Error("[object Object]") again);
    // instead it falls through to JSON.stringify.
    captureError({ message: { nested: "x" } }, "test");
    const received = mockedCaptureException.mock.calls[0][0] as Error;
    expect(received).toBeInstanceOf(Error);
    expect(received.message).toBe('{"message":{"nested":"x"}}');
  });

  it("applies the feature tag + extras", () => {
    const setTagMock = jest.fn();
    const setExtrasMock = jest.fn();
    const localScope: MockScope = { setTag: setTagMock, setExtras: setExtrasMock };
    const withScopeMock = Sentry.withScope as unknown as jest.Mock;
    withScopeMock.mockImplementationOnce((cb: (s: MockScope) => void) => cb(localScope));
    captureError(new Error("x"), "feature-tag", { foo: "bar" });
    expect(setTagMock).toHaveBeenCalledWith("feature", "feature-tag");
    expect(setExtrasMock).toHaveBeenCalledWith({ foo: "bar" });
  });
});
