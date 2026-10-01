import { reactive } from "vue";

export const messageState = reactive({
  messages: [],
});

export const message = {
  success(text) {
    return show(text, "success");
  },

  error(text) {
    return show(text, "error");
  },

  warning(text) {
    return show(text, "warning");
  },

  loading(text) {
    return show(text, "loading", 0);
  },

  dismiss(id) {
    const index = messageState.messages.findIndex(
      (item) => item.id === id,
    );

    if (index !== -1) {
      messageState.messages.splice(index, 1);
    }
  },

  withLoading(text, task) {
    return async function (...args) {
      let id = null;

      const timer = setTimeout(() => {
        id = message.loading(text);
      }, 200);

      try {
        return await task.apply(this, args);
      } finally {
        clearTimeout(timer);

        if (id !== null) {
          message.dismiss(id);
        }
      }
    };
  },
};

function show(text, type, duration = 3000) {
  const id = Date.now() + Math.random();

  messageState.messages.push({
    id,
    text,
    type,
  });

  if (duration > 0) {
    setTimeout(() => {
      message.dismiss(id);
    }, duration);
  }

  return id;
}