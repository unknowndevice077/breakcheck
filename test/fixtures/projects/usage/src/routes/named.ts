import { json, redirect } from 'react-router';

export async function loader() {
  const user = await getUser();
  if (!user) return redirect('/login');
  return json({ user });
}

declare function getUser(): Promise<unknown>;
