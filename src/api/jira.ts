import {Toolkit} from "../types";

export const jiraHost = "shopware.atlassian.net";
export const jiraBaseUrl = `https://${jiraHost}/rest/api/3`;

/**
 * Makes an API call to JIRA with the provided endpoint and request body.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param endpoint - The JIRA API endpoint to call.
 * @param requestBody - The request body to send with the API call.
 *
 * @return The response from the JIRA API.
 */
export async function callJiraApi(toolkit: Toolkit, endpoint: string, requestBody: object) {
    return await toolkit.fetch(`${jiraBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(
                `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`,
            ).toString('base64')}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    }).then(res => res.json());
}
