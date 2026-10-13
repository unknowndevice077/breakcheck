import * as RQ from '@tanstack/react-query';
import { useQuery as useQ, QueryClient } from '@tanstack/react-query';

export const client = new QueryClient({
  defaultOptions: { queries: { cacheTime: 60_000, useErrorBoundary: true } },
});

export function useTodos() {
  return useQ(['todos'], () => fetch('/api/todos').then((r) => r.json()), { keepPreviousData: true });
}

export function useUser(id: string) {
  const q = RQ.useQuery({ queryKey: ['user', id], queryFn: () => fetch(`/api/users/${id}`).then((r) => r.json()) });
  return q.isLoading ? null : q.data;
}

export function invalidate() {
  return client.invalidateQueries(['todos']);
}
