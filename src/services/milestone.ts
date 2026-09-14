import { getMilestoneByTitle } from "../api";
import { Toolkit } from "../types";
import { isDryRun } from "../util/dry_run";
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

    let moveError: unknown;
    try {
        await moveMilestoneLabelsToNextVersion(toolkit, { version });
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
