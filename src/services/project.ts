import { Label, Toolkit } from "../types";

import {
    addLabelToLabelable,
    addProjectItem,
    closeIssue,
    findIssueWithProjectItems,
    getLabelByName,
    getProjectIdByNumber,
    getProjectInfo,
    setFieldValue
} from "../api";

import {
    createDocIssueComment, findWithProjectItems,
    getEpicsInProgressByProject,
    hasDocIssueComment
} from "./issue";

import { createDocumentationTask } from "../index";

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
export async function setStatusInProjects(toolkit: Toolkit, props: {
    toStatus: string,
    fromStatus?: string | RegExp
}) {
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
        const itemId = (await addProjectItem(toolkit, {
            projectId: projectInfo.node_id,
            issueId: issue.node_id
        })).node_id

        await setFieldValue(toolkit, {
            projectId: projectInfo.node_id,
            itemId,
            fieldId: statusField!.id,
            valueId: toStatusOption.id
        })
    }
}

export async function syncPriorities(toolkit: Toolkit, excludeList: number[] = []) {
    const issue = toolkit.context.payload.issue!;
    toolkit.core.debug(`Issue node ID: ${issue.node_id}`);
    const priorityLabel = issue.labels.find((label: Label) =>
        label.name.startsWith("priority/")
    )?.name;

    if (!priorityLabel) {
        return;
    }
    toolkit.core.info(`Found priority label: ${priorityLabel}`);

    const priority = priorityLabel.split('/')[1];
    toolkit.core.info(`Priority: ${priority}`);

    const issueWithProjectItems = await findIssueWithProjectItems(toolkit, issue.number);
    for (const projectItem of issueWithProjectItems.projectItems) {
        if (excludeList.includes(projectItem.project.number)) {
            toolkit.core.info(`The project number ${projectItem.project.number} is on the excludeList. skipping...`);
            continue;
        }
        const projectInfo = await getProjectInfo(toolkit, { number: projectItem.project.number });
        const priorityField = projectInfo.fields.find(field => field.name == "Priority");
        if (!priorityField) {
            toolkit.core.info(`${projectInfo.title} doesn't have a priority field. skipping...`);
            continue;
        }
        const priorityOption = priorityField?.options.find(option => option.name == priority);
        if (!priorityOption) {
            toolkit.core.info(`${projectInfo.title} doesn't have the priority option ${priority}. skipping...`);
            continue;
        }

        toolkit.core.info(`Setting priority for issue ${issue.number} on ${projectInfo.title} to ${priority}`);

        await setFieldValue(toolkit, {
            projectId: projectInfo.node_id,
            itemId: projectItem.id,
            fieldId: priorityField!.id,
            valueId: priorityOption.id
        });
    }
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

export async function markStaleIssues(toolkit: Toolkit, projectNumber: number, dryRun: boolean) {
    const DAYS_UNTIL_STALE = 180;

    const now = new Date();
    now.setDate(now.getDate() - DAYS_UNTIL_STALE);
    const staleDate = now.toISOString().split('T')[0];

    switch (Number(projectNumber)) {
        case 27: {
            const query = /* GraphQL */ `
                query searchClosableIssues {
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

    const query = /* GraphQL */ `
        query searchStaleIssues {
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
