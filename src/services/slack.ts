import {Toolkit} from "../types";
import {getVerifiedDomainEmails, SlackClient} from "../api";

/**
 * Sends a message to a GitHub org member via Slack.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param login - The GitHub username of the user to send the message to.
 * @param organization - Optional organization name to filter verified domain emails.
 * @param message - The message to send.
 */
export async function sendSlackMessageForGithubUser(toolkit: Toolkit, login: string, organization: string, message: string) {
    if (process.env.SLACK_TOKEN === undefined) {
        throw new Error("SLACK_TOKEN environment variable is not set");
    }

    const slackClient = new SlackClient(process.env.SLACK_TOKEN);
    const verifiedDomainEmails = await getVerifiedDomainEmails(toolkit, login, organization);

    if (verifiedDomainEmails.length < 1) {
        toolkit.core.warning(`No verified domain emails found for user ${login}, can't send message.`);
        return;
    }

    let slackUserId: string | null = null;

    for (const email of verifiedDomainEmails) {
        slackUserId = await slackClient.getUserByEmail(email);

        if (slackUserId !== null) {
            break;
        }
    }

    if (slackUserId === null) {
        toolkit.core.warning(`No Slack user found for ${login}, can't send message.`);
        return;
    }

    await slackClient.sendIMToUser(slackUserId, message);

    toolkit.core.info(`Sent message to ${login} via Slack.`);
}
