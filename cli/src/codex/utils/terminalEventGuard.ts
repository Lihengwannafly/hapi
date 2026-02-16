export type TerminalEventGuardInput = {
    useAppServer: boolean;
    eventTurnId: string | null;
    currentTurnId: string | null;
    turnInFlight: boolean;
};

export function shouldIgnoreTerminalEvent(input: TerminalEventGuardInput): boolean {
    if (!input.useAppServer) {
        return false;
    }

    if (input.eventTurnId) {
        return Boolean(input.currentTurnId && input.eventTurnId !== input.currentTurnId);
    }

    if (input.currentTurnId) {
        return true;
    }

    if (input.turnInFlight) {
        return true;
    }

    return false;
}
