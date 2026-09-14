import { describe, expect, it } from "vitest";
import { isNonHumanLogin, lastHumanActivityAt } from "../../src/util/activity";

const human = { login: "mitelg", __typename: "User" };

describe("isNonHumanLogin", () => {
    it("catches the suffix a User-typed field keeps", () => {
        // A commit author is typed `User` whoever pushed it, so `__typename` cannot help.
        expect(isNonHumanLogin("dependabot[bot]")).toBe(true);
    });

    it("catches the service accounts GitHub reports as a plain User", () => {
        expect(isNonHumanLogin("CLAassistant")).toBe(true);
        expect(isNonHumanLogin("Copilot")).toBe(true);
        expect(isNonHumanLogin("cursoragent")).toBe(true);
        expect(isNonHumanLogin("shopwareBot")).toBe(true);
    });

    it("leaves people alone", () => {
        expect(isNonHumanLogin("mitelg")).toBe(false);
        expect(isNonHumanLogin("aragon999")).toBe(false);
    });
});

describe("lastHumanActivityAt", () => {
    it("is undefined when the activity fields were not requested", () => {
        expect(lastHumanActivityAt({})).toBeUndefined();
    });

    it("is undefined when a pull request has seen nothing but bots", () => {
        const at = lastHumanActivityAt({
            timelineItems: {
                nodes: [
                    { createdAt: "2026-06-08T15:43:35Z", author: { login: "github-actions", __typename: "Bot" } },
                    { createdAt: "2026-06-08T15:45:17Z", author: { login: "explore-openapi", __typename: "Bot" } },
                    { createdAt: "2026-07-31T00:00:00Z", author: { login: "CLAassistant", __typename: "User" } },
                ],
            },
        });

        expect(at).toBeUndefined();
    });

    it("takes the newest human timestamp across comments, reviews and commits", () => {
        const at = lastHumanActivityAt({
            timelineItems: {
                nodes: [
                    { createdAt: "2026-06-01T00:00:00Z", author: human },
                    { submittedAt: "2026-06-02T00:00:00Z", author: human },
                    { commit: { committedDate: "2026-06-03T00:00:00Z", author: { user: { login: "aragon999" } } } },
                ],
            },
        });

        expect(at).toBe("2026-06-03T00:00:00Z");
    });

    it("reads replies inside review threads, which the timeline does not report", () => {
        // Regression: shopware/shopware#16259, where the author answered on 2026-07-21
        // with a single inline reply. That produces no timeline item at all, and reading
        // the timeline alone dated the pull request three months early.
        const at = lastHumanActivityAt({
            timelineItems: { nodes: [{ submittedAt: "2026-04-28T07:55:58Z", author: human }] },
            reviewThreads: {
                nodes: [
                    { comments: { nodes: [{ createdAt: "2026-07-21T12:44:55Z", author: { login: "gecolay", __typename: "User" } }] } },
                ],
            },
        });

        expect(at).toBe("2026-07-21T12:44:55Z");
    });

    it("keeps a commit whose committer GitHub cannot resolve", () => {
        const at = lastHumanActivityAt({
            timelineItems: { nodes: [{ commit: { committedDate: "2026-08-01T00:00:00Z", author: null } }] },
        });

        expect(at).toBe("2026-08-01T00:00:00Z");
    });

    it("drops a commit an app pushed", () => {
        const at = lastHumanActivityAt({
            timelineItems: { nodes: [{ commit: { committedDate: "2026-08-01T00:00:00Z", author: { user: { login: "dependabot[bot]" } } } }] },
        });

        expect(at).toBeUndefined();
    });
});
