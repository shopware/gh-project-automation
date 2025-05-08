import * as automation from "../index";
import {getOctokit} from "@actions/github";
import {Context} from "@actions/github/lib/context";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as glob from "@actions/glob";
import * as io from "@actions/io";
import fetch from "node-fetch";
import JiraApi from "jira-client";

const toolkit = {
    github: getOctokit(process.env.GITHUB_TOKEN ?? ""),
    context: new Context(),
    core: core,
    exec: exec,
    glob: glob,
    io: io,
    fetch: fetch,
}

const jira = new JiraApi({
    protocol: 'https',
    host: 'shopware.atlassian.net',
    username: process.env.JIRA_USERNAME,
    password: process.env.JIRA_API_TOKEN,
    apiVersion: '3',
    strictSSL: true
});

export async function run(method: string, ...args: string[]) {
    let result;

    switch (method) {
        case "getProjectsByOrg":
            result = await automation.getProjectsByOrg(toolkit, null, null);
            break;
        case "getProjectIdByNumber":
            result = await automation.getProjectIdByNumber(toolkit, null, parseInt(args[0]));
            break;
        case "getIssuesByProject":
            result = await automation.getIssuesByProject(toolkit, args[0], parseInt(args[1]));
            break;
        case "getEpicsInProgressByProject":
            result = await automation.getEpicsInProgressByProject(toolkit, args[0], null);
            break;
        case "correlateGitHubIssueWithJiraEpic":
            result = await automation.correlateGitHubIssueWithJiraEpic(toolkit, jira, {
                id: "awdawd",
                title: args[0],
                number: 0,
                url: args[1],
                status: "In Progress",
                labels: []
            });
            break;
        case "correlateIssuesForProject":
            result = await automation.correlateIssuesForProject(toolkit, jira, args[0], parseInt(args[1]));
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
