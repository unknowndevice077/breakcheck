import { describe, expect, it } from 'vitest';
import { esc, inlineHtml } from '../src/report/render.js';

describe('esc (Markdown text from notes or the model)', () => {
  it('turns @mentions into code so strangers thanked in release notes are not pinged', () => {
    expect(esc('Thanks @kentcdodds! Imports from @remix-run/router can fail')).toBe('Thanks `@kentcdodds`! Imports from `@remix-run/router` can fail');
  });
  it('leaves emails, existing code spans and paths alone', () => {
    expect(esc('mail me at a@b.com, use `@scope/pkg` or node_modules/@types/node')).toBe('mail me at a@b.com, use `@scope/pkg` or node_modules/@types/node');
  });
  it('escapes angle brackets outside code so generics are not eaten as HTML', () => {
    expect(esc('useFetcher<LoaderData>() and `useFetcher<typeof loader>()`')).toBe('useFetcher&lt;LoaderData&gt;() and `useFetcher<typeof loader>()`');
  });
  it('escapes table pipes and joins lines', () => {
    expect(esc('a | b\nc')).toBe('a \\| b c');
  });
});

describe('inlineHtml (<summary> text)', () => {
  it('renders code spans as <code>, escapes HTML and neutralises mentions', () => {
    expect(inlineHtml('`json` removed; see @remix-run/router <b>now</b>')).toBe('<code>json</code> removed; see <code>@remix-run/router</code> &lt;b&gt;now&lt;/b&gt;');
  });
});
