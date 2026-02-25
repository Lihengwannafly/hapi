export type ReadyAfterTurnDecision =
    | { type: 'skip' }
    | { type: 'wait'; delayMs: number }
    | { type: 'ready'; forceCompleteTurn: boolean; warnMissingTurnComplete: boolean };

export type ReadyAfterTurnDecisionInput = {
    now: number;
    shouldExit: boolean;
    readySentForTurn: boolean;
    queueSize: number;
    turnInFlight: boolean;
    promptSettledAt: number;
    lastSessionUpdateAt: number;
    readyCheckIntervalMs: number;
    activityQuietPeriodMs: number;
    missingTurnCompleteGraceMs: number;
};

export function decideReadyAfterTurn(input: ReadyAfterTurnDecisionInput): ReadyAfterTurnDecision {
    if (input.shouldExit || input.readySentForTurn) {
        return { type: 'skip' };
    }

    if (input.queueSize > 0) {
        return { type: 'skip' };
    }

    if (!input.promptSettledAt) {
        return { type: 'wait', delayMs: normalizeDelay(input.readyCheckIntervalMs) };
    }

    const elapsedSincePromptSettled = input.now - input.promptSettledAt;
    const exceededTurnCompleteGrace = input.turnInFlight && elapsedSincePromptSettled >= input.missingTurnCompleteGraceMs;

    if (input.turnInFlight && !exceededTurnCompleteGrace) {
        return {
            type: 'wait',
            delayMs: normalizeDelay(Math.min(
                input.readyCheckIntervalMs,
                input.missingTurnCompleteGraceMs - elapsedSincePromptSettled
            ))
        };
    }

    const forceCompleteTurn = input.turnInFlight;
    const warnMissingTurnComplete = exceededTurnCompleteGrace;
    const lastActivityAt = Math.max(input.promptSettledAt, input.lastSessionUpdateAt);
    const quietMs = input.now - lastActivityAt;

    if (quietMs < input.activityQuietPeriodMs) {
        return {
            type: 'wait',
            delayMs: normalizeDelay(input.activityQuietPeriodMs - quietMs)
        };
    }

    return {
        type: 'ready',
        forceCompleteTurn,
        warnMissingTurnComplete
    };
}

function normalizeDelay(ms: number): number {
    return Math.max(1, Math.ceil(ms));
}
