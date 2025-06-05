import {
    GitHubComment,
    GitHubIssue,
    JiraIssue,
    Label,
    Labelable,
    QueryResponse,
    Toolkit
} from './types';

import {
    addLabelToLabelable,
    addProjectItem,
    closeIssue,
    findIssueWithProjectItems,
    findPRWithProjectItems,
    getCommentsForIssue,
    getIssuesByProject,
    getLabelByName,
    getProjectIdByNumber,
    getProjectInfo,
    setFieldValue
} from "./api/github";

const jiraHost = "shopware.atlassian.net";
const jiraBaseUrl = `https://${jiraHost}/rest/api/3`;
const docIssueReference = Buffer.from("doc-issue-created").toString("base64");

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
 * Sets the status of issues in projects using the provided toolkit.
 *
 * @param toolkit - The toolkit instance to interact with the project management system.
 * @param props - The properties for setting the status.
 * @param props.toStatus - The status to set the issues to.
 * @param props.fromStatus - (Optional) The status to filter issues by before setting the new status. Can be a string which has to match exactly or an instance of RegExp
 *
 * @remarks
 * This function finds issues in projects and updates their status based on the provided `toStatus`.
 * If `fromStatus` is provided, only issues with the matching status will be updated.
 * If the `toStatus` option is not found in the project's status options, the issue will be skipped.
 *
 * @example
 * ```typescript
 * await setStatusInProjects({ github, context, core, exec, glob, io, fetch }, { toStatus: 'In Progress', fromStatus: 'Done' });
 * ```
 */
export async function setStatusInProjects(toolkit: Toolkit, props: { toStatus: string, fromStatus?: string | RegExp }) {
    const issue = await findWithProjectItems(toolkit);

    for (const i in issue.projectItems) {
        const item = issue.projectItems[i];
        const projectInfo = await getProjectInfo(toolkit, { number: item.project.number })
        const statusField = projectInfo.fields.find(field => field.name == "Status");
        const toStatusOption = statusField?.options.find(x => x.name.toLowerCase() === props.toStatus.toLowerCase())

        if (!toStatusOption) {
            toolkit.core.debug(`Option "${props.toStatus}" not found in project ${item.project.number}`)
            continue;
        }

        if (props.fromStatus instanceof RegExp) {
            if (!item.fieldValueByName.name.match(props.fromStatus)) {
                toolkit.core.debug(`skipping: issue/pr ${issue.number} status ${item.fieldValueByName} did not match ${props.fromStatus} in project ${item.project.number}`);
                continue;
            }
        } else if (props.fromStatus && item.fieldValueByName.name.toLowerCase() !== props.fromStatus.toLowerCase()) {
            toolkit.core.debug(`skipping: issue/pr ${issue.number} status != ${props.fromStatus} in project ${item.project.number}`)
            continue;
        }

        toolkit.core.info(`get item in project ${item.project.number} for issue/pr ${issue.number}`)
        const itemId = (await addProjectItem(toolkit, { projectId: projectInfo.node_id, issueId: issue.node_id })).node_id

        await setFieldValue(toolkit, { projectId: projectInfo.node_id, itemId, fieldId: statusField!.id, valueId: toStatusOption.id })
    }
}

export async function syncPriorities(toolkit: Toolkit) {
    const FRAMEWORK_GROUP_PROJECT_NUMBER = 27;

    const issue = toolkit.context.payload.issue!;
    toolkit.core.debug(`Issue node ID: ${issue.node_id}`);

    const issueWithProjectItems = await findIssueWithProjectItems(toolkit, issue.number);
    const projectCard = issueWithProjectItems.projectItems.find(projectItem => projectItem.project.number == FRAMEWORK_GROUP_PROJECT_NUMBER);
    if (!projectCard) {
        toolkit.core.info("Issue is not part of the Framework Group project");
        return;
    }

    const priorityLabel = issue.labels.find((label: Label) =>
        label.name.startsWith("priority/")
    )?.name;

    if (!priorityLabel) {
        return;
    }
    toolkit.core.info(`Found priority label: ${priorityLabel}`);

    const priority = priorityLabel.split('/')[1];
    toolkit.core.info(`Priority: ${priority}`);

    const projectInfo = await getProjectInfo(toolkit, { number: FRAMEWORK_GROUP_PROJECT_NUMBER });
    const priorityField = projectInfo.fields.find(field => field.name == "Priority");
    const priorityOption = priorityField?.options.find(option => option.name == priority);

    if (!priorityOption) {
        throw new Error(`Unknown priority "${priority}`);
    }

    const cardId = projectCard.id;

    if (!cardId) {
        toolkit.core.warning(`Couldn't find issue ${issue.number} in project with number ${FRAMEWORK_GROUP_PROJECT_NUMBER}`);
        return;
    }

    toolkit.core.info(`Setting priority for issue ${issue.number}`);

    await setFieldValue(toolkit, {
        projectId: projectInfo.node_id,
        itemId: cardId,
        fieldId: priorityField!.id,
        valueId: priorityOption.id
    });
}

export async function markStaleIssues(toolkit: Toolkit, projectNumber: number, dryRun: boolean) {
    const DAYS_UNTIL_STALE = 180;

    const now = new Date();
    now.setDate(now.getDate() - DAYS_UNTIL_STALE);
    const staleDate = now.toISOString().split('T')[0];

    switch (Number(projectNumber)) {
        case 27: {
            const query = `
                query {
                    search(
                      type: ISSUE
                      first: 100
                      query: "repo:shopware/shopware is:issue state:open project:shopware/27 label:priority/low -label:AboutToClose -label:DoNotClose created:<=$staleDate"
                    ) {
                      pageInfo {
                        hasNextPage
                        endCursor
                      }
                      edges {
                        node {
                          ... on Issue {
                            id
                            title
                            number
                            url
                            parent {
                              issueType {
                                name
                              }
                            }
                            labels(first: 20) {
                              nodes {
                                name
                              }
                            }
                            projectItems(first: 10) {
                              nodes {
                                project {
                                    number
                                }
                                fieldValueByName(name: "Status") {
                                  ... on ProjectV2ItemFieldSingleSelectValue {
                                    name
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
              `;

            type QueryReturn = {
                search: {
                    pageInfo: {
                        hasNextPage: boolean,
                        endCursor: string
                    },
                    edges: [
                        {
                            node: {
                                id: string,
                                title: string,
                                number: number,
                                url: string,
                                parent?: {
                                    issueType: {
                                        name: string
                                    }
                                },
                                labels: {
                                    nodes: [
                                        {
                                            name: string
                                        }
                                    ]
                                },
                                projectItems: {
                                    nodes: [
                                        {
                                            project: {
                                                number: number
                                            }
                                            fieldValueByName: {
                                                name: string
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    ]
                }
            };

            // replace because GraphQL doesn't support variables in strings...
            const res = await toolkit.github.graphql<QueryReturn>(query.replace("$staleDate", staleDate), {
                headers: {
                    "GraphQL-Features": "issue_types"
                }
            });

            const issues = res.search.edges;

            for (const issueNode of issues) {
                const issue = issueNode.node;
                const parentIssueType = issue.parent?.issueType.name;
                const labels = issue.labels.nodes;
                const priorityLabel = labels.find((label) =>
                    label.name.startsWith("priority/")
                )?.name;

                const statusInProject = issue.projectItems.nodes.find((projectItem) => projectItem.project.number == 27)?.fieldValueByName.name;

                if (((priorityLabel && priorityLabel.split('/')[1] === "low") || statusInProject == "Backlog") && parentIssueType != "Epic") {
                    if (dryRun) {
                        toolkit.core.info(`Would set "${issue.title}" (${issue.url}) to AboutToClose`);
                        continue;
                    }
                    const aboutToCloseLabel = await getLabelByName(toolkit, "shopware", "AboutToClose");
                    if (!aboutToCloseLabel) {
                        throw Error("Couldn't find the AboutToClose label");
                    }
                    await addLabelToLabelable(toolkit, issue.id, aboutToCloseLabel.id);
                }
            }

            break;
        }
        default:
            throw new Error(`There is no query for the project with the number ${projectNumber}`);
    }
}

export async function closeStaleIssues(toolkit: Toolkit, dryRun: boolean) {
    const DAYS_UNTIL_CLOSE = 30;

    const now = new Date();
    now.setDate(now.getDate() - DAYS_UNTIL_CLOSE);
    const closeDate = now.toISOString().split('T')[0];

    const query = `
        query {
            search(
              type: ISSUE
              first: 100
              query: "repo:shopware/shopware is:issue state:open label:AboutToClose updated:<=$closeDate"
            ) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  ... on Issue {
                    id
                    title
                    number
                    url
                    parent {
                      issueType {
                        name
                      }
                    }
                    labels(first: 20) {
                      nodes {
                        name
                      }
                    }
                    projectItems(first: 10) {
                      nodes {
                        fieldValueByName(name: "Status") {
                          ... on ProjectV2ItemFieldSingleSelectValue {
                            name
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
    `;

    type QueryReturn = {
        search: {
            pageInfo: {
                hasNextPage: boolean,
                endCursor: string
            },
            edges: [
                {
                    node: {
                        id: string,
                        title: string,
                        number: number,
                        url: string,
                        parent?: {
                            issueType: {
                                name: string
                            }
                        },
                        labels: {
                            nodes: [
                                {
                                    name: string
                                }
                            ]
                        },
                        projectItems: {
                            nodes: [
                                {
                                    project: {
                                        number: number
                                    }
                                    fieldValueByName: {
                                        name: string
                                    }
                                }
                            ]
                        }
                    }
                }
            ]
        }
    };

    // replace because GraphQL doesn't support variables in strings...
    const res = await toolkit.github.graphql<QueryReturn>(query.replace("$closeDate", closeDate), {
        headers: {
            "GraphQL-Features": "issue_types"
        }
    });

    const issues = res.search.edges;

    for (const issueNode of issues) {
        const issue = issueNode.node;
        if (dryRun) {
            toolkit.core.info(`Would close "${issue.title}" (${issue.url})`);
            continue;
        }

        await closeIssue(toolkit, issue.id);
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

    const comment = await toolkit.github.graphql<{
        addComment: {
            commentEdge: {
                node: GitHubComment
            }
        }
    }>(`
        mutation addComment($issueId: ID!, $body: String!) {
            addComment(input: {
                subjectId: $issueId,
                body: $body
            }) {
                commentEdge {
                    node {
                        id
                        author {
                            login
                        }
                        body
                        url
                    }
                }
            }
        }
    `, {
        issueId,
        body: commentBody
    }).then(res => res.addComment.commentEdge.node);

    if (!comment || !comment.id) {
        throw new Error(`Failed to create comment: ${JSON.stringify(comment)}`);
    }

    toolkit.core.info(`Created documentation issue reference comment: ${comment.url}`);

    return comment;
}

/**
 * createDocumentationTask creates a documentation task in JIRA for a given GitHub issue.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param issue - The issue to create a documentation task for.
 * @param documentationProjectId - The ID of the documentation project.
 * @param description - The description of the documentation task.
 */
export async function createDocumentationTask(toolkit: Toolkit, issue: GitHubIssue, documentationProjectId: number | null = 11806, description: string | null = null): Promise<JiraIssue> {
    const docTask = await toolkit.fetch(`${jiraBaseUrl}/issue`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(
                `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`,
            ).toString('base64')}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fields: {
                project: {
                    id: documentationProjectId
                },
                summary: `${issue.title}`,
                description: {
                    version: 1,
                    type: "doc",
                    content: [
                        {
                            type: "paragraph",
                            content: [
                                {
                                    type: "text",
                                    text: description ?? `This issue was created automatically.`,
                                },
                                {
                                    type: "text",
                                    text: `\n\nPlease refer to the following links and/or related issues for more information:`,
                                },
                            ],
                        },
                        {
                            type: "bulletList",
                            content: [
                                {
                                    type: "listItem",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: issue.url,
                                                    marks: [
                                                        {
                                                            type: "link",
                                                            attrs: {
                                                                href: issue.url,
                                                            },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                }
                            ],
                        }
                    ],
                },
                issuetype: {
                    name: "Task",
                },
            }
        })
    }).then(res => res.json());

    if (!docTask || !docTask.key) {
        throw new Error(`Failed to create documentation task: ${JSON.stringify(docTask)}`);
    }

    toolkit.core.info(`Created documentation task in JIRA: https://${jiraHost}/browse/${docTask.key}`);

    return docTask;
}

/**
 * createDocumentationTasksForProjects creates documentation tasks for all projects with the given project numbers.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param projectNumbers - The project numbers to create documentation tasks for.
 * @param organization - The organization name whose projects to consider.
 * @param documentationProjectId - The ID of the documentation project.
 * @param description - Prefix for the description of the documentation task.
 * @param comment - Prefix for the documentation task reference comment.
 */
export async function createDocumentationTasksForProjects(toolkit: Toolkit, projectNumbers: number[], organization: string | null = "shopware", documentationProjectId: number | null = 11806, description: string | null = null, comment: string | null = null) {
    for (const projectNumber of projectNumbers) {
        const projectId = await getProjectIdByNumber(toolkit, projectNumber, organization);
        const epicsInProgress = await getEpicsInProgressByProject(toolkit, projectId);

        for (const epic of epicsInProgress) {
            if (await hasDocIssueComment(toolkit, epic.id)) {
                toolkit.core.info(`Skipping issue ${epic.url} because it already has a documentation issue reference.`);

                continue;
            }

            const docTask = await createDocumentationTask(toolkit, epic, documentationProjectId, description);
            await createDocIssueComment(toolkit, epic.id, docTask.key, comment);
        }
    }
}

async function manageNeedsTriageLabel(toolkit: Toolkit, labelable: Labelable, needsTriageLabel: Label, dryRun: boolean) {
    const labels = labelable.labels.nodes.map((label: { name: string }) => label.name);
    const hasNeedsTriage = labels.includes("needs-triage");
    const hasDomainOrServiceLabel = labels.some((label: string) =>
        label.startsWith("domain/") || label.startsWith("service/")
    );

    if (hasDomainOrServiceLabel && hasNeedsTriage) {
        if (dryRun) {
            toolkit.core.info(`Would remove needs-triage label from #${labelable.number}: ${labelable.title} (has domain/service label)`);
        } else {
            await toolkit.github.graphql(`
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
 * @param toolkit - The toolkit instance to interact with the project management system.
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
        const res: QueryResponse = await toolkit.github.graphql<QueryResponse>(`
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
        const res: QueryResponse = await toolkit.github.graphql<QueryResponse>(`
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
