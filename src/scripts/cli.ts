import * as automation from "../index";
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
        default:
            console.warn("Unknown method");
            break;
    }

    if (result) {
        console.debug(result);
    }
}

run(process.argv[2], ...process.argv.slice(3))
