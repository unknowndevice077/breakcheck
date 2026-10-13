import { format, parse, addDays, differenceInDays, isValid, parseISO, formatDistance, startOfWeek } from 'date-fns'
import { enUS } from 'date-fns/locale'

export function label(d: Date): string {
  return format(d, 'yyyy-MM-dd', { locale: enUS })
}

export function fromInput(s: string): Date | null {
  const d = parse(s, 'dd/MM/yyyy', new Date())
  return isValid(d) ? d : null
}

export function nextWeek(d: Date | number): Date {
  return addDays(d, 7)
}

export function age(iso: string): number {
  return differenceInDays(new Date(), parseISO(iso))
}

export function ago(d: Date): string {
  return formatDistance(d, Date.now(), { addSuffix: true })
}

export function weekStart(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 })
}
