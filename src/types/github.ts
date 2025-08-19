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

export type GitHubMilestone = {
    id: number
    url: string
    html_url: string
    labels_url: string
    node_id: string
    number: number
    state: "open" | "closed"
    title: string
    description: string | null
    created_at: string
    updated_at: string
    closed_at: string | null
    due_on: string | null
    open_issues: number
    closed_issues: number
}
