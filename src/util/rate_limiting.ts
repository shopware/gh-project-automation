export async function rateLimitedRun<T>(items: T[], fn: (item: T) => Promise<void>, max_concurrency: number = 10, delay_ms: number = 1000): Promise<void> {
    // Split items into chunks of max_concurrency
    const chunks = [];
    for (let i = 0; i < items.length; i += max_concurrency) {
        chunks.push(items.slice(i, i + max_concurrency));
    }

    for (const chunk of chunks) {
        // Run all items in the chunk concurrently
        await Promise.all(chunk.map(item => fn(item)));

        // Add a small delay between batches to respect the secondary rate limit
        const nextChunk = chunks[chunks.indexOf(chunk) + 1];
        if (nextChunk) {
            await new Promise(resolve => setTimeout(resolve, delay_ms));
        }
    }
}

