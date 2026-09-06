/**
 * Adding an MCP server the way a person does, in the packaged app.
 *
 * Everything below this in the test pyramid can be lied to. `sourcesFor` can be
 * handed a fake transport, the registry can be handed a fake source, and the
 * Servers panel can be handed a fake bridge — each of those tests proves one
 * seam and assumes the others. This file assumes nothing: it is the real
 * binary, the real database in a throwaway directory, the real IPC boundary,
 * and a real subprocess on the far end of a real pipe.
 *
 * The one thing it cannot do for itself is click the consent dialog, which the
 * operating system draws. See `answerDialogs`.
 */

import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { answerDialogs, dialogCount, launch, openSettings, showSection, type Luna } from './luna.js'

const serverScript = fileURLToPath(new URL('fixtures/server.mjs', import.meta.url))

let luna: Luna

test.beforeEach(async () => {
  luna = await launch()
})

test.afterEach(async () => {
  await luna.close()
})

/**
 * Fills the Servers form. The command is the Node that is running this test.
 *
 * Anchored regexes rather than exact names: each field's hint sits inside its
 * `<label>`, so the accessible name is the label followed by the hint. Matching
 * on the start keeps these stable when the hint copy changes.
 */
async function fillServer(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add server' }).click()
  await page.getByRole('textbox', { name: /^Name/ }).fill(name)
  await page.getByRole('textbox', { name: /^Command/ }).fill(process.execPath)
  await page.getByRole('textbox', { name: /^Arguments/ }).fill(serverScript)
}

test('adds a server, runs it, and shows the tools it offers', async () => {
  const settings = await openSettings(luna)
  await showSection(settings, 'Servers')

  await expect(settings.getByText('No servers configured')).toBeVisible()

  await fillServer(settings, 'Fixture')
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings.getByText('Saved.')).toBeVisible()

  // Created switched off. Writing a row commits Luna to running nothing.
  await expect(settings.getByText('Off', { exact: true })).toBeVisible()
  expect(await dialogCount(luna.app)).toBe(0)

  await answerDialogs(luna.app, 1)
  await settings.getByRole('switch', { name: 'Run Fixture' }).click()

  await expect(settings.getByText('Running · 2 tools')).toBeVisible({ timeout: 30_000 })
  // Starting the program is what the person was asked about, exactly once.
  expect(await dialogCount(luna.app)).toBe(1)

  await showSection(settings, 'Tools')
  await expect(settings.getByText('Reverse text')).toBeVisible()
  await expect(settings.getByText('Fixture · reverse_text')).toBeVisible()
})

test('leaves the server off when the consent prompt is declined', async () => {
  const settings = await openSettings(luna)
  await showSection(settings, 'Servers')

  await fillServer(settings, 'Fixture')
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings.getByText('Saved.')).toBeVisible()

  // 0 is Cancel. Deny-by-default makes it both the default and the escape.
  await answerDialogs(luna.app, 0)
  await settings.getByRole('switch', { name: 'Run Fixture' }).click()

  await expect(settings.getByText('Cancelled. The server was not started.')).toBeVisible()
  await expect(settings.getByText('Off', { exact: true })).toBeVisible()
  expect(await dialogCount(luna.app)).toBe(1)
})

/**
 * A tool a server offers is not a tool the model may call. The panel has to
 * show it switched off, having been discovered rather than approved.
 */
test('discovers a server tool switched off', async () => {
  const settings = await openSettings(luna)
  await showSection(settings, 'Servers')

  await fillServer(settings, 'Fixture')
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await answerDialogs(luna.app, 1)
  await settings.getByRole('switch', { name: 'Run Fixture' }).click()
  await expect(settings.getByText('Running · 2 tools')).toBeVisible({ timeout: 30_000 })

  await showSection(settings, 'Tools')
  const tool = settings.locator('li', { hasText: 'Fixture · reverse_text' })
  await expect(tool.getByText('New — not enabled')).toBeVisible()
  await expect(tool.getByRole('checkbox', { name: 'Off' })).not.toBeChecked()
})

/**
 * The renderer sends a value once and never gets one back. What it can see
 * afterwards is that something is stored, which is the same deal a provider key
 * gets.
 */
test('stores a variable without ever showing it again', async () => {
  const settings = await openSettings(luna)
  await showSection(settings, 'Servers')

  await fillServer(settings, 'Fixture')
  await settings.getByRole('textbox', { name: /^Environment variables/ }).fill('E2E_TOKEN')
  await settings.getByLabel('E2E_TOKEN', { exact: true }).fill('test-value-not-real')
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings.getByText('Saved.')).toBeVisible()

  // The box is a password field and comes back empty, not repopulated.
  const box = settings.getByLabel('E2E_TOKEN', { exact: true })
  await expect(box).toHaveAttribute('type', 'password')
  await expect(box).toHaveValue('')
  await expect(box).toHaveAttribute('placeholder', /Stored securely/)

  // And nothing in the window's own state is holding it either.
  const leaked = await settings.evaluate(() => document.body.innerHTML.includes('test-value-not-real'))
  expect(leaked).toBe(false)
})

test('removes a server and everything stored for it', async () => {
  const settings = await openSettings(luna)
  await showSection(settings, 'Servers')

  await fillServer(settings, 'Fixture')
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings.getByText('Saved.')).toBeVisible()

  settings.on('dialog', (confirmation) => {
    void confirmation.accept()
  })
  await settings.getByRole('button', { name: 'Delete' }).click()

  await expect(settings.getByText('No servers configured')).toBeVisible()
})

/**
 * A server whose command is not a program must fail as a server, not as the
 * app. The panel explains it in words; the code stays in the payload.
 */
test('reports a command that cannot be started', async () => {
  const settings = await openSettings(luna)
  await showSection(settings, 'Servers')

  await settings.getByRole('button', { name: 'Add server' }).click()
  await settings.getByRole('textbox', { name: /^Name/ }).fill('Broken')
  await settings.getByRole('textbox', { name: /^Command/ }).fill('/nonexistent/luna-e2e-server')
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings.getByText('Saved.')).toBeVisible()

  await answerDialogs(luna.app, 1)
  await settings.getByRole('switch', { name: 'Run Broken' }).click()

  // Twice on purpose: on the row, because that is where the server's state
  // lives, and under the form, because that is where the person was looking
  // when they flipped the switch.
  await expect(settings.getByRole('status')).toHaveText(/could not be started/, {
    timeout: 30_000,
  })
  await expect(settings.getByText(/^Failed — /)).toBeVisible()

  // And it is words, not a code.
  await expect(settings.getByText('rpc/spawn')).toHaveCount(0)
})
