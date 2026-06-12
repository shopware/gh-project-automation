import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    dontExecuteOnDryRun,
    isDryRun,
    rejectOnDryRun,
    throwOnDryRun,
} from "../../src/util/dry_run";
import { createMockToolkit } from "../helpers";

describe("dry_run", () => {
    const originalDryRun = process.env.DRY_RUN;

    beforeEach(() => {
        delete process.env.DRY_RUN;
    });

    afterEach(() => {
        if (originalDryRun === undefined) {
            delete process.env.DRY_RUN;
        } else {
            process.env.DRY_RUN = originalDryRun;
        }
    });

    describe("isDryRun", () => {
        it("is true for 'true' and '1'", () => {
            process.env.DRY_RUN = "true";
            expect(isDryRun()).toBe(true);

            process.env.DRY_RUN = "1";
            expect(isDryRun()).toBe(true);
        });

        it("is false when unset or any other value", () => {
            expect(isDryRun()).toBe(false);

            process.env.DRY_RUN = "false";
            expect(isDryRun()).toBe(false);

            process.env.DRY_RUN = "yes";
            expect(isDryRun()).toBe(false);
        });
    });

    describe("dontExecuteOnDryRun", () => {
        it("runs the callback when not a dry run", () => {
            const toolkit = createMockToolkit();
            const callback = vi.fn();

            dontExecuteOnDryRun(toolkit, callback);

            expect(callback).toHaveBeenCalledOnce();
        });

        it("skips the callback and logs when a dry run", () => {
            process.env.DRY_RUN = "true";
            const toolkit = createMockToolkit();
            const callback = vi.fn();

            dontExecuteOnDryRun(toolkit, callback);

            expect(callback).not.toHaveBeenCalled();
            expect(toolkit.core.info).toHaveBeenCalled();
        });
    });

    describe("throwOnDryRun", () => {
        it("does nothing when not a dry run", () => {
            const toolkit = createMockToolkit();
            expect(() => throwOnDryRun(toolkit)).not.toThrow();
        });

        it("throws when a dry run", () => {
            process.env.DRY_RUN = "1";
            const toolkit = createMockToolkit();
            expect(() => throwOnDryRun(toolkit, "blocked")).toThrow("Dry run mode is enabled.");
            expect(toolkit.core.info).toHaveBeenCalledWith("blocked");
        });
    });

    describe("rejectOnDryRun", () => {
        it("resolves when not a dry run", async () => {
            const toolkit = createMockToolkit();
            await expect(rejectOnDryRun(toolkit)).resolves.toBeUndefined();
        });

        it("rejects when a dry run", async () => {
            process.env.DRY_RUN = "true";
            const toolkit = createMockToolkit();
            await expect(rejectOnDryRun(toolkit, "blocked")).rejects.toBe("Dry run mode is enabled.");
            expect(toolkit.core.info).toHaveBeenCalledWith("blocked");
        });
    });
});
