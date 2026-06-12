import { sectionLabel } from '../Shell';

export function PlaceholderPage({ path }: { path: string }): React.JSX.Element {
  return (
    <section className="placeholder">
      <h2>{sectionLabel(path)}</h2>
      <p>
        This screen is scheduled in WP-UI-02. The API behind it is already live and tested —
        only the screen is pending.
      </p>
    </section>
  );
}

export function NotFoundPage(): React.JSX.Element {
  return (
    <section className="placeholder">
      <h2>Page not found</h2>
      <p>This address does not match any screen.</p>
    </section>
  );
}
