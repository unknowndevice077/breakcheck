import { cookies, headers } from 'next/headers';
import { Button } from '@acme/ui';

export default function Page() {
  const theme = cookies().get('theme')?.value ?? 'light';
  const ua = headers().get('user-agent');
  return <Button theme={theme}>{ua}</Button>;
}
