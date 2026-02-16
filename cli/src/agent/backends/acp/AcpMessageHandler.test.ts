import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@/agent/types';
import { AcpMessageHandler } from './AcpMessageHandler';
import { ACP_SESSION_UPDATE_TYPES } from './constants';

function getToolResult(messages: AgentMessage[], id: string): Extract<AgentMessage, { type: 'tool_result' }> {
    const result = messages.find((message): message is Extract<AgentMessage, { type: 'tool_result' }> =>
        message.type === 'tool_result' && message.id === id
    );
    if (!result) {
        throw new Error(`Missing tool_result for ${id}`);
    }
    return result;
}

describe('AcpMessageHandler', () => {
    it('does not synthesize {status} output when tool completes without payload', () => {
        const messages: AgentMessage[] = [];
        const handler = new AcpMessageHandler((message) => messages.push(message));

        handler.handleUpdate({
            sessionUpdate: ACP_SESSION_UPDATE_TYPES.toolCall,
            toolCallId: 'tool-1',
            title: 'Read',
            rawInput: { path: 'README.md' },
            status: 'in_progress'
        });

        handler.handleUpdate({
            sessionUpdate: ACP_SESSION_UPDATE_TYPES.toolCallUpdate,
            toolCallId: 'tool-1',
            status: 'completed'
        });

        const result = getToolResult(messages, 'tool-1');
        expect(result.status).toBe('completed');
        expect(result.output).toBeUndefined();
    });

    it('keeps raw output when provided by ACP update', () => {
        const messages: AgentMessage[] = [];
        const handler = new AcpMessageHandler((message) => messages.push(message));

        handler.handleUpdate({
            sessionUpdate: ACP_SESSION_UPDATE_TYPES.toolCall,
            toolCallId: 'tool-2',
            title: 'Bash',
            rawInput: { cmd: 'echo ok' },
            status: 'in_progress'
        });

        handler.handleUpdate({
            sessionUpdate: ACP_SESSION_UPDATE_TYPES.toolCallUpdate,
            toolCallId: 'tool-2',
            status: 'completed',
            rawOutput: { stdout: 'ok\n' }
        });

        const result = getToolResult(messages, 'tool-2');
        expect(result.status).toBe('completed');
        expect(result.output).toEqual({ stdout: 'ok\n' });
    });
});
