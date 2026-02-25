import { describe, expect, it } from 'vitest'
import { ensureToolBlock, isChangeTitleToolName } from './reducerTools'
import type { ChatBlock, ToolCallBlock } from './types'

describe('isChangeTitleToolName', () => {
    it('recognizes change-title tool aliases across agents', () => {
        expect(isChangeTitleToolName('mcp__hapi__change_title')).toBe(true)
        expect(isChangeTitleToolName('hapi__change_title')).toBe(true)
        expect(isChangeTitleToolName('functions.hapi__change_title')).toBe(true)
        expect(isChangeTitleToolName('hapi_change_title')).toBe(true)
        expect(isChangeTitleToolName('change_title')).toBe(true)
        expect(isChangeTitleToolName('Change Chat Title')).toBe(true)
    })

    it('rejects unrelated tool names', () => {
        expect(isChangeTitleToolName('hapi__save_memory')).toBe(false)
        expect(isChangeTitleToolName('mcp__hapi__list_sessions')).toBe(false)
        expect(isChangeTitleToolName('tool')).toBe(false)
    })
})

describe('ensureToolBlock tool name precedence', () => {
    it('keeps concrete tool names when later updates provide generic placeholders', () => {
        const blocks: ChatBlock[] = []
        const toolBlocksById = new Map<string, ToolCallBlock>()

        ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
            createdAt: 1,
            localId: null,
            name: 'hapi_change_title',
            input: { title: 'A' },
            description: null
        })

        const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
            createdAt: 2,
            localId: null,
            name: 'other',
            input: { title: 'B' },
            description: null
        })

        expect(updated.tool.name).toBe('hapi_change_title')
    })

    it('allows generic labels to replace placeholder names', () => {
        const blocks: ChatBlock[] = []
        const toolBlocksById = new Map<string, ToolCallBlock>()

        ensureToolBlock(blocks, toolBlocksById, 'tool-2', {
            createdAt: 1,
            localId: null,
            name: 'Tool',
            input: {},
            description: null
        })

        const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-2', {
            createdAt: 2,
            localId: null,
            name: 'search',
            input: {},
            description: null
        })

        expect(updated.tool.name).toBe('search')
    })

    it('does not replace concrete read tool name with Tool fallback', () => {
        const blocks: ChatBlock[] = []
        const toolBlocksById = new Map<string, ToolCallBlock>()

        ensureToolBlock(blocks, toolBlocksById, 'tool-3', {
            createdAt: 1,
            localId: null,
            name: 'Read',
            input: { path: 'README.md' },
            description: null
        })

        const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-3', {
            createdAt: 2,
            localId: null,
            name: 'Tool',
            input: null,
            description: null
        })

        expect(updated.tool.name).toBe('Read')
    })
})
