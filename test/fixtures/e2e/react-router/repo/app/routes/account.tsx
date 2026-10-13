import { defer, json, useLoaderData } from 'react-router';
import { getOrders, getUser } from '../data';

export async function loader() {
  const user = await getUser();
  if (!user) {
    return json({ error: 'not signed in' }, { status: 401 });
  }
  return defer({ user, orders: getOrders(user.id) });
}

export default function Account() {
  const { user } = useLoaderData() as { user: { name: string } };
  return <h1>Hello {user.name}</h1>;
}
