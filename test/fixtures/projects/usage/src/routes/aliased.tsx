import { json as toJson, useFetcher } from 'react-router';
import type { LoaderFunction } from 'react-router';

export const loader: LoaderFunction = async () => toJson({ ok: true });

export function Widget() {
  const fetcher = useFetcher();
  return <fetcher.Form method="post" />;
}
