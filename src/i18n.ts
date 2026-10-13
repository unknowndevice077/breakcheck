import { createI18n } from 'vue-i18n'

export const i18n = createI18n({
  legacy: true,
  allowComposition: true,
  locale: 'en',
  messages: {
    en: { apple: 'no apples | one apple | {count} apples', hello: 'Hello' },
  },
})

export function apples(count: number): string {
  return i18n.global.tc('apple', count)
}
