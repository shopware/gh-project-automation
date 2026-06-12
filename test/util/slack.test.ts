import { describe, expect, it } from "vitest";
import { isWebAPIPlatformError } from "../../src/util/slack";

describe("isWebAPIPlatformError", () => {
    it("recognises an object carrying both 'code' and 'data'", () => {
        const error = { code: "slack_webapi_platform_error", data: { ok: false } };
        expect(isWebAPIPlatformError(error)).toBe(true);
    });

    it("rejects values that are not platform errors", () => {
        expect(isWebAPIPlatformError(null)).toBe(false);
        expect(isWebAPIPlatformError(undefined)).toBe(false);
        expect(isWebAPIPlatformError("error")).toBe(false);
        expect(isWebAPIPlatformError(new Error("boom"))).toBe(false);
        expect(isWebAPIPlatformError({ code: "x" })).toBe(false);
        expect(isWebAPIPlatformError({ data: {} })).toBe(false);
    });
});
