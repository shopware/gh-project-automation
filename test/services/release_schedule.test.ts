import { describe, expect, it } from "vitest";
import { computeReleaseSchedule, scheduleForMinor } from "../../src/services/release_schedule";

describe("computeReleaseSchedule", () => {
    it("derives dates from the first Monday of the following month", () => {
        // June 2025 -> next month July 2025; first Monday is July 7.
        const schedule = computeReleaseSchedule(new Date("2025-06-12T00:00:00Z"));

        expect(schedule.onpremReleaseDate).toBe("Monday, July 7, 2025");
        expect(schedule.branchoffDate).toBe("Monday, June 23, 2025"); // 14 days before
        expect(schedule.announcementDate).toBe("2025-06-18"); // 5 days before branch-off
    });

    it("exposes both dates as ISO dates for the milestone due date", () => {
        const schedule = computeReleaseSchedule(new Date("2025-06-12T00:00:00Z"));

        expect(schedule.onpremReleaseDateIso).toBe("2025-07-07");
        expect(schedule.branchoffDateIso).toBe("2025-06-23");
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

describe("scheduleForMinor", () => {
    it("puts the next minor on the first Monday of the following month", () => {
        // 6.7.14.0 shipped 2026-09-09, so 6.7.15.0 is one cycle later.
        const schedule = scheduleForMinor(new Date("2026-09-09T07:06:52Z"), 1);

        expect(schedule.releaseDateIso).toBe("2026-10-05");
        expect(schedule.releaseDate).toBe("Monday, October 5, 2026");
        expect(schedule.branchoffDateIso).toBe("2026-09-21");
    });

    it("reaches past the minor that is already branched off", () => {
        // Asked on the day 6.7.14.x was branched off: 6.7.13.0 was the last release,
        // so 6.7.15.0 is two cycles out and must not inherit 6.7.14.0's date.
        const schedule = scheduleForMinor(new Date("2026-08-05T09:29:37Z"), 2);

        expect(schedule.releaseDateIso).toBe("2026-10-05");
    });

    it("rolls over into the next year", () => {
        const schedule = scheduleForMinor(new Date("2026-12-07T00:00:00Z"), 1);

        expect(schedule.releaseDateIso).toBe("2027-01-04");
        expect(schedule.branchoffDateIso).toBe("2026-12-21");
    });

    it("rejects a non-positive distance", () => {
        expect(() => scheduleForMinor(new Date("2026-09-09T00:00:00Z"), 0)).toThrow("positive integer");
    });
});
