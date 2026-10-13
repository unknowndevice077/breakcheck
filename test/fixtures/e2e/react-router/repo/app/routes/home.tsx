import { data, redirect } from 'react-router';

// v7_startTransition is on by default in v7; nothing to do here.
export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  if (!form.get('q')) return redirect('/');
  return data({ ok: true }, { status: 201 });
}
