import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanMessage, type ListResponse } from '../api';

// WP-UI-03b — catalog browse (read-only). Products / packages / masters over the
// M05 read API (GET /catalog/*, all catalog.read). Catalog stays import-only until
// cutover_catalog flips (mirror mode), so this screen is intentionally read-only — it
// mirrors the legacy Products / Packages / Masters lists for verification + cutover.

interface ProductRow {
  id: string; code: string | null; nameEn: string; nameAr: string;
  mealTypeId: string | null; price: number | null; currency: string;
  active: boolean; origin: 'new' | 'legacy';
}
interface PackageRow {
  id: string; nameEn: string; nameAr: string; parentPackageId: string | null;
  durationDays: number | null; mealsPerDay: number | null; price: number | null;
  currency: string; packageForId: string | null; active: boolean; origin: 'new' | 'legacy';
}
interface MasterRow { id: string; nameEn: string; nameAr: string; active: boolean; origin: 'new' | 'legacy' }
interface NutritionRow {
  productId: string; calories: number | null; proteinG: number | null;
  carbsG: number | null; fatG: number | null; notesEn: string | null; notesAr: string | null;
}
interface ResolvedAllergen { allergenId: string; nameEn: string; source: 'declared' | 'derived_from_ingredient' }

const CATALOG_MASTER_KINDS = ['meal_type', 'diet_status', 'tag', 'package_for_type', 'ingredient', 'allergen'] as const;
type CatalogMasterKind = (typeof CATALOG_MASTER_KINDS)[number];

const short = (s: string | null | undefined): string => (s ? (s.length > 12 ? `${s.slice(0, 12)}…` : s) : '—');
const money = (v: number | null, ccy?: string): string =>
  (v === null || v === undefined ? '—' : `${v.toLocaleString()}${ccy ? ` ${ccy}` : ''}`);
const kindLabel = (k: string): string => k.replaceAll('_', ' ');

// Shared read-list hook (mirrors the list pattern in Orders/lists, scoped to catalog).
function useCatalogList<T>(path: string): { items: T[]; busy: boolean; error: string | null; reload: () => void } {
  const [items, setItems] = useState<T[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    api<ListResponse<T>>(path)
      .then((d) => { if (seq.current === mine) setItems(d.items); })
      .catch((e: unknown) => { if (seq.current === mine) setError(humanMessage(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { items, busy, error, reload };
}

export function CatalogPage(): React.JSX.Element {
  const [tab, setTab] = useState<'products' | 'packages' | 'masters'>('products');
  return (
    <section>
      <div className="segmented">
        {(['products', 'packages', 'masters'] as const).map((t) => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'products' ? 'Products' : t === 'packages' ? 'Packages' : 'Masters'}
          </button>
        ))}
      </div>
      {tab === 'products' ? <ProductsTab /> : tab === 'packages' ? <PackagesTab /> : <MastersTab />}
    </section>
  );
}

function ProductsTab(): React.JSX.Element {
  const [activeOnly, setActiveOnly] = useState(false);
  const list = useCatalogList<ProductRow>(`/catalog/products${activeOnly ? '?active=true' : ''}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <section className="toolbar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} style={{ minHeight: 'auto' }} />
          <span>Active only</span>
        </label>
        <button type="button" onClick={list.reload} disabled={list.busy}>Refresh</button>
        <span className="countLine">{list.busy ? 'Loading…' : `${list.items.length} product${list.items.length === 1 ? '' : 's'}`}</span>
      </section>
      {list.error ? <p className="error">{list.error}</p> : null}
      {!list.busy && !list.error && list.items.length === 0 ? <p className="emptyLine">No products — catalog loads via the M19 import while mirror mode is on.</p> : null}
      {list.items.length > 0 ? (
        <table className="table">
          <thead><tr><th>Code</th><th>Name (EN)</th><th>Name (AR)</th><th>Price</th><th>Active</th><th>Origin</th><th></th></tr></thead>
          <tbody>
            {list.items.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.code ?? '—'}</td>
                <td>{p.nameEn}</td>
                <td dir="rtl">{p.nameAr}</td>
                <td>{money(p.price, p.currency)}</td>
                <td>{p.active ? 'yes' : 'no'}</td>
                <td><span className="badge">{p.origin}</span></td>
                <td><button type="button" onClick={() => setOpen(p.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {open ? <ProductDetail id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ProductDetail({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const [data, setData] = useState<{ product: ProductRow; nutrition: NutritionRow | null; allergens: ResolvedAllergen[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    Promise.all([
      api<ProductRow>(`/catalog/products/${id}`),
      api<{ item: NutritionRow | null }>(`/catalog/products/${id}/nutrition`),
      api<{ items: ResolvedAllergen[] }>(`/catalog/products/${id}/allergens`),
    ])
      .then(([product, nut, alg]) => { if (alive) setData({ product, nutrition: nut.item, allergens: alg.items }); })
      .catch((e: unknown) => { if (alive) setError(humanMessage(e)); });
    return () => { alive = false; };
  }, [id]);

  return (
    <section className="card reviewPanel">
      <div className="panelHead">
        <h2>{data ? data.product.nameEn : 'Product'}</h2>
        <button type="button" className="linkBtn" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {!data && !error ? <p className="emptyLine">Loading…</p> : null}
      {data ? (
        <>
          <dl className="kv">
            <div><dt>Name (AR)</dt><dd dir="rtl">{data.product.nameAr}</dd></div>
            <div><dt>Code</dt><dd className="mono">{data.product.code ?? '—'}</dd></div>
            <div><dt>Price</dt><dd>{money(data.product.price, data.product.currency)}</dd></div>
            <div><dt>Meal type</dt><dd className="mono">{short(data.product.mealTypeId)}</dd></div>
            <div><dt>Active</dt><dd>{data.product.active ? 'yes' : 'no'}</dd></div>
            <div><dt>Origin</dt><dd><span className="badge">{data.product.origin}</span></dd></div>
          </dl>
          <strong>Nutrition</strong>
          {data.nutrition ? (
            <dl className="kv">
              <div><dt>Calories</dt><dd>{data.nutrition.calories ?? '—'}</dd></div>
              <div><dt>Protein (g)</dt><dd>{data.nutrition.proteinG ?? '—'}</dd></div>
              <div><dt>Carbs (g)</dt><dd>{data.nutrition.carbsG ?? '—'}</dd></div>
              <div><dt>Fat (g)</dt><dd>{data.nutrition.fatG ?? '—'}</dd></div>
            </dl>
          ) : <p className="emptyLine">No nutrition facts recorded.</p>}
          <strong>Allergens</strong>
          <ul className="hits">
            {data.allergens.map((a) => <li key={a.allergenId}><span>{a.nameEn} · {a.source === 'declared' ? 'declared' : 'from ingredient'}</span></li>)}
            {data.allergens.length === 0 ? <li><span>none resolved</span></li> : null}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function PackagesTab(): React.JSX.Element {
  const [activeOnly, setActiveOnly] = useState(false);
  const list = useCatalogList<PackageRow>(`/catalog/packages${activeOnly ? '?active=true' : ''}`);
  const [open, setOpen] = useState<PackageRow | null>(null);
  return (
    <>
      <section className="toolbar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} style={{ minHeight: 'auto' }} />
          <span>Active only</span>
        </label>
        <button type="button" onClick={list.reload} disabled={list.busy}>Refresh</button>
        <span className="countLine">{list.busy ? 'Loading…' : `${list.items.length} package${list.items.length === 1 ? '' : 's'}`}</span>
      </section>
      {list.error ? <p className="error">{list.error}</p> : null}
      {!list.busy && !list.error && list.items.length === 0 ? <p className="emptyLine">No packages — catalog loads via the M19 import while mirror mode is on.</p> : null}
      {list.items.length > 0 ? (
        <table className="table">
          <thead><tr><th>Name (EN)</th><th>Name (AR)</th><th>Duration</th><th>Meals/day</th><th>Price</th><th>Parent</th><th>Active</th><th>Origin</th><th></th></tr></thead>
          <tbody>
            {list.items.map((p) => (
              <tr key={p.id}>
                <td>{p.nameEn}</td>
                <td dir="rtl">{p.nameAr}</td>
                <td>{p.durationDays === null ? '—' : `${p.durationDays}d`}</td>
                <td>{p.mealsPerDay ?? '—'}</td>
                <td>{money(p.price, p.currency)}</td>
                <td className="mono">{p.parentPackageId ? short(p.parentPackageId) : '—'}</td>
                <td>{p.active ? 'yes' : 'no'}</td>
                <td><span className="badge">{p.origin}</span></td>
                <td><button type="button" onClick={() => setOpen(p)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {open ? (
        <section className="card reviewPanel">
          <div className="panelHead">
            <h2>{open.nameEn}</h2>
            <button type="button" className="linkBtn" onClick={() => setOpen(null)}>Close</button>
          </div>
          <dl className="kv">
            <div><dt>Name (AR)</dt><dd dir="rtl">{open.nameAr}</dd></div>
            <div><dt>Duration</dt><dd>{open.durationDays === null ? '—' : `${open.durationDays} days`}</dd></div>
            <div><dt>Meals / day</dt><dd>{open.mealsPerDay ?? '—'}</dd></div>
            <div><dt>Price</dt><dd>{money(open.price, open.currency)}</dd></div>
            <div><dt>Parent package</dt><dd className="mono">{open.parentPackageId ? short(open.parentPackageId) : '—'}</dd></div>
            <div><dt>Active</dt><dd>{open.active ? 'yes' : 'no'}</dd></div>
            <div><dt>Origin</dt><dd><span className="badge">{open.origin}</span></dd></div>
          </dl>
        </section>
      ) : null}
    </>
  );
}

function MastersTab(): React.JSX.Element {
  const [kind, setKind] = useState<CatalogMasterKind>('meal_type');
  const list = useCatalogList<MasterRow>(`/catalog/masters/${kind}`);
  return (
    <>
      <section className="toolbar">
        <label>
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as CatalogMasterKind)}>
            {CATALOG_MASTER_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
        </label>
        <button type="button" onClick={list.reload} disabled={list.busy}>Refresh</button>
        <span className="countLine">{list.busy ? 'Loading…' : `${list.items.length} item${list.items.length === 1 ? '' : 's'}`}</span>
      </section>
      {list.error ? <p className="error">{list.error}</p> : null}
      {!list.busy && !list.error && list.items.length === 0 ? <p className="emptyLine">No {kindLabel(kind)} entries yet.</p> : null}
      {list.items.length > 0 ? (
        <table className="table">
          <thead><tr><th>Name (EN)</th><th>Name (AR)</th><th>Active</th><th>Origin</th></tr></thead>
          <tbody>
            {list.items.map((m) => (
              <tr key={m.id}>
                <td>{m.nameEn}</td>
                <td dir="rtl">{m.nameAr}</td>
                <td>{m.active ? 'yes' : 'no'}</td>
                <td><span className="badge">{m.origin}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
