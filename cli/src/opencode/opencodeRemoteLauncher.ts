import React from 'react';
import { logger } from '@/ui/logger';
import { buildHapiMcpBridge } from '@/codex/utils/buildHapiMcpBridge';
import { convertAgentMessage } from '@/agent/messageConverter';
import type { AgentMessage, McpServerStdio, PromptContent } from '@/agent/types';
import { RemoteLauncherBase, type RemoteLauncherDisplayContext, type RemoteLauncherExitReason } from '@/modules/common/remote/RemoteLauncherBase';
import { OpencodeDisplay } from '@/ui/ink/OpencodeDisplay';
import type { OpencodeSession } from './session';
import type { PermissionMode } from './types';
import { createOpencodeBackend } from './utils/opencodeBackend';
import { OpencodePermissionHandler } from './utils/permissionHandler';
import { decideReadyAfterTurn } from './utils/readyAfterTurn';
import { TITLE_INSTRUCTION } from './utils/systemPrompt';

class OpencodeRemoteLauncher extends RemoteLauncherBase {
    private readonly session: OpencodeSession;
    private backend: ReturnType<typeof createOpencodeBackend> | null = null;
    private permissionHandler: OpencodePermissionHandler | null = null;
    private happyServer: { stop: () => void } | null = null;
    private abortController = new AbortController();
    private displayPermissionMode: PermissionMode | null = null;
    private instructionsSent = false;

    constructor(session: OpencodeSession) {
        super(process.env.DEBUG ? session.logPath : undefined);
        this.session = session;
    }

    public async launch(): Promise<RemoteLauncherExitReason> {
        return this.start({
            onExit: () => this.handleExitFromUi(),
            onSwitchToLocal: () => this.handleSwitchFromUi()
        });
    }

    protected createDisplay(context: RemoteLauncherDisplayContext): React.ReactElement {
        return React.createElement(OpencodeDisplay, context);
    }

    protected async runMainLoop(): Promise<void> {
        const session = this.session;
        const messageBuffer = this.messageBuffer;

        const { server: happyServer, mcpServers } = await buildHapiMcpBridge(session.client);
        this.happyServer = happyServer;

        const backend = createOpencodeBackend({
            cwd: session.path
        });
        this.backend = backend;

        backend.onStderrError((error) => {
            logger.debug('[opencode-remote] stderr error', error);
            session.sendSessionEvent({ type: 'message', message: error.message });
            messageBuffer.addMessage(error.message, 'status');
        });

        await backend.initialize();

        const resumeSessionId = session.sessionId;
        const mcpServerList = toAcpMcpServers(mcpServers);
        let acpSessionId: string;
        if (resumeSessionId) {
            try {
                acpSessionId = await backend.loadSession({
                    sessionId: resumeSessionId,
                    cwd: session.path,
                    mcpServers: mcpServerList
                });
            } catch (error) {
                logger.warn('[opencode-remote] resume failed, starting new session', error);
                session.sendSessionEvent({
                    type: 'message',
                    message: 'OpenCode resume failed; starting a new session.'
                });
                acpSessionId = await backend.newSession({
                    cwd: session.path,
                    mcpServers: mcpServerList
                });
            }
        } else {
            acpSessionId = await backend.newSession({
                cwd: session.path,
                mcpServers: mcpServerList
            });
        }
        session.onSessionFound(acpSessionId);

        this.permissionHandler = new OpencodePermissionHandler(
            session.client,
            backend,
            () => session.getPermissionMode() as PermissionMode | undefined
        );
        this.applyDisplayMode(session.getPermissionMode() as PermissionMode);

        this.setupAbortHandlers(session.client.rpcHandlerManager, {
            onAbort: () => this.handleAbort(),
            onSwitch: () => this.handleSwitchRequest()
        });

        const sendReady = () => {
            session.sendSessionEvent({ type: 'ready' });
        };
        const READY_CHECK_INTERVAL_MS = 120;
        const ACTIVITY_QUIET_PERIOD_MS = 500;
        const parsedMissingTurnCompleteGraceMs = Number.parseInt(
            process.env.HAPI_OPENCODE_MISSING_TURN_COMPLETE_GRACE_MS ?? '',
            10
        );
        const MISSING_TURN_COMPLETE_GRACE_MS =
            Number.isFinite(parsedMissingTurnCompleteGraceMs) && parsedMissingTurnCompleteGraceMs > 0
                ? parsedMissingTurnCompleteGraceMs
                : 60 * 1000;
        let turnInFlight = false;
        let promptSettledAt = 0;
        let readySentForTurn = false;
        let readyAfterTurnTimer: ReturnType<typeof setTimeout> | null = null;
        const clearReadyAfterTurnTimer = () => {
            if (!readyAfterTurnTimer) {
                return;
            }
            clearTimeout(readyAfterTurnTimer);
            readyAfterTurnTimer = null;
        };
        const tryEmitReadyAfterTurn = () => {
            const decision = decideReadyAfterTurn({
                now: Date.now(),
                shouldExit: this.shouldExit,
                readySentForTurn,
                queueSize: session.queue.size(),
                turnInFlight,
                promptSettledAt,
                lastSessionUpdateAt: backend.getLastSessionUpdateAt(),
                readyCheckIntervalMs: READY_CHECK_INTERVAL_MS,
                activityQuietPeriodMs: ACTIVITY_QUIET_PERIOD_MS,
                missingTurnCompleteGraceMs: MISSING_TURN_COMPLETE_GRACE_MS
            });

            if (decision.type === 'skip') {
                return;
            }

            if (decision.type === 'wait') {
                scheduleReadyAfterTurn(decision.delayMs);
                return;
            }

            if (decision.warnMissingTurnComplete) {
                logger.warn('[opencode-remote] turn_complete missing after prompt settled; forcing ready state');
            }
            if (decision.forceCompleteTurn) {
                turnInFlight = false;
            }

            readySentForTurn = true;
            if (session.thinking) {
                session.onThinkingChange(false);
            }
            sendReady();
        };
        const scheduleReadyAfterTurn = (delayMs = READY_CHECK_INTERVAL_MS) => {
            clearReadyAfterTurnTimer();
            readyAfterTurnTimer = setTimeout(() => {
                readyAfterTurnTimer = null;
                tryEmitReadyAfterTurn();
            }, Math.max(1, delayMs));
            readyAfterTurnTimer.unref?.();
        };

        while (!this.shouldExit) {
            const waitSignal = this.abortController.signal;
            const batch = await session.queue.waitForMessagesAndGetAsString(waitSignal);
            if (!batch) {
                if (waitSignal.aborted && !this.shouldExit) {
                    continue;
                }
                break;
            }

            clearReadyAfterTurnTimer();
            this.applyDisplayMode(batch.mode.permissionMode);
            messageBuffer.addMessage(batch.message, 'user');
            readySentForTurn = false;
            promptSettledAt = 0;

            // Inject title instructions on first prompt
            let messageText = batch.message;
            if (!this.instructionsSent) {
                messageText = `${TITLE_INSTRUCTION}\n\n${batch.message}`;
                this.instructionsSent = true;
            }

            const promptContent: PromptContent[] = [{
                type: 'text',
                text: messageText
            }];

            session.onThinkingChange(true);
            turnInFlight = true;

            try {
                await backend.prompt(acpSessionId, promptContent, (message: AgentMessage) => {
                    this.handleAgentMessage(message);
                    if (message.type !== 'turn_complete' && readySentForTurn) {
                        readySentForTurn = false;
                        if (!session.thinking && !this.shouldExit) {
                            session.onThinkingChange(true);
                        }
                    }
                    if (message.type === 'turn_complete') {
                        turnInFlight = false;
                        scheduleReadyAfterTurn();
                        return;
                    }
                    if (readyAfterTurnTimer) {
                        scheduleReadyAfterTurn();
                        return;
                    }
                    if (promptSettledAt && !this.shouldExit && session.queue.size() === 0) {
                        scheduleReadyAfterTurn();
                    }
                });
            } catch (error) {
                logger.warn('[opencode-remote] prompt failed', error);
                turnInFlight = false;
                promptSettledAt = Date.now();
                session.sendSessionEvent({
                    type: 'message',
                    message: 'OpenCode prompt failed. Check logs for details.'
                });
                messageBuffer.addMessage('OpenCode prompt failed', 'status');
            } finally {
                if (!promptSettledAt) {
                    promptSettledAt = Date.now();
                }
                await this.permissionHandler?.cancelAll('Prompt finished');
                if (session.queue.size() === 0 && !this.shouldExit) {
                    scheduleReadyAfterTurn();
                } else {
                    clearReadyAfterTurnTimer();
                }
            }
        }
        clearReadyAfterTurnTimer();
        session.onThinkingChange(false);
    }

    protected async cleanup(): Promise<void> {
        this.clearAbortHandlers(this.session.client.rpcHandlerManager);

        if (this.permissionHandler) {
            await this.permissionHandler.cancelAll('Session ended');
            this.permissionHandler = null;
        }

        if (this.backend) {
            await this.backend.disconnect();
            this.backend = null;
        }

        if (this.happyServer) {
            this.happyServer.stop();
            this.happyServer = null;
        }
    }

    private handleAgentMessage(message: AgentMessage): void {
        const converted = convertAgentMessage(message);
        if (converted) {
            this.session.sendCodexMessage(converted);
        }

        switch (message.type) {
            case 'text':
                this.messageBuffer.addMessage(message.text, 'assistant');
                break;
            case 'tool_call':
                this.messageBuffer.addMessage(`Tool call: ${message.name}`, 'tool');
                break;
            case 'tool_result':
                this.messageBuffer.addMessage('Tool result received', 'result');
                break;
            case 'plan':
                this.messageBuffer.addMessage('Plan updated', 'status');
                break;
            case 'error':
                this.messageBuffer.addMessage(message.message, 'status');
                break;
            case 'turn_complete':
                this.messageBuffer.addMessage('Turn complete', 'status');
                break;
            default: {
                const _exhaustive: never = message;
                return _exhaustive;
            }
        }
    }

    private applyDisplayMode(permissionMode: PermissionMode | undefined): void {
        if (permissionMode && permissionMode !== this.displayPermissionMode) {
            this.displayPermissionMode = permissionMode;
            this.messageBuffer.addMessage(`[MODE:${permissionMode}]`, 'system');
        }
    }

    private async handleAbort(): Promise<void> {
        const backend = this.backend;
        if (backend && this.session.sessionId) {
            await backend.cancelPrompt(this.session.sessionId);
        }
        await this.permissionHandler?.cancelAll('User aborted');
        this.session.queue.reset();
        this.session.onThinkingChange(false);
        this.abortController.abort();
        this.abortController = new AbortController();
        this.messageBuffer.addMessage('Turn aborted', 'status');
    }

    private async handleExitFromUi(): Promise<void> {
        await this.requestExit('exit', () => this.handleAbort());
    }

    private async handleSwitchFromUi(): Promise<void> {
        await this.requestExit('switch', () => this.handleAbort());
    }

    private async handleSwitchRequest(): Promise<void> {
        await this.requestExit('switch', () => this.handleAbort());
    }
}

function toAcpMcpServers(config: Record<string, { command: string; args: string[] }>): McpServerStdio[] {
    return Object.entries(config).map(([name, entry]) => ({
        name,
        command: entry.command,
        args: entry.args,
        env: []
    }));
}

export async function opencodeRemoteLauncher(
    session: OpencodeSession
): Promise<'switch' | 'exit'> {
    const launcher = new OpencodeRemoteLauncher(session);
    return launcher.launch();
}
