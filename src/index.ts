type Toolkit = {
    github: InstanceType<typeof import('@actions/github/lib/utils.js').GitHub>
    context: import('@actions/github/lib/context.js').Context
    core: typeof import('@actions/core')
    exec: typeof import('@actions/exec')
    glob: typeof import('@actions/glob')
    io: typeof import('@actions/io')
    fetch: typeof import('node-fetch')
}

export async function findIssueWithProjectItems(toolkit: Toolkit, number: number) {
    const res = await toolkit.github.graphql<{
        repository: {
            issue: {
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
        `query findIssueWithProjectItems($number: Int!) {
            repository(owner: "shopware", name: "shopware") {
            issue(number: $number) {
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
                field: {
                    id: string,
                    options: [{ id: string, name: string }]
                }
            }
        }
    };
    const res = await toolkit.github.graphql<getProjectInfo>(
        `query getProjectInfo($organization: String!, $number: Int!) {
            organization(login: $organization) {
              projectV2(number: $number) {
                id
                field(name: "Status") {
                  ... on ProjectV2SingleSelectField {
                    id
                    options {
                      id
                      name
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
        status_field_id: project.field.id,
        status_options: project.field.options
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
        const toStatusOption = projectInfo.status_options.find(x => x.name.toLowerCase() === props.toStatus.toLowerCase())

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

        await setFieldValue(toolkit, { projectId: projectInfo.node_id, itemId, fieldId: projectInfo.status_field_id, valueId: toStatusOption.id })
    }
}


