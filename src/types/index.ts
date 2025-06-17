// Types exported from the library
import { GitHub } from '@actions/github/lib/utils.js'
import { Context } from '@actions/github/lib/context.js'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as glob from '@actions/glob'
import * as io from '@actions/io'
import fetch from 'node-fetch'

export type Toolkit = {
    github: InstanceType<typeof GitHub>
    context: Context
    core: typeof core
    exec: typeof exec
    glob: typeof glob
    io: typeof io
    fetch: typeof fetch
}

export * from './github'
export * from './jira'
export * from './util'
