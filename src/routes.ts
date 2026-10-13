import { json as toJson, defer, redirect } from 'react-router';

export async function accountLoader(userId: string | null) {
  if (!userId) return redirect('/login');
  return defer({ orders: fetchOrders(userId) });
}

export function healthLoader() {
  return toJson({ ok: true }, { status: 200 });
}

declare function fetchOrders(id: string): Promise<unknown[]>;
