import { Toolkit } from "../types";

export async function cancelStuckWorkflows(toolkit: Toolkit, repo: string, organization: string = "shopware") {
    const TIME_THRESHOLD = 2 * 3600;

    const queuedRuns = await toolkit.github.rest.actions.listWorkflowRunsForRepo({
        owner: organization,
        repo: repo,
        status: "queued"
    });

    if (queuedRuns.data.total_count == 0) {
        toolkit.core.warning("No queued workflow found.");
        return;
    }

    const currentTime = Math.round(new Date().getTime() / 1000);

    for (const run of queuedRuns.data.workflow_runs) {
        const createdAt = Math.floor(new Date(run.created_at).getTime() / 1000);
        const timeDiff = currentTime - createdAt;
        const hoursQueued = Math.floor(timeDiff / 3600);
        const minutesQueued = Math.floor((timeDiff % 3600) / 60);

        if (timeDiff > TIME_THRESHOLD) {
            toolkit.core.info(`Found old queued run: ${run.name} (ID: ${run.id}) - queued for ${hoursQueued}h ${minutesQueued}m`);
            toolkit.core.info(`Force cancelling run ${run.id}...`);

            try {
                await toolkit.github.rest.actions.forceCancelWorkflowRun({
                    owner: organization,
                    repo: repo,
                    run_id: run.id
                });
                toolkit.core.info(`✓ Successfully force-cancelled run ${run.id}`);
            } catch (error) {
                toolkit.core.error(`✗ Failed to force-cancel run ${run.id}: ${error}`);
            }
        } else {
            toolkit.core.info(`Run ${run.name} (ID: ${run.id}) queued for ${hoursQueued}h ${minutesQueued}m - within threshold`);
        }
    }
}

export async function checkMissingLiceneInRepos(toolkit: Toolkit, organization: string = "shopware") {
    const excludeRepositories: Array<string> = [];

    let currentCursor = null;
    type ObjectsResponse = {
        organization: {
            repositories: {
                pageInfo: {
                    startCursor: string,
                    endCursor: string,
                    hasNextPage: boolean
                },
                nodes: Array<{
                    name: string,
                    visibility: string,
                    object: { byteSize: number } | null
                }>
            }
        }
    };

    let reposWithoutLicenseCount = 0;

    while (true) {
        const res: ObjectsResponse = await toolkit.github.graphql<ObjectsResponse>(/* GraphQL */ `
                query getLicenseFile($cursor: String, $organization: String!){
                  organization(login: $organization) {
                    repositories(first: 100, after: $cursor) {
                      pageInfo {
                        startCursor
                        endCursor
                        hasNextPage
                      }
                      nodes {
                        name
                        visibility
                        object(expression: "HEAD:LICENSE") {
                          ... on Blob {
                            byteSize
                          }
                        }
                      }
                    }
                  }
                }
                `,
            {
                cursor: currentCursor,
                organization
            }
        );
        res.organization.repositories.nodes.filter(x => !excludeRepositories.includes(x.name) && x.visibility === "PUBLIC" && x.object === null).forEach(x => {
            toolkit.core.error(`${x.name} doesn't have a LICENSE`); reposWithoutLicenseCount++;
        });
        if (!res.organization.repositories.pageInfo.hasNextPage) {
            break;
        }
        currentCursor = res.organization.repositories.pageInfo.endCursor;

    }

    if (reposWithoutLicenseCount > 0) {
        toolkit.core.setFailed(`${reposWithoutLicenseCount} repositories without LICENSE detected!`);
    }
}
