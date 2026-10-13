import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';

export function mountLegacy(el: Element) {
  ReactDOM.render(<div />, el);
}

export function mount(el: Element) {
  const root = createRoot(el);
  root.render(<div />);
}
