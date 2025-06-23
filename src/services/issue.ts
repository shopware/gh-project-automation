import {
    GitHubComment,
    GitHubIssue,
    Label,
    Labelable,
    QueryResponse,
    Toolkit
} from "../types";

import {
    addComment,
    addLabelToLabelable, closePullRequest,
    findIssueWithProjectItems,
    findPRWithProjectItems,
    getCommentsForIssue,
    getIssuesByProject,
    getLabelByName,
    getPullRequests,
    jiraHost
} from "../api";

import {sendSlackMessageForGithubUser} from "./slack";

export const docIssueReference = Buffer.from("doc-issue-created").toString("base64");

/**
 * getDevelopmentIssueForPullRequest fetches the development issue linked to a pull request.
 *
 * @remarks
 * This function searches for pull requests in the Shopware organization that match the given head and assignee.
 * It retrieves the first closing issue reference from the matching pull requests.
 * If a matching development issue is found, it returns the issue details; otherwise, it returns null.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param repo - The repository to search in, formatted as "owner/repo".
 * @param pullRequestNumber - The number of the pull request to search for.
 * @param pullRequestHead - The head branch of the pull request.
 * @param pullRequestAssignee - The assignee of the pull request.
 */
export async function getDevelopmentIssueForPullRequest(toolkit: Toolkit, repo: string, pullRequestNumber: number, pullRequestHead: string, pullRequestAssignee: string): Promise<GitHubIssue | null> {
    const pullRequests = await getPullRequests(
        toolkit,
        `repo:${repo} is:pr assignee:${pullRequestAssignee} head:${pullRequestHead}`
    );

    const matchingPullRequests = pullRequests.filter(pr => pr.number === pullRequestNumber);
    const developmentIssue = matchingPullRequests.length > 0 ? matchingPullRequests[0]?.closingIssuesReferences?.nodes[0] : null;

    if (developmentIssue) {
        return {
            id: developmentIssue.id,
            title: developmentIssue.title,
            number: developmentIssue.number,
            url: developmentIssue.url,
            labels: [],
            owner: developmentIssue.repository.owner.login,
            repository: developmentIssue.repository.name
        };
    } else {
        toolkit.core.info(`No development issue found for PR #${pullRequestNumber}`);
        return null;
    }
}

/**
 * getEpicsInProgressByProject fetches all epics in progress from a project.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param projectId - The ID of the project to fetch issues from.
 */
export async function getEpicsInProgressByProject(toolkit: Toolkit, projectId: string): Promise<GitHubIssue[]> {
    const res = await getIssuesByProject(toolkit, projectId);

    return res.filter((item) => {
        return item.status?.toLowerCase() === "in progress" && item.type?.toLowerCase() === "epic";
    })
}

/**
 * createDocIssueComment creates a comment on a GitHub issue that references a documentation issue.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param issueId - The ID of the issue to comment on.
 * @param docIssueKey - The key of the documentation issue to reference.
 * @param content - The comment to add.
 */
export async function createDocIssueComment(toolkit: Toolkit, issueId: string, docIssueKey: string, content: string | null = null): Promise<GitHubComment> {
    const commentBody = `${content ?? "A documentation Task has been created for this issue:"} [${docIssueKey}](https://${jiraHost}/browse/${docIssueKey}). <!-- ${docIssueReference} -->`;

    const comment = await addComment(toolkit, issueId, commentBody);

    toolkit.core.info(`Created documentation issue reference comment: ${comment.url}`);

    return comment;
}

/**
 * hasDocIssueComment checks if a GitHub issue has a comment that references a documentation issue.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param issueId - The ID of the issue to check.
 */
export async function hasDocIssueComment(toolkit: Toolkit, issueId: string) {
    const comments = await getCommentsForIssue(toolkit, issueId);

    for (const comment of comments) {
        if (referencesDocIssue(comment)) {
            return true;
        }
    }

    return false;
}

/**
 * referencesDocIssue checks if a comment contains a link to a documentation issue.
 *
 * @param comment - The comment to check.
 */
export function referencesDocIssue(comment: GitHubComment) {
    return comment.body.includes(docIssueReference)
}

async function manageNeedsTriageLabel(toolkit: Toolkit, labelable: Labelable, needsTriageLabel: Label, dryRun: boolean) {
    const labels = labelable.labels.nodes.map((label: {
        name: string
    }) => label.name);
    const hasNeedsTriage = labels.includes("needs-triage");
    const hasDomainOrServiceLabel = labels.some((label: string) =>
        label.startsWith("domain/") || label.startsWith("service/")
    );

    if (hasDomainOrServiceLabel && hasNeedsTriage) {
        if (dryRun) {
            toolkit.core.info(`Would remove needs-triage label from #${labelable.number}: ${labelable.title} (has domain/service label)`);
        } else {
            await toolkit.github.graphql(/* GraphQL */ `
                mutation removeLabel($labelableId: ID!, $labelIds: [ID!]!) {
                    removeLabelsFromLabelable(input: {
                        labelableId: $labelableId,
                        labelIds: $labelIds
                    }) {
                        clientMutationId
                    }
                }
            `, {
                labelableId: labelable.id,
                labelIds: [needsTriageLabel.id]
            });
            toolkit.core.info(`Removed needs-triage label from #${labelable.number}: ${labelable.title} (has domain/service label)`);
        }
    } else if (!hasNeedsTriage && !hasDomainOrServiceLabel) {
        if (dryRun) {
            toolkit.core.info(`Would add needs-triage label to #${labelable.number}: ${labelable.title}`);
        } else {
            await addLabelToLabelable(toolkit, needsTriageLabel.id, labelable.id);
            toolkit.core.info(`Added needs-triage label to #${labelable.number}: ${labelable.title}`);
        }
    }
}

/**
 * Cleans up needs-triage in issues and pull requests
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param dryRun - If true, only log what would be done without making changes.
 *
 * @remarks
 * This function finds all open issues and pull requests and ensures they have either:
 * - The needs-triage label, or
 * - A label starting with 'domain/' or 'service/'
 * - If an item has a `domain/` or `service/` label, remove the `needs-triage` label
 *
 * Closed items are ignored. The function handles pagination to process all items.
 */
export async function cleanupNeedsTriage(toolkit: Toolkit, dryRun: boolean = false) {
    const needsTriageLabel = await getLabelByName(toolkit, "shopware", "needs-triage");
    if (!needsTriageLabel) {
        throw new Error("Couldn't find the needs-triage label");
    }

    let processedItems = 0;

    // Process issues
    let hasNextPageIssues = true;
    let cursorIssues: string | null = null;

    while (hasNextPageIssues) {
        const res: QueryResponse = await toolkit.github.graphql<QueryResponse>(/* GraphQL */ `
            query getOpenIssues($cursor: String) {
                repository(owner: "shopware", name: "shopware") {
                    issues(first: 100, after: $cursor, states: OPEN) {
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                        nodes {
                            id
                            number
                            title
                            labels(first: 20) {
                                nodes {
                                    name
                                }
                            }
                        }
                    }
                }
            }
        `, {
            cursor: cursorIssues
        });

        const issues = res.repository.issues?.nodes ?? [];
        hasNextPageIssues = res.repository.issues?.pageInfo.hasNextPage ?? false;
        cursorIssues = res.repository.issues?.pageInfo.endCursor ?? null;

        for (const item of issues) {
            await manageNeedsTriageLabel(toolkit, item, needsTriageLabel, dryRun);
        }

        processedItems += issues.length;
        toolkit.core.info(`Processed ${processedItems} items so far...`);
    }

    // Process pull requests
    let hasNextPagePRs = true;
    let cursorPRs: string | null = null;

    while (hasNextPagePRs) {
        const res: QueryResponse = await toolkit.github.graphql<QueryResponse>(/* GraphQL */ `
            query getOpenPRs($cursor: String) {
                repository(owner: "shopware", name: "shopware") {
                    pullRequests(first: 100, after: $cursor, states: OPEN) {
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                        nodes {
                            id
                            number
                            title
                            labels(first: 20) {
                                nodes {
                                    name
                                }
                            }
                        }
                    }
                }
            }
        `, {
            cursor: cursorPRs
        });

        const pullRequests = res.repository.pullRequests?.nodes ?? [];
        hasNextPagePRs = res.repository.pullRequests?.pageInfo.hasNextPage ?? false;
        cursorPRs = res.repository.pullRequests?.pageInfo.endCursor ?? null;

        for (const item of pullRequests) {
            await manageNeedsTriageLabel(toolkit, item, needsTriageLabel, dryRun);
        }

        processedItems += pullRequests.length;
        toolkit.core.info(`Processed ${processedItems} items so far...`);
    }

    toolkit.core.info(`Finished processing ${processedItems} items`);
}

export async function findWithProjectItems(toolkit: Toolkit) {
    if (toolkit.context.payload.issue) {
        return await findIssueWithProjectItems(toolkit, toolkit.context.payload.issue.number);
    } else if (toolkit.context.payload.pull_request) {
        return await findPRWithProjectItems(toolkit, toolkit.context.payload.pull_request.number);
    } else {
        throw new Error('only issue and pull_request events are supported');
    }
}

/**
 * manageOldPullRequests checks for old pull requests and sends a reminder message to the assignee.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param organization - The GitHub organization to check for old pull requests.
 * @param days - Consider pull requests old after this many days of inactivity.
 * @param close - If true, the pull request will be closed after sending the reminder.
 */
export async function manageOldPullRequests(toolkit: Toolkit, organization: string = "shopware", days: number = 7, close: boolean = false) {
    const pullRequests = await getPullRequests(
        toolkit,
        `org:${organization} is:pr is:open updated:<${new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()}`
    );

    for (const pr of pullRequests) {
        const assignee = pr.assignees.nodes[0];
        const baseMsg = `Hi @${assignee.login}, this pull request (${pr.repository.owner}/${pr.repository.name}#${pr.number}: "${pr.title}") has not been updated in over ${days} days. Please take a look and update it if needed: ${pr.url}`
        const closeMsg = `The pull request has been closed automatically. If you would like to continue working on it, please feel free to re-open it!`;
        const message = close ? `${baseMsg}\n\n${closeMsg}` : baseMsg;

        if (!assignee) {
            toolkit.core.info(`Pull request ${pr.repository.owner}/${pr.repository.name}#${pr.number} has no assignee, skipping.`);

            continue;
        }

        if (close) {
            toolkit.core.info(`Closing pull request ${pr.repository.owner}/${pr.repository.name}#${pr.number}.`);

            await closePullRequest(toolkit, pr.id);
        }

        await sendSlackMessageForGithubUser(toolkit, assignee.login, organization, message);
    }
}
