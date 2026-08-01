import { useState, type KeyboardEvent } from 'react'

/**
 * Draft state and the Enter/Shift+Enter contract.
 * Enter sends, Shift+Enter puts in a newline — the convention every chat
 * client uses, so getting it wrong is immediately felt.
 */
export function useComposer(onSend: (text: string) => void) {
  const [draft, setDraft] = useState('')
  const canSend = draft.trim() !== ''

  function submit(): void {
    if (!canSend) return
    onSend(draft.trim())
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey) return
    // Also let IME composition finish before treating Enter as send.
    if (e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }

  return { draft, setDraft, canSend, submit, onKeyDown }
}
