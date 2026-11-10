import { SlackClient } from "../api";
import { Toolkit } from "../types";
import { isDryRun } from "../util/dry_run";

export const EXTERNAL_CONTRIBUTION_LABEL = "external-contribution";

/** octo-sts apps open pull requests without holding a collaborator permission themselves. */
export const TRUSTED_BOT_NODE_IDS = [
    "BOT_kgDOCV3tAw", // octo-sts
    "BOT_kgDODjoiJw", // shopware-octo-sts-app
    "BOT_kgDODoqSag", // shopware-octo-sts-app-2
];

type Item = {
    number: number;
    title: string;
    html_url: string;
    user: { login: string; node_id: string };
    labels?: { name: string }[];
};

function eventItem(toolkit: Toolkit): { item: Item; kind: "issue" | "pull request" } {
    const { issue, pull_request: pullRequest } = toolkit.context.payload;

    if (pullRequest) {
        return { item: pullRequest as Item, kind: "pull request" };
    }

    if (issue) {
        return { item: issue as Item, kind: "issue" };
    }

    throw new Error("Expected an issues or pull_request event.");
}

async function hasWriteAccess(toolkit: Toolkit, login: string): Promise<boolean> {
    try {
        const { data } = await toolkit.github.rest.repos.getCollaboratorPermissionLevel({
            ...toolkit.context.repo,
            username: login,
        });

        return ["admin", "write"].includes(data.permission);
    } catch (error) {
        toolkit.core.info(`Failed to get the permission level of "${login}", assuming no write access: ${error}`);

        return false;
    }
}

/**
 * Labels the issue or pull request of the current event when its author has no write
 * access to the repository. Meant for `issues` and `pull_request_target` events of type
 * `opened` and `reopened`.
 *
 * A label added with GITHUB_TOKEN starts no workflow, so a `labeled` workflow does not see
 * it. To notify right away, call {@link notifyExternalContribution} when this returns true.
 *
 * @returns Whether the label was added by this call.
 */
export async function labelExternalContribution(
    toolkit: Toolkit,
    label: string = EXTERNAL_CONTRIBUTION_LABEL,
    trustedBotNodeIds: string[] = TRUSTED_BOT_NODE_IDS,
): Promise<boolean> {
    const { item, kind } = eventItem(toolkit);
    const author = item.user.login;

    if (trustedBotNodeIds.includes(item.user.node_id) || await hasWriteAccess(toolkit, author)) {
        toolkit.core.info(`"${author}" has write access, ${kind} #${item.number} is not external.`);

        return false;
    }

    if (item.labels?.some(candidate => candidate.name === label)) {
        toolkit.core.info(`${kind} #${item.number} already carries "${label}".`);

        return false;
    }

    if (isDryRun()) {
        toolkit.core.info(`[DRY_RUN] Would add "${label}" to ${kind} #${item.number}.`);
    } else {
        await toolkit.github.rest.issues.addLabels({
            ...toolkit.context.repo,
            issue_number: item.number,
            labels: [label],
        });
        toolkit.core.info(`Added "${label}" to ${kind} #${item.number}.`);
    }

    return true;
}

/** A JSON object, or its string form, from a label to a Slack channel id. */
export type ExternalContributionChannels = string | Record<string, string> | undefined;

export function parseExternalContributionChannels(channels: ExternalContributionChannels): Map<string, string> {
    if (channels === undefined || (typeof channels === "string" && channels.trim() === "")) {
        return new Map();
    }

    const parsed: unknown = typeof channels === "string" ? JSON.parse(channels) : channels;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !Object.values(parsed).every(value => typeof value === "string")) {
        throw new Error("Channels must be a JSON object from a label to a Slack channel id.");
    }

    return new Map(Object.entries(parsed as Record<string, string>));
}

/**
 * The channels to notify, given the labels an item carries and the label just added.
 * Only the label that completes the pair of the external label and a channel's label
 * notifies, so neither one added later sends the message twice. A channel keyed by the
 * external label itself receives every external item.
 */
export function externalContributionChannels(labels: string[], addedLabel: string, channels: Map<string, string>, externalLabel: string = EXTERNAL_CONTRIBUTION_LABEL): string[] {
    if (!labels.includes(externalLabel)) {
        return [];
    }

    return [...channels]
        .filter(([channelLabel]) => labels.includes(channelLabel) && (addedLabel === channelLabel || addedLabel === externalLabel))
        .map(([, channel]) => channel);
}

/** Slack reads `&`, `<` and `>` as markup. */
export function escapeSlack(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Tells Slack about a new external issue or pull request. Meant for `issues` and
 * `pull_request_target` events of type `labeled`, or right after
 * {@link labelExternalContribution} with `addedLabel` set to the external label.
 *
 * Posts with SLACK_TOKEN, whose bot has to be a member of each channel. Without a token,
 * or in a dry run, the message is logged instead.
 *
 * @param channels - From a label to a Slack channel id, e.g. `{"external-contribution": "C0123456789"}`.
 * @param addedLabel - The label that was just added. Defaults to the one of a `labeled` event.
 */
export async function notifyExternalContribution(
    toolkit: Toolkit,
    channels: ExternalContributionChannels,
    addedLabel: string | undefined = undefined,
    externalLabel: string = EXTERNAL_CONTRIBUTION_LABEL,
): Promise<void> {
    const { item, kind } = eventItem(toolkit);
    const added = addedLabel ?? toolkit.context.payload.label?.name;

    if (added === undefined) {
        throw new Error("Expected a labeled event or an addedLabel.");
    }

    // The payload is a snapshot from before a label added in the same run.
    const labels = [...new Set([...(item.labels ?? []).map(label => label.name), added])];
    const targets = externalContributionChannels(labels, added, parseExternalContributionChannels(channels), externalLabel);

    if (targets.length === 0) {
        toolkit.core.info(`"${added}" does not complete an external ${kind} for any channel.`);

        return;
    }

    const { owner, repo } = toolkit.context.repo;
    const text = `:wave: New external ${kind}: <${item.html_url}|${escapeSlack(`${owner}/${repo}#${item.number} ${item.title}`)}> by ${escapeSlack(item.user.login)}`;
    const token = process.env.SLACK_TOKEN;

    for (const channel of targets) {
        if (!token || isDryRun()) {
            toolkit.core.info(`[DRY_RUN] Would post to ${channel}:\n${text}`);

            continue;
        }

        await new SlackClient(token).postToChannel(channel, text);
        toolkit.core.info(`Posted to ${channel}.`);
    }
}
