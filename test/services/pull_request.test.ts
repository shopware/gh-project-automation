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
    isDraft?: boolean,
    author?: string,
    assignee?: string,
    timeline?: unknown[],
    reviewThreads?: unknown[],
    labels?: string[],
    labelEvents?: { createdAt: string, label: { name: string } }[]
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
    const drafted: string[] = [];
    const comments: string[] = [];
    const labeled: string[] = [];
    const unlabeled: string[] = [];

    (toolkit.github.rest as Record<string, unknown>).issues = {
        addLabels: vi.fn().mockImplementation(async ({ issue_number, labels }: { issue_number: number, labels: string[] }) => {
            labeled.push(...labels.map((label) => `${issue_number} ${label}`));
        }),
        removeLabel: vi.fn().mockImplementation(async ({ issue_number, name }: { issue_number: number, name: string }) => {
            unlabeled.push(`${issue_number} ${name}`);
        }),
    };

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
                        isDraft: pr.isDraft ?? false,
                        url: `https://github.com/shopware/shopware/pull/${pr.number}`,
                        author: { login: pr.author ?? "someone" },
                        repository: { owner: { login: "shopware" }, name: "shopware" },
                        assignees: { nodes: pr.assignee ? [{ login: pr.assignee }] : [] },
                        reviewRequests: { nodes: [] },
                        closingIssuesReferences: { nodes: [] },
                        timelineItems: { nodes: pr.timeline ?? [] },
                        reviewThreads: { nodes: pr.reviewThreads ?? [] },
                        labels: { nodes: (pr.labels ?? []).map((name) => ({ name })) },
                        labelEvents: { nodes: pr.labelEvents ?? [] },
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

        if (query.includes("convertPullRequestToDraft")) {
            drafted.push(String(variables.pullRequestId));

            return {};
        }

        if (query.includes("addComment")) {
            comments.push(String(variables.issueId));

            return { addComment: { commentEdge: { node: { id: "c1" } } } };
        }

        throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    });

    return { toolkit, closed, drafted, comments, labeled, unlabeled };
}

/** A conversion to draft as the timeline reports it. */
function convertedToDraft(at: string) {
    return { convertedAt: at };
}

/** The state a previous run's warning left: the label, and when it was added. */
function warned(at: string) {
    return {
        labels: ["lifecycle/AboutToClose"],
        labelEvents: [{ createdAt: at, label: { name: "lifecycle/AboutToClose" } }],
    };
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

    it("warns a pull request whose only recent event was a bot, without converting it to a draft", async () => {
        // convertPullRequestToDraft answers "Resource not accessible by integration" for the app.
        const { toolkit, closed, drafted, comments, labeled } = staleToolkit([{
            number: 5420,
            assignee: "vienthuong",
            timeline: [
                { createdAt: OLD, author: { login: "g-volker", __typename: "User" } },
                { createdAt: daysAgo(1), author: { login: "github-actions", __typename: "Bot" } },
            ],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(labeled).toEqual(["5420 lifecycle/AboutToClose"]);
        expect(comments).toEqual(["id-5420"]);
        expect(drafted).toEqual([]);
        expect(closed).toEqual([]);
        const [, commentVariables] = toolkit.github.graphql.mock.calls.find(([query]: [string]) => query.includes("addComment"));
        expect(commentVariables.body).toContain("lifecycle/DoNotClose");
    });

    it("takes the label back when the warning comment fails", async () => {
        const { toolkit, labeled, unlabeled } = staleToolkit([{
            number: 5420,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "g-volker", __typename: "User" } }],
        }]);
        const graphql = toolkit.github.graphql.getMockImplementation();
        toolkit.github.graphql = vi.fn().mockImplementation(async (query: string, variables: Record<string, unknown>) => {
            if (query.includes("addComment")) {
                throw new Error("Resource not accessible by integration");
            }

            return graphql!(query, variables);
        });

        await expect(manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true)).rejects.toThrow("shopware/shopware#5420");

        expect(labeled).toEqual(["5420 lifecycle/AboutToClose"]);
        expect(unlabeled).toEqual(["5420 lifecycle/AboutToClose"]);
    });

    it("warns an inactive draft without converting it again", async () => {
        const { toolkit, closed, drafted, comments, labeled } = staleToolkit([{
            number: 1,
            isDraft: true,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "someone", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(labeled).toEqual(["1 lifecycle/AboutToClose"]);
        expect(comments).toEqual(["id-1"]);
        expect(drafted).toEqual([]);
        expect(closed).toEqual([]);
    });

    it("comments nothing when the warning label cannot be set", async () => {
        const { toolkit, drafted, comments } = staleToolkit([{
            number: 5420,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "g-volker", __typename: "User" } }],
        }]);
        toolkit.github.rest.issues.addLabels = vi.fn().mockRejectedValue(new Error("Resource not accessible by integration")) as never;

        await expect(manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true)).rejects.toThrow("shopware/shopware#5420");

        expect(drafted).toEqual([]);
        expect(comments).toEqual([]);
    });

    it("closes a warned draft once a full period has passed since the warning, swapping the labels", async () => {
        const { toolkit, closed, drafted, comments, labeled, unlabeled } = staleToolkit([{
            number: 17488,
            isDraft: true,
            assignee: "vienthuong",
            timeline: [
                { createdAt: OLD, author: { login: "g-volker", __typename: "User" } },
                convertedToDraft(daysAgo(CUTOFF_DAYS + 1)),
            ],
            ...warned(daysAgo(CUTOFF_DAYS + 1)),
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual(["id-17488"]);
        expect(unlabeled).toEqual(["17488 lifecycle/AboutToClose"]);
        expect(labeled).toEqual(["17488 lifecycle/ClosedDueToNoActivity"]);
        expect(comments).toEqual(["id-17488"]);
        expect(drafted).toEqual([]);
    });

    it("waits after the warning until a full period has passed", async () => {
        const { toolkit, closed, comments, unlabeled } = staleToolkit([{
            number: 1,
            isDraft: true,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "someone", __typename: "User" } }],
            ...warned(daysAgo(3)),
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
        expect(comments).toEqual([]);
        expect(unlabeled).toEqual([]);
    });

    it("withdraws the warning when a person was active after it", async () => {
        const { toolkit, closed, comments, unlabeled } = staleToolkit([{
            number: 17488,
            isDraft: true,
            assignee: "vienthuong",
            timeline: [{ createdAt: daysAgo(2), author: { login: "vienthuong", __typename: "User" } }],
            ...warned(daysAgo(CUTOFF_DAYS + 5)),
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(unlabeled).toEqual(["17488 lifecycle/AboutToClose"]);
        expect(closed).toEqual([]);
        expect(comments).toEqual([]);
    });

    it("closes a warned pull request that is not a draft", async () => {
        const { toolkit, closed, unlabeled } = staleToolkit([{
            number: 17488,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "vienthuong", __typename: "User" } }],
            ...warned(daysAgo(CUTOFF_DAYS + 5)),
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual(["id-17488"]);
        expect(unlabeled).toEqual(["17488 lifecycle/AboutToClose"]);
    });

    it("withdraws the warning and does nothing else once lifecycle/DoNotClose is added", async () => {
        const { toolkit, closed, comments, unlabeled } = staleToolkit([{
            number: 17488,
            isDraft: true,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "vienthuong", __typename: "User" } }],
            labels: ["lifecycle/AboutToClose", "lifecycle/DoNotClose"],
            labelEvents: warned(daysAgo(CUTOFF_DAYS + 5)).labelEvents,
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(unlabeled).toEqual(["17488 lifecycle/AboutToClose"]);
        expect(closed).toEqual([]);
        expect(comments).toEqual([]);
    });

    it("never warns a pull request labeled lifecycle/DoNotClose", async () => {
        const { toolkit, drafted, comments, labeled } = staleToolkit([{
            number: 5420,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "g-volker", __typename: "User" } }],
            labels: ["lifecycle/DoNotClose"],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(labeled).toEqual([]);
        expect(drafted).toEqual([]);
        expect(comments).toEqual([]);
    });

    it("warns again after a person removed the label from an inactive draft", async () => {
        // The labeling is still in the timeline, but without the label there is no warning.
        const { toolkit, closed, comments, labeled } = staleToolkit([{
            number: 1,
            isDraft: true,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "someone", __typename: "User" } }],
            labelEvents: warned(daysAgo(CUTOFF_DAYS * 2)).labelEvents,
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(labeled).toEqual(["1 lifecycle/AboutToClose"]);
        expect(comments).toEqual(["id-1"]);
        expect(closed).toEqual([]);
    });

    it("skips a labeled pull request whose labeling is not in the fetched timeline", async () => {
        const { toolkit, closed, comments } = staleToolkit([{
            number: 1,
            isDraft: true,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "someone", __typename: "User" } }],
            labels: ["lifecycle/AboutToClose"],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
        expect(comments).toEqual([]);
        expect(toolkit.core.warning).toHaveBeenCalledWith(expect.stringContaining("shopware/shopware#1"));
    });

    it("still closes and comments when the labels cannot be swapped", async () => {
        const { toolkit, closed, comments } = staleToolkit([{
            number: 17488,
            isDraft: true,
            assignee: "vienthuong",
            timeline: [convertedToDraft(OLD)],
            ...warned(OLD),
        }]);
        toolkit.github.rest.issues.addLabels = vi.fn().mockRejectedValue(new Error("Resource not accessible by integration")) as never;

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual(["id-17488"]);
        expect(comments).toEqual(["id-17488"]);
        expect(toolkit.core.warning).toHaveBeenCalledWith(expect.stringContaining("shopware/shopware#17488"));
    });

    it("leaves a pull request alone when a person wrote inside the window", async () => {
        const { toolkit, labeled } = staleToolkit([{
            number: 18745,
            assignee: "h1k3r",
            timeline: [{ createdAt: daysAgo(3), author: { login: "h1k3r", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(labeled).toEqual([]);
    });

    it("counts a reply inside a review thread as activity", async () => {
        const { toolkit, labeled } = staleToolkit([{
            number: 16259,
            assignee: "mitelg",
            timeline: [{ submittedAt: OLD, author: { login: "keulinho", __typename: "User" } }],
            reviewThreads: [{ comments: { nodes: [{ createdAt: daysAgo(2), author: { login: "gecolay", __typename: "User" } }] } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(labeled).toEqual([]);
    });

    it("still skips a pull request without an assignee", async () => {
        // The gate that keeps this job off community contributions stays where it was.
        const { toolkit, labeled } = staleToolkit([{ number: 9265, timeline: [{ createdAt: OLD, author: { login: "wexoag", __typename: "User" } }] }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(labeled).toEqual([]);
    });

    it("still skips a pull request whose assignee has no verified organization email", async () => {
        const { toolkit, labeled } = staleToolkit(
            [{ number: 9265, author: "someone", assignee: "wexoag", timeline: [{ createdAt: OLD, author: { login: "wexoag", __typename: "User" } }] }],
            ["someone"],
        );

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(labeled).toEqual([]);
    });

    it("never closes a community contribution, even with a maintainer assigned", async () => {
        // The assignee gate alone did not cover this. On the live organization the fixed
        // measure put shopware/shopware#16259, #11516, #5420 and #13970 up for closing:
        // all external contributions, all assigned to one of us, which is exactly the
        // handling we ask for.
        const { toolkit, labeled, comments } = staleToolkit([{
            number: 16259,
            author: "gecolay",
            assignee: "mitelg",
            timeline: [{ createdAt: OLD, author: { login: "gecolay", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(labeled).toEqual([]);
        expect(comments).toEqual([]);
    });

    it("skips an app-authored pull request without asking for its emails", async () => {
        const { toolkit, labeled } = staleToolkit([{
            number: 2,
            author: "renovate",
            assignee: "mitelg",
            timeline: [{ createdAt: OLD, author: { login: "someone", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(labeled).toEqual([]);
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

    it("changes nothing on a dry run", async () => {
        process.env.DRY_RUN = "true";
        const { toolkit, closed, comments, labeled } = staleToolkit([
            { number: 5420, assignee: "vienthuong", timeline: [{ createdAt: OLD, author: { login: "g-volker", __typename: "User" } }] },
            { number: 17488, isDraft: true, assignee: "vienthuong", timeline: [convertedToDraft(OLD)], ...warned(OLD) },
        ]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true);

        expect(closed).toEqual([]);
        expect(comments).toEqual([]);
        expect(labeled).toEqual([]);
        expect(toolkit.core.info).toHaveBeenCalledWith(expect.stringContaining("[DRY_RUN]\twarn"));
        expect(toolkit.core.info).toHaveBeenCalledWith(expect.stringContaining("[DRY_RUN]\tclose"));
    });

    it("changes nothing when close is off", async () => {
        const { toolkit, closed, labeled } = staleToolkit([
            { number: 5420, assignee: "vienthuong", timeline: [{ createdAt: OLD, author: { login: "g-volker", __typename: "User" } }] },
            { number: 17488, isDraft: true, assignee: "vienthuong", timeline: [convertedToDraft(OLD)], ...warned(OLD) },
        ]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, false);

        expect(closed).toEqual([]);
        expect(labeled).toEqual([]);
    });

    it("skips repositories on the exclude list", async () => {
        const { toolkit, labeled } = staleToolkit([{
            number: 5420,
            assignee: "vienthuong",
            timeline: [{ createdAt: OLD, author: { login: "g-volker", __typename: "User" } }],
        }]);

        await manageOldPullRequests(toolkit, "shopware", CUTOFF_DAYS, true, ["shopware"]);

        expect(labeled).toEqual([]);
    });
});
