const { describe, expect, beforeAll, it } = require('@jest/globals')
const { serializeHTTP, parseHTTP } = require('./tool')

describe('tool', () => {
  /** @type {Buffer} */
  let DATA
  /** @type {Buffer} */
  let BODY
  /** @type {string} */
  let Json
  /** @type {import('./tool').HttpRequestOptions} */
  let OPTIONS

  beforeAll(() => {
    Json = '{ "hello": "world!" }'
    BODY = Buffer.from(Json, 'utf-8')
    OPTIONS = {
      method: 'POST',
      url: '/hello.json',
      version: 'HTTP/1.0',
      headers: {
        'keep-alive': 'timeout=5, max=1000',
        'content-type': 'application/json',
        'content-length': `${BODY.length}`,
      },
      body: BODY,
    }
    DATA = serializeHTTP(OPTIONS)
  })
  it('parseHTTP', () => {
    const res = parseHTTP(DATA)
    expect(res.method).toEqual(OPTIONS.method)
    expect(res.url).toEqual(OPTIONS.url)
    expect(res.version).toEqual(OPTIONS.version)
    Object.keys(OPTIONS.headers).forEach((key) => {
      expect(res.headers).toHaveProperty(key.toLowerCase())
      expect(res.headers[key.toLowerCase()]).toEqual(OPTIONS.headers[key])
    })
    expect(Buffer.compare(res.body, BODY)).toEqual(0)
  })
  describe('serializeHTTP', () => {
    it('with body', () => {
      const options = { ...OPTIONS }
      const data = serializeHTTP(options)
      const res = parseHTTP(data)
      expect(res.method).toEqual(options.method)
      expect(res.url).toEqual(options.url)
      expect(res.version).toEqual(options.version)
      Object.keys(options.headers).forEach((key) => {
        expect(res.headers).toHaveProperty(key.toLowerCase())
        expect(res.headers[key.toLowerCase()]).toEqual(options.headers[key])
      })
      expect(Buffer.compare(res.body, options.body)).toEqual(0)
    })
    it('empty body', () => {
      const options = { ...OPTIONS, body: undefined }
      const data = serializeHTTP(options)
      const res = parseHTTP(data)
      expect(res.method).toEqual(options.method)
      expect(res.url).toEqual(options.url)
      expect(res.version).toEqual(options.version)
      Object.keys(options.headers).forEach((key) => {
        expect(res.headers).toHaveProperty(key.toLowerCase())
        expect(res.headers[key.toLowerCase()]).toEqual(options.headers[key])
      })
      expect(Buffer.compare(res.body, Buffer.from([]))).toEqual(0)
    })
  })
})