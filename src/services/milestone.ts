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

export type MoveMilestoneLabelsOptions = {
    /** Current version whose milestone label should be moved, e.g. "6.7.10.0". */
    version: string;
    /** Repository owner. Defaults to "shopware". */
    owner?: string;
    /** Repository name. Defaults to "shopware". */
    repo?: string;
    /**
     * When set, only PRs targeting this base branch are relabelled. PRs
     * targeting a release branch follow a different milestone scheme and must
     * not be bumped, so callers relabelling trunk PRs should pass "trunk".
     * When omitted, PRs targeting any base branch are relabelled.
     */
    baseRefName?: string;
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

/**
 * findOpenPullRequestsWithLabel returns all open PRs carrying `label`,
 * optionally restricted to those targeting `baseRefName`. Paginates through
 * every result page.
 */
async function findOpenPullRequestsWithLabel(toolkit: Toolkit, owner: string, repo: string, label: string, baseRefName?: string): Promise<{ number: number, title: string }[]> {
    const query = `
      query ($owner: String!, $repo: String!, $label: String!, $baseRefName: String, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequests(labels: [$label], baseRefName: $baseRefName, states: OPEN, first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { number title }
          }
        }
      }`;

    const pullRequests: { number: number, title: string }[] = [];
    let after: string | undefined = undefined;

    do {
        const res: {
            repository: {
                pullRequests: {
                    pageInfo: { hasNextPage: boolean, endCursor: string | null },
                    nodes: { number: number, title: string }[],
                }
            }
        } = await toolkit.github.graphql(query, { owner, repo, label, baseRefName: baseRefName ?? null, after });

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

    // PRs targeting a version branch follow a different milestone scheme, so
    // callers pass baseRefName ("trunk") to leave those untouched.
    const pullRequests = await findOpenPullRequestsWithLabel(toolkit, owner, repo, currentLabel, options.baseRefName);

    if (pullRequests.length === 0) {
        toolkit.core.info(`No open PRs with label "${currentLabel}" found in ${owner}/${repo}.`);
        return;
    }

    if (dryRun) {
        toolkit.core.info(`${pullRequests.length} open PR(s) in ${owner}/${repo} would have "${currentLabel}" moved to "${nextLabel}":`);
        for (const pr of pullRequests) {
            toolkit.core.info(`  - #${pr.number} ${pr.title}`);
        }
        return;
    }

    for (const pr of pullRequests) {
        await toolkit.github.rest.issues.removeLabel({ owner, repo, issue_number: pr.number, name: currentLabel });
        // addLabels creates the label on the fly if it doesn't exist yet.
        await toolkit.github.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels: [nextLabel] });
        toolkit.core.info(`Moved label on #${pr.number}: "${currentLabel}" -> "${nextLabel}" (${pr.title})`);
    }

    toolkit.core.info(`Moved "${currentLabel}" to "${nextLabel}" on ${pullRequests.length} PR(s) in ${owner}/${repo}.`);
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
