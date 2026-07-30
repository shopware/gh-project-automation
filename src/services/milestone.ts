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

/**
 * updateMilestonesOnRelease updates the milestones on release if a PR didn't
 * get merged in the merge window. It reads the released version from the `TAG`
 * environment variable (e.g. "v6.7.10.0") and delegates to
 * {@link moveMilestoneLabelsToNextVersion} for shopware/shopware.
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

    await moveMilestoneLabelsToNextVersion(toolkit, { version });
}
