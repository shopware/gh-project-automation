import {Toolkit} from "../types";
import {getVerifiedDomainEmails, SlackClient} from "../api";

export async function sendSlackMessageForGithubUser(toolkit: Toolkit, login: string, message: string) {
    if (process.env.SLACK_TOKEN === undefined) {
        throw new Error("SLACK_TOKEN environment variable is not set");
    }

    const slackClient = new SlackClient(process.env.SLACK_TOKEN);
    const verifiedDomainEmails = await getVerifiedDomainEmails(toolkit, login);

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
