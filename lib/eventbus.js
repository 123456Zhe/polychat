function createEventBus() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    off(event, fn) {
      const list = listeners.get(event);
      if (!list) return;
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    emit(event, data) {
      for (const fn of (listeners.get(event) || [])) {
        try { fn(data); } catch (e) { console.error(`EventBus[${event}] error:`, e); }
      }
    }
  };
}

export const eventBus = createEventBus();
