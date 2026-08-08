import './App.css';
import { AuthProvider, useAuth } from './auth';
import { NAV, Shell } from './Shell';
import { Redirect, usePath } from './router';
import { LoginPage } from './pages/Login';
import { KitchenBoardPage } from './pages/Kitchen';
import { IntakePage } from './pages/Intake';
import { ReviewPage } from './pages/Review';
import { OrdersPage } from './pages/Orders';
import { PaymentsPage } from './pages/Payments';
import { CustomersPage } from './pages/Customers';
import { CatalogPage } from './pages/Catalog';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { DashboardPage } from './pages/Dashboard';
import { StaffPage } from './pages/Staff';
import { ExceptionsPage } from './pages/Exceptions';
import { PackingPage } from './pages/Packing';
import { DeliveryPage } from './pages/Delivery';
import { AuditPage } from './pages/Audit';
import { DraftsPage } from './pages/lists';
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

  const shellPath = path.startsWith('/app/dashboard/') ? '/app/dashboard' : path;
  let page: React.JSX.Element;
  switch (path) {
    case '/app/dashboard':
      page = <DashboardPage />;
      break;
    case '/app/kitchen':
      page = <KitchenBoardPage />;
      break;
    case '/app/packing':
      page = <PackingPage />;
      break;
    case '/app/delivery':
      page = <DeliveryPage />;
      break;
    case '/app/drafts':
      page = <DraftsPage />;
      break;
    case '/app/intake':
      page = <IntakePage />;
      break;
    case '/app/review-queue':
      page = <ReviewPage />;
      break;
    case '/app/orders':
      page = <OrdersPage />;
      break;
    case '/app/payments':
      page = <PaymentsPage />;
      break;
    case '/app/customers':
      page = <CustomersPage />;
      break;
    case '/app/catalog':
      page = <CatalogPage />;
      break;
    case '/app/reports':
      page = <ReportsPage />;
      break;
    case '/app/settings':
      page = <SettingsPage />;
      break;
    case '/app/staff':
      page = <StaffPage />;
      break;
    case '/app/exceptions':
      page = <ExceptionsPage />;
      break;
    case '/app/audit':
      page = <AuditPage />;
      break;
    default:
      if (path.startsWith('/app/dashboard/')) {
        page = <DashboardPage metricSlug={path.slice('/app/dashboard/'.length)} />;
      } else {
        page = NAV.some((n) => n.path === path) ? <PlaceholderPage path={path} /> : <NotFoundPage />;
      }
  }
  return <Shell path={shellPath}>{page}</Shell>;
}
