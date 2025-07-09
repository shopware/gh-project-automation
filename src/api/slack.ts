import { WebClient } from '@slack/web-api';
import { User } from '@slack/web-api/dist/types/response/UsersLookupByEmailResponse';

export class SlackClient {
    private webClient: WebClient;

    constructor(token: string) {
        this.webClient = new WebClient(token);
    }

    async getUserByEmail(email: string): Promise<User | null> {
        const response = await this.webClient.users.lookupByEmail({ email });

        return response.user || null;
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
