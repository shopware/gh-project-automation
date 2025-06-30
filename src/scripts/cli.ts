import {getOctokit} from "@actions/github";
import {Context} from "@actions/github/lib/context";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as glob from "@actions/glob";
import * as io from "@actions/io";
import fetch from "node-fetch";

const toolkit = {
    github: getOctokit(process.env.GITHUB_TOKEN ?? ""),
    context: new Context(),
    core: core,
    exec: exec,
    glob: glob,
    io: io,
    fetch: fetch,
}

import * as automation from "../index";

/**
 * Run the automation functions from the command line.
 * This is just a convenience for testing and debugging.
 *
 * @param method The method to run
 * @param args The arguments to pass to the method
 *
 * @example
 * npm run cli -- getProjectIdByNumber 22
 */
export async function run(method: string, ...args: string[]) {
    let result;

    switch (method) {
        case "getProjectIdByNumber":
            result = await automation.getProjectIdByNumber(toolkit, parseInt(args[0]), "shopware");
            break;
        case "getIssuesByProject":
            result = await automation.getIssuesByProject(toolkit, args[0], null, null);
            break;
        case "getEpicsInProgressByProject":
            result = await automation.getEpicsInProgressByProject(toolkit, args[0]);
            break;
        case "getCommentsForIssue":
            result = await automation.getCommentsForIssue(toolkit, args[0]);
            break;
        case "hasDocIssueComment":
            result = await automation.hasDocIssueComment(toolkit, args[0]);
            break;
        case "createDocIssueComment":
            result = await automation.createDocIssueComment(toolkit, args[0], args[1]);
            break;
        case "createDocumentationTasksForProjects":
            result = await automation.createDocumentationTasksForProjects(toolkit, args[0].split(",").map(i => parseInt(i)));
            break;
        case "cleanupNeedsTriage":
            result = await automation.cleanupNeedsTriage(toolkit, true);
            break;
        case "getDevelopmentIssueForPullRequest":
            result = await automation.getDevelopmentIssueForPullRequest(toolkit, args[0], parseInt(args[1]), args[2], args[3]);
            break;
        case "manageOldPullRequests":
            result = await automation.manageOldPullRequests(toolkit, args[0], parseInt(args[1]), args[2] === "true");
            break;
        default:
            // eslint-disable-next-line no-console
            console.warn("Unknown method");
            break;
    }

    if (result !== undefined) {
        // eslint-disable-next-line no-console
        console.debug(result);
    }
}

run(process.argv[2], ...process.argv.slice(3))
