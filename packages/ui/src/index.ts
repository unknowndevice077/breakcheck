import clsx from 'clsx';
export function Button(props: { theme: string; children?: unknown }) {
  return { type: 'button', className: clsx('btn', props.theme), children: props.children };
}
