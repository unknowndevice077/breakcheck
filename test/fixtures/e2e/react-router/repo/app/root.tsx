import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { routes } from './routes';

const router = createBrowserRouter(routes);

export function Root() {
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}
