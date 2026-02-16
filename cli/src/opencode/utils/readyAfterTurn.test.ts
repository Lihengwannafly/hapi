import { describe, expect, it } from 'vitest';
import { decideReadyAfterTurn } from './readyAfterTurn';

const DEFAULT_INPUT = {
    now: 1_000,
    shouldExit: false,
    readySentForTurn: false,
    queueSize: 0,
    turnInFlight: false,
    promptSettledAt: 800,
    lastSessionUpdateAt: 800,
    readyCheckIntervalMs: 120,
    activityQuietPeriodMs: 500,
    missingTurnCompleteGraceMs: 15_000
};

describe('decideReadyAfterTurn', () => {
    it('skips when queue is not empty', () => {
        const decision = decideReadyAfterTurn({
            ...DEFAULT_INPUT,
            queueSize: 1
        });

        expect(decision).toEqual({ type: 'skip' });
    });

    it('waits when prompt has not settled yet', () => {
        const decision = decideReadyAfterTurn({
            ...DEFAULT_INPUT,
            promptSettledAt: 0
        });

        expect(decision).toEqual({ type: 'wait', delayMs: 120 });
    });

    it('waits during grace period when turn_complete is missing, even if updates are silent', () => {
        const decision = decideReadyAfterTurn({
            ...DEFAULT_INPUT,
            turnInFlight: true,
            now: 2_000,
            promptSettledAt: 1_900,
            lastSessionUpdateAt: 600
        });

        expect(decision).toEqual({ type: 'wait', delayMs: 120 });
    });

    it('forces completion with warning when turn_complete is missing beyond grace period', () => {
        const decision = decideReadyAfterTurn({
            ...DEFAULT_INPUT,
            turnInFlight: true,
            now: 20_550,
            promptSettledAt: 1_000,
            lastSessionUpdateAt: 20_000
        });

        expect(decision).toEqual({
            type: 'ready',
            forceCompleteTurn: true,
            warnMissingTurnComplete: true
        });
    });

    it('keeps waiting until activity quiet period is reached', () => {
        const decision = decideReadyAfterTurn({
            ...DEFAULT_INPUT,
            now: 1_250,
            promptSettledAt: 900,
            lastSessionUpdateAt: 1_200
        });

        expect(decision).toEqual({ type: 'wait', delayMs: 450 });
    });

    it('emits ready when queue is empty and activity is quiet', () => {
        const decision = decideReadyAfterTurn({
            ...DEFAULT_INPUT,
            now: 2_000,
            promptSettledAt: 1_000,
            lastSessionUpdateAt: 1_000
        });

        expect(decision).toEqual({
            type: 'ready',
            forceCompleteTurn: false,
            warnMissingTurnComplete: false
        });
    });
});
