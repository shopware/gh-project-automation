import {WebClient} from '@slack/web-api';

export class SlackClient {
    private webClient: WebClient;

    constructor(token: string) {
        this.webClient = new WebClient(token);
    }

    async getUserByEmail(email: string): Promise<string | null> {
        const response = await this.webClient.users.lookupByEmail({email});

        return response.user?.id || null;
    }

    async sendIMToUser(userId: string, message: string): Promise<void> {
        await this.webClient.chat.postMessage({
            channel: userId,
            text: message,
        });
    }
}
