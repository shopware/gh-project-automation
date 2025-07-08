import { Toolkit } from "../types";
import { SlackClient } from "../api";
import { User } from "@slack/web-api/dist/types/response/UsersLookupByEmailResponse";

/**
 * Sends a message to a Slack user identified by their email address.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param emails - The email address(es) of the Slack user to send the message to.
 * @param message - The message to send.
 */
export async function sendSlackMessageForEMail(toolkit: Toolkit, emails: string[], message: string) {
    if (process.env.SLACK_TOKEN === undefined) {
        throw new Error("Unauthorized. SLACK_TOKEN environment variable not provided.");
    }

    const slackClient = new SlackClient(process.env.SLACK_TOKEN);

    const user = await getSlackUserByEmail(toolkit, emails);

    if (!user || !user.id) {
        toolkit.core.warning(`No valid Slack user found for emails, can't send message.`);
        return;
    }

    await slackClient.sendIMToUser(user.id, message);
}

/**
 * Gets a Slack user by their email address.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param emails - The email address(es) of the Slack user.
 * @param message - The message to send.
 */
export async function getSlackUserByEmail(toolkit: Toolkit, emails: string[]): Promise<User | null> {
    if (process.env.SLACK_TOKEN === undefined) {
        throw new Error("Unauthorized. SLACK_TOKEN environment variable not provided.");
    }

    const slackClient = new SlackClient(process.env.SLACK_TOKEN);

    for (const email of emails) {
        if (!email || email.trim() === '') {
            continue;
        }

        const user = await slackClient.getUserByEmail(email);
        if (!user) {
            continue;
        }

        return user;
    }

    toolkit.core.warning(`No valid Slack user found for emails.`)

    return null;
}
