import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ProtocolErrorHandlerService {
    private readonly logger = new Logger(ProtocolErrorHandlerService.name);

    /**
     * Checks if an error is an expected WhatsApp protocol error that can be safely ignored
     */
    isExpectedProtocolError(error: unknown): boolean {
        if (!error || typeof error !== 'object' || !('message' in error)) {
            return false;
        }

        const message = (error as Error).message || '';
        return (
            message.includes('Protocol error') &&
            (message.includes('Session closed') ||
                message.includes('Target closed') ||
                message.includes('Connection closed') ||
                message.includes('Runtime.callFunctionOn'))
        );
    }

    /**
     * Handles protocol errors by logging them appropriately and deciding whether to throw
     * @param error The error to handle
     * @param context The context for logging
     * @param throwOnUnexpected If true, rethrows unexpected errors (default: false)
     */
    handleProtocolError(error: unknown, context: string, throwOnUnexpected: boolean = false): void {
        if (this.isExpectedProtocolError(error)) {
            this.logger.debug(`[${context}] Ignoring expected protocol error: ${(error as Error).message}`);
            return;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`[${context}] Unexpected error: ${errorMessage}`);

        if (throwOnUnexpected) {
            throw error;
        }
    }

    /**
     * Wraps an async operation with protocol error handling
     * @param operation The async operation to execute
     * @param context The context for logging
     * @param fallbackValue Optional fallback value to return on error
     */
    async safeExecute<T>(
        operation: () => Promise<T>,
        context: string,
        fallbackValue: T | undefined = undefined,
    ): Promise<T | undefined> {
        try {
            return await operation();
        } catch (error) {
            this.handleProtocolError(error, context, false);
            return fallbackValue;
        }
    }

    /**
     * Wraps a Promise.race with timeout and protocol error handling
     * @param operations Array of promises to race
     * @param timeoutMs Timeout duration in milliseconds
     * @param context The context for logging
     * @param fallbackValue Optional fallback value to return on error
     */
    async safeRace<T>(
        operations: Promise<T>[],
        timeoutMs: number,
        context: string,
        fallbackValue: T | undefined = undefined,
    ): Promise<T | undefined> {
        try {
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
            );

            return await Promise.race([...operations, timeoutPromise]);
        } catch (error) {
            const isTimeoutError = error instanceof Error && error.message.includes('Timeout after');
            if (isTimeoutError) {
                this.logger.warn(`[${context}] Operation timed out after ${timeoutMs}ms`);
            } else {
                this.handleProtocolError(error, context, false);
            }
            return fallbackValue;
        }
    }

    /**
     * Creates a safe version of a browser operation that handles protocol errors
     * @param operation The async browser operation
     * @param context The context for logging
     */
    safeBrowserOperation<T>(operation: () => Promise<T>, context: string): Promise<T | undefined> {
        return this.safeExecute(operation, `Browser-${context}`);
    }

    /**
     * Creates a safe version of a client operation that handles protocol errors
     * @param operation The async client operation
     * @param context The context for logging
     */
    safeClientOperation<T>(operation: () => Promise<T>, context: string): Promise<T | undefined> {
        return this.safeExecute(operation, `Client-${context}`);
    }
}