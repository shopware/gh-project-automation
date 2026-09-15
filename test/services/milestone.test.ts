import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeCompletedMilestones, ensureReleaseMilestone, moveLtsMilestoneLabels, moveMilestoneLabelsToNextVersion, scheduleReleaseMilestone, syncMilestoneForPR, updateMilestonesOnRelease } from "../../src/services/milestone";
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
    // No maintenance branch, so the released version is on the current line.
    toolkit.github.rest.repos = { getBranch: vi.fn().mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 })) };

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

describe("ensureReleaseMilestone", () => {
    const originalDryRun = process.env.DRY_RUN;

    const schedule = {
        version: "6.7.15.0",
        dueOn: "2026-10-05",
        releaseDate: "Monday, October 5, 2026",
        branchOffDate: "Monday, September 21, 2026",
    };

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

    /** `existing` is the milestone getMilestoneByTitle will find, or none at all. */
    function scheduleToolkit(existing?: Record<string, unknown>) {
        const toolkit = createMockToolkit();

        toolkit.github.paginate = vi.fn().mockResolvedValue(existing ? [existing] : []);
        toolkit.github.rest.issues = {
            listMilestones: vi.fn(),
            createMilestone: vi.fn().mockResolvedValue({ data: {} }),
            updateMilestone: vi.fn().mockResolvedValue({}),
        };

        return toolkit;
    }

    it("creates the milestone with its due date and description", async () => {
        const toolkit = scheduleToolkit();

        await ensureReleaseMilestone(toolkit, schedule);

        expect(toolkit.github.rest.issues.createMilestone).toHaveBeenCalledWith(expect.objectContaining({
            owner: "shopware",
            repo: "shopware",
            title: "6.7.15.0",
            due_on: "2026-10-05T00:00:00Z",
        }));
        const { description } = toolkit.github.rest.issues.createMilestone.mock.calls[0][0];
        expect(description).toContain("Monday, October 5, 2026");
        expect(description).toContain("Monday, September 21, 2026");
    });

    it("fills in a due date that is missing", async () => {
        const toolkit = scheduleToolkit({ number: 7, title: "6.7.15.0", state: "open", due_on: null, description: "hand written" });

        await ensureReleaseMilestone(toolkit, schedule);

        expect(toolkit.github.rest.issues.updateMilestone).toHaveBeenCalledWith(expect.objectContaining({
            milestone_number: 7,
            due_on: "2026-10-05T00:00:00Z",
        }));
        // The description was already there and must survive.
        expect(toolkit.github.rest.issues.updateMilestone.mock.calls[0][0]).not.toHaveProperty("description");
    });

    it("never overwrites a due date that was moved by hand", async () => {
        const toolkit = scheduleToolkit({ number: 7, title: "6.7.15.0", state: "open", due_on: "2026-10-19T00:00:00Z", description: "d" });

        await ensureReleaseMilestone(toolkit, schedule);

        expect(toolkit.github.rest.issues.updateMilestone).not.toHaveBeenCalled();
        expect(toolkit.core.info).toHaveBeenCalledWith(expect.stringContaining("2026-10-19"));
    });

    it("leaves a closed milestone alone", async () => {
        const toolkit = scheduleToolkit({ number: 7, title: "6.7.15.0", state: "closed", due_on: null, description: null });

        await ensureReleaseMilestone(toolkit, schedule);

        expect(toolkit.github.rest.issues.updateMilestone).not.toHaveBeenCalled();
        expect(toolkit.github.rest.issues.createMilestone).not.toHaveBeenCalled();
    });

    it("does nothing when the milestone is already complete", async () => {
        const toolkit = scheduleToolkit({ number: 7, title: "6.7.15.0", state: "open", due_on: "2026-10-05T00:00:00Z", description: "d" });

        await ensureReleaseMilestone(toolkit, schedule);

        expect(toolkit.github.rest.issues.updateMilestone).not.toHaveBeenCalled();
    });

    it("writes nothing in dry run mode", async () => {
        process.env.DRY_RUN = "true";
        const toolkit = scheduleToolkit();

        await ensureReleaseMilestone(toolkit, schedule);

        expect(toolkit.github.rest.issues.createMilestone).not.toHaveBeenCalled();
        expect(toolkit.core.info).toHaveBeenCalledWith(expect.stringContaining("6.7.15.0"));
    });

    it("rejects a version that is not a full four-segment version", async () => {
        const toolkit = scheduleToolkit();

        await expect(ensureReleaseMilestone(toolkit, { ...schedule, version: "6.8" })).rejects.toThrow("6.8");
    });
});

describe("scheduleReleaseMilestone", () => {
    /** `releases` are tag/date pairs as the releases endpoint returns them, newest first. */
    function releaseToolkit(releases: [string, string][], existing?: Record<string, unknown>) {
        const toolkit = createMockToolkit();

        toolkit.github.paginate = vi.fn().mockResolvedValue(existing ? [existing] : []);
        toolkit.github.rest.repos = {
            listReleases: vi.fn().mockResolvedValue({
                data: releases.map(([tag_name, published_at]) => ({ tag_name, published_at, draft: false, prerelease: false })),
            }),
        };
        toolkit.github.rest.issues = {
            listMilestones: vi.fn(),
            createMilestone: vi.fn().mockResolvedValue({ data: {} }),
            updateMilestone: vi.fn().mockResolvedValue({}),
        };

        return toolkit;
    }

    const RELEASES: [string, string][] = [
        ["v6.6.10.24", "2026-09-10T06:49:15Z"],
        ["v6.7.14.0", "2026-09-09T07:06:52Z"],
        ["v6.7.13.1", "2026-08-25T14:27:35Z"],
        ["v6.7.13.0", "2026-08-05T09:29:37Z"],
    ];

    it("dates the next minor from the last released one", async () => {
        const toolkit = releaseToolkit(RELEASES);

        await scheduleReleaseMilestone(toolkit, { version: "6.7.15.0", dryRun: false });

        expect(toolkit.github.rest.issues.createMilestone).toHaveBeenCalledWith(expect.objectContaining({
            title: "6.7.15.0",
            due_on: "2026-10-05T00:00:00Z",
        }));
    });

    it("ignores the LTS line when picking the anchor", async () => {
        // v6.6.10.24 is the newest release of all, but belongs to another line.
        const toolkit = releaseToolkit(RELEASES);

        await scheduleReleaseMilestone(toolkit, { version: "6.7.15.0", dryRun: false });

        // Anchored on 6.6.10.24 the result would have been November.
        expect(toolkit.github.rest.issues.createMilestone).toHaveBeenCalledWith(expect.objectContaining({
            due_on: "2026-10-05T00:00:00Z",
        }));
    });

    it("skips the minor that is already branched off", async () => {
        // Before 6.7.14.0 shipped: the anchor is 6.7.13.0 and 6.7.15.0 is two cycles out.
        const toolkit = releaseToolkit(RELEASES.filter(([tag]) => tag !== "v6.7.14.0"));

        await scheduleReleaseMilestone(toolkit, { version: "6.7.15.0", dryRun: false });

        expect(toolkit.github.rest.issues.createMilestone).toHaveBeenCalledWith(expect.objectContaining({
            due_on: "2026-10-05T00:00:00Z",
        }));
    });

    it("refuses to date a patch release", async () => {
        const toolkit = releaseToolkit(RELEASES);

        await expect(scheduleReleaseMilestone(toolkit, { version: "6.7.15.1" })).rejects.toThrow("patch release");
    });

    it("does nothing when the version is not ahead of the last release", async () => {
        const toolkit = releaseToolkit(RELEASES);

        await scheduleReleaseMilestone(toolkit, { version: "6.7.14.0", dryRun: false });

        expect(toolkit.github.rest.issues.createMilestone).not.toHaveBeenCalled();
        expect(toolkit.github.rest.issues.updateMilestone).not.toHaveBeenCalled();
    });

    it("warns instead of guessing when the line has no release yet", async () => {
        const toolkit = releaseToolkit([["v6.6.10.24", "2026-09-10T06:49:15Z"]]);

        await scheduleReleaseMilestone(toolkit, { version: "6.8.1.0", dryRun: false });

        expect(toolkit.core.warning).toHaveBeenCalledWith(expect.stringContaining("6.8"));
        expect(toolkit.github.rest.issues.createMilestone).not.toHaveBeenCalled();
    });
});

describe("moveLtsMilestoneLabels", () => {
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

    it("counts in the fourth segment, not the third", async () => {
        const toolkit = milestoneToolkit([{ number: 1, title: "a", baseRefName: "6.6.x" }]);

        await moveLtsMilestoneLabels(toolkit, { version: "6.6.10.25" });

        expect(toolkit.github.graphql).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            label: "milestone/6.6.10.25",
        }));
        expect(toolkit.github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({
            issue_number: 1,
            labels: ["milestone/6.6.10.26"],
        }));
    });

    it("leaves PRs alone that do not target the maintenance branch", async () => {
        const toolkit = milestoneToolkit([
            { number: 1, title: "on the line", baseRefName: "6.6.x" },
            { number: 2, title: "a backport branch", baseRefName: "fix/something-backport-6.6.x" },
            { number: 3, title: "trunk", baseRefName: "trunk" },
        ]);

        await moveLtsMilestoneLabels(toolkit, { version: "6.6.10.25" });

        expect(toolkit.github.rest.issues.addLabels).toHaveBeenCalledTimes(1);
        expect(toolkit.github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({ issue_number: 1 }));
    });

    it("changes nothing in dry run mode", async () => {
        process.env.DRY_RUN = "true";
        const toolkit = milestoneToolkit([{ number: 1, title: "a", baseRefName: "6.6.x" }]);

        await moveLtsMilestoneLabels(toolkit, { version: "6.6.10.25" });

        expect(toolkit.github.rest.issues.removeLabel).not.toHaveBeenCalled();
        expect(toolkit.github.rest.issues.addLabels).not.toHaveBeenCalled();
    });

    it("rejects a malformed version", async () => {
        const toolkit = milestoneToolkit([]);

        await expect(moveLtsMilestoneLabels(toolkit, { version: "6.6.x" })).rejects.toThrow("not a valid version");
    });
});

describe("updateMilestonesOnRelease on a maintenance line", () => {
    const originalTag = process.env.TAG;
    const originalDryRun = process.env.DRY_RUN;

    beforeEach(() => {
        delete process.env.DRY_RUN;
    });

    afterEach(() => {
        if (originalTag === undefined) delete process.env.TAG; else process.env.TAG = originalTag;
        if (originalDryRun === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = originalDryRun;
    });

    it("bumps the hotfix segment when the maintenance branch exists", async () => {
        process.env.TAG = "v6.6.10.25";
        const toolkit = milestoneToolkit([{ number: 5, title: "c", baseRefName: "6.6.x" }]);
        toolkit.github.rest.repos.getBranch = vi.fn().mockResolvedValue({});

        await updateMilestonesOnRelease(toolkit);

        expect(toolkit.github.rest.repos.getBranch).toHaveBeenCalledWith(expect.objectContaining({ branch: "6.6.x" }));
        expect(toolkit.github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({
            issue_number: 5,
            labels: ["milestone/6.6.10.26"],
        }));
    });

    it("keeps bumping the minor when there is no maintenance branch", async () => {
        process.env.TAG = "v6.7.10.0";
        const toolkit = milestoneToolkit([{ number: 5, title: "c" }]);

        await updateMilestonesOnRelease(toolkit);

        expect(toolkit.github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({
            labels: ["milestone/6.7.11.0"],
        }));
    });
});

describe("syncMilestoneForPR", () => {
    /** Builds a toolkit around one pull request payload. `milestones` is what the repo already has. */
    function syncToolkit(pullRequest: Record<string, unknown>, action = "labeled", milestones: Record<string, unknown>[] = [{ number: 7, title: "6.7.15.0" }]) {
        const toolkit = createMockToolkit();

        toolkit.context = {
            repo: { owner: "shopware", repo: "shopware" },
            payload: { action, pull_request: { number: 1, labels: [], head: "feat/x", assignee: "someone", ...pullRequest } },
        };
        toolkit.github.paginate = vi.fn().mockResolvedValue(milestones);
        // No linked development issue unless a test says otherwise.
        toolkit.github.graphql = vi.fn().mockResolvedValue({ search: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
        toolkit.github.rest.issues = {
            listMilestones: vi.fn(),
            update: vi.fn().mockResolvedValue({}),
            createMilestone: vi.fn().mockResolvedValue({ data: { number: 9, title: "6.7.16.0" } }),
        };

        return toolkit;
    }

    it("puts an open pull request on the milestone its label names", async () => {
        const toolkit = syncToolkit({ labels: [{ name: "milestone/6.7.15.0" }] });

        await syncMilestoneForPR(toolkit);

        expect(toolkit.github.rest.issues.update).toHaveBeenCalledWith(expect.objectContaining({
            issue_number: 1,
            milestone: 7,
        }));
    });

    it("creates the milestone when the label names a new one", async () => {
        const toolkit = syncToolkit({ labels: [{ name: "milestone/6.7.16.0" }] });

        await syncMilestoneForPR(toolkit);

        expect(toolkit.github.rest.issues.createMilestone).toHaveBeenCalledWith(expect.objectContaining({ title: "6.7.16.0" }));
        expect(toolkit.github.rest.issues.update).toHaveBeenCalledWith(expect.objectContaining({ milestone: 9 }));
    });

    it("does nothing when the milestone is already right", async () => {
        const toolkit = syncToolkit({ labels: [{ name: "milestone/6.7.15.0" }], milestone: { number: 7 } });

        await syncMilestoneForPR(toolkit);

        expect(toolkit.github.rest.issues.update).not.toHaveBeenCalled();
    });

    it("clears the milestone when the label is gone", async () => {
        const toolkit = syncToolkit({ labels: [], milestone: { number: 7 } }, "unlabeled");

        await syncMilestoneForPR(toolkit);

        expect(toolkit.github.rest.issues.update).toHaveBeenCalledWith(expect.objectContaining({
            issue_number: 1,
            milestone: null,
        }));
    });

    it("clears the milestone of a pull request closed without merging", async () => {
        // GitHub counts every closed item as completed, so an abandoned one would
        // otherwise show up as delivered.
        const toolkit = syncToolkit({ labels: [{ name: "milestone/6.7.15.0" }], milestone: { number: 7 }, merged: false }, "closed");

        await syncMilestoneForPR(toolkit);

        expect(toolkit.github.rest.issues.update).toHaveBeenCalledWith(expect.objectContaining({ milestone: null }));
    });

    it("keeps the milestone of a merged pull request", async () => {
        const toolkit = syncToolkit({ labels: [{ name: "milestone/6.7.15.0" }], milestone: { number: 7 }, merged: true }, "closed");

        await syncMilestoneForPR(toolkit);

        expect(toolkit.github.rest.issues.update).not.toHaveBeenCalled();
    });

    it("does not clear a milestone that was never set", async () => {
        const toolkit = syncToolkit({ labels: [] }, "unlabeled");

        await syncMilestoneForPR(toolkit);

        expect(toolkit.github.rest.issues.update).not.toHaveBeenCalled();
    });

    it("prefers the linked development issue over the pull request", async () => {
        const toolkit = syncToolkit({ labels: [{ name: "milestone/6.7.15.0" }] });
        toolkit.github.graphql = vi.fn().mockResolvedValue({
            search: {
                nodes: [{
                    number: 1,
                    closingIssuesReferences: { nodes: [{ id: "I_1", title: "the issue", number: 42, url: "u", repository: { owner: { login: "shopware" }, name: "shopware" } }] },
                }],
                pageInfo: { hasNextPage: false, endCursor: null },
            },
        });

        await syncMilestoneForPR(toolkit);

        expect(toolkit.github.rest.issues.update).toHaveBeenCalledWith(expect.objectContaining({
            issue_number: 42,
            milestone: 7,
        }));
    });

    it("refuses to run outside a pull request workflow", async () => {
        const toolkit = createMockToolkit();
        toolkit.context = { repo: { owner: "shopware", repo: "shopware" }, payload: {} };

        await expect(syncMilestoneForPR(toolkit)).rejects.toThrow("pull_request");
    });
});
