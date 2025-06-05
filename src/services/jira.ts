import {GitHubIssue, JiraIssue, Toolkit} from "../types";
import {callJiraApi, jiraHost} from "../api/jira";

/**
 * createDocumentationTask creates a documentation task in JIRA for a given GitHub issue.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param issue - The issue to create a documentation task for.
 * @param documentationProjectId - The ID of the documentation project.
 * @param description - The description of the documentation task.
 */
export async function createDocumentationTask(
    toolkit: Toolkit,
    issue: GitHubIssue,
    documentationProjectId: number | null = 11806,
    description: string | null = null
): Promise<JiraIssue> {
    const requestBody = buildDocumentationTaskRequest(issue, documentationProjectId, description);
    const docTask = await callJiraApi(toolkit, '/issue', requestBody);

    if (!docTask || !docTask.key) {
        throw new Error(`Failed to create documentation task: ${JSON.stringify(docTask)}`);
    }

    toolkit.core.info(`Created documentation task in JIRA: https://${jiraHost}/browse/${docTask.key}`);

    return docTask;
}

/**
 * Returns the request body for creating a documentation task in JIRA.
 */
function buildDocumentationTaskRequest(issue: GitHubIssue, documentationProjectId: number | null, description: string | null): object {
    return {
        fields: {
            project: {
                id: documentationProjectId
            },
            summary: `${issue.title}`,
            description: buildDocumentationDescription(issue, description),
            issuetype: {
                name: "Task",
            },
        }
    };
}

/**
 * Returns the description for the documentation task using JIRA's document format.
 */
function buildDocumentationDescription(issue: GitHubIssue, description: string | null): object {
    return {
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
    };
}
