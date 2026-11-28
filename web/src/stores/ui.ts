import { defineStore } from 'pinia'

let timer: ReturnType<typeof setTimeout> | undefined

export const useToast = defineStore('toast', {
  state: () => ({ text: '', err: false }),
  actions: {
    show(text: string, err = false) {
      this.text = text
      this.err = err
      clearTimeout(timer)
      timer = setTimeout(() => (this.text = ''), 3200)
    },
    ok(text: string) { this.show(text, false) },
    bad(text: string) { this.show(text, true) },
  },
})
