import { defineStore } from 'pinia'

// Object-with-id syntax
export const useCart = defineStore({
  id: 'cart',
  state: () => ({ items: [] as string[] }),
  actions: {
    add(item: string) {
      this.items.push(item)
    },
  },
})
