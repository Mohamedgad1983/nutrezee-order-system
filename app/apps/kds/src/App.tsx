import { useCallback, useEffect, useState } from 'react';
import type { KdsSectionTotalsContract } from '@nutrezee/shared';
import { ApiError, request } from './api';
import { formatQuantity, initialLanguage, kuwaitToday, type Language } from './model';

type AuthState = 'checking' | 'signed_in' | 'signed_out';

const COPY = {
  ar: {
    appName: 'شاشة إنتاج المطبخ',
    appSubtitle: 'إجمالي المطلوب لكل قسم — بدون بيانات العملاء',
    checkSession: 'جاري التحقق من الجلسة…',
    date: 'تاريخ التسليم',
    kitchen: 'المطبخ',
    refresh: 'تحديث الآن',
    refreshing: 'جاري التحديث…',
    logout: 'تسجيل الخروج',
    sourceTotal: 'إجمالي الوجبات',
    workTotal: 'إجمالي مهام الأقسام',
    sections: 'الأقسام',
    updated: 'آخر تحديث',
    empty: 'لا توجد كميات مطلوبة لهذا اليوم.',
    portion: 'الحجم',
    packing: 'تجهيز',
    unroutedWarning: 'يوجد عناصر غير موجّهة لقسم. يجب مراجعة التوجيه قبل الإنتاج.',
    signIn: 'تسجيل دخول المطبخ',
    signInHint: 'استخدم حساب الموظف المصرّح له بعرض شاشة المطبخ.',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    signingIn: 'جاري الدخول…',
    loginFailed: 'تعذر تسجيل الدخول. راجع البيانات وحاول مرة أخرى.',
    unavailable: 'مصدر الإنتاج غير متاح الآن. لم يتم عرض أرقام قديمة أو تقديرية.',
    invalidSource: 'بيانات مصدر الإنتاج غير صالحة. تم إيقاف العرض بدل استخدام أرقام غير مؤكدة.',
    forbidden: 'هذا الحساب غير مصرح له بعرض شاشة المطبخ.',
    network: 'تعذر الاتصال بالخادم.',
  },
  en: {
    appName: 'Kitchen Production Display',
    appSubtitle: 'Required totals by section — no customer data',
    checkSession: 'Checking session…',
    date: 'Delivery date',
    kitchen: 'Kitchen',
    refresh: 'Refresh now',
    refreshing: 'Refreshing…',
    logout: 'Sign out',
    sourceTotal: 'Meal quantity',
    workTotal: 'Section work quantity',
    sections: 'Sections',
    updated: 'Last updated',
    empty: 'No production quantities are required for this date.',
    portion: 'Portion',
    packing: 'Packing',
    unroutedWarning: 'Some items have no section route. Review routing before production.',
    signIn: 'Kitchen sign in',
    signInHint: 'Use a staff account allowed to view the kitchen board.',
    email: 'Email',
    password: 'Password',
    signingIn: 'Signing in…',
    loginFailed: 'Sign in failed. Check the account details and try again.',
    unavailable: 'The production source is unavailable. No stale or estimated totals are shown.',
    invalidSource: 'The production source response is invalid. Display stopped instead of using uncertain totals.',
    forbidden: 'This account cannot view the kitchen display.',
    network: 'Could not reach the server.',
  },
} as const;

export function App(): React.JSX.Element {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [auth, setAuth] = useState<AuthState>('checking');
  const copy = COPY[language];

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('nutrezee-kds-language', language);
  }, [language]);

  useEffect(() => {
    let active = true;
    request('/auth/me')
      .then(() => { if (active) setAuth('signed_in'); })
      .catch(() => { if (active) setAuth('signed_out'); });
    return () => { active = false; };
  }, []);

  const languageButton = (
    <button
      className="languageButton"
      type="button"
      onClick={() => setLanguage((current) => current === 'ar' ? 'en' : 'ar')}
    >
      {language === 'ar' ? 'English' : 'العربية'}
    </button>
  );

  if (auth === 'checking') {
    return <main className="centered"><div className="loader" />{copy.checkSession}</main>;
  }
  if (auth === 'signed_out') {
    return (
      <main className="loginPage">
        <div className="loginLanguage">{languageButton}</div>
        <Login language={language} onSuccess={() => setAuth('signed_in')} />
      </main>
    );
  }
  return (
    <KdsBoard
      language={language}
      languageButton={languageButton}
      onUnauthorized={() => setAuth('signed_out')}
    />
  );
}

function Login({ language, onSuccess }: { language: Language; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const copy = COPY[language];

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onSuccess();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <form className="loginCard" onSubmit={(event) => void submit(event)}>
      <div className="brandMark" aria-hidden="true">N</div>
      <h1>{copy.signIn}</h1>
      <p>{copy.signInHint}</p>
      <label><span>{copy.email}</span><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label><span>{copy.password}</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error ? <div className="errorBanner" role="alert">{copy.loginFailed}</div> : null}
      <button className="primaryButton" type="submit" disabled={busy || !email || !password}>
        {busy ? copy.signingIn : copy.signIn}
      </button>
    </form>
  );
}

function KdsBoard({
  language,
  languageButton,
  onUnauthorized,
}: {
  language: Language;
  languageButton: React.ReactNode;
  onUnauthorized: () => void;
}) {
  const [date, setDate] = useState(kuwaitToday);
  const [kitchen, setKitchen] = useState('main');
  const [data, setData] = useState<KdsSectionTotalsContract | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[language];

  const load = useCallback(async () => {
    if (!date || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(kitchen)) {
      setData(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await request<KdsSectionTotalsContract>(
        `/kitchen/section-totals?date=${encodeURIComponent(date)}&kitchen=${encodeURIComponent(kitchen)}`,
      );
      setData(result);
    } catch (caught) {
      setData(null);
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      setError(errorMessage(caught, language));
    } finally {
      setBusy(false);
    }
  }, [date, kitchen, language, onUnauthorized]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function logout(): Promise<void> {
    try {
      await request('/auth/logout', { method: 'POST' });
      onUnauthorized();
    } catch {
      setError(copy.network);
    }
  }

  const hasUnrouted = (data?.summary.unrouted_quantity_total ?? 0) > 0;
  return (
    <main className="appFrame">
      <header className="topbar">
        <div className="titleBlock">
          <div className="brandMark small" aria-hidden="true">N</div>
          <div><h1>{copy.appName}</h1><p>{copy.appSubtitle}</p></div>
        </div>
        <div className="topActions">
          {languageButton}
          <button className="ghostButton" type="button" onClick={() => void logout()}>{copy.logout}</button>
        </div>
      </header>

      <section className="controlBar" aria-label="Display filters">
        <label><span>{copy.date}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>{copy.kitchen}</span><input className="kitchenInput" value={kitchen} pattern="[a-z0-9_-]+" maxLength={40} onChange={(event) => setKitchen(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} /></label>
        <button className="refreshButton" type="button" onClick={() => void load()} disabled={busy || !date || !kitchen}>
          {busy ? copy.refreshing : copy.refresh}
        </button>
        {data ? <p className="updatedAt">{copy.updated}<strong>{formatTime(data.generated_at, language)}</strong></p> : null}
      </section>

      {error ? <div className="errorBanner wide" role="alert">{error}</div> : null}
      {hasUnrouted ? <div className="warningBanner" role="alert">⚠ {copy.unroutedWarning}</div> : null}

      {data ? (
        <>
          <section className="summaryStrip" aria-label="Production summary">
            <Metric label={copy.sourceTotal} value={data.summary.source_quantity_total} language={language} />
            <Metric label={copy.workTotal} value={data.summary.section_assignment_quantity_total} language={language} />
            <Metric label={copy.sections} value={data.sections.length} language={language} />
          </section>
          {data.sections.length === 0 ? <div className="emptyState">{copy.empty}</div> : (
            <section className="sectionGrid">
              {data.sections.map((section) => (
                <article className={`sectionCard${section.unrouted ? ' unrouted' : ''}`} key={`${section.section_id ?? 'none'}-${section.code}`}>
                  <header>
                    <div>
                      <p className="sectionCode">{section.code}</p>
                      <h2>{language === 'ar' ? section.name_ar ?? section.name_en ?? section.code : section.name_en ?? section.name_ar ?? section.code}</h2>
                    </div>
                    <div className="sectionTotal">{formatQuantity(section.total_qty, language)}</div>
                  </header>
                  {section.is_packing ? <span className="packingBadge">{copy.packing}</span> : null}
                  <div className="mealList">
                    {section.meals.map((meal) => (
                      <div className="mealRow" key={`${meal.meal_id}-${meal.portion_size ?? ''}`}>
                        <div className="mealName">
                          <strong>{language === 'ar' ? meal.name_ar ?? meal.name_en : meal.name_en ?? meal.name_ar}</strong>
                          {meal.portion_size ? <span>{copy.portion}: {meal.portion_size}</span> : null}
                        </div>
                        <span className="mealQty">{formatQuantity(meal.total_qty, language)}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      ) : busy && !error ? <div className="centered boardLoader"><div className="loader" />{copy.refreshing}</div> : null}
    </main>
  );
}

function Metric({ label, value, language }: { label: string; value: number; language: Language }) {
  return <div className="metric"><span>{label}</span><strong>{formatQuantity(value, language)}</strong></div>;
}

function formatTime(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-KW' : 'en-KW', {
    timeZone: 'Asia/Kuwait',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function errorMessage(error: unknown, language: Language): string {
  const copy = COPY[language];
  if (!(error instanceof ApiError)) return copy.network;
  if (error.status === 403) return copy.forbidden;
  if (error.code === 'kds_source_response_invalid') return copy.invalidSource;
  return copy.unavailable;
}
