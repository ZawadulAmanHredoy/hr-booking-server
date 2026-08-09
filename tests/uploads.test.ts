import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

const app = createApp()

// 1x1 transparent PNG
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

describe('POST /api/v1/uploads/avatar', () => {
  it('accepts an image and returns a URL under /uploads', async () => {
    const res = await request(app)
      .post('/api/v1/uploads/avatar')
      .attach('image', tinyPng, { filename: 'avatar.png', contentType: 'image/png' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.url).toMatch(/^https?:\/\/.+\/uploads\/.+\.png$/)
  })

  it('rejects a non-image mimetype with 400', async () => {
    const res = await request(app)
      .post('/api/v1/uploads/avatar')
      .attach('image', Buffer.from('not an image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('rejects an oversized file with 400', async () => {
    const oversized = Buffer.alloc(6 * 1024 * 1024, 0)
    const res = await request(app)
      .post('/api/v1/uploads/avatar')
      .attach('image', oversized, { filename: 'huge.png', contentType: 'image/png' })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('rejects a request with no file attached', async () => {
    const res = await request(app).post('/api/v1/uploads/avatar')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BAD_REQUEST')
  })
})
