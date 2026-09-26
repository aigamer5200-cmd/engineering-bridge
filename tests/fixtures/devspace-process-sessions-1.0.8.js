const DEFAULT_EXEC_YIELD_MS = 10_000;
const DEFAULT_INTERACTIVE_YIELD_MS = 250;
const DEFAULT_POLL_YIELD_MS = 5_000;
const MAX_COMMAND_YIELD_MS = 30_000;
const MAX_POLL_YIELD_MS = 110_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
const COMPLETED_SESSION_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

function boundedInteger(value, fallback, maximum) {
    if (value === undefined)
        return fallback;
    if (!Number.isFinite(value) || value < 0)
        throw new Error("Duration and output limits must be non-negative.");
    return Math.min(Math.floor(value), maximum);
}

function terminalSize(value, fallback) {
    if (value === undefined)
        return fallback;
    if (!Number.isInteger(value) || value < 1 || value > 1_000)
        throw new Error("Terminal dimensions must be integers between 1 and 1000.");
    return value;
}

class HeadTailBuffer {
    output = "";

    append(output) {
        this.output += output;
    }

    hasOutput() {
        return this.output.length > 0;
    }

    drain(maxCharacters) {
        const truncated = this.output.length > maxCharacters;
        const output = this.output.slice(0, maxCharacters);
        this.output = "";
        return { output, truncated };
    }
}

export class ProcessSessionManager {
    sessions = new Map();
    maxBufferCharacters;
    completedSessionTtlMs;
    nextSessionId = 1;

    constructor(options = {}) {
        this.maxBufferCharacters = options.maxBufferCharacters ?? 1_000_000;
        this.completedSessionTtlMs = options.completedSessionTtlMs ?? COMPLETED_SESSION_TTL_MS;
    }

    async start(input) {
        const session = this.createSession(input);
        this.sessions.set(session.id, session);
        try {
            if (input.tty && process.platform !== "win32")
                await this.startPty(session, input);
            else
                this.startPipe(session, input);
        }
        catch (error) {
            this.sessions.delete(session.id);
            throw error;
        }
        const yieldTimeMs = boundedInteger(input.yieldTimeMs, DEFAULT_EXEC_YIELD_MS, MAX_COMMAND_YIELD_MS);
        await this.waitForExit(session, yieldTimeMs);
        const snapshot = this.consume(session, input.maxOutputTokens);
        if (!session.running)
            this.removeSession(session.id);
        return snapshot;
    }

    async write(input) {
        const session = this.getOwnedSession(input.workspaceId, input.sessionId);
        const chars = input.chars ?? "";
        const interactionRequested = chars.length > 0 || input.columns !== undefined || input.rows !== undefined;
        if (input.columns !== undefined || input.rows !== undefined) {
            session.columns = terminalSize(input.columns, session.columns);
            session.rows = terminalSize(input.rows, session.rows);
            if (!session.process?.resize)
                throw new Error(`Process session ${session.id} is not a PTY and cannot be resized.`);
            session.process.resize(session.columns, session.rows);
        }
        const interruptRequested = chars.includes("\u0003") && session.running;
        if (interruptRequested)
            session.process?.kill("SIGINT");
        const writableChars = chars.replaceAll("\u0003", "");
        if (writableChars && session.running)
            session.process?.write(writableChars);
        if ((interactionRequested || !session.buffer.hasOutput()) && session.running) {
            const fallback = interactionRequested ? DEFAULT_INTERACTIVE_YIELD_MS : DEFAULT_POLL_YIELD_MS;
            const maximum = interactionRequested ? MAX_COMMAND_YIELD_MS : MAX_POLL_YIELD_MS;
            const yieldTimeMs = boundedInteger(input.yieldTimeMs, fallback, maximum);
            await this.waitForExit(session, yieldTimeMs);
        }
        const snapshot = this.consume(session, input.maxOutputTokens);
        if (!session.running)
            this.removeSession(session.id);
        return snapshot;
    }

    terminate(workspaceId, sessionId) {
        const session = this.getOwnedSession(workspaceId, sessionId);
        if (session.running)
            session.process?.kill("SIGTERM");
    }

    shutdown() {
        for (const session of this.sessions.values()) {
            if (session.cleanupTimer)
                clearTimeout(session.cleanupTimer);
            if (session.running)
                session.process?.kill("SIGTERM");
        }
        this.sessions.clear();
    }

    async waitForExit(session, yieldTimeMs) {
        let timer;
        try {
            await Promise.race([
                session.exitPromise,
                new Promise((resolve) => {
                    timer = setTimeout(resolve, yieldTimeMs);
                }),
            ]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }

    createSession(input) {
        let resolveExit = () => undefined;
        const exitPromise = new Promise((resolve) => {
            resolveExit = resolve;
        });
        return {
            id: this.nextSessionId++,
            workspaceId: input.workspaceId,
            startedAt: Date.now(),
            columns: terminalSize(input.columns, DEFAULT_COLUMNS),
            rows: terminalSize(input.rows, DEFAULT_ROWS),
            buffer: new HeadTailBuffer(),
            running: true,
            exitPromise,
            resolveExit,
        };
    }

    startPipe(session, input) {
        session.process = {
            write: () => undefined,
            kill: () => this.finish(session, 130, "SIGINT"),
            resize: input.tty ? () => undefined : undefined,
        };
        const timer = setTimeout(() => {
            this.append(session, input.output ?? "terminal-result\n");
            this.finish(session, input.exitCode ?? 7, undefined);
        }, input.completeAfterMs ?? 1);
        timer.unref?.();
    }

    async startPty(session, input) {
        this.startPipe(session, input);
    }

    finish(session, exitCode, signal) {
        if (!session.running)
            return;
        session.running = false;
        session.exitCode = exitCode;
        session.signal = signal;
        session.resolveExit();
        session.cleanupTimer = setTimeout(() => this.sessions.delete(session.id), this.completedSessionTtlMs);
        session.cleanupTimer.unref();
    }

    append(session, output) {
        session.buffer.append(output);
    }

    consume(session, maxOutputTokens) {
        const limit = boundedInteger(maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS, 100_000);
        const maxCharacters = Math.max(256, limit * 4);
        const buffered = session.buffer.drain(maxCharacters);
        return {
            sessionId: session.running ? session.id : undefined,
            output: buffered.output,
            outputTruncated: buffered.truncated,
            running: session.running,
            exitCode: session.exitCode,
            signal: session.signal,
            wallTimeMs: Date.now() - session.startedAt,
        };
    }

    getOwnedSession(workspaceId, sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            throw new Error(`Unknown process session: ${sessionId}`);
        if (session.workspaceId !== workspaceId) {
            throw new Error(`Process session ${sessionId} does not belong to workspace ${workspaceId}.`);
        }
        return session;
    }

    removeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session?.cleanupTimer)
            clearTimeout(session.cleanupTimer);
        this.sessions.delete(sessionId);
    }
}
