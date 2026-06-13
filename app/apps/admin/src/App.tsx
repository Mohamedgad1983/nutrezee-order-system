import './App.css';
import { AuthProvider, useAuth } from './auth';
import { NAV, Shell } from './Shell';
import { Redirect, usePath } from './router';
import { LoginPage } from './pages/Login';
import { KitchenBoardPage } from './pages/Kitchen';
import { IntakePage } from './pages/Intake';
import { DraftsPage, OrdersPage, ReviewQueuePage } from './pages/lists';
import { NotFoundPage, PlaceholderPage } from './pages/Placeholder';

export function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  );
}

function Routed(): React.JSX.Element | null {
  const path = usePath();
  const { me, ready } = useAuth();

  if (!ready) {
    return (
      <main className="loginWrap">
        <p className="loginHint">Loading…</p>
      </main>
    );
  }

  // Legacy/tablet bookmarks and the root URL funnel into the shell.
  if (path === '/' || path === '/kitchen') {
    return <Redirect to={me ? '/app/kitchen' : '/app/login'} />;
  }

  if (!me) {
    if (path !== '/app/login') return <Redirect to="/app/login" />;
    return <LoginPage />;
  }

  if (path === '/app/login' || path === '/app') {
    return <Redirect to="/app/kitchen" />;
  }

  let page: React.JSX.Element;
  switch (path) {
    case '/app/kitchen':
      page = <KitchenBoardPage />;
      break;
    case '/app/drafts':
      page = <DraftsPage />;
      break;
    case '/app/intake':
      page = <IntakePage />;
      break;
    case '/app/review-queue':
      page = <ReviewQueuePage />;
      break;
    case '/app/orders':
      page = <OrdersPage />;
      break;
    default:
      page = NAV.some((n) => n.path === path) ? <PlaceholderPage path={path} /> : <NotFoundPage />;
  }
  return <Shell path={path}>{page}</Shell>;
}
