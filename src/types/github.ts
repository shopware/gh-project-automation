export type GitHubIssue = {
    id: string
    title: string
    number?: number
    url?: string
    status?: string
    labels: Label[]
    type?: string
    owner?: string
    repository?: string
    assignees?: {
        login: string
    }
    reviewRequests?: {
        login: string
    }
    closingIssuesReferences?: GitHubIssue
}

export type GitHubComment = {
    id: string
    author: {
        login: string
    }
    body: string
    url?: string
}

export type Label = {
    id: string
    name: string
    url: string
    description?: string
    color: string
}

export type Labelable = {
    id: string
    number: number
    title: string
    labels: {
        nodes: [{
            name: string
        }]
    }
}
