// WP-00 shell. Admin surfaces (intake, review queue, settings, finance queue) and the
// /kitchen PWA route arrive with their WPs. lang/dir switching (EN/AR, RTL) is wired at
// the html element from the locale once auth exists (WP-01/02).
export function App(): React.JSX.Element {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Nutrezee Admin</h1>
      <p>Environment shell (WP-00). Business surfaces arrive with WP-01+.</p>
    </main>
  );
}
