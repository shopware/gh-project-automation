/**
 * Computed dates for the "branch-off and minor release" announcement, derived
 * from the first Monday of the month following `now`.
 */
export type ReleaseSchedule = {
    /** The effective "today" (the override if given, otherwise `now`), as `YYYY-MM-DD`. */
    today: string;
    /** The day the announcement should be sent, as `YYYY-MM-DD`. */
    announcementDate: string;
    /** Human-readable on-prem release date, e.g. `Monday, July 7, 2025`. */
    onpremReleaseDate: string;
    /** Human-readable branch-off date, e.g. `Monday, June 23, 2025`. */
    branchoffDate: string;
    /** Whether `today` is the announcement day. */
    notify: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Formats a date as `YYYY-MM-DD` in UTC, matching `date +%Y-%m-%d`. */
function toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** Formats a date as e.g. `Monday, July 7, 2025` in UTC, matching `date "+%A, %B %-d, %Y"`. */
function toLongDate(date: Date): string {
    return new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
    }).format(date);
}

/**
 * Computes the release-announcement schedule.
 *
 * The on-prem release happens on the first Monday of the month after `now`.
 * Branch-off is 14 days before that, and the announcement 5 days before
 * branch-off. All calculations are performed in UTC to match the GitHub Actions
 * runner behaviour of the previous shell implementation.
 *
 * @param now - The current date. Only its year/month drive the schedule.
 * @param overrideToday - Optional `YYYY-MM-DD` string used in place of `now`
 *   for the `notify` comparison (used for manual testing of the workflow).
 */
export function computeReleaseSchedule(now: Date, overrideToday?: string | null): ReleaseSchedule {
    // First Monday of the month following `now`.
    let firstMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    while (firstMonday.getUTCDay() !== 1 /* Monday */) {
        firstMonday = new Date(firstMonday.getTime() + DAY_MS);
    }

    const branchoff = new Date(firstMonday.getTime() - 14 * DAY_MS);
    const announcement = new Date(branchoff.getTime() - 5 * DAY_MS);

    const today = overrideToday && overrideToday.trim() !== "" ? overrideToday.trim() : toIsoDate(now);
    const announcementDate = toIsoDate(announcement);

    return {
        today,
        announcementDate,
        onpremReleaseDate: toLongDate(firstMonday),
        branchoffDate: toLongDate(branchoff),
        notify: today === announcementDate,
    };
}
