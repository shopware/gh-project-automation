export type QueryResponse = {
    repository: {
        issues?: {
            pageInfo: {
                hasNextPage: boolean,
                endCursor: string
            },
            nodes: [{
                id: string,
                number: number,
                title: string,
                labels: {
                    nodes: [{
                        name: string
                    }]
                }
            }]
        },
        pullRequests?: {
            pageInfo: {
                hasNextPage: boolean,
                endCursor: string
            },
            nodes: [{
                id: string,
                number: number,
                title: string,
                labels: {
                    nodes: [{
                        name: string
                    }]
                }
            }]
        }
    }
};
