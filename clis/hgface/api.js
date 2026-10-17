import { CommandExecutionError, TimeoutError } from '@geonmoo/opencli/errors';

export async function hfFetch(url) {
    try {
        const response = await fetch(url, {
            headers: { Accept: 'application/json', 'User-Agent': 'opencli' },
            signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
            throw new CommandExecutionError(`Hugging Face HTTP ${response.status}`,
                response.status === 429 ? 'Wait before retrying; Hugging Face has rate limited this request.' : undefined);
        }
        return await response.json();
    } catch (error) {
        if (error instanceof CommandExecutionError) throw error;
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new TimeoutError('Hugging Face request', 30);
        throw new CommandExecutionError(`Hugging Face request failed: ${error.message}`);
    }
}
