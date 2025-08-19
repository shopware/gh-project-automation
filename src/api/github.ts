import { GitHubComment, GitHubIssue, GitHubMilestone, Label, Toolkit } from "../types";

export async function closeIssue(toolkit: Toolkit, issueId: string, reason: string = "NOT_PLANNED") {
    const res = await toolkit.github.graphql(/* GraphQL */ `
        mutation closeIssue($issueId: ID!, $reason: IssueClosedStateReason!) {
            closeIssue(input: {
                issueId: $issueId,
                stateReason: $reason,
            }) {
                clientMutationId
            }
        }
    `,
        {
            issueId: issueId,
            reason: reason
        }
    );

    toolkit.core.debug(`closeIssue response: ${JSON.stringify(res)}`);
}

export async function closePullRequest(toolkit: Toolkit, pullRequestId: string) {
    const res = await toolkit.github.graphql(/* GraphQL */ `
        mutation closeIssue($pullRequestId: ID!) {
            closePullRequest(input: {
                pullRequestId: $pullRequestId
            }) {
                clientMutationId
            }
        }
    `,
        {
            pullRequestId: pullRequestId
        }
    );

    toolkit.core.debug(`closePullRequest response: ${JSON.stringify(res)}`);
}

export async function getLabelByName(toolkit: Toolkit, repository: string, labelName: string) {
    const res = await toolkit.github.graphql<{
        repository: {
            label?: Label
        }
    }>(/* GraphQL */ `
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
    }>(/* GraphQL */ `
        mutation addLabels($labelId: ID!, $labelableId: ID!) {
            addLabelsToLabelable(input: {
                labelIds: [$labelId],
                labelableId: $labelableId
            }) {
                clientMutationId
            }
        }
    `,
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
    }>(/* GraphQL */ `
        query findIssueWithProjectItems($number: Int!) {
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
        }
    `,
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
    }>(/* GraphQL */ `
        query findPRWithProjectItems($number: Int!) {
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
        }
    `,
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

export async function setFieldValue(toolkit: Toolkit, data: {
    projectId: string,
    itemId: string,
    fieldId: string,
    valueId: string
}) {
    const res = await toolkit.github.graphql(/* GraphQL */ `
        mutation setFieldValue($projectId: ID!, $itemId: ID!, $fieldId: ID!, $valueId: String!) {
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
        }
    `,
        data
    )

    toolkit.core.debug(`setFieldValue response: ${JSON.stringify(res)}`)

    return res
}

export async function getProjectInfo(toolkit: Toolkit, data: {
    number: number,
    organization?: string
}) {
    type getProjectInfo = {
        organization: {
            projectV2: {
                id: string,
                title: string,
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
    const res = await toolkit.github.graphql<getProjectInfo>(/* GraphQL */ `
        query getProjectInfo($organization: String!, $projectNumber: Int!) {
            organization(login: $organization) {
                projectV2(number: $projectNumber) {
                    id
                    title
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
            projectNumber: data.number,
        }
    )

    toolkit.core.debug(`getProjectInfo response: ${JSON.stringify(res)}`)

    const project = res.organization.projectV2

    return {
        node_id: project.id,
        title: project.title,
        fields: project.fields.nodes,
    }
}

export async function addProjectItem(toolkit: Toolkit, data: {
    projectId: string,
    issueId: string
}) {
    const res = await toolkit.github.graphql<{
        addProjectV2ItemById: { item: { id: string } }
    }>(/* GraphQL */ `
        mutation addProjectItem($projectId: ID!, $contentId: ID!) {
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

/**
 * getProjectIdByNumber fetches the project ID for a given project number.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param number - The project number to get the ID for.
 * @param organization - The organization name whose projects to consider.
 */
export async function getProjectIdByNumber(toolkit: Toolkit, number: number, organization: string | null = "shopware") {
    const res = await toolkit.github.graphql<{
        organization: {
            projectV2: {
                id: string
            }
        }
    }>(/* GraphQL */ `
        query getProjectIdByNumber($organization: String!, $number: Int!) {
            organization(login: $organization) {
                projectV2(number: $number) {
                    id
                }
            }
        }
    `,
        {
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
    }>(/* GraphQL */ `
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
    `,
        {
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
 * getCommentsForIssue fetches all comments for a given issue.
 *
 * @remarks
 * This function uses pagination to fetch all comments for an issue.
 * It will keep fetching until all comments are retrieved.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param issueId - The ID of the issue to fetch comments for.
 * @param cursor - The cursor for pagination.
 * @param carry - The comments already fetched.
 */
export async function getCommentsForIssue(toolkit: Toolkit, issueId: string, cursor: string | null = null, carry: GitHubComment[] | null = null) {
    const res = await toolkit.github.graphql<{
        node: {
            comments: {
                pageInfo: {
                    startCursor: string,
                    endCursor: string,
                    hasPreviousPage: boolean,
                    hasNextPage: boolean
                },
                nodes: GitHubComment[]
            }
        }
    }>(/* GraphQL */ `
        query getCommentsForIssue($issueId: ID!, $count: Int, $cursor: String) {
            node(id: $issueId) {
                ... on Issue {
                    comments(first: $count, after: $cursor) {
                        pageInfo {
                            startCursor
                            endCursor
                            hasPreviousPage
                            hasNextPage
                        }
                        nodes {
                            id
                            author {
                                login
                            }
                            body
                        }
                    }
                }
            }
        }
    `,
        {
            issueId,
            count: 100,
            cursor: cursor
        })

    const comments = res.node.comments.nodes;

    if (res.node.comments.pageInfo.hasNextPage) {
        return await getCommentsForIssue(toolkit, issueId, res.node.comments.pageInfo.endCursor, [...comments, ...(carry ?? [])]);
    } else {
        return [...comments, ...(carry ?? [])];
    }
}

/**
 * Gets pull requests matching the given search criteria
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param searchQuery - The GitHub search query to use
 */
export async function getPullRequests(toolkit: Toolkit, searchQuery: string) {
    const pullRequests = await toolkit.github.graphql<
        {
            search: {
                pageInfo: {
                    startCursor: string,
                    endCursor: string,
                    hasPreviousPage: boolean,
                    hasNextPage: boolean
                },
                nodes: [
                    {
                        id: string,
                        title: string,
                        number: number,
                        url: string,
                        repository: {
                            owner: {
                                login: string
                            },
                            name: string
                        },
                        assignees: {
                            nodes: [{
                                login: string
                            }]
                        },
                        reviewRequests: {
                            nodes: [{
                                requestedReviewer: {
                                    login?: string,
                                    name?: string
                                }
                            }]
                        },
                        closingIssuesReferences: {
                            nodes: [{
                                id: string,
                                title: string,
                                number: number,
                                url: string,
                                repository: {
                                    owner: {
                                        login: string
                                    },
                                    name: string
                                }
                            }]
                        }
                    }
                ]
            }
        }
    >(/* GraphQL */ `
        query findPullRequests($searchQuery: String!) {
            search(query: $searchQuery, type: ISSUE, first: 50) {
                pageInfo {
                    startCursor
                    endCursor
                    hasPreviousPage
                    hasNextPage
                }
                nodes {
                    ... on PullRequest {
                        id
                        title
                        number
                        url
                        repository {
                            owner {
                                login
                            }
                            name
                        }
                        assignees(first: 50) {
                            nodes {
                                login
                            }
                        }
                        reviewRequests(first: 50) {
                            nodes {
                                requestedReviewer {
                                    ... on User {
                                        login
                                    }
                                    ... on Team {
                                        name
                                    }
                                }
                            }
                        }
                        closingIssuesReferences(first: 1) {
                            nodes {
                                id
                                title
                                number
                                url
                                repository {
                                    owner {
                                        login
                                    }
                                    name
                                }
                            }
                        }
                    }
                }
            }
        }`,
        {
            searchQuery
        }).then(res => res.search.nodes);

    return pullRequests;
}

export async function addComment(toolkit: Toolkit, issueId: string, commentBody: string): Promise<GitHubComment> {
    const comment = await toolkit.github.graphql<{
        addComment: {
            commentEdge: {
                node: GitHubComment
            }
        }
    }>(/* GraphQL */ `
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
    `,
        {
            issueId,
            body: commentBody
        }).then(res => res.addComment.commentEdge.node);

    if (!comment || !comment.id) {
        throw new Error(`Failed to create comment: ${JSON.stringify(comment)}`);
    }

    return comment;
}

/**
 * getVerifiedDomainEmails fetches the verified domain emails for a user account associated with an enterprise.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param login - The login of the user.
 * @param organization - The organization name whose verified domains to consider.
 */
export async function getVerifiedDomainEmails(toolkit: Toolkit, login: string, organization: string) {
    const res = await toolkit.github.graphql<{
        user: {
            organizationVerifiedDomainEmails: string[]
        }
    }>(/* GraphQL */ `
        query getVerifiedDomainEmails($login: String!, $organization: String!) {
            user(login: $login) {
                organizationVerifiedDomainEmails(login: $organization)
            }
        }
    `,
        {
            login,
            organization
        });

    return res.user.organizationVerifiedDomainEmails;
}

/**
 * getMilestoneByTitle fetches a milestone by it's title.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param repo - The name of the repository
 * @param milestoneTitle the title of the milestone
 * @param organization - The organization name of the repository
 */
export async function getMilestoneByTitle(toolkit: Toolkit, repo: string, milestoneTitle: string, organization: string = "shopware"): Promise<GitHubMilestone | undefined> {
    const milestones = await toolkit.github.paginate(toolkit.github.rest.issues.listMilestones, {
        owner: organization,
        repo: repo
    });

    return milestones.find(x => x.title == milestoneTitle)
}
