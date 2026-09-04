import './labelSheet.css';

// WP-LBL-A27 — exact reproduction of the legacy Nutreeze daily-meal label.
//
// Field order, captions, grouping rules and the meals/nutrition table match the legacy printed
// label one-for-one (transcribed in docs/evidence/label_barcode/01_discovery_dependency_map.md).
// The ONLY addition is the Code 128 barcode strip at the bottom. Nothing existing is moved,
// renamed or removed.
//
// Two legacy quirks are reproduced deliberately:
//   * the right-hand caption reads "User ID" although it carries the ORDER NUMBER;
//   * unknown values print as "-", exactly as the legacy label does for Floor / Flat / Direction.

export interface LabelMealRow {
  dish_name: string;
  qty: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  calories: number | null;
}

export interface LabelDocument {
  order_id: string;
  customer_id: string;
  delivery_date: string;
  full_name: string;
  subscription_date_display: string;
  delivery_time: string | null;
  days_remaining: number | null;
  delivery_method: string | null;
  package_name: string | null;
  meals_per_day: number | null;
  snacks_per_day: number | null;
  legacy_user_id: string | null;
  driver_ref: string | null;
  order_number: string;
  address: {
    area: string | null; block: string | null; street: string | null; building: string | null;
    floor: string | null; flat: string | null; direction: string | null;
  };
  phone: string | null;
  notes: string | null;
  meals: LabelMealRow[];
  meal_source: 'dish_day' | 'no_dish_source';
  totals: {
    protein: number | null; carbs: number | null; fat: number | null;
    calories: number | null; complete: boolean;
  };
  barcode_value: string;
  barcode_svg: string;
  masked?: boolean;
}

/** The legacy label prints "-" for any value it does not have. */
const dash = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === '' ? '-' : String(v);

export function LabelSheet({ doc }: { doc: LabelDocument }): React.JSX.Element {
  return (
    <article className="labelSheet" aria-label={`Label for order ${doc.order_number}`}>
      <header className="labelHeader">
        <svg className="labelMark" viewBox="0 0 40 44" aria-hidden="true">
          <polygon
            points="20,2 37,12 37,32 20,42 3,32 3,12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
        <div className="labelBrand">Nutreeze</div>
        <div className="labelTagline">Stay Healthy</div>
      </header>

      <div className="labelBody">
        <section className="labelInfo">
          <div className="labelGroup">
            <Row label="Full Name" value={doc.full_name} />
            <Row label="Subscription" value={doc.subscription_date_display} />
            <Row label="Delivery Time" value={dash(doc.delivery_time)} />
            <Row label="Days Remaining" value={dash(doc.days_remaining)} />
            <Row label="Delivery Method" value={dash(doc.delivery_method)} />
          </div>

          <div className="labelGroup labelPackage">
            <div>
              <strong>{dash(doc.package_name)}</strong> (Meal: {dash(doc.meals_per_day)})
            </div>
            <div>(Snacks: {dash(doc.snacks_per_day)})</div>
          </div>

          <div className="labelGroup labelIds">
            <span>User ID <strong>{dash(doc.legacy_user_id)}</strong></span>
            <span>Driver ID <strong>{dash(doc.driver_ref)}</strong></span>
            {/* Legacy caption is literally "User ID" here, but the value is the order number. */}
            <span className="labelOrderNo">
              User ID
              <strong>{doc.order_number}</strong>
            </span>
          </div>

          <div className="labelGroup labelAddress">
            <div>
              <b>Area</b>: {dash(doc.address.area)}, <b>Block</b>: {dash(doc.address.block)},{' '}
              <b>Street</b>: {dash(doc.address.street)}
            </div>
            <div>
              <b>Building</b>: {dash(doc.address.building)}, <b>Floor</b>: {dash(doc.address.floor)},{' '}
              <b>Flat</b>: {dash(doc.address.flat)}, <b>Direction</b>: {dash(doc.address.direction)}
            </div>
            <div><b>Phone</b>: {dash(doc.phone)}</div>
            <div><b>Notes</b>: {dash(doc.notes)}</div>
          </div>
        </section>

        <section className="labelMeals">
          <table className="labelTable">
            {/* fixed numeric widths so "Qty"/"Carb"/"Cal" can never wrap mid-word */}
            <colgroup>
              <col className="dishCol" />
              <col className="numCol" /><col className="numCol" /><col className="numCol" />
              <col className="numCol" /><col className="numCol" />
            </colgroup>
            <thead>
              <tr>
                <th className="dishCol">Dish Name</th>
                <th>Qty</th><th>Pro</th><th>Carb</th><th>Fat</th><th>Cal</th>
              </tr>
            </thead>
            <tbody>
              {doc.meals.map((m, i) => (
                <tr key={`${m.dish_name}-${i}`}>
                  <td className="dishCol">{m.dish_name}</td>
                  <td>{dash(m.qty)}</td>
                  <td>{dash(m.protein)}</td>
                  <td>{dash(m.carbs)}</td>
                  <td>{dash(m.fat)}</td>
                  <td>{dash(m.calories)}</td>
                </tr>
              ))}
              {doc.meals.length === 0 ? (
                <tr>
                  {/* Honest empty state: no dish detail was captured for this date. The label
                      must never show invented dishes or nutrition figures. */}
                  <td className="labelNoDish" colSpan={6}>
                    No dish detail recorded for this date
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <div className="labelTotals">
            <div className="labelTotalsLabel">Total Nutrition</div>
            <table className="labelTotalsTable">
              <thead>
                <tr><th>Protein</th><th>Carb</th><th>Fat</th><th>Calories</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>{dash(doc.totals.protein)}</td>
                  <td>{dash(doc.totals.carbs)}</td>
                  <td>{dash(doc.totals.fat)}</td>
                  <td>{dash(doc.totals.calories)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <footer className="labelBarcode">
        <div
          className="labelBarcodeImg"
          /* Server-rendered Code 128 SVG from our own encoder — no external input, no scripts. */
          dangerouslySetInnerHTML={{ __html: doc.barcode_svg }}
        />
        <div className="labelBarcodeRef">{doc.barcode_value}</div>
      </footer>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="labelRow">
      <span className="labelKey">{label} :</span>
      <span className="labelVal">{value}</span>
    </div>
  );
}
