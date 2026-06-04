import { reactive } from 'vue'

export const messageState = reactive({
  messages: [],
})

let timer = null

export const message = {
  success(text) {
    show(text)
  },

  error(text) {
    show(text)
  },

  warning(text) {
    show(text)
  },
}

function show(text, type = 'success') {
  const id = Date.now() + Math.random()

  messageState.messages.push({
    id,
    text,
    type,
  })

  setTimeout(() => {
    const index = messageState.messages.findIndex(
      m => m.id === id
    )

    if (index !== -1) {
      messageState.messages.splice(index, 1)
    }
  }, 3000)
}