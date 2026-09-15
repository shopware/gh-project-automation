import { getMilestoneByTitle } from "../api";
import { Toolkit } from "../types";
import { isDryRun } from "../util/dry_run";
import { scheduleForMinor } from "./release_schedule";
import { getDevelopmentIssueForPullRequest } from "./issue";

/**
 * setMilestoneForPR sets the milestone for a Pull request or an Issue.
 * If a milestone doesn't exists it will create one.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 */
export async function setMilestoneForPR(toolkit: Toolkit) {

    const pr = toolkit.context.payload.pull_request;
    if (!pr) {
        throw new Error("This function can only be called on 'pull_request' workflows.")
    }
    const labels: [{ name: string }] = pr.labels;
    const { owner, repo } = toolkit.context.repo;

    const milestoneLabel = labels.find(x => x.name.startsWith("milestone/"));

    if (!milestoneLabel) {
        toolkit.core.info("No milestone labels found.");
        return;
    }

    const milestoneTitle = milestoneLabel.name.split('/')[1]

    let milestone = await getMilestoneByTitle(toolkit, toolkit.context.repo.repo, milestoneTitle, toolkit.context.repo.owner);

    if (!milestone) {
        toolkit.core.info(`Couldn't find a milestone with the title "${milestoneTitle}". Creating one...`);
        const res = await toolkit.github.rest.issues.createMilestone({
            owner: toolkit.context.repo.owner,
            repo: toolkit.context.repo.repo,
            title: milestoneTitle,
        });

        milestone = res.data
    }

    const linkedIssue = await getDevelopmentIssueForPullRequest(toolkit, `${owner}/${repo}`, pr.number, pr.head, pr.assignee);
    if (linkedIssue && linkedIssue.number) {
        toolkit.core.info(`Found linked issue (#${linkedIssue.number}), will add issue to milestone`);
        await toolkit.github.rest.issues.update({
            owner,
            repo,
            issue_number: linkedIssue.number,
            milestone: milestone.number
        });
        return;
    }

    toolkit.core.info(`Havent't found an linked issue, will add pull request to milestone`);

    await toolkit.github.rest.issues.update({
        owner,
        repo,
        issue_number: pr.number,
        milestone: milestone.number
    });
}

/** Matches a full four-segment Shopware version, e.g. "6.7.10.0". */
const VERSION_REGEX = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;

/**
 * Base branches whose PRs follow a different milestone scheme and must never be
 * relabelled: version branches such as "6.7.13.x" or "6.6.x", and SaaS release
 * branches such as "saas/2025/12".
 *
 * This is deliberately a denylist. An allowlist of "trunk" would also skip
 * stacked PRs, which target another PR's head branch until GitHub retargets them
 * to trunk once the parent merges — at which point nothing re-evaluates their
 * milestone label and it silently ships against the wrong version.
 */
const NON_BUMPABLE_BASE_REGEX = /^(saas\/\d{4}\/\d+|\d+\.\d+(\.\d+)*\.x)$/;

export type MoveMilestoneLabelsOptions = {
    /** Current version whose milestone label should be moved, e.g. "6.7.10.0". */
    version: string;
    /** Repository owner. Defaults to "shopware". */
    owner?: string;
    /** Repository name. Defaults to "shopware". */
    repo?: string;
    /** Overrides the DRY_RUN env detection when provided. */
    dryRun?: boolean;
};

/**
 * bumpPatchVersion returns the next version by incrementing the third
 * (patch) segment, e.g. "6.7.10.0" -> "6.7.11.0". Returns undefined for input
 * that isn't a full four-segment version.
 */
function bumpPatchVersion(version: string): string | undefined {
    const matches = VERSION_REGEX.exec(version);
    if (!matches) {
        return undefined;
    }
    return `${matches[1]}.${matches[2]}.${parseInt(matches[3], 10) + 1}.0`;
}

type PullRequestRef = { number: number, title: string, baseRefName: string };

/**
 * findOpenPullRequestsWithLabel returns all open PRs carrying `label`,
 * regardless of base branch. Paginates through every result page.
 *
 * The base branch is returned rather than filtered server-side so callers can
 * apply {@link NON_BUMPABLE_BASE_REGEX} and report what they skipped.
 */
async function findOpenPullRequestsWithLabel(toolkit: Toolkit, owner: string, repo: string, label: string): Promise<PullRequestRef[]> {
    const query = `
      query ($owner: String!, $repo: String!, $label: String!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequests(labels: [$label], states: OPEN, first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { number title baseRefName }
          }
        }
      }`;

    const pullRequests: PullRequestRef[] = [];
    let after: string | undefined = undefined;

    do {
        const res: {
            repository: {
                pullRequests: {
                    pageInfo: { hasNextPage: boolean, endCursor: string | null },
                    nodes: PullRequestRef[],
                }
            }
        } = await toolkit.github.graphql(query, { owner, repo, label, after });

        pullRequests.push(...res.repository.pullRequests.nodes);
        after = res.repository.pullRequests.pageInfo.hasNextPage ? res.repository.pullRequests.pageInfo.endCursor ?? undefined : undefined;
    } while (after);

    return pullRequests;
}

/**
 * moveMilestoneLabelsToNextVersion moves the `milestone/<version>` label to the
 * next patch version (`milestone/<version+1>`) on every open PR that still
 * carries it. It is used both when a release is tagged and when a release
 * branch is split off, so the operation is fully parameterized.
 *
 * PRs targeting a release branch are left alone (see
 * {@link NON_BUMPABLE_BASE_REGEX}); every other base branch is relabelled,
 * including the head branches that stacked PRs target.
 *
 * Every PR is attempted independently. If some fail, the rest are still
 * processed and the function throws once at the end listing the failures.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param options - see {@link MoveMilestoneLabelsOptions}
 */
export async function moveMilestoneLabelsToNextVersion(toolkit: Toolkit, options: MoveMilestoneLabelsOptions): Promise<void> {
    const owner = options.owner ?? "shopware";
    const repo = options.repo ?? "shopware";
    const dryRun = options.dryRun ?? isDryRun();

    const nextVersion = bumpPatchVersion(options.version);
    if (!nextVersion) {
        throw new Error(`"${options.version}" is not a valid version (expected e.g. "6.7.10.0").`);
    }

    const currentLabel = `milestone/${options.version}`;
    const nextLabel = `milestone/${nextVersion}`;

    if (dryRun) {
        toolkit.core.info("Running in DRY RUN mode - no labels will be created or changed.");
    }

    const candidates = await findOpenPullRequestsWithLabel(toolkit, owner, repo, currentLabel);
    const skipped = candidates.filter(pr => NON_BUMPABLE_BASE_REGEX.test(pr.baseRefName));
    const pullRequests = candidates.filter(pr => !NON_BUMPABLE_BASE_REGEX.test(pr.baseRefName));

    for (const pr of skipped) {
        toolkit.core.info(`Skipping #${pr.number}: targets "${pr.baseRefName}", which follows its own milestone scheme (${pr.title})`);
    }

    if (pullRequests.length === 0) {
        toolkit.core.info(candidates.length === 0
            ? `No open PRs with label "${currentLabel}" found in ${owner}/${repo}.`
            : `All ${candidates.length} open PR(s) with label "${currentLabel}" in ${owner}/${repo} target a release branch — nothing to move.`);
        return;
    }

    await applyLabelMove(toolkit, { owner, repo, currentLabel, nextLabel, pullRequests, dryRun });
}

type LabelMove = {
    owner: string;
    repo: string;
    currentLabel: string;
    nextLabel: string;
    pullRequests: PullRequestRef[];
    dryRun: boolean;
};

/**
 * Moves one milestone label to another on the given pull requests. Every PR is
 * attempted independently; if some fail, the rest are still processed and this
 * throws once at the end listing the failures.
 */
async function applyLabelMove(toolkit: Toolkit, { owner, repo, currentLabel, nextLabel, pullRequests, dryRun }: LabelMove): Promise<void> {
    if (dryRun) {
        toolkit.core.info(`${pullRequests.length} open PR(s) in ${owner}/${repo} would have "${currentLabel}" moved to "${nextLabel}":`);
        for (const pr of pullRequests) {
            toolkit.core.info(`  - #${pr.number} ${pr.title} (base: ${pr.baseRefName})`);
        }
        return;
    }

    /** PRs whose label could not be moved, collected so one failure can't hide the rest. */
    const failed: number[] = [];
    let moved = 0;

    for (const pr of pullRequests) {
        try {
            await toolkit.github.rest.issues.removeLabel({ owner, repo, issue_number: pr.number, name: currentLabel });
        } catch (error) {
            // A 404 means the label is already gone — someone changed the milestone
            // between the query and now. Adding the next label would overwrite that
            // deliberate change, so leave the PR alone.
            if (isNotFound(error)) {
                toolkit.core.info(`Skipping #${pr.number}: "${currentLabel}" was removed in the meantime (${pr.title})`);
                continue;
            }
            failed.push(pr.number);
            toolkit.core.error(`Failed to remove "${currentLabel}" from #${pr.number}: ${errorMessage(error)}`);
            continue;
        }

        try {
            // addLabels creates the label on the fly if it doesn't exist yet.
            await toolkit.github.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels: [nextLabel] });
        } catch (error) {
            // The PR now carries no milestone label at all, so name it explicitly.
            failed.push(pr.number);
            toolkit.core.error(`Removed "${currentLabel}" from #${pr.number} but failed to add "${nextLabel}": ${errorMessage(error)} — this PR has no milestone label now`);
            continue;
        }

        ++moved;
        toolkit.core.info(`Moved label on #${pr.number}: "${currentLabel}" -> "${nextLabel}" (${pr.title})`);
    }

    toolkit.core.info(`Moved "${currentLabel}" to "${nextLabel}" on ${moved} of ${pullRequests.length} PR(s) in ${owner}/${repo}.`);

    if (failed.length > 0) {
        throw new Error(`Failed to move "${currentLabel}" on ${failed.length} PR(s) in ${owner}/${repo}: ${failed.map(n => `#${n}`).join(", ")}`);
    }
}

/** True when the error is an Octokit HTTP error with status 404. */
function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "status" in error && (error as { status: unknown }).status === 404;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The permanent maintenance branch of a version's line, e.g. "6.6.x" for
 * "6.6.10.25". Whether that branch exists is what separates a maintained LTS line
 * from the current one: 6.6.x and 6.5.x exist, 6.7.x never will, because the
 * current major is developed on the default branch and cut into 6.7.N.x branches.
 */
function maintenanceBranchOf(version: string): string | undefined {
    const matches = VERSION_REGEX.exec(version);

    return matches ? `${matches[1]}.${matches[2]}.x` : undefined;
}

/**
 * bumpHotfixVersion returns the next version by incrementing the fourth segment,
 * e.g. "6.6.10.25" -> "6.6.10.26". A maintenance line counts there; only the
 * current line opens a new minor for every release.
 */
function bumpHotfixVersion(version: string): string | undefined {
    const matches = VERSION_REGEX.exec(version);
    if (!matches) {
        return undefined;
    }

    return `${matches[1]}.${matches[2]}.${matches[3]}.${parseInt(matches[4], 10) + 1}`;
}

async function branchExists(toolkit: Toolkit, owner: string, repo: string, branch: string): Promise<boolean> {
    try {
        await toolkit.github.rest.repos.getBranch({ owner, repo, branch });
        return true;
    } catch (error) {
        if (isNotFound(error)) {
            return false;
        }
        throw error;
    }
}

export type MoveLtsMilestoneLabelsOptions = {
    /** The released maintenance version, e.g. "6.6.10.25". */
    version: string;
    /** Repository owner. Defaults to "shopware". */
    owner?: string;
    /** Repository name. Defaults to "shopware". */
    repo?: string;
    /** Overrides the DRY_RUN env detection when provided. */
    dryRun?: boolean;
};

/**
 * moveLtsMilestoneLabels moves `milestone/<version>` to the next hotfix version on
 * every open PR targeting the maintenance branch of that line.
 *
 * A maintenance line has no branch-off: the branch is permanent and a release is
 * the only event that closes a milestone, so this is the LTS counterpart of
 * {@link moveMilestoneLabelsToNextVersion}, which bumps the minor instead and
 * deliberately skips these PRs.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param options - see {@link MoveLtsMilestoneLabelsOptions}
 */
export async function moveLtsMilestoneLabels(toolkit: Toolkit, options: MoveLtsMilestoneLabelsOptions): Promise<void> {
    const owner = options.owner ?? "shopware";
    const repo = options.repo ?? "shopware";
    const dryRun = options.dryRun ?? isDryRun();

    const nextVersion = bumpHotfixVersion(options.version);
    const branch = maintenanceBranchOf(options.version);
    if (!nextVersion || !branch) {
        throw new Error(`"${options.version}" is not a valid version (expected e.g. "6.6.10.25").`);
    }

    const currentLabel = `milestone/${options.version}`;
    const nextLabel = `milestone/${nextVersion}`;

    if (dryRun) {
        toolkit.core.info("Running in DRY RUN mode - no labels will be created or changed.");
    }

    const candidates = await findOpenPullRequestsWithLabel(toolkit, owner, repo, currentLabel);
    const pullRequests = candidates.filter(pr => pr.baseRefName === branch);

    for (const pr of candidates.filter(pr => pr.baseRefName !== branch)) {
        toolkit.core.info(`Skipping #${pr.number}: targets "${pr.baseRefName}", not the maintenance branch "${branch}" (${pr.title})`);
    }

    if (pullRequests.length === 0) {
        toolkit.core.info(`No open PRs against "${branch}" carry "${currentLabel}" in ${owner}/${repo}.`);
        return;
    }

    await applyLabelMove(toolkit, { owner, repo, currentLabel, nextLabel, pullRequests, dryRun });
}

export type CloseCompletedMilestonesOptions = {
    /** Repository owner. Defaults to "shopware". */
    owner?: string;
    /** Repository name. Defaults to "shopware". */
    repo?: string;
    /** Overrides the DRY_RUN env detection when provided. */
    dryRun?: boolean;
};

/**
 * hasReleaseTag reports whether the repository carries a `v<version>` tag, i.e.
 * whether that version was actually released.
 *
 * Each candidate is looked up individually instead of listing every tag: the
 * platform repository has well over a thousand tags, and only a handful of
 * milestones are ever open at the same time.
 */
async function hasReleaseTag(toolkit: Toolkit, owner: string, repo: string, version: string): Promise<boolean> {
    try {
        await toolkit.github.rest.git.getRef({ owner, repo, ref: `tags/v${version}` });
        return true;
    } catch (error) {
        if (isNotFound(error)) {
            return false;
        }
        throw error;
    }
}

/**
 * closeCompletedMilestones closes every open milestone that has already
 * shipped. A milestone qualifies when all three hold:
 *
 * 1. its title is a full four-segment version (so the "6.8"/"6.9" umbrella
 *    milestones for major releases are never touched),
 * 2. it has no open issues left, and
 * 3. a matching `v<version>` tag exists, proving the version was released.
 *
 * Without (3) a milestone that is merely empty — created early for an upcoming
 * patch — would be closed before anything shipped. Without (2) a PR that missed
 * the merge window would be left hanging on a closed milestone: its label is
 * moved by {@link moveMilestoneLabelsToNextVersion}, but the milestone itself is
 * reassigned by a separate workflow reacting to that label change, which may not
 * have run yet. Such a milestone simply stays open and is closed by the next
 * release run.
 *
 * Every milestone is attempted independently. If some fail, the rest are still
 * processed and the function throws once at the end listing the failures.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param options - see {@link CloseCompletedMilestonesOptions}
 */
export async function closeCompletedMilestones(toolkit: Toolkit, options: CloseCompletedMilestonesOptions = {}): Promise<void> {
    const owner = options.owner ?? "shopware";
    const repo = options.repo ?? "shopware";
    const dryRun = options.dryRun ?? isDryRun();

    if (dryRun) {
        toolkit.core.info("Running in DRY RUN mode - no milestones will be closed.");
    }

    const milestones: { number: number, title: string, open_issues: number }[] = await toolkit.github.paginate(
        toolkit.github.rest.issues.listMilestones,
        { owner, repo, state: "open", per_page: 100 },
    );

    const completed: typeof milestones = [];

    for (const milestone of milestones) {
        if (!VERSION_REGEX.test(milestone.title)) {
            continue;
        }
        if (milestone.open_issues > 0) {
            toolkit.core.info(`Keeping "${milestone.title}" open: ${milestone.open_issues} open issue(s) left.`);
            continue;
        }
        if (!await hasReleaseTag(toolkit, owner, repo, milestone.title)) {
            toolkit.core.info(`Keeping "${milestone.title}" open: no "v${milestone.title}" tag, so it has not been released yet.`);
            continue;
        }
        completed.push(milestone);
    }

    if (completed.length === 0) {
        toolkit.core.info(`No released milestones to close in ${owner}/${repo}.`);
        return;
    }

    if (dryRun) {
        toolkit.core.info(`${completed.length} milestone(s) in ${owner}/${repo} would be closed:`);
        for (const milestone of completed) {
            toolkit.core.info(`  - ${milestone.title}`);
        }
        return;
    }

    /** Milestones that could not be closed, collected so one failure can't hide the rest. */
    const failed: string[] = [];

    for (const milestone of completed) {
        try {
            await toolkit.github.rest.issues.updateMilestone({
                owner,
                repo,
                milestone_number: milestone.number,
                state: "closed",
            });
            toolkit.core.info(`Closed milestone "${milestone.title}".`);
        } catch (error) {
            failed.push(milestone.title);
            toolkit.core.error(`Failed to close milestone "${milestone.title}": ${errorMessage(error)}`);
        }
    }

    toolkit.core.info(`Closed ${completed.length - failed.length} of ${completed.length} released milestone(s) in ${owner}/${repo}.`);

    if (failed.length > 0) {
        throw new Error(`Failed to close ${failed.length} milestone(s) in ${owner}/${repo}: ${failed.join(", ")}`);
    }
}

/**
 * updateMilestonesOnRelease updates the milestones on release: it moves the
 * label of any PR that didn't get merged in the merge window to the next
 * version, and closes the milestones of versions that have shipped. It reads
 * the released version from the `TAG` environment variable (e.g. "v6.7.10.0")
 * and operates on shopware/shopware.
 *
 * Both steps run even if the other fails, so a single unlabelable PR cannot
 * leave the milestone open for good.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 */
export async function updateMilestonesOnRelease(toolkit: Toolkit) {
    if (process.env.TAG === undefined) {
        toolkit.core.error("Environment variable TAG is missing!");
        return 1;
    }
    const version = process.env.TAG.substring(1);
    if (!VERSION_REGEX.test(version)) {
        toolkit.core.error("Environment variable TAG has a wrong value!");
        return 1;
    }

    // A maintenance line counts in the fourth segment and has no branch-off, so the
    // trunk rule would bump it to a minor that will never be released.
    const maintenanceBranch = maintenanceBranchOf(version);
    const isMaintenanceLine = maintenanceBranch !== undefined && await branchExists(toolkit, "shopware", "shopware", maintenanceBranch);

    let moveError: unknown;
    try {
        if (isMaintenanceLine) {
            await moveLtsMilestoneLabels(toolkit, { version });
        } else {
            await moveMilestoneLabelsToNextVersion(toolkit, { version });
        }
    } catch (error) {
        moveError = error;
    }

    await closeCompletedMilestones(toolkit);

    if (moveError) {
        throw moveError;
    }
}

export type EnsureReleaseMilestoneOptions = {
    /** The version the milestone is for, e.g. "6.7.15.0". */
    version: string;
    /** Planned release date as `YYYY-MM-DD`, used as the milestone's due date. */
    dueOn: string;
    /** Human-readable release date for the description, e.g. "Monday, October 5, 2026". */
    releaseDate: string;
    /** Human-readable branch-off date for the description. */
    branchOffDate: string;
    /** Repository owner. Defaults to "shopware". */
    owner?: string;
    /** Repository name. Defaults to "shopware". */
    repo?: string;
    /** Overrides the DRY_RUN env detection when provided. */
    dryRun?: boolean;
};

function milestoneDescription(options: EnsureReleaseMilestoneOptions): string {
    return [
        `Planned on-prem release: ${options.releaseDate}.`,
        `Branch-off: ${options.branchOffDate}.`,
        "Generated from the release schedule. Patch releases are not planned ahead and carry no date.",
    ].join(" ");
}

/**
 * ensureReleaseMilestone makes the milestone for an upcoming release exist ahead
 * of time, carrying the planned release date as its due date so the repository's
 * milestone page doubles as a public release schedule.
 *
 * It only ever fills in what is missing and never overwrites a value that is
 * already there. A release that slips is corrected by hand — in the milestone and
 * in the release thread — and this must not silently revert that correction on its
 * next run.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param options - see {@link EnsureReleaseMilestoneOptions}
 */
export async function ensureReleaseMilestone(toolkit: Toolkit, options: EnsureReleaseMilestoneOptions): Promise<void> {
    const owner = options.owner ?? "shopware";
    const repo = options.repo ?? "shopware";
    const dryRun = options.dryRun ?? isDryRun();

    if (!VERSION_REGEX.test(options.version)) {
        throw new Error(`"${options.version}" is not a valid version (expected e.g. "6.7.15.0").`);
    }

    const dueOn = `${options.dueOn}T00:00:00Z`;
    const description = milestoneDescription(options);
    const existing = await getMilestoneByTitle(toolkit, repo, options.version, owner);

    if (!existing) {
        if (dryRun) {
            toolkit.core.info(`Would create milestone "${options.version}" in ${owner}/${repo}, due ${options.dueOn}.`);
            return;
        }

        await toolkit.github.rest.issues.createMilestone({ owner, repo, title: options.version, due_on: dueOn, description });
        toolkit.core.info(`Created milestone "${options.version}" in ${owner}/${repo}, due ${options.dueOn}.`);
        return;
    }

    if (existing.state === "closed") {
        toolkit.core.info(`Leaving milestone "${options.version}" alone: it is already closed.`);
        return;
    }

    const update: { due_on?: string, description?: string } = {};

    if (!existing.due_on) {
        update.due_on = dueOn;
    } else if (existing.due_on.slice(0, 10) !== options.dueOn) {
        toolkit.core.info(`Keeping the due date of "${options.version}": it is set to ${existing.due_on.slice(0, 10)}, not the scheduled ${options.dueOn}.`);
    }

    if (!existing.description) {
        update.description = description;
    }

    if (Object.keys(update).length === 0) {
        toolkit.core.info(`Milestone "${options.version}" is already complete, nothing to fill in.`);
        return;
    }

    if (dryRun) {
        toolkit.core.info(`Would fill in ${Object.keys(update).join(" and ")} on milestone "${options.version}".`);
        return;
    }

    await toolkit.github.rest.issues.updateMilestone({ owner, repo, milestone_number: existing.number, ...update });
    toolkit.core.info(`Filled in ${Object.keys(update).join(" and ")} on milestone "${options.version}".`);
}

export type ScheduleReleaseMilestoneOptions = {
    /** The version to schedule, e.g. "6.7.15.0". */
    version: string;
    /** Repository owner. Defaults to "shopware". */
    owner?: string;
    /** Repository name. Defaults to "shopware". */
    repo?: string;
    /** Overrides the DRY_RUN env detection when provided. */
    dryRun?: boolean;
};

/**
 * The most recently released minor of a release line, e.g. `6.7.14.0` for line
 * `6.7`. Only the first page of releases is read: minors ship monthly, so the
 * newest one is always far inside the 100 most recent releases.
 */
async function lastReleasedMinor(toolkit: Toolkit, owner: string, repo: string, line: string): Promise<{ patch: number, releasedAt: Date } | undefined> {
    const { data } = await toolkit.github.rest.repos.listReleases({ owner, repo, per_page: 100 });
    const minorTag = new RegExp(`^v${line.replace(/\./g, "\\.")}\\.(\\d+)\\.0$`);

    let newest: { patch: number, releasedAt: Date } | undefined;

    for (const release of data) {
        if (release.draft || release.prerelease || !release.published_at) {
            continue;
        }

        const patch = minorTag.exec(release.tag_name)?.[1];
        if (patch === undefined) {
            continue;
        }

        const candidate = { patch: parseInt(patch, 10), releasedAt: new Date(release.published_at) };
        if (!newest || candidate.patch > newest.patch) {
            newest = candidate;
        }
    }

    return newest;
}

/**
 * scheduleReleaseMilestone gives the milestone of an upcoming minor its planned
 * dates, creating the milestone if no PR has been labelled for it yet.
 *
 * The dates are derived from the last released minor of the same line rather than
 * from today, so this is correct whenever it runs. Between a branch-off and the
 * release that follows it, two minors are in flight and the calendar alone cannot
 * say which one a date belongs to.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param options - see {@link ScheduleReleaseMilestoneOptions}
 */
export async function scheduleReleaseMilestone(toolkit: Toolkit, options: ScheduleReleaseMilestoneOptions): Promise<void> {
    const owner = options.owner ?? "shopware";
    const repo = options.repo ?? "shopware";

    const matches = VERSION_REGEX.exec(options.version);
    if (!matches) {
        throw new Error(`"${options.version}" is not a valid version (expected e.g. "6.7.15.0").`);
    }
    if (matches[4] !== "0") {
        throw new Error(`"${options.version}" is a patch release. Patch releases are not planned ahead and get no date.`);
    }

    const line = `${matches[1]}.${matches[2]}`;
    const anchor = await lastReleasedMinor(toolkit, owner, repo, line);

    if (!anchor) {
        toolkit.core.warning(`No released minor found for line ${line} in ${owner}/${repo}, cannot derive a date for "${options.version}".`);
        return;
    }

    const monthsAhead = parseInt(matches[3], 10) - anchor.patch;
    if (monthsAhead < 1) {
        toolkit.core.info(`"${options.version}" is not ahead of the last released minor ${line}.${anchor.patch}.0, nothing to schedule.`);
        return;
    }

    const schedule = scheduleForMinor(anchor.releasedAt, monthsAhead);
    toolkit.core.info(`Scheduling "${options.version}", ${monthsAhead} cycle(s) after ${line}.${anchor.patch}.0: release ${schedule.releaseDateIso}, branch-off ${schedule.branchoffDateIso}.`);

    await ensureReleaseMilestone(toolkit, {
        version: options.version,
        dueOn: schedule.releaseDateIso,
        releaseDate: schedule.releaseDate,
        branchOffDate: schedule.branchoffDate,
        owner,
        repo,
        dryRun: options.dryRun,
    });
}

/**
 * syncMilestoneForPR makes the milestone field of a pull request follow its
 * `milestone/*` label, so an open pull request already counts towards the release
 * it is planned for instead of appearing only once it is merged.
 *
 * Without this the milestone of an unreleased version shows every item as done,
 * because nothing enters it before merging, which makes it useless for planning.
 *
 * A pull request closed without merging loses its milestone again — GitHub counts
 * every closed item as completed, so an abandoned one would otherwise inflate the
 * progress of the release. A linked issue keeps its milestone in that case: the
 * issue is planned in its own right, and abandoning one attempt at it is not a
 * decision to drop it from the release.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 */
export async function syncMilestoneForPR(toolkit: Toolkit): Promise<void> {
    const pr = toolkit.context.payload.pull_request;
    if (!pr) {
        throw new Error("This function can only be called on 'pull_request' workflows.");
    }

    const { owner, repo } = toolkit.context.repo;
    const labels: { name: string }[] = pr.labels ?? [];
    const milestoneLabel = labels.find(label => label.name.startsWith("milestone/"));
    const abandoned = toolkit.context.payload.action === "closed" && !pr.merged;

    if (abandoned || !milestoneLabel) {
        if (!pr.milestone) {
            toolkit.core.info(`#${pr.number} carries no milestone, nothing to clear.`);
            return;
        }

        await toolkit.github.rest.issues.update({ owner, repo, issue_number: pr.number, milestone: null });
        toolkit.core.info(abandoned
            ? `Cleared the milestone of #${pr.number}: closed without merging.`
            : `Cleared the milestone of #${pr.number}: it has no milestone label.`);
        return;
    }

    const milestoneTitle = milestoneLabel.name.split("/")[1];
    let milestone = await getMilestoneByTitle(toolkit, repo, milestoneTitle, owner);

    if (!milestone) {
        toolkit.core.info(`Couldn't find a milestone with the title "${milestoneTitle}". Creating one...`);
        milestone = (await toolkit.github.rest.issues.createMilestone({ owner, repo, title: milestoneTitle })).data;
    }

    const linkedIssue = await getDevelopmentIssueForPullRequest(toolkit, `${owner}/${repo}`, pr.number, pr.head, pr.assignee);
    if (linkedIssue && linkedIssue.number) {
        await toolkit.github.rest.issues.update({ owner, repo, issue_number: linkedIssue.number, milestone: milestone.number });
        toolkit.core.info(`Set milestone "${milestoneTitle}" on the issue linked to #${pr.number} (#${linkedIssue.number}).`);
        return;
    }

    if (pr.milestone?.number === milestone.number) {
        toolkit.core.info(`#${pr.number} is already on milestone "${milestoneTitle}".`);
        return;
    }

    await toolkit.github.rest.issues.update({ owner, repo, issue_number: pr.number, milestone: milestone.number });
    toolkit.core.info(`Set milestone "${milestoneTitle}" on #${pr.number}.`);
}
