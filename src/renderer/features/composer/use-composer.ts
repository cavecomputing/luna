import { useState, type KeyboardEvent } from 'react'

/**
 * Draft state and the Enter/Shift+Enter contract.
 * Enter sends, Shift+Enter puts in a newline — the convention every chat
 * client uses, so getting it wrong is immediately felt.
 */
export function useComposer(onSend: (text: string) => boolean | Promise<boolean>) {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canSend = draft.trim() !== ''

  async function submit(): Promise<void> {
    if (!canSend || submitting) return
    setSubmitting(true)
    const sent = await onSend(draft.trim())
    if (sent) setDraft('')
    setSubmitting(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey) return
    // Also let IME composition finish before treating Enter as send.
    if (e.nativeEvent.isComposing) return
    e.preventDefault()
    void submit()
  }

  return { draft, setDraft, canSend: canSend && !submitting, submitting, submit, onKeyDown }
}
