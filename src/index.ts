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

type GitHubIssue = {
    id: string
    title: string
    number?: number
    url?: string
    status?: string
    labels: Label[]
    type?: string
}

type JiraIssueLink = {
    id: string
    type: {
        name: string
    }
    outwardIssue: {
        key: string
        fields: {
            issuetype: {
                name: string
            }
            key: string
        }
    }
}

type JiraIssue = {
    id: string
    title: string
    key: string
    url?: string
    status?: string
    labels: string[]
    type?: string
    linkedIssues?: JiraIssueLink[]
}

type CorrelatedIssue = {
    github: GitHubIssue,
    jira: JiraIssue
}

const jiraHost = "shopware.atlassian.net";
const jiraBaseUrl = `https://${jiraHost}/rest/api/3`;

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
        `mutation($labelId: ID!, $labelableId: ID!) {
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
 * getProjectIdByNumber fetches the project ID for a given project number.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param number - The project number to get the ID for.
 * @param organization - The organization name whose projects to consider.
 */
export async function getProjectIdByNumber(toolkit: Toolkit,  number: number, organization: string | null = "shopware") {
    const res = await toolkit.github.graphql<{
        organization: {
            projectV2: {
                id: string
            }
        }
    }>(`
        query getProjectIdByNumber($organization: String!, $number: Int!) {
          organization(login: $organization) {
            projectV2(number: $number) {
              id
            }
          }
        }
    `, {
        organization: organization,
        number: number
    });

    return res.organization.projectV2.id;
}

/**
 * getIssuesByProject fetches all issues from a project.
 *
 * @remarks
 * This function uses pagination to fetch all issues from a project.
 * It will keep fetching until all issues are retrieved.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param projectId - The ID of the project to fetch issues from.
 * @param cursor - The cursor for pagination.
 * @param carry - The issues already fetched.
 */
export async function getIssuesByProject(toolkit: Toolkit, projectId: string, cursor: string | null = null, carry: GitHubIssue[] | null = null): Promise<GitHubIssue[]> {
    const res = await toolkit.github.graphql<{
        node: {
            items: {
                pageInfo: {
                    startCursor: string,
                    endCursor: string,
                    hasPreviousPage: boolean,
                    hasNextPage: boolean
                },
                nodes: [{
                    fieldValueByName: {
                        name: string
                    },
                    content: {
                        id: string,
                        title: string,
                        number: number,
                        url: string,
                        issueType?: {
                            name: string
                        }
                    }
                }]
            }
        }
    }>(`
        query getIssuesByProject($projectId: ID!, $count: Int, $cursor: String) {
            node(id: $projectId) {
                ... on ProjectV2 {
                    items(first: $count, after: $cursor) {
                        pageInfo {
                            startCursor
                            endCursor
                            hasPreviousPage
                            hasNextPage
                        }
                        nodes {
                            fieldValueByName(name: "Status") {
                                ... on ProjectV2ItemFieldSingleSelectValue {
                                    name
                                }
                            }
                            content {
                                ... on Issue {
                                    id
                                    title
                                    number
                                    url
                                    issueType {
                                        name
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    `, {
        projectId,
        count: 100,
        cursor: cursor
    });

    const issues = res.node.items.nodes.map((item) => {
        return {
            id: item.content.id,
            title: item.content.title,
            number: item.content.number,
            url: item.content.url,
            status: item.fieldValueByName?.name,
            labels: [],
            type: item.content?.issueType?.name
        }
    });

    if (res.node.items.pageInfo.hasNextPage) {
        return await getIssuesByProject(toolkit, projectId, res.node.items.pageInfo.endCursor, [...issues, ...(carry ?? [])]);
    } else {
        return [...issues, ...(carry ?? [])];
    }
}

/**
 * getEpicsInProgressByProject fetches all epics in progress from a project.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param projectId - The ID of the project to fetch issues from.
 */
export async function getEpicsInProgressByProject(toolkit: Toolkit, projectId: string) {
    const res = await getIssuesByProject(toolkit, projectId);

    return res.filter((item) => {
        return item.status?.toLowerCase() === "in progress" && item.type?.toLowerCase() === "epic";
    })
}

/**
 * correlateGitHubIssueWithJiraEpic fetches the JIRA epic for a given GitHub issue.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param issue - The GitHub issue to correlate with a JIRA epic.
 */
export async function correlateGitHubIssueWithJiraEpic(toolkit: Toolkit, issue: GitHubIssue): Promise<CorrelatedIssue | null> {
    const jiraSearchResult = await toolkit.fetch(`${jiraBaseUrl}/search/jql`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(
                `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`,
            ).toString('base64')}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            jql: `issuetype = "Epic" AND (summary ~ "${issue.title}" OR comment ~ "${issue.url}")`,
            fields: ["summary", "status", "labels", "issuelinks"],
            maxResults: 1,
        })
    }).then(res => res.json());

    if (!jiraSearchResult.issues || jiraSearchResult.issues.length < 1) {
        toolkit.core.warning(`No JIRA Epic found for GitHub issue ${issue.title} (${issue.url})`);
        return null;
    }

    const jiraIssue = {
        id: jiraSearchResult.issues[0].id,
        key: jiraSearchResult.issues[0].key,
        title: jiraSearchResult.issues[0].fields.summary,
        status: jiraSearchResult.issues[0].fields.status.name,
        url: `https://shopware.atlassian.net/browse/${jiraSearchResult.issues[0].key}`,
        labels: jiraSearchResult.issues[0].fields.labels,
        linkedIssues: jiraSearchResult.issues[0].fields.issuelinks,
    }

    if (hasDocumentationIssueLink(jiraIssue)) {
        toolkit.core.warning(`Found JIRA epic ${jiraIssue.key} but it already has a documentation issue link, skipping...`);
        return null;
    } else {
        return {
            github: issue,
            jira: jiraIssue
        }
    }
}

/**
 * correlateIssuesForProject fetches all issues from a project and correlates them with JIRA epics.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param projectId - The ID of the project to fetch issues from.
 */
export async function correlateIssuesForProject(toolkit: Toolkit, projectId: string) {
    const githubEpics = await getEpicsInProgressByProject(toolkit, projectId);

    const correlatedIssues: CorrelatedIssue[] = [];

    for (const githubEpic of githubEpics) {
        const correlatedIssue = await correlateGitHubIssueWithJiraEpic(toolkit, githubEpic);
        if (correlatedIssue) {
            correlatedIssues.push(correlatedIssue);
        }
    }

    return correlatedIssues;
}

/**
 * hasDocumentationIssueLink checks if a JIRA issue is linked to a documentation issue.
 *
 * @param issue - The JIRA issue to check.
 */
export function hasDocumentationIssueLink(issue: JiraIssue) {
    return issue.linkedIssues?.some(link => {
        return link.type.name === "Relates"
            && link.outwardIssue.fields.issuetype.name === "Task"
            && link.outwardIssue.key.startsWith("WM-");
    });
}

/**
 * createDocumentationTask creates a documentation task in JIRA for a given correlated issue.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param issue - The issue to create a documentation task for.
 * @param documentationProjectId - The ID of the documentation project.
 * @param description - The description of the documentation task.
 */
export async function createDocumentationTask(toolkit: Toolkit, issue: CorrelatedIssue, documentationProjectId: number | null = 11806, description: string | null = null) {
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
                summary: `${issue.github.title}`,
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
                                                    text: issue.github.url,
                                                    marks: [
                                                        {
                                                            type: "link",
                                                            attrs: {
                                                                href: issue.github.url,
                                                            },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "listItem",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                {
                                                    type: "text",
                                                    text: issue.jira.key,
                                                    marks: [
                                                        {
                                                            type: "link",
                                                            attrs: {
                                                                href: "https://shopware.atlassian.net/browse/" + issue.jira.key,
                                                            },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        }
                    ],
                },
                issuetype: {
                    name: "Task",
                },
            },
            update: {
                issuelinks: [
                    {
                        add: {
                            type: {
                                name: "Relates",
                            },
                            inwardIssue: {
                                key: issue.jira.key
                            }
                        }
                    }
                ],
            }
        })
    }).then(res => res.json());

    toolkit.core.info(`Created documentation task in JIRA: https://shopware.atlassian.net/browse/${docTask.key}`);
}

/**
 * createDocumentationTasksForProjects creates documentation tasks for all projects with the given project numbers.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param projectNumbers - The project numbers to create documentation tasks for.
 * @param organization - The organization name whose projects to consider.
 * @param documentationProjectId - The ID of the documentation project.
 * @param description - The description of the documentation task.
 */
export async function createDocumentationTasksForProjects(toolkit: Toolkit, projectNumbers: number[], organization: string | null = "shopware", documentationProjectId: number | null = 11806, description: string | null = null) {
    for (const projectNumber of projectNumbers) {
        const projectId = await getProjectIdByNumber(toolkit, projectNumber, organization);
        const correlatedIssues = await correlateIssuesForProject(toolkit, projectId);

        for (const issue of correlatedIssues) {
            await createDocumentationTask(toolkit, issue, documentationProjectId, description);
        }
    }
}

type QueryResponse = {
    repository: {
        issues?: {
            pageInfo: {
                hasNextPage: boolean,
                endCursor: string
            },
            nodes: [{
                id: string,
                number: number,
                title: string,
                labels: {
                    nodes: [{
                        name: string
                    }]
                }
            }]
        },
        pullRequests?: {
            pageInfo: {
                hasNextPage: boolean,
                endCursor: string
            },
            nodes: [{
                id: string,
                number: number,
                title: string,
                labels: {
                    nodes: [{
                        name: string
                    }]
                }
            }]
        }
    }
};

type Labelable = {
    id: string,
    number: number,
    title: string,
    labels: {
        nodes: [{
            name: string
        }]
    }
};

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
