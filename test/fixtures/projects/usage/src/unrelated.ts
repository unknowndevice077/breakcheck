// Not using the package: a local helper that happens to be called json
function json(x: unknown) {
  return JSON.stringify(x);
}
export const out = json({ a: 1 });
