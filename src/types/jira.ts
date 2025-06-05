export type JiraIssue = {
    id: string
    title: string
    key: string
    url?: string
    status?: string
    labels: string[]
    type?: string
}
