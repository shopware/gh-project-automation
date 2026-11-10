import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    externalContributionChannels,
    labelExternalContribution,
    notifyExternalContribution,
    parseExternalContributionChannels,
} from "../../src/services/external_contribution";
import { createMockToolkit } from "../helpers";

const postToChannel = vi.fn();

vi.mock("../../src/api", () => ({
    SlackClient: vi.fn().mockImplementation(function () {
        return { postToChannel };
    }),
}));

type Payload = Record<string, unknown>;

function item(labels: string[] = [], login = "contributor", nodeId = "U_contributor") {
    return {
        number: 42,
        title: "Fix <thing> & more",
        html_url: "https://github.com/shopware/helm-charts/issues/42",
        user: { login, node_id: nodeId },
        labels: labels.map(name => ({ name })),
    };
}

function toolkitFor(payload: Payload, permission: string | Error = "read") {
    const addLabels = vi.fn();
    const getCollaboratorPermissionLevel = vi.fn().mockImplementation(async () => {
        if (permission instanceof Error) {
            throw permission;
        }

        return { data: { permission } };
    });

    const toolkit = createMockToolkit({
        context: { payload, repo: { owner: "shopware", repo: "helm-charts" } },
        github: { rest: { repos: { getCollaboratorPermissionLevel }, issues: { addLabels } } },
    });

    return { toolkit, addLabels, getCollaboratorPermissionLevel };
}

beforeEach(() => {
    vi.stubEnv("DRY_RUN", "");
    vi.stubEnv("SLACK_TOKEN", "xoxb-test");
    postToChannel.mockReset();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("labelExternalContribution", () => {
    it("labels an issue by an author without write access", async () => {
        const { toolkit, addLabels, getCollaboratorPermissionLevel } = toolkitFor({ issue: item() });

        expect(await labelExternalContribution(toolkit)).toBe(true);
        expect(getCollaboratorPermissionLevel).toHaveBeenCalledWith({ owner: "shopware", repo: "helm-charts", username: "contributor" });
        expect(addLabels).toHaveBeenCalledWith({ owner: "shopware", repo: "helm-charts", issue_number: 42, labels: ["external-contribution"] });
    });

    it("labels a pull request with a custom label", async () => {
        const { toolkit, addLabels } = toolkitFor({ pull_request: item() });

        expect(await labelExternalContribution(toolkit, "external")).toBe(true);
        expect(addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: ["external"] }));
    });

    it.each(["write", "admin"])("skips an author with %s access", async (permission) => {
        const { toolkit, addLabels } = toolkitFor({ issue: item() }, permission);

        expect(await labelExternalContribution(toolkit)).toBe(false);
        expect(addLabels).not.toHaveBeenCalled();
    });

    it("skips a trusted bot without asking for its permission", async () => {
        const { toolkit, addLabels, getCollaboratorPermissionLevel } = toolkitFor({ pull_request: item([], "octo-sts[bot]", "BOT_kgDOCV3tAw") });

        expect(await labelExternalContribution(toolkit)).toBe(false);
        expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled();
        expect(addLabels).not.toHaveBeenCalled();
    });

    it("treats a failed permission lookup as no write access", async () => {
        const { toolkit, addLabels } = toolkitFor({ issue: item() }, new Error("Not Found"));

        expect(await labelExternalContribution(toolkit)).toBe(true);
        expect(addLabels).toHaveBeenCalled();
    });

    it("does not report a reopened item that already carries the label", async () => {
        const { toolkit, addLabels } = toolkitFor({ issue: item(["external-contribution"]) });

        expect(await labelExternalContribution(toolkit)).toBe(false);
        expect(addLabels).not.toHaveBeenCalled();
    });

    it("only logs in a dry run", async () => {
        vi.stubEnv("DRY_RUN", "true");
        const { toolkit, addLabels } = toolkitFor({ issue: item() });

        expect(await labelExternalContribution(toolkit)).toBe(true);
        expect(addLabels).not.toHaveBeenCalled();
    });

    it("rejects an event without an issue or pull request", async () => {
        const { toolkit } = toolkitFor({});

        await expect(labelExternalContribution(toolkit)).rejects.toThrow("Expected an issues or pull_request event.");
    });
});

describe("parseExternalContributionChannels", () => {
    it("accepts a JSON string, an object and nothing", () => {
        expect(parseExternalContributionChannels('{"a": "C1"}')).toEqual(new Map([["a", "C1"]]));
        expect(parseExternalContributionChannels({ a: "C1" })).toEqual(new Map([["a", "C1"]]));
        expect(parseExternalContributionChannels(undefined)).toEqual(new Map());
        expect(parseExternalContributionChannels(" ")).toEqual(new Map());
    });

    it.each(['["C1"]', '{"a": 1}', "null"])("rejects %s", (json) => {
        expect(() => parseExternalContributionChannels(json)).toThrow("Channels must be a JSON object");
    });
});

describe("externalContributionChannels", () => {
    const channels = new Map([["domain/a", "C_A"], ["domain/b", "C_B"], ["external-contribution", "C_ALL"]]);

    it("notifies nobody without the external label", () => {
        expect(externalContributionChannels(["domain/a"], "domain/a", channels)).toEqual([]);
    });

    it("notifies every matching channel when the external label completes the pair", () => {
        expect(externalContributionChannels(["external-contribution", "domain/a"], "external-contribution", channels)).toEqual(["C_A", "C_ALL"]);
    });

    it("notifies only the team whose label was added later", () => {
        expect(externalContributionChannels(["external-contribution", "domain/a", "domain/b"], "domain/b", channels)).toEqual(["C_B"]);
    });

    it("ignores unrelated labels", () => {
        expect(externalContributionChannels(["external-contribution", "domain/a"], "bug", channels)).toEqual([]);
    });
});

describe("notifyExternalContribution", () => {
    const channels = '{"external-contribution": "C_ALL"}';

    it("posts a labeled issue with escaped title", async () => {
        const { toolkit } = toolkitFor({ issue: item(["external-contribution"]), label: { name: "external-contribution" } });

        await notifyExternalContribution(toolkit, channels);

        expect(postToChannel).toHaveBeenCalledWith(
            "C_ALL",
            ":wave: New external issue: <https://github.com/shopware/helm-charts/issues/42|shopware/helm-charts#42 Fix &lt;thing&gt; &amp; more> by contributor",
        );
    });

    it("takes the label just added in the same run, missing from the payload", async () => {
        const { toolkit } = toolkitFor({ pull_request: item() });

        await notifyExternalContribution(toolkit, channels, "external-contribution");

        expect(postToChannel).toHaveBeenCalledWith("C_ALL", expect.stringContaining("New external pull request"));
    });

    it("posts nothing when no channel matches", async () => {
        const { toolkit } = toolkitFor({ issue: item(["external-contribution"]), label: { name: "bug" } });

        await notifyExternalContribution(toolkit, channels);

        expect(postToChannel).not.toHaveBeenCalled();
    });

    it.each([["without a token", "SLACK_TOKEN", ""], ["in a dry run", "DRY_RUN", "true"]])("only logs %s", async (_, name, value) => {
        vi.stubEnv(name, value);
        const { toolkit } = toolkitFor({ issue: item(["external-contribution"]), label: { name: "external-contribution" } });

        await notifyExternalContribution(toolkit, channels);

        expect(postToChannel).not.toHaveBeenCalled();
        expect(toolkit.core.info).toHaveBeenCalledWith(expect.stringContaining("Would post to C_ALL"));
    });

    it("needs a labeled event or an added label", async () => {
        const { toolkit } = toolkitFor({ issue: item() });

        await expect(notifyExternalContribution(toolkit, channels)).rejects.toThrow("Expected a labeled event or an addedLabel.");
    });
});
