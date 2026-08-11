import * as appIpc from './app.js'
import * as attachmentsIpc from './attachments.js'
import * as chatIpc from './chat.js'
import * as chatsIpc from './chats.js'
import * as prefsIpc from './prefs.js'
import * as providersIpc from './providers.js'
import * as settingsIpc from './settings.js'
import * as messagesIpc from './messages.js'

/** Every IPC domain registers here. One line per new domain file. */
export function registerAll(): void {
  appIpc.register()
  attachmentsIpc.register()
  chatsIpc.setCancelConversation((id) => {
    chatIpc.coordinator.cancelConversation(id)
  })
  chatsIpc.register()
  chatIpc.register()
  prefsIpc.register()
  providersIpc.register()
  messagesIpc.register()
  settingsIpc.register()
}
