import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeCompletedMilestones, moveMilestoneLabelsToNextVersion, updateMilestonesOnRelease } from "../../src/services/milestone";
import { createMockToolkit } from "../helpers";

/** Builds a mocked toolkit with the issues REST + graphql surface these tests touch. */
function milestoneToolkit(prs: { number: number, title: string, baseRefName?: string }[], overrides: Record<string, unknown> = {}) {
    const toolkit = createMockToolkit();

    toolkit.github.graphql = vi.fn().mockResolvedValue({
        repository: {
            pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: prs.map(pr => ({ baseRefName: "trunk", ...pr })),
            },
        },
    });

    toolkit.github.rest.issues = {
        removeLabel: vi.fn().mockResolvedValue({}),
        addLabels: vi.fn().mockResolvedValue({}),
        listMilestones: vi.fn(),
        updateMilestone: vi.fn().mockResolvedValue({}),
        ...overrides,
    };

    // updateMilestonesOnRelease also closes released milestones; without a
    // milestone list to walk that step is a no-op.
    toolkit.github.paginate = vi.fn().mockResolvedValue([]);
    toolkit.github.rest.git = { getRef: vi.fn().mockResolvedValue({}) };

    return toolkit;
}

/** Builds a mocked toolkit whose repo has `milestones` open and `tags` pushed. */
function closeToolkit(milestones: { number: number, title: string, open_issues: number }[], tags: string[], overrides: Record<string, unknown> = {}) {
    const toolkit = createMockToolkit();

    toolkit.github.paginate = vi.fn().mockResolvedValue(milestones);
    toolkit.github.rest.issues = {
        listMilestones: vi.fn(),
        updateMilestone: vi.fn().mockResolvedValue({}),
        ...overrides,
    };
    toolkit.github.rest.git = {
        getRef: vi.fn().mockImplementation(async ({ ref }: { ref: string }) => {
            if (tags.includes(ref.replace(/^tags\//, ""))) {
                return {};
            }
            throw Object.assign(new Error("Not Found"), { status: 404 });
        }),
    };

    return toolkit;
}

/** Titles the toolkit was asked to close, in call order. */
function closedTitles(toolkit: ReturnType<typeof closeToolkit>, milestones: { number: number, title: string }[]): string[] {
    return toolkit.github.rest.issues.updateMilestone.mock.calls
        .map(([args]: [{ milestone_number: number }]) => milestones.find(m => m.number === args.milestone_number)?.title);
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

        await moveMilestoneLabelsToNextVersion(toolkit, { version: "6.7.10.0" });

        // The GraphQL query is scoped to the current label and repo.
        expect(toolkit.github.graphql).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            owner: "shopware",
            repo: "shopware",
            label: "milestone/6.7.10.0",
        }));

        expect(toolkit.github.rest.issues.removeLabel).toHaveBeenCalledTimes(2);
        // Regression: the added label MUST keep the "milestone/" prefix.
        expect(toolkit.github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({
            issue_number: 1,
            labels: ["milestone/6.7.11.0"],
        }));
    });

    it("relabels stacked PRs that target another PR's head branch", async () => {
        // Regression: these were skipped while an allowlist of "trunk" was used, so
        // they merged into trunk carrying an obsolete milestone label once GitHub
        // retargeted them.
        const toolkit = milestoneToolkit([
            { number: 17997, title: "add MCP session toolsets", baseRefName: "feat/mcp-list-changed-notifications" },
        ]);

        await moveMilestoneLabelsToNextVersion(toolkit, { version: "6.7.13.0" });

        expect(toolkit.github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({
            issue_number: 17997,
            labels: ["milestone/6.7.14.0"],
        }));
    });

    it.each([
        "6.7.13.x",
        "6.6.x",
        "saas/2025/12",
    ])("leaves PRs targeting the release branch %s alone", async (baseRefName) => {
        const toolkit = milestoneToolkit([{ number: 1, title: "a", baseRefName }]);

        await moveMilestoneLabelsToNextVersion(toolkit, { version: "6.7.10.0" });

        expect(toolkit.github.rest.issues.removeLabel).not.toHaveBeenCalled();
        expect(toolkit.github.rest.issues.addLabels).not.toHaveBeenCalled();
    });

    it("processes the remaining PRs when one fails, then throws listing the failures", async () => {
        // Regression: a permission error on the first PR used to abort the whole run.
        const toolkit = milestoneToolkit([
            { number: 1, title: "a" },
            { number: 2, title: "b" },
            { number: 3, title: "c" },
        ], {
            removeLabel: vi.fn().mockImplementation(({ issue_number }: { issue_number: number }) => {
                if (issue_number === 1) {
                    return Promise.reject(Object.assign(new Error("Resource not accessible by integration"), { status: 403 }));
                }
                return Promise.resolve({});
            }),
            addLabels: vi.fn().mockResolvedValue({}),
        });

        await expect(moveMilestoneLabelsToNextVersion(toolkit, { version: "6.7.10.0" })).rejects.toThrow("#1");

        expect(toolkit.github.rest.issues.addLabels).toHaveBeenCalledTimes(2);
        expect(toolkit.core.error).toHaveBeenCalledWith(expect.stringContaining("#1"));
    });

    it("does not add the next label when the current one vanished in the meantime", async () => {
        // A 404 means someone deliberately changed the milestone after the query.
        const toolkit = milestoneToolkit([{ number: 1, title: "a" }], {
            removeLabel: vi.fn().mockRejectedValue(Object.assign(new Error("Label does not exist"), { status: 404 })),
            addLabels: vi.fn().mockResolvedValue({}),
        });

        await moveMilestoneLabelsToNextVersion(toolkit, { version: "6.7.10.0" });

        expect(toolkit.github.rest.issues.addLabels).not.toHaveBeenCalled();
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

    it("closes the released milestone as well", async () => {
        process.env.TAG = "v6.7.10.0";
        const toolkit = milestoneToolkit([]);
        toolkit.github.paginate = vi.fn().mockResolvedValue([{ number: 7, title: "6.7.10.0", open_issues: 0 }]);

        await updateMilestonesOnRelease(toolkit);

        expect(toolkit.github.rest.issues.updateMilestone).toHaveBeenCalledWith(expect.objectContaining({
            milestone_number: 7,
            state: "closed",
        }));
    });

    it("still closes milestones when moving a label fails, then reports the failure", async () => {
        process.env.TAG = "v6.7.10.0";
        const toolkit = milestoneToolkit([{ number: 5, title: "c" }], {
            removeLabel: vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { status: 500 })),
            addLabels: vi.fn().mockResolvedValue({}),
            listMilestones: vi.fn(),
            updateMilestone: vi.fn().mockResolvedValue({}),
        });
        toolkit.github.paginate = vi.fn().mockResolvedValue([{ number: 7, title: "6.7.10.0", open_issues: 0 }]);

        await expect(updateMilestonesOnRelease(toolkit)).rejects.toThrow("#5");

        // A PR that can't be relabelled must not keep the shipped milestone open.
        expect(toolkit.github.rest.issues.updateMilestone).toHaveBeenCalledWith(expect.objectContaining({
            milestone_number: 7,
            state: "closed",
        }));
    });
});

describe("closeCompletedMilestones", () => {
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

    it("closes milestones whose version has been tagged", async () => {
        const milestones = [
            { number: 1, title: "6.7.13.0", open_issues: 0 },
            { number: 2, title: "6.5.8.19", open_issues: 0 },
        ];
        const toolkit = closeToolkit(milestones, ["v6.7.13.0", "v6.5.8.19"]);

        await closeCompletedMilestones(toolkit);

        expect(toolkit.github.paginate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            owner: "shopware",
            repo: "shopware",
            state: "open",
        }));
        expect(closedTitles(toolkit, milestones)).toEqual(["6.7.13.0", "6.5.8.19"]);
    });

    it("keeps the umbrella milestones of major releases open", async () => {
        const milestones = [
            { number: 1, title: "6.8", open_issues: 0 },
            { number: 2, title: "6.9", open_issues: 0 },
        ];
        // Even a stray "v6.8" tag must not close an umbrella milestone.
        const toolkit = closeToolkit(milestones, ["v6.8", "v6.9"]);

        await closeCompletedMilestones(toolkit);

        expect(toolkit.github.rest.issues.updateMilestone).not.toHaveBeenCalled();
    });

    it("keeps milestones with open issues open", async () => {
        const milestones = [{ number: 1, title: "6.7.13.0", open_issues: 2 }];
        const toolkit = closeToolkit(milestones, ["v6.7.13.0"]);

        await closeCompletedMilestones(toolkit);

        expect(toolkit.github.rest.issues.updateMilestone).not.toHaveBeenCalled();
    });

    it("keeps milestones without a release tag open", async () => {
        const milestones = [{ number: 1, title: "6.7.15.0", open_issues: 0 }];
        const toolkit = closeToolkit(milestones, []);

        await closeCompletedMilestones(toolkit);

        expect(toolkit.github.rest.issues.updateMilestone).not.toHaveBeenCalled();
    });

    it("closes nothing in dry run mode", async () => {
        process.env.DRY_RUN = "true";
        const milestones = [{ number: 1, title: "6.7.13.0", open_issues: 0 }];
        const toolkit = closeToolkit(milestones, ["v6.7.13.0"]);

        await closeCompletedMilestones(toolkit);

        expect(toolkit.github.rest.issues.updateMilestone).not.toHaveBeenCalled();
        expect(toolkit.core.info).toHaveBeenCalledWith(expect.stringContaining("6.7.13.0"));
    });

    it("processes every milestone even when one fails, then throws", async () => {
        const milestones = [
            { number: 1, title: "6.7.13.0", open_issues: 0 },
            { number: 2, title: "6.7.14.0", open_issues: 0 },
        ];
        const toolkit = closeToolkit(milestones, ["v6.7.13.0", "v6.7.14.0"], {
            listMilestones: vi.fn(),
            updateMilestone: vi.fn()
                .mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }))
                .mockResolvedValue({}),
        });

        await expect(closeCompletedMilestones(toolkit)).rejects.toThrow("6.7.13.0");

        expect(toolkit.github.rest.issues.updateMilestone).toHaveBeenCalledTimes(2);
    });

    it("propagates unexpected errors from the tag lookup", async () => {
        const milestones = [{ number: 1, title: "6.7.13.0", open_issues: 0 }];
        const toolkit = closeToolkit(milestones, []);
        toolkit.github.rest.git.getRef = vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { status: 403 }));

        await expect(closeCompletedMilestones(toolkit)).rejects.toThrow("rate limited");
    });

    it("can target another repository", async () => {
        const milestones = [{ number: 1, title: "6.7.13.0", open_issues: 0 }];
        const toolkit = closeToolkit(milestones, ["v6.7.13.0"]);

        await closeCompletedMilestones(toolkit, { owner: "acme", repo: "widgets" });

        expect(toolkit.github.rest.issues.updateMilestone).toHaveBeenCalledWith(expect.objectContaining({
            owner: "acme",
            repo: "widgets",
        }));
    });
});
