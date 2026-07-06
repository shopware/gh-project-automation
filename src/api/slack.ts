import { ErrorCode, WebClient } from '@slack/web-api';
import { User } from '@slack/web-api/dist/types/response/UsersLookupByEmailResponse';
import { Toolkit } from '../types';
import { isWebAPIPlatformError } from '../util/slack';

export class SlackClient {
    private webClient: WebClient;

    constructor(token: string) {
        this.webClient = new WebClient(token);
    }

    async getUserByEmail(toolkit: Toolkit, email: string): Promise<User | null> {
        try {
            const response = await this.webClient.users.lookupByEmail({ email });
            return response.user || null;
        } catch (error: unknown) {
            if (isWebAPIPlatformError(error)) {
                if (error.code == ErrorCode.PlatformError) {
                    // `users_not_found` just means no Slack account uses this email.
                    // That is an expected outcome while probing multiple emails, so
                    // don't surface it as an error annotation.
                    if (error.data.error === "users_not_found") {
                        toolkit.core.info(`No Slack user found for email ${email}.`);
                    } else {
                        toolkit.core.error("Failed to get user: " + error.data.error);
                    }
                    toolkit.core.debug(JSON.stringify(error.data));
                } else {
                    throw error;
                }
            } else {
                throw error;
            }
        }

        return null;
    }

    async sendIMToUser(userId: string, message: string): Promise<void> {
        await this.webClient.chat.postMessage({
            channel: userId,
            text: message,
            blocks: [
                {
                    type: 'markdown',
                    text: message
                }
            ]
        });
    }
}
