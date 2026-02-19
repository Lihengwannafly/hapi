import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createPermissionsRoutes } from './permissions'

function buildSession(overrides?: Partial<Session>): Session {
    return {
        id: 'session-1',
        namespace: 'ns-test',
        seq: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        metadata: null,
        metadataVersion: 0,
        agentState: {
            controlledByUser: false,
            requests: {
                'request-1': {
                    tool: 'Bash',
                    arguments: { command: 'pwd' },
                    createdAt: Date.now()
                }
            },
            completedRequests: {}
        },
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        permissionMode: 'default',
        todos: [],
        ...overrides
    }
}

function buildApp(engine: SyncEngine): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'ns-test')
        c.set('userId', 1)
        await next()
    })
    app.route('/', createPermissionsRoutes(() => engine))
    return app
}

describe('permissions routes', () => {
    it('approves permission when session is remote-controlled', async () => {
        let called = false
        const session = buildSession()

        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: session.id, session }),
            approvePermission: async () => {
                called = true
            }
        } as unknown as SyncEngine

        const app = buildApp(engine)
        const response = await app.request(`/sessions/${session.id}/permissions/request-1/approve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        expect(called).toBe(true)
        await expect(response.json()).resolves.toEqual({ ok: true })
    })

    it('returns 409 when permission is attempted in local mode', async () => {
        const session = buildSession({
            agentState: {
                controlledByUser: true,
                requests: {
                    'request-1': {
                        tool: 'Bash',
                        arguments: { command: 'pwd' },
                        createdAt: Date.now()
                    }
                },
                completedRequests: {}
            }
        })

        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: session.id, session }),
            approvePermission: async () => {
                throw new Error('Session is in local mode. Handle permissions in the local terminal.')
            }
        } as unknown as SyncEngine

        const app = buildApp(engine)
        const response = await app.request(`/sessions/${session.id}/permissions/request-1/approve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(409)
        await expect(response.json()).resolves.toEqual({
            error: 'Session is in local mode. Handle permissions in the local terminal.'
        })
    })

    it('returns 404 for unknown permission request ids', async () => {
        const session = buildSession({
            agentState: {
                controlledByUser: false,
                requests: {},
                completedRequests: {}
            }
        })

        const engine = {
            resolveSessionAccess: () => ({ ok: true as const, sessionId: session.id, session }),
            denyPermission: async () => {
                throw new Error('should not be called')
            }
        } as unknown as SyncEngine

        const app = buildApp(engine)
        const response = await app.request(`/sessions/${session.id}/permissions/request-404/deny`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(404)
        await expect(response.json()).resolves.toEqual({ error: 'Request not found' })
    })
})
