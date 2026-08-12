// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HtmlPreviewRef } from '../../../shared/ipc.js'
import { HtmlPreview } from './html-preview.js'

const preview: HtmlPreviewRef = {
  id: '12345678-1234-4123-8123-123456789abc',
  url: 'app://preview/12345678-1234-4123-8123-123456789abc',
}

const create = vi.fn()
const release = vi.fn()

afterEach(cleanup)

beforeEach(() => {
  create.mockReset()
  release.mockReset()
  create.mockResolvedValue({ ok: true, value: preview })
  release.mockResolvedValue({ ok: true, value: undefined })
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: { preview: { create, release } },
  })
})

describe('HtmlPreview', () => {
  it('renders through an isolated URL only after an explicit toggle', async () => {
    render(<HtmlPreview code="<style>h1 { color: red }</style><h1>Hello</h1>" />)

    expect(screen.queryByTitle('Rendered HTML preview')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Render' }))

    const frame = await screen.findByTitle('Rendered HTML preview')
    expect(create).toHaveBeenCalledWith('<style>h1 { color: red }</style><h1>Hello</h1>')
    expect(frame.getAttribute('sandbox')).toBe('allow-popups')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('src')).toBe(preview.url)
    expect(frame.hasAttribute('srcdoc')).toBe(false)
  })

  it('keeps source visible when preview creation fails', async () => {
    create.mockResolvedValueOnce({
      ok: false,
      code: 'preview/limit',
      message: 'too many HTML previews are active',
    })
    render(<HtmlPreview code="<p>Hello</p>" />)

    fireEvent.click(screen.getByRole('button', { name: 'Render' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Preview unavailable')
    expect(screen.getByText('<p>Hello</p>')).toBeTruthy()
    expect(screen.queryByTitle('Rendered HTML preview')).toBeNull()
  })

  it('disables rendering until displayed output is stable', () => {
    render(<HtmlPreview code="<p>Partial" canRender={false} />)

    const button = screen.getByRole('button', { name: 'Render' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(create).not.toHaveBeenCalled()
  })

  it('releases the capability when returning to source and on unmount', async () => {
    const first = render(<HtmlPreview code="<p>Hello</p>" />)
    fireEvent.click(screen.getByRole('button', { name: 'Render' }))
    await screen.findByTitle('Rendered HTML preview')

    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    await waitFor(() => {
      expect(release).toHaveBeenCalledWith(preview.id)
    })
    first.unmount()
    expect(release).toHaveBeenCalledTimes(1)

    release.mockClear()
    const second = render(<HtmlPreview code="<p>Again</p>" />)
    fireEvent.click(screen.getByRole('button', { name: 'Render' }))
    await screen.findByTitle('Rendered HTML preview')
    second.unmount()
    expect(release).toHaveBeenCalledWith(preview.id)
  })

  it('releases a stale asynchronous result after source is selected', async () => {
    let finish: ((result: { ok: true; value: HtmlPreviewRef }) => void) | undefined
    create.mockImplementationOnce(
      () => new Promise((resolve) => {
        finish = resolve
      }),
    )
    render(<HtmlPreview code="<p>Hello</p>" />)

    fireEvent.click(screen.getByRole('button', { name: 'Render' }))
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    finish?.({ ok: true, value: preview })

    await waitFor(() => {
      expect(release).toHaveBeenCalledWith(preview.id)
    })
    expect(screen.queryByTitle('Rendered HTML preview')).toBeNull()
  })
})
