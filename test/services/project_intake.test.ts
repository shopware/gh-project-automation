import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectIntakeItem, resetProjectIntakeStatus, wasPlacedBySync } from "../../src/services/project_intake";
import { createMockToolkit } from "../helpers";

function item(id: string, addedAt: Date, status: string | null, statusUpdatedAt: Date = new Date(addedAt.getTime() + 2000)): ProjectIntakeItem {
    return {
        id,
        createdAt: addedAt.toISOString(),
        content: { number: 1, url: `https://github.com/shopware/shopware/issues/${id}` },
        fieldValueByName: status === null ? null : { name: status, updatedAt: statusUpdatedAt.toISOString() },
    };
}

const projectInfoResponse = {
    organization: {
        projectV2: {
            id: "PROJECT",
            title: "Framework Group",
            fields: {
                nodes: [
                    {},
                    {
                        id: "STATUS",
                        name: "Status",
                        options: [
                            { id: "OPT_TRIAGE", name: "To Triage" },
                            { id: "OPT_BACKLOG", name: "Backlog" },
                            { id: "OPT_TODO", name: "ToDo" },
                        ],
                    },
                ],
            },
        },
    },
};

function itemsResponse(nodes: ProjectIntakeItem[], hasNextPage = false) {
    return {
        organization: {
            projectV2: {
                items: {
                    pageInfo: { endCursor: "cursor", hasNextPage },
                    nodes,
                },
            },
        },
    };
}

describe("wasPlacedBySync", () => {
    const added = new Date("2026-11-26T10:00:00Z");

    it("matches Backlog/Todo set right after the add, ignoring case", () => {
        expect(wasPlacedBySync(item("1", added, "Backlog"), "To Triage")).toBe(true);
        expect(wasPlacedBySync(item("2", added, "ToDo"), "To Triage")).toBe(true);
    });

    it("ignores items moved later", () => {
        const later = new Date(added.getTime() + 5 * 60 * 1000);
        expect(wasPlacedBySync(item("1", added, "Backlog", later), "To Triage")).toBe(false);
    });

    it("ignores items already in the intake column, without status or in other columns", () => {
        expect(wasPlacedBySync(item("1", added, "To Triage"), "To Triage")).toBe(false);
        expect(wasPlacedBySync(item("2", added, null), "To Triage")).toBe(false);
        expect(wasPlacedBySync(item("3", added, "In Progress"), "To Triage")).toBe(false);
        expect(wasPlacedBySync(item("4", added, "Done"), "To Triage")).toBe(false);
    });

    it("does not reset Todo when Todo is the intake status", () => {
        expect(wasPlacedBySync(item("1", added, "Todo"), "Todo")).toBe(false);
    });
});

describe("resetProjectIntakeStatus", () => {
    const originalDryRun = process.env.DRY_RUN;

    beforeEach(() => {
        delete process.env.DRY_RUN;
    });

    afterEach(() => {
        process.env.DRY_RUN = originalDryRun;
        if (originalDryRun === undefined) {
            delete process.env.DRY_RUN;
        }
    });

    it("moves only sync-placed items that were added within the lookback window", async () => {
        const now = Date.now();
        const toolkit = createMockToolkit();
        toolkit.github.graphql
            .mockResolvedValueOnce(projectInfoResponse)
            .mockResolvedValueOnce(itemsResponse([
                item("synced", new Date(now - 10 * 60 * 1000), "Backlog"),
                item("triaged", new Date(now - 10 * 60 * 1000), "Backlog", new Date(now - 60 * 1000)),
                item("old", new Date(now - 5 * 60 * 60 * 1000), "Backlog"),
            ]))
            .mockResolvedValue({});

        await resetProjectIntakeStatus(toolkit, { 27: "To Triage" }, 120);

        expect(toolkit.github.graphql).toHaveBeenCalledTimes(3);
        expect(toolkit.github.graphql.mock.calls[2][1]).toEqual({
            projectId: "PROJECT",
            itemId: "synced",
            fieldId: "STATUS",
            valueId: "OPT_TRIAGE",
        });
    });

    it("follows pagination", async () => {
        const now = Date.now();
        const toolkit = createMockToolkit();
        toolkit.github.graphql
            .mockResolvedValueOnce(projectInfoResponse)
            .mockResolvedValueOnce(itemsResponse([item("a", new Date(now - 60 * 1000), "Backlog")], true))
            .mockResolvedValueOnce(itemsResponse([item("b", new Date(now - 60 * 1000), "ToDo")]))
            .mockResolvedValue({});

        await resetProjectIntakeStatus(toolkit, { 27: "To Triage" }, 120);

        expect(toolkit.github.graphql.mock.calls[2][1]).toMatchObject({ cursor: "cursor" });
        expect(toolkit.github.graphql.mock.calls.slice(3).map(call => call[1].itemId)).toEqual(["a", "b"]);
    });

    it("does not write in dry run mode", async () => {
        process.env.DRY_RUN = "true";
        const toolkit = createMockToolkit();
        toolkit.github.graphql
            .mockResolvedValueOnce(projectInfoResponse)
            .mockResolvedValueOnce(itemsResponse([item("synced", new Date(Date.now() - 60 * 1000), "Backlog")]));

        await resetProjectIntakeStatus(toolkit, { 27: "To Triage" }, 120);

        expect(toolkit.github.graphql).toHaveBeenCalledTimes(2);
    });

    it("skips boards without the intake option", async () => {
        const toolkit = createMockToolkit();
        toolkit.github.graphql.mockResolvedValueOnce(projectInfoResponse);

        await resetProjectIntakeStatus(toolkit, { 27: "Needs Triage" }, 120);

        expect(toolkit.github.graphql).toHaveBeenCalledTimes(1);
        expect(toolkit.core.warning).toHaveBeenCalled();
    });
});
