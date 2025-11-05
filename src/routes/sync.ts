import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db, syncLogs, vaultKeys, type NewSyncLog, type NewVaultKey } from '../db'
import { authMiddleware } from '../middleware/auth'
import { eq, and, gt, desc } from 'drizzle-orm'

const sync = new Hono()

// All sync routes require authentication
sync.use('/*', authMiddleware)

// Validation schemas
const vaultKeySchema = z.object({
  vaultId: z.string().uuid(),
  encryptedVaultKey: z.string(),
  salt: z.string(),
  nonce: z.string(),
})

const pushLogsSchema = z.object({
  vaultId: z.string().uuid(),
  logs: z.array(
    z.object({
      encryptedData: z.string(),
      nonce: z.string(),
      haexTimestamp: z.string(),
    })
  ),
})

const pullLogsSchema = z.object({
  vaultId: z.string().uuid(),
  afterSequence: z.number().int().optional(), // Pull logs after this sequence number
  limit: z.number().int().min(1).max(1000).default(100),
})

/**
 * POST /sync/vault-key
 * Store encrypted vault key for a user (Hybrid-Ansatz)
 */
sync.post('/vault-key', zValidator('json', vaultKeySchema), async (c) => {
  const user = c.get('user')
  const { vaultId, encryptedVaultKey, salt, nonce } = c.req.valid('json')

  try {
    // Check if vault key already exists
    const existing = await db.query.vaultKeys.findFirst({
      where: and(
        eq(vaultKeys.userId, user.userId),
        eq(vaultKeys.vaultId, vaultId)
      ),
    })

    if (existing) {
      return c.json({ error: 'Vault key already exists for this vault' }, 409)
    }

    // Insert vault key
    const [newVaultKey] = await db
      .insert(vaultKeys)
      .values({
        userId: user.userId,
        vaultId,
        encryptedVaultKey,
        salt,
        nonce,
      } as NewVaultKey)
      .returning()

    return c.json({
      message: 'Vault key stored successfully',
      vaultKey: {
        id: newVaultKey.id,
        vaultId: newVaultKey.vaultId,
        createdAt: newVaultKey.createdAt,
      },
    }, 201)
  } catch (error) {
    console.error('Store vault key error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

/**
 * GET /sync/vault-key/:vaultId
 * Retrieve encrypted vault key for a user
 */
sync.get('/vault-key/:vaultId', async (c) => {
  const user = c.get('user')
  const vaultId = c.req.param('vaultId')

  try {
    const vaultKey = await db.query.vaultKeys.findFirst({
      where: and(
        eq(vaultKeys.userId, user.userId),
        eq(vaultKeys.vaultId, vaultId)
      ),
    })

    if (!vaultKey) {
      return c.json({ error: 'Vault key not found' }, 404)
    }

    return c.json({
      vaultKey: {
        vaultId: vaultKey.vaultId,
        encryptedVaultKey: vaultKey.encryptedVaultKey,
        salt: vaultKey.salt,
        nonce: vaultKey.nonce,
        createdAt: vaultKey.createdAt,
      },
    })
  } catch (error) {
    console.error('Get vault key error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

/**
 * POST /sync/push
 * Push encrypted CRDT logs to server
 */
sync.post('/push', zValidator('json', pushLogsSchema), async (c) => {
  const user = c.get('user')
  const { vaultId, logs } = c.req.valid('json')

  try {
    // Get current max sequence for this user
    const maxSeqResult = await db.query.syncLogs.findFirst({
      where: eq(syncLogs.userId, user.userId),
      orderBy: desc(syncLogs.sequence),
    })

    let currentSequence = maxSeqResult?.sequence || 0

    // Insert logs with auto-incrementing sequence
    const insertedLogs = await db
      .insert(syncLogs)
      .values(
        logs.map((log) => ({
          userId: user.userId,
          vaultId,
          encryptedData: log.encryptedData,
          nonce: log.nonce,
          haexTimestamp: log.haexTimestamp,
          sequence: ++currentSequence,
        } as NewSyncLog))
      )
      .returning({
        id: syncLogs.id,
        sequence: syncLogs.sequence,
        haexTimestamp: syncLogs.haexTimestamp,
        createdAt: syncLogs.createdAt,
      })

    return c.json({
      message: 'Logs pushed successfully',
      count: insertedLogs.length,
      logs: insertedLogs,
    })
  } catch (error) {
    console.error('Push logs error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

/**
 * POST /sync/pull
 * Pull encrypted CRDT logs from server
 */
sync.post('/pull', zValidator('json', pullLogsSchema), async (c) => {
  const user = c.get('user')
  const { vaultId, afterSequence, limit } = c.req.valid('json')

  try {
    // Build query
    const whereConditions = [
      eq(syncLogs.userId, user.userId),
      eq(syncLogs.vaultId, vaultId),
    ]

    if (afterSequence !== undefined) {
      whereConditions.push(gt(syncLogs.sequence, afterSequence))
    }

    // Fetch limit + 1 to check if there are more records
    const logs = await db.query.syncLogs.findMany({
      where: and(...whereConditions),
      orderBy: syncLogs.sequence,
      limit: limit + 1,
    })

    // Check if there are more records
    const hasMore = logs.length > limit

    // Return only the requested limit
    const returnLogs = logs.slice(0, limit)

    return c.json({
      logs: returnLogs.map((log) => ({
        id: log.id,
        encryptedData: log.encryptedData,
        nonce: log.nonce,
        haexTimestamp: log.haexTimestamp,
        sequence: log.sequence,
        createdAt: log.createdAt,
      })),
      hasMore,
    })
  } catch (error) {
    console.error('Pull logs error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default sync
