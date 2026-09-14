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
    /** The same on-prem release date as `YYYY-MM-DD`, for APIs that want a date. */
    onpremReleaseDateIso: string;
    /** Human-readable branch-off date, e.g. `Monday, June 23, 2025`. */
    branchoffDate: string;
    /** The same branch-off date as `YYYY-MM-DD`. */
    branchoffDateIso: string;
    /** Whether `today` is the announcement day. */
    notify: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days between the branch-off and the on-prem release it leads to. */
const BRANCH_OFF_LEAD_DAYS = 14;

/** Days between the announcement and the branch-off it announces. */
const ANNOUNCEMENT_LEAD_DAYS = 5;

/**
 * The first Monday of a month, in UTC. `monthIndex` may be out of range;
 * `Date.UTC` rolls it over into the following years.
 */
function firstMondayOf(year: number, monthIndex: number): Date {
    let day = new Date(Date.UTC(year, monthIndex, 1));
    while (day.getUTCDay() !== 1 /* Monday */) {
        day = new Date(day.getTime() + DAY_MS);
    }

    return day;
}

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
    const firstMonday = firstMondayOf(now.getUTCFullYear(), now.getUTCMonth() + 1);
    const branchoff = new Date(firstMonday.getTime() - BRANCH_OFF_LEAD_DAYS * DAY_MS);
    const announcement = new Date(branchoff.getTime() - ANNOUNCEMENT_LEAD_DAYS * DAY_MS);

    const today = overrideToday && overrideToday.trim() !== "" ? overrideToday.trim() : toIsoDate(now);
    const announcementDate = toIsoDate(announcement);

    return {
        today,
        announcementDate,
        onpremReleaseDate: toLongDate(firstMonday),
        onpremReleaseDateIso: toIsoDate(firstMonday),
        branchoffDate: toLongDate(branchoff),
        branchoffDateIso: toIsoDate(branchoff),
        notify: today === announcementDate,
    };
}

/** The dates of one minor release, independent of when they are asked for. */
export type MinorSchedule = {
    /** Human-readable on-prem release date, e.g. `Monday, October 5, 2026`. */
    releaseDate: string;
    /** The same date as `YYYY-MM-DD`. */
    releaseDateIso: string;
    /** Human-readable branch-off date. */
    branchoffDate: string;
    /** The same date as `YYYY-MM-DD`. */
    branchoffDateIso: string;
};

/**
 * Dates of the minor release that is `monthsAhead` cycles after the one released
 * at `anchorReleasedAt`. One cycle is one month, and every minor targets the first
 * Monday of its month.
 *
 * Unlike {@link computeReleaseSchedule} this does not depend on the current date,
 * so it answers "when does 6.7.15.0 ship" correctly at any point in the cycle —
 * including right after a branch-off, when two minors are in flight at once and
 * "the next release" is ambiguous if you only look at the calendar.
 *
 * The anchor's *planned* month is taken to be the month it was actually released
 * in. Minors ship on or after their first Monday, never before, and the observed
 * delay has stayed well inside the month.
 *
 * @param anchorReleasedAt - When the most recently released minor came out.
 * @param monthsAhead - How many minors later the wanted release is. 1 is the next one.
 */
export function scheduleForMinor(anchorReleasedAt: Date, monthsAhead: number): MinorSchedule {
    if (!Number.isInteger(monthsAhead) || monthsAhead < 1) {
        throw new Error(`monthsAhead must be a positive integer, got ${monthsAhead}.`);
    }

    const release = firstMondayOf(anchorReleasedAt.getUTCFullYear(), anchorReleasedAt.getUTCMonth() + monthsAhead);
    const branchoff = new Date(release.getTime() - BRANCH_OFF_LEAD_DAYS * DAY_MS);

    return {
        releaseDate: toLongDate(release),
        releaseDateIso: toIsoDate(release),
        branchoffDate: toLongDate(branchoff),
        branchoffDateIso: toIsoDate(branchoff),
    };
}
