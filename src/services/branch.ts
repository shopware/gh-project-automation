import { Toolkit } from "../types";
import { isDryRun } from "../util/dry_run";

export async function getOldBranches(toolkit: Toolkit, repo: string, excludeRegex: string | RegExp = "", organization: string = "shopware"): Promise<string[] | null> {
    const DAYS_UNTIL_STALE = 6 * 30;

    toolkit.core.info(`Getting branches for ${organization}/${repo}`);

    const branches = [];

    let currentCursor = null;

    type BranchResponse = {
        repository: {
            refs: {
                pageInfo: {
                    startCursor: string,
                    endCursor: string,
                    hasNextPage: boolean
                },
                nodes: Array<{
                    name: string,
                    target: {
                        committedDate: string
                    },
                    associatedPullRequests: {
                        nodes: Array<{
                            number: number
                        }>
                    }
                }>
            }
        }
    };

    while (true) {
        const res: BranchResponse = await toolkit.github.graphql<BranchResponse>(/* GraphQL */ `
            query getBranches(
              $cursor: String
              $organization: String!
              $repository: String!
            ) {
              repository(owner: $organization, name: $repository) {
                refs(first: 100, after: $cursor, refPrefix: "refs/heads/") {
                  pageInfo {
                    startCursor
                    endCursor
                    hasNextPage
                  }
                  nodes {
                    name
                    target {
                      ... on Commit {
                        committedDate
                      }
                    }
                    associatedPullRequests(first: 100) {
                      nodes {
                        number
                      }
                    }
                  }
                }
              }
            }
            `,
            {
                cursor: currentCursor,
                repository: repo,
                organization: organization
            });

        branches.push(...res.repository.refs.nodes);

        if (!res.repository.refs.pageInfo.hasNextPage) {
            break;
        }
        currentCursor = res.repository.refs.pageInfo.endCursor;
    }

    const today = new Date();
    const cmpDate = new Date(new Date().setDate(today.getDate() - DAYS_UNTIL_STALE));

    const oldBranches: string[] = [];

    for (const branch of branches.filter(x => x.associatedPullRequests.nodes.length == 0)) {
        const regex = new RegExp(excludeRegex, "mg");
        if (excludeRegex != "" && regex.test(branch.name)) {
            continue;
        }
        const lastUpdate = new Date(branch.target.committedDate);

        if (lastUpdate < cmpDate) {

            oldBranches.push(branch.name);

            toolkit.core.debug(`${branch.name} : ${lastUpdate} - ${(excludeRegex != "" && regex.test(branch.name))}`);
        }
    }

    return oldBranches;
}

export async function cleanupBranches(toolkit: Toolkit, repo: string, organization: string = "shopware", excludeRegex: string | RegExp = "") {
    const branches = await getOldBranches(toolkit, repo, excludeRegex, organization);
    if (!branches) {
        toolkit.core.error("No old branches found!");
        return;
    }
    for (const branch of branches) {
        if (isDryRun()) {
            toolkit.core.info(`Would delete ${branch}`);
            continue;
        }
        toolkit.core.info(`Deleting ${branch}...`);
        toolkit.github.rest.git.deleteRef({
            owner: organization,
            repo: repo,
            ref: branch
        });
    }
}
