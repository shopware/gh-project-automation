import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupBranches, getOldBranches, protectedReleaseBranchRegex } from "../../src/services/branch";
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

describe("protectedReleaseBranchRegex", () => {
    // Guards the branch-cleanup workflow: anything matching here must NOT be deleted.
    const protect = (name: string) => protectedReleaseBranchRegex.test(name);

    it("protects semantic release branches", () => {
        for (const name of ["6.5", "6.x", "6.5.0", "6.5.x", "6.6.9.9", "6.5.0.0"]) {
            expect(protect(name), name).toBe(true);
        }
    });

    it("protects SaaS release branches", () => {
        expect(protect("saas/2025/1")).toBe(true);
        expect(protect("saas/2025/42")).toBe(true);
    });

    it("does NOT protect feature, trunk or bare-number branches", () => {
        for (const name of ["main", "trunk", "feature/foo", "fix/bug-123", "6", "release/6.5", "v6.5"]) {
            expect(protect(name), name).toBe(false);
        }
    });

    it("documents that the SaaS year is currently hard-coded to 2025", () => {
        // NOTE: the pattern hard-codes `2025`, so other years are NOT protected.
        // If SaaS release branches roll into a new year, update the regex.
        expect(protect("saas/2024/1")).toBe(false);
        expect(protect("saas/2026/1")).toBe(false);
    });
});

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
