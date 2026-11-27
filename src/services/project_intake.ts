import { Toolkit } from "../types";
import { getProjectInfo, setFieldValue } from "../api";
import { isDryRun } from "../util/dry_run";

/**
 * Intake status per org project number. New items on these boards must start in
 * this column, but GitHub's issue status sync puts them into a column named like
 * the issue's own status (`Backlog`, `Todo`) right after they are added.
 */
export const projectIntakeStatuses: Record<number, string> = {
    17: "To Triage",
    21: "To be Refined",
    27: "To Triage",
    50: "Pending Refinement",
};

/** Issue statuses a new issue starts with: `Backlog` by default, `Todo` when assigned on creation. */
export const initialIssueStatuses = ["Backlog", "Todo"];

/** The sync sets the status within a few seconds of the add; anything later was a deliberate move. */
const SYNC_WINDOW_MS = 60 * 1000;

export type ProjectIntakeItem = {
    id: string
    createdAt: string
    content: {
        number?: number
        url?: string
    } | null
    fieldValueByName: {
        name: string
        updatedAt: string
    } | null
}

type ProjectItemsResponse = {
    organization: {
        projectV2: {
            items: {
                pageInfo: {
                    endCursor: string | null
                    hasNextPage: boolean
                }
                nodes: ProjectIntakeItem[]
            }
        }
    }
}

/**
 * Whether the item's status was set by the issue status sync when the item was
 * added, and has not been touched since.
 */
export function wasPlacedBySync(item: ProjectIntakeItem, intakeStatus: string, syncedStatuses: string[] = initialIssueStatuses): boolean {
    const status = item.fieldValueByName;
    if (!status) {
        return false;
    }

    const name = status.name.toLowerCase();
    if (name === intakeStatus.toLowerCase()) {
        return false;
    }

    if (!syncedStatuses.some(s => s.toLowerCase() === name)) {
        return false;
    }

    const delta = Date.parse(status.updatedAt) - Date.parse(item.createdAt);

    return delta >= 0 && delta <= SYNC_WINDOW_MS;
}

export async function getRecentProjectItems(toolkit: Toolkit, projectNumber: number, since: Date, organization: string = "shopware"): Promise<ProjectIntakeItem[]> {
    const items: ProjectIntakeItem[] = [];
    // The project filter only has day precision; the exact cut-off is applied below.
    const filter = `updated:>=${since.toISOString().slice(0, 10)}`;
    let cursor: string | null = null;

    while (true) {
        const res: ProjectItemsResponse = await toolkit.github.graphql<ProjectItemsResponse>(/* GraphQL */ `
            query getRecentProjectItems($organization: String!, $number: Int!, $filter: String!, $cursor: String) {
                organization(login: $organization) {
                    projectV2(number: $number) {
                        items(first: 100, after: $cursor, query: $filter) {
                            pageInfo {
                                endCursor
                                hasNextPage
                            }
                            nodes {
                                id
                                createdAt
                                content {
                                    ... on Issue {
                                        number
                                        url
                                    }
                                }
                                fieldValueByName(name: "Status") {
                                    ... on ProjectV2ItemFieldSingleSelectValue {
                                        name
                                        updatedAt
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `,
            { organization, number: projectNumber, filter, cursor }
        );

        const page = res.organization.projectV2.items;
        items.push(...page.nodes.filter(item => Date.parse(item.createdAt) >= since.getTime()));

        if (!page.pageInfo.hasNextPage) {
            break;
        }

        cursor = page.pageInfo.endCursor;
    }

    return items;
}

/**
 * Moves items that the issue status sync placed into `Backlog`/`Todo` on add back
 * to the board's intake status. Items moved later (by people, linked PRs or
 * assignments) are left alone.
 *
 * @param lookbackMinutes - Only items added within this window are considered.
 */
export async function resetProjectIntakeStatus(toolkit: Toolkit, projects: Record<number, string> = projectIntakeStatuses, lookbackMinutes: number = 120, organization: string = "shopware") {
    const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);

    for (const [projectNumber, intakeStatus] of Object.entries(projects).map(([n, s]) => [Number(n), s] as const)) {
        const projectInfo = await getProjectInfo(toolkit, { number: projectNumber, organization });
        const statusField = projectInfo.fields.find(field => field.name === "Status");
        const intakeOption = statusField?.options.find(option => option.name.toLowerCase() === intakeStatus.toLowerCase());

        if (!statusField || !intakeOption) {
            toolkit.core.warning(`Project ${projectNumber} (${projectInfo.title}) has no Status option "${intakeStatus}". Skipping.`);
            continue;
        }

        const items = await getRecentProjectItems(toolkit, projectNumber, since, organization);
        const toReset = items.filter(item => wasPlacedBySync(item, intakeStatus));

        toolkit.core.info(`Project ${projectNumber} (${projectInfo.title}): ${items.length} item(s) added since ${since.toISOString()}, ${toReset.length} to reset to "${intakeStatus}".`);

        for (const item of toReset) {
            const label = item.content?.url ?? item.id;

            if (isDryRun()) {
                toolkit.core.info(`[dry run] Would move ${label} from "${item.fieldValueByName?.name}" to "${intakeStatus}".`);
                continue;
            }

            toolkit.core.info(`Moving ${label} from "${item.fieldValueByName?.name}" to "${intakeStatus}".`);
            await setFieldValue(toolkit, {
                projectId: projectInfo.node_id,
                itemId: item.id,
                fieldId: statusField.id,
                valueId: intakeOption.id,
            });
        }
    }
}
