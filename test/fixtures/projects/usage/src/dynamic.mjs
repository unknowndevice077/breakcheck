export async function lazyJson(value) {
  const { json } = await import('react-router');
  return json(value);
}

export async function lazyDefer(value) {
  const mod = await import('react-router');
  return mod.defer(value);
}

export async function plugin(name) {
  return import(name);
}
