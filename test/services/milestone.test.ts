import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveMilestoneLabelsToNextVersion, updateMilestonesOnRelease } from "../../src/services/milestone";
import { createMockToolkit } from "../helpers";

/** Builds a mocked toolkit with the issues REST + graphql surface these tests touch. */
function milestoneToolkit(prs: { number: number, title: string }[], overrides: Record<string, unknown> = {}) {
    const toolkit = createMockToolkit();

    toolkit.github.graphql = vi.fn().mockResolvedValue({
        repository: {
            pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: prs,
            },
        },
    });

    toolkit.github.rest.issues = {
        removeLabel: vi.fn().mockResolvedValue({}),
        addLabels: vi.fn().mockResolvedValue({}),
        ...overrides,
    };

    return toolkit;
}

describe("moveMilestoneLabelsToNextVersion", () => {
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

    it("moves the milestone label to the next patch version on every matching PR", async () => {
        const toolkit = milestoneToolkit([
            { number: 1, title: "a" },
            { number: 2, title: "b" },
        ]);

        await moveMilestoneLabelsToNextVersion(toolkit, { version: "6.7.10.0", baseRefName: "trunk" });

        // The GraphQL query is scoped to the current label, repo and base branch.
        expect(toolkit.github.graphql).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            owner: "shopware",
            repo: "shopware",
            label: "milestone/6.7.10.0",
            baseRefName: "trunk",
        }));

        expect(toolkit.github.rest.issues.removeLabel).toHaveBeenCalledTimes(2);
        // Regression: the added label MUST keep the "milestone/" prefix.
        expect(toolkit.github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({
            issue_number: 1,
            labels: ["milestone/6.7.11.0"],
        }));
    });

    it("does not mutate anything in dry-run mode", async () => {
        const toolkit = milestoneToolkit([{ number: 1, title: "a" }]);

        await moveMilestoneLabelsToNextVersion(toolkit, { version: "6.7.10.0", dryRun: true });

        expect(toolkit.github.rest.issues.removeLabel).not.toHaveBeenCalled();
        expect(toolkit.github.rest.issues.addLabels).not.toHaveBeenCalled();
    });

    it("does nothing when no PRs carry the current label", async () => {
        const toolkit = milestoneToolkit([]);

        await moveMilestoneLabelsToNextVersion(toolkit, { version: "6.7.10.0" });

        expect(toolkit.github.rest.issues.removeLabel).not.toHaveBeenCalled();
    });

    it("throws on an invalid version", async () => {
        const toolkit = milestoneToolkit([]);

        await expect(moveMilestoneLabelsToNextVersion(toolkit, { version: "6.7.x" })).rejects.toThrow();
    });
});

describe("updateMilestonesOnRelease", () => {
    const originalTag = process.env.TAG;
    const originalDryRun = process.env.DRY_RUN;

    beforeEach(() => {
        delete process.env.DRY_RUN;
    });

    afterEach(() => {
        if (originalTag === undefined) delete process.env.TAG; else process.env.TAG = originalTag;
        if (originalDryRun === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = originalDryRun;
    });

    it("returns 1 when TAG is missing", async () => {
        delete process.env.TAG;
        const toolkit = milestoneToolkit([]);

        expect(await updateMilestonesOnRelease(toolkit)).toBe(1);
        expect(toolkit.core.error).toHaveBeenCalled();
    });

    it("returns 1 when TAG is malformed", async () => {
        process.env.TAG = "v6.7.x";
        const toolkit = milestoneToolkit([]);

        expect(await updateMilestonesOnRelease(toolkit)).toBe(1);
    });

    it("derives the version from TAG and bumps the milestone", async () => {
        process.env.TAG = "v6.7.10.0";
        const toolkit = milestoneToolkit([{ number: 5, title: "c" }]);

        await updateMilestonesOnRelease(toolkit);

        expect(toolkit.github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({
            issue_number: 5,
            labels: ["milestone/6.7.11.0"],
        }));
    });
});
