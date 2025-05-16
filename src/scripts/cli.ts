import * as automation from "../index";
import {getOctokit} from "@actions/github";
import {Context} from "@actions/github/lib/context";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as glob from "@actions/glob";
import * as io from "@actions/io";
import fetch from "node-fetch";
import {createDocumentationTasksForProjects} from "../index";

const toolkit = {
    github: getOctokit(process.env.GITHUB_TOKEN ?? ""),
    context: new Context(),
    core: core,
    exec: exec,
    glob: glob,
    io: io,
    fetch: fetch,
}

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
        case "correlateGitHubIssueWithJiraEpic":
            result = await automation.correlateGitHubIssueWithJiraEpic(toolkit, {
                id: "awdawd",
                title: args[0],
                number: 0,
                url: args[1],
                status: "In Progress",
                labels: []
            });
            break;
        case "correlateIssuesForProject":
            result = await automation.correlateIssuesForProject(toolkit, args[0]);
            break;
        case "createDocumentationTasksForProjects":
            result = await createDocumentationTasksForProjects(toolkit, args[0].split(",").map(i => parseInt(i)));
            break;
        case "cleanupNeedsTriage":
            result = await automation.cleanupNeedsTriage(toolkit, true);
            break;
        default:
            console.warn("Unknown method");
            break;
    }

    if (result) {
        console.debug(result);
    }
}

run(process.argv[2], ...process.argv.slice(3))
