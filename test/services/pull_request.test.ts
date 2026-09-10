import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manageOldPullRequests } from "../../src/services/pull_request";
import { createMockToolkit } from "../helpers";

const CUTOFF_DAYS = 28;

/** Long before any cutoff these tests use. */
const OLD = "2025-01-01T00:00:00Z";

function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

type TestPullRequest = {
    number: number,
    author?: string,
    assignee?: string,
    timeline?: unknown[],
    reviewThreads?: unknown[]
};

/** Every login these tests do not deliberately treat as external. */
const INTERNAL = ["vienthuong", "mitelg", "h1k3r", "someone"];

/**
 * Routes the mocked graphql by query name, because one run touches the search, the
 * verified-email lookup and both close mutations.
 */
function staleToolkit(pullRequests: TestPullRequest[], internalLogins: string[] = INTERNAL) {
    const toolkit = createMockToolkit();
    const closed: string[] = [];
    const comments: string[] = [];

    toolkit.github.graphql = vi.fn().mockImplementation(async (query: string, variables: Record<string, unknown>) => {
        if (query.includes("findPullRequests")) {
            expect(variables.withActivity).toBe(true);

            return {
                search: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: pullRequests.map(pr => ({
                        id: `id-${pr.number}`,
                        title: `pull request ${pr.number}`,
                        number: pr.number,
                        url: `https://github.com/shopware/shopware/pull/${pr.number}`,
                        author: { login: pr.author ?? "someone" },
                        repository: { owner: { login: "shopware" }, name: "shopware" },
                        assignees: { nodes: pr.assignee ? [{ login: pr.assignee }] : [] },
                        reviewRequests: { nodes: [] },
                        closingIssuesReferences: { nodes: [] },
                        timelineItems: { nodes: pr.timeline ?? [] },
                        reviewThreads: { nodes: pr.reviewThreads ?? [] },
                    })),
                },
            };
        }

        if (query.includes("getVerifiedDomainEmails")) {
            const login = String(variables.login);

            return { user: { organizationVerifiedDomainEmails: internalLogins.includes(login) ? [`${login}@shopware.com`] : [] } };
        }

        if (query.includes("closeIssue")) {
            closed.push(String(variables.pullRequestId));

            return {};
        }

        if (query.includes("addComment")) {
            comments.push(String(variables.issueId));

            return { addComment: { commentEdge: { node: { id: "c1" } } } };
        }

        throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    });

    return { toolkit, closed, comments };
}

describe("manageOldPullRequests", () => {
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

    it("searches on when a pull request was opened, not on when GitHub last touched it", () => {
        // `updated:<` is what made this job miss its own targets: a label edit resets that
        // clock, and one milestone rotation reset 71 of 273 open pull requests at once.
        const { toolkit } = staleToolkit([]);

        return manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true).then(() => {
            const [, variables] = toolkit.github.graphql.mock.calls[0];

            expect(variables.searchQuery).toContain("created:<");
            expect(variables.searchQuery).not.toContain("updated:<");
        });
    });

    it("closes a pull request whose only recent event was a bot", async () => {
        const { toolkit, closed, comments } = staleToolkit([{
            number: 5420,
            assignee: "vienthuong",
            timeline: [
                { createdAt: OLD, author: { login: "g-volker", __typename: "User" } },
                { createdAt: daysAgo(1), author: { login: "github-actions", __typename: "Bot" } },
            ],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual(["id-5420"]);
        expect(comments).toEqual(["id-5420"]);
    });

    it("leaves a pull request alone when a person wrote inside the window", async () => {
        const { toolkit, closed } = staleToolkit([{
            number: 18745,
            assignee: "h1k3r",
            timeline: [{ createdAt: daysAgo(3), author: { login: "h1k3r", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
    });

    it("counts a reply inside a review thread as activity", async () => {
        const { toolkit, closed } = staleToolkit([{
            number: 16259,
            assignee: "mitelg",
            timeline: [{ submittedAt: OLD, author: { login: "keulinho", __typename: "User" } }],
            reviewThreads: [{ comments: { nodes: [{ createdAt: daysAgo(2), author: { login: "gecolay", __typename: "User" } }] } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
    });

    it("still skips a pull request without an assignee", async () => {
        // The gate that keeps this job off community contributions stays where it was.
        const { toolkit, closed } = staleToolkit([{ number: 9265, timeline: [{ createdAt: OLD, author: { login: "wexoag", __typename: "User" } }] }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
    });

    it("still skips a pull request whose assignee has no verified organization email", async () => {
        const { toolkit, closed } = staleToolkit(
            [{ number: 9265, author: "someone", assignee: "wexoag", timeline: [{ createdAt: OLD, author: { login: "wexoag", __typename: "User" } }] }],
            ["someone"],
        );

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
    });

    it("never closes a community contribution, even with a maintainer assigned", async () => {
        // The assignee gate alone did not cover this. On the live organization the fixed
        // measure put shopware/shopware#16259, #11516, #5420 and #13970 up for closing:
        // all external contributions, all assigned to one of us, which is exactly the
        // handling we ask for.
        const { toolkit, closed, comments } = staleToolkit([{
            number: 16259,
            author: "gecolay",
            assignee: "mitelg",
            timeline: [{ createdAt: OLD, author: { login: "gecolay", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
        expect(comments).toEqual([]);
    });

    it("skips an app-authored pull request without asking for its emails", async () => {
        const { toolkit, closed } = staleToolkit([{
            number: 2,
            author: "renovate",
            assignee: "mitelg",
            timeline: [{ createdAt: OLD, author: { login: "someone", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
        expect(toolkit.github.graphql.mock.calls.some(([query]: [string]) => query.includes("getVerifiedDomainEmails"))).toBe(false);
    });

    it("skips a pull request whose author GitHub cannot resolve", async () => {
        const { toolkit, closed } = staleToolkit([{
            number: 1,
            assignee: "mitelg",
            timeline: [{ createdAt: OLD, author: { login: "someone", __typename: "User" } }],
        }]);
        // A deleted account leaves `author: null`.
        toolkit.github.graphql = vi.fn().mockImplementation(async (query: string) => {
            if (query.includes("findPullRequests")) {
                return {
                    search: {
                        pageInfo: { hasNextPage: false, endCursor: null },
                        nodes: [{
                            id: "id-1",
                            number: 1,
                            url: "https://github.com/shopware/shopware/pull/1",
                            author: null,
                            repository: { owner: { login: "shopware" }, name: "shopware" },
                            assignees: { nodes: [{ login: "mitelg" }] },
                            timelineItems: { nodes: [{ createdAt: OLD, author: { login: "someone", __typename: "User" } }] },
                            reviewThreads: { nodes: [] },
                        }],
                    },
                };
            }

            throw new Error(`unexpected query: ${query.slice(0, 60)}`);
        });

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
    });

    it("closes nothing on a dry run", async () => {
        process.env.DRY_RUN = "true";
        const { toolkit, closed, comments } = staleToolkit([{
            number: 5420,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "g-volker", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
        expect(comments).toEqual([]);
        expect(toolkit.core.info).toHaveBeenCalledWith(expect.stringContaining("[DRY_RUN]"));
    });

    it("closes nothing when close is off", async () => {
        const { toolkit, closed } = staleToolkit([{
            number: 5420,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "g-volker", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, false);

        expect(closed).toEqual([]);
    });

    it("skips repositories on the exclude list", async () => {
        const { toolkit, closed } = staleToolkit([{
            number: 5420,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "g-volker", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true, ["shopware"]);

        expect(closed).toEqual([]);
    });
});
