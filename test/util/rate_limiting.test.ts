import { describe, expect, it, vi } from "vitest";
import { rateLimitedRun } from "../../src/util/rate_limiting";

describe("rateLimitedRun", () => {
    it("processes every item exactly once", async () => {
        const items = [1, 2, 3, 4, 5];
        const seen: number[] = [];

        await rateLimitedRun(items, async item => {
            seen.push(item);
        }, 2, 0);

        expect(seen.sort()).toEqual(items);
    });

    it("does nothing for an empty list", async () => {
        const fn = vi.fn();
        await rateLimitedRun([], fn, 3, 0);
        expect(fn).not.toHaveBeenCalled();
    });

    it("never exceeds the configured concurrency", async () => {
        const items = Array.from({ length: 9 }, (_, i) => i);
        let active = 0;
        let maxActive = 0;

        await rateLimitedRun(items, async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active--;
        }, 3, 0);

        expect(maxActive).toBeLessThanOrEqual(3);
    });

    it("delays between chunks but not after the last one", async () => {
        vi.useFakeTimers();
        try {
            const delayMs = 1000;
            // 5 items, concurrency 2 => 3 chunks => 2 inter-chunk delays.
            const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

            const run = rateLimitedRun([1, 2, 3, 4, 5], async () => {}, 2, delayMs);
            await vi.runAllTimersAsync();
            await run;

            const delayCalls = setTimeoutSpy.mock.calls.filter(([, ms]) => ms === delayMs);
            expect(delayCalls).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
