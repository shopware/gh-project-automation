import { describe, expect, it } from "vitest";
import { computeReleaseSchedule } from "../../src/services/release_schedule";

describe("computeReleaseSchedule", () => {
    it("derives dates from the first Monday of the following month", () => {
        // June 2025 -> next month July 2025; first Monday is July 7.
        const schedule = computeReleaseSchedule(new Date("2025-06-12T00:00:00Z"));

        expect(schedule.onpremReleaseDate).toBe("Monday, July 7, 2025");
        expect(schedule.branchoffDate).toBe("Monday, June 23, 2025"); // 14 days before
        expect(schedule.announcementDate).toBe("2025-06-18"); // 5 days before branch-off
    });

    it("handles the December -> January year rollover", () => {
        // December 2025 -> next month January 2026; first Monday is January 5.
        const schedule = computeReleaseSchedule(new Date("2025-12-15T00:00:00Z"));

        expect(schedule.onpremReleaseDate).toBe("Monday, January 5, 2026");
        expect(schedule.branchoffDate).toBe("Monday, December 22, 2025");
        expect(schedule.announcementDate).toBe("2025-12-17");
    });

    it("does not notify when today is not the announcement date", () => {
        const schedule = computeReleaseSchedule(new Date("2025-06-12T00:00:00Z"));

        expect(schedule.today).toBe("2025-06-12");
        expect(schedule.notify).toBe(false);
    });

    it("notifies when today equals the announcement date", () => {
        const schedule = computeReleaseSchedule(new Date("2025-06-18T09:30:00Z"));

        expect(schedule.notify).toBe(true);
    });

    it("uses the override date for the notify comparison", () => {
        // `now` is far from the announcement, but the override lands on it.
        const schedule = computeReleaseSchedule(new Date("2025-06-01T00:00:00Z"), "2025-06-18");

        expect(schedule.today).toBe("2025-06-18");
        expect(schedule.notify).toBe(true);
    });

    it("ignores a blank override date", () => {
        const schedule = computeReleaseSchedule(new Date("2025-06-12T00:00:00Z"), "   ");

        expect(schedule.today).toBe("2025-06-12");
    });
});
