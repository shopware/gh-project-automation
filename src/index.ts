type Toolkit = {
    github: InstanceType<typeof import('@actions/github/lib/utils.js').GitHub>
    context: import('@actions/github/lib/context.js').Context
    core: typeof import('@actions/core')
    exec: typeof import('@actions/exec')
    glob: typeof import('@actions/glob')
    io: typeof import('@actions/io')
    fetch: typeof import('node-fetch')
}

type Label = {
    id: string
    name: string
    url: string
    description?: string
    color: string
};

async function closeIssue(toolkit: Toolkit, issueId: string) {
    const res = await toolkit.github.graphql(
        `mutation closeIssue($issueId: ID!) {
            closeIssue(input: {
                issueId: $issueId,
                stateReason:NOT_PLANNED
            }) {
                clientMutationId
            }
        }`,
        {
            issueId: issueId
        }
    );

    toolkit.core.debug(`closeIssue response: ${JSON.stringify(res)}`);
}

export async function getLabelByName(toolkit: Toolkit, repository: string, labelName: string) {
    const res = await toolkit.github.graphql<{
        repository: {
            label?: Label
        }
    }>(`
        query getLabelId($repository: String!, $labelName: String!) {
           repository(owner: "shopware", name: $repository) {
             label(name: $labelName) {
               id
               name
               url
               description
               color
             }
           }
         }
    `,
        {
            repository: repository,
            labelName: labelName
        });

    return res.repository.label;
}

export async function addLabelToLabelable(toolkit: Toolkit, labelId: string, labelableId: string) {
    const res = await toolkit.github.graphql<{
        clientMutationId: string
    }>(
        `mutation addLabelToLableable($labelId: ID!, labelableId: ID!) {
            addLabelsToLabelable(input: {
                labelIds: [$labelId],
                labelableId: $labelableId
            }) {
                clientMutationId
            }
        }`,
        {
            labelId: labelId,
            labelableId: labelableId
        }
    );

    toolkit.core.debug(`addLabelToIssue response: ${JSON.stringify(res)}`);
}

export async function findIssueWithProjectItems(toolkit: Toolkit, number: number) {
    const res = await toolkit.github.graphql<{
        repository: {
            issue: {
                projectItems: {
                    nodes: [{
                        id: string,
                        project: { number: number },
                        fieldValueByName: { name: string },
                    }]
                },
                id: string,
                number: number,
            }
        }
    }>(
        `query findIssueWithProjectItems($number: Int!) {
            repository(owner: "shopware", name: "shopware") {
            issue(number: $number) {
                projectItems(first: 20) {
                    nodes {
                        id
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
                id
                number
            }
            }
        }`,
        {
            number,
        }
    )

    toolkit.core.debug(`findIssueInProject response: ${JSON.stringify(res)}`)

    return {
        node_id: res.repository.issue.id,
        number: res.repository.issue.number,
        projectItems: res.repository.issue.projectItems.nodes,
    }
}

export async function findPRWithProjectItems(toolkit: Toolkit, number: number) {
    const res = await toolkit.github.graphql<{
        repository: {
            pullRequest: {
                projectItems: {
                    nodes: [{
                        project: { number: number },
                        fieldValueByName: { name: string },
                    }]
                },
                id: string,
                number: number,
            }
        }
    }>(
        `query findPRWithProjectItems($number: Int!) {
            repository(owner: "shopware", name: "shopware") {
            pullRequest(number: $number) {
                projectItems(first: 20) {
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
                id
                number
            }
            }
        }`,
        {
            number,
        }
    )

    toolkit.core.debug(`findIssueInProject response: ${JSON.stringify(res)}`)

    return {
        node_id: res.repository.pullRequest.id,
        number: res.repository.pullRequest.number,
        projectItems: res.repository.pullRequest.projectItems.nodes,
    }
}

export async function setFieldValue(toolkit: Toolkit, data: { projectId: string, itemId: string, fieldId: string, valueId: string }) {
    const res = await toolkit.github.graphql(
        `mutation setFieldValue($projectId: ID!, $itemId: ID!, $fieldId: ID!, $valueId: String!) {
            updateProjectV2ItemFieldValue(input: {
                projectId: $projectId,
                itemId: $itemId,
                fieldId: $fieldId,
                value: {singleSelectOptionId: $valueId}
            }) {
                projectV2Item {
                    id
                }
            }
        }`,
        data
    )

    toolkit.core.debug(`setFieldValue response: ${JSON.stringify(res)}`)

    return res
}

export async function getProjectInfo(toolkit: Toolkit, data: { number: number, organization?: string }) {
    type getProjectInfo = {
        organization: {
            projectV2: {
                id: string,
                fields: {
                    nodes: [{
                        id: string,
                        name: string,
                        options: [{
                            id: string,
                            name: string
                        }]
                    }]
                }
            }
        }
    };
    const res = await toolkit.github.graphql<getProjectInfo>(
        `
        query getProjectInfo($organization: String!, $projectNumber: Int!) {
          organization(login: $organization) {
            projectV2(number: $projectNumber) {
              id
              fields(first: 20) {
                nodes {
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }
        `,
        {
            organization: data.organization ?? "shopware",
            number: data.number,
        }
    )

    toolkit.core.debug(`getProjectInfo response: ${JSON.stringify(res)}`)

    const project = res.organization.projectV2

    return {
        node_id: project.id,
        fields: project.fields.nodes,
    }
}

export async function addProjectItem(toolkit: Toolkit, data: { projectId: string, issueId: string }) {
    const res = await toolkit.github.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
        `mutation addProjectItem($projectId: ID!, $contentId: ID!) {
            addProjectV2ItemById(input: {
                projectId: $projectId,
                contentId: $contentId
            }) {
                item {
                    id
                }
            }
        }
        `,
        {
            projectId: data.projectId,
            contentId: data.issueId
        }
    );

    toolkit.core.debug(`addCard response: ${JSON.stringify(res)}`)

    return {
        node_id: res.addProjectV2ItemById.item.id
    }
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

                if (priorityLabel && (priorityLabel.split('/')[1] === "low" || statusInProject == "Backlog") && parentIssueType != "Epic") {
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
