import { describe, expect, it } from 'vitest'
import { normalizeAgentRecord } from './normalizeAgent'
import { reduceChatBlocks } from './reducer'
import type { ChatBlock, NormalizedMessage, ToolCallBlock } from './types'

function getFirstToolBlock(blocks: ChatBlock[]): ToolCallBlock {
    const block = blocks.find((entry): entry is ToolCallBlock => entry.kind === 'tool-call')
    if (!block) {
        throw new Error('expected at least one tool block')
    }
    return block
}

describe('tool status reconciliation', () => {
    it('preserves tool-call status from codex content', () => {
        const normalized = normalizeAgentRecord(
            'msg-1',
            null,
            1000,
            {
                type: 'codex',
                data: {
                    type: 'tool-call',
                    callId: 'call-1',
                    name: 'Bash',
                    input: { cmd: 'echo ok' },
                    status: 'completed'
                }
            }
        )

        expect(normalized?.role).toBe('agent')
        const content = normalized && normalized.role === 'agent' ? normalized.content[0] : null
        expect(content && content.type === 'tool-call' ? content.status : null).toBe('completed')
    })

    it('preserves tool result error flag from codex content', () => {
        const normalized = normalizeAgentRecord(
            'msg-2',
            null,
            1000,
            {
                type: 'codex',
                data: {
                    type: 'tool-call-result',
                    callId: 'call-2',
                    output: { message: 'failed' },
                    is_error: true
                }
            }
        )

        expect(normalized?.role).toBe('agent')
        const content = normalized && normalized.role === 'agent' ? normalized.content[0] : null
        expect(content && content.type === 'tool-result' ? content.is_error : null).toBe(true)
    })

    it('marks tool as completed even when only terminal tool-call status is available', () => {
        const messages: NormalizedMessage[] = [{
            id: 'm1',
            localId: null,
            createdAt: 1000,
            role: 'agent',
            isSidechain: false,
            content: [{
                type: 'tool-call',
                id: 'call-3',
                name: 'Edit',
                input: { path: 'a.ts' },
                description: null,
                status: 'completed',
                uuid: 'm1',
                parentUUID: null
            }]
        }]

        const reduced = reduceChatBlocks(messages, null)
        const tool = getFirstToolBlock(reduced.blocks)

        expect(tool.tool.state).toBe('completed')
        expect(tool.tool.result).toBeUndefined()
    })

    it('marks tool as error when terminal status is failed', () => {
        const messages: NormalizedMessage[] = [{
            id: 'm2',
            localId: null,
            createdAt: 1000,
            role: 'agent',
            isSidechain: false,
            content: [{
                type: 'tool-call',
                id: 'call-4',
                name: 'Read',
                input: { path: 'b.ts' },
                description: null,
                status: 'failed',
                uuid: 'm2',
                parentUUID: null
            }]
        }]

        const reduced = reduceChatBlocks(messages, null)
        const tool = getFirstToolBlock(reduced.blocks)

        expect(tool.tool.state).toBe('error')
        expect(tool.tool.result).toBeUndefined()
    })

    it('keeps concrete tool name when tool result arrives without permission entry', () => {
        const messages: NormalizedMessage[] = [
            {
                id: 'm3',
                localId: null,
                createdAt: 1000,
                role: 'agent',
                isSidechain: false,
                content: [{
                    type: 'tool-call',
                    id: 'call-5',
                    name: 'Read',
                    input: { path: 'README.md' },
                    description: null,
                    status: 'in_progress',
                    uuid: 'm3',
                    parentUUID: null
                }]
            },
            {
                id: 'm4',
                localId: null,
                createdAt: 1001,
                role: 'agent',
                isSidechain: false,
                content: [{
                    type: 'tool-result',
                    tool_use_id: 'call-5',
                    content: { ok: true },
                    is_error: false,
                    uuid: 'm4',
                    parentUUID: null
                }]
            }
        ]

        const reduced = reduceChatBlocks(messages, null)
        const tool = getFirstToolBlock(reduced.blocks)

        expect(tool.tool.name).toBe('Read')
        expect(tool.tool.state).toBe('completed')
    })
})
