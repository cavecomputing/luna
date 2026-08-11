import { describe, expect, it } from 'vitest'
import { plainRemoteUrl } from './providers.js'

describe('plainRemoteUrl', () => {
  it('flags plain HTTP hosts that are not loopback', () => {
    expect(plainRemoteUrl('http://llama.example.test:8080/v1')).toBe(true)
    expect(plainRemoteUrl('http://192.168.1.25:8080/v1')).toBe(true)
  })

  it('does not flag HTTPS or loopback servers', () => {
    expect(plainRemoteUrl('https://llama.example.test/v1')).toBe(false)
    expect(plainRemoteUrl('http://localhost:11434/v1')).toBe(false)
    expect(plainRemoteUrl('http://127.0.0.1:11434/v1')).toBe(false)
    expect(plainRemoteUrl('http://[::1]:11434/v1')).toBe(false)
  })

  it('does not treat an incomplete URL as a remote HTTP endpoint', () => {
    expect(plainRemoteUrl('llama-server')).toBe(false)
  })
})
