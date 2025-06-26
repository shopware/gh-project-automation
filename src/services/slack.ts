import {Toolkit} from "../types";
import {SlackClient} from "../api";

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

    for (const email of emails) {
        if (!email || email.trim() === '') {
            continue;
        }

        const userId = await slackClient.getUserByEmail(email);

        if (!userId) {
            continue;
        }

        await slackClient.sendIMToUser(userId, message);

        return;
    }

    toolkit.core.warning(`No valid Slack user found for emails, can't send message.`);
}
