import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupBranches, getOldBranches } from "../../src/services/branch";
import { createMockToolkit } from "../helpers";

/** Builds the GraphQL ref node shape returned by the getBranches query. */
function refNode(name: string, committedDate: string, pullRequests: number[] = []) {
    return {
        name,
        target: { committedDate },
        associatedPullRequests: { nodes: pullRequests.map(number => ({ number })) },
    };
}

function branchesResponse(nodes: ReturnType<typeof refNode>[]) {
    return {
        repository: {
            refs: {
                pageInfo: { startCursor: "a", endCursor: "b", hasNextPage: false },
                nodes,
            },
        },
    };
}

const OLD_DATE = "2000-01-01T00:00:00Z";
const RECENT_DATE = new Date().toISOString();

describe("getOldBranches", () => {
    it("returns only branches that are stale and have no open PR", async () => {
        const toolkit = createMockToolkit();
        toolkit.github.graphql.mockResolvedValueOnce(branchesResponse([
            refNode("stale-no-pr", OLD_DATE),
            refNode("stale-with-pr", OLD_DATE, [42]),
            refNode("fresh-no-pr", RECENT_DATE),
        ]));

        const result = await getOldBranches(toolkit, "my-repo");

        expect(result).toEqual(["stale-no-pr"]);
    });

    it("excludes branches matching the exclude regex", async () => {
        const toolkit = createMockToolkit();
        toolkit.github.graphql.mockResolvedValueOnce(branchesResponse([
            refNode("stale-no-pr", OLD_DATE),
            refNode("release/6.5", OLD_DATE),
        ]));

        const result = await getOldBranches(toolkit, "my-repo", "^release/");

        expect(result).toEqual(["stale-no-pr"]);
    });

    it("paginates until hasNextPage is false", async () => {
        const toolkit = createMockToolkit();
        toolkit.github.graphql
            .mockResolvedValueOnce({
                repository: {
                    refs: {
                        pageInfo: { startCursor: "a", endCursor: "page2", hasNextPage: true },
                        nodes: [refNode("stale-1", OLD_DATE)],
                    },
                },
            })
            .mockResolvedValueOnce(branchesResponse([refNode("stale-2", OLD_DATE)]));

        const result = await getOldBranches(toolkit, "my-repo");

        expect(toolkit.github.graphql).toHaveBeenCalledTimes(2);
        expect(result).toEqual(["stale-1", "stale-2"]);
    });
});

describe("cleanupBranches", () => {
    const originalDryRun = process.env.DRY_RUN;

    beforeEach(() => {
        delete process.env.DRY_RUN;
    });

    afterEach(() => {
        if (originalDryRun === undefined) {
            delete process.env.DRY_RUN;
        } else {
            process.env.DRY_RUN = originalDryRun;
        }
    });

    it("deletes each stale branch via the REST API", async () => {
        const toolkit = createMockToolkit();
        toolkit.github.graphql.mockResolvedValueOnce(branchesResponse([
            refNode("stale-a", OLD_DATE),
            refNode("stale-b", OLD_DATE),
        ]));

        await cleanupBranches(toolkit, "my-repo", "shopware");

        expect(toolkit.github.rest.git.deleteRef).toHaveBeenCalledTimes(2);
        expect(toolkit.github.rest.git.deleteRef).toHaveBeenCalledWith({
            owner: "shopware",
            repo: "my-repo",
            ref: "heads/stale-a",
        });
    });

    it("does not delete anything in dry-run mode", async () => {
        process.env.DRY_RUN = "true";
        const toolkit = createMockToolkit();
        toolkit.github.graphql.mockResolvedValueOnce(branchesResponse([
            refNode("stale-a", OLD_DATE),
        ]));

        await cleanupBranches(toolkit, "my-repo", "shopware");

        expect(toolkit.github.rest.git.deleteRef).not.toHaveBeenCalled();
    });
});
