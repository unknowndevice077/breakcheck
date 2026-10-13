import { QueryClient, QueryObserver, MutationObserver, hashQueryKey } from '@tanstack/query-core'

export const client = new QueryClient({
  defaultOptions: { queries: { cacheTime: 5 * 60_000, staleTime: 1000, useErrorBoundary: false } },
})

export async function loadTodos() {
  return client.fetchQuery(['todos'], () => fetch('/api/todos').then((r) => r.json()))
}

export function prime(todos: unknown[]) {
  client.setQueryData(['todos'], todos)
  return client.getQueryData(['todos'])
}

export function invalidate() {
  return client.invalidateQueries(['todos'], { exact: true })
}

export function observe() {
  const observer = new QueryObserver(client, {
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then((r) => r.json()),
    keepPreviousData: true,
    onSuccess: (data: unknown) => console.log('loaded', data),
  })
  return observer.subscribe((result) => {
    if (result.isLoading) console.log('loading')
    if (result.status === 'loading') console.log('still loading')
  })
}

export function save() {
  const m = new MutationObserver(client, { mutationFn: (v: string) => Promise.resolve(v) })
  return m.mutate('x')
}

export const key = hashQueryKey(['todos'])

export function cancel() {
  return client.cancelQueries(['todos'])
}

export function remove() {
  client.removeQueries(['todos'], { exact: true })
}
