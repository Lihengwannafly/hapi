import { describe, expect, it } from 'vitest'
import { isChangeTitleToolName } from './reducerTools'

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
