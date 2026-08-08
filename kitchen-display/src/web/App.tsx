import { useCallback, useEffect, useRef, useState } from 'react';
import type { KdsDisplayConfig, KdsSectionTotals } from '../contracts';
import { ApiError, request } from './api';
import {
  formatQuantity,
  initialLanguage,
  kuwaitToday,
  LANGUAGE_STORAGE_KEY,
  type Language,
} from './model';

type AuthState = 'checking' | 'signed_in' | 'signed_out';

const COPY = {
  ar: {
    appName: 'شاشة إنتاج المطبخ',
    appSubtitle: 'الكميات المطلوبة للأقسام المخصّصة لهذا المستخدم فقط',
    checkSession: 'جاري التحقق من الجلسة…',
    date: 'تاريخ التسليم',
    kitchen: 'المطبخ',
    refresh: 'تحديث الآن',
    refreshing: 'جاري التحديث…',
    logout: 'تسجيل الخروج',
    assignedQuantity: 'إجمالي الكمية المطلوبة',
    sections: 'الأقسام المخصّصة',
    signedInAs: 'المستخدم',
    assignment: 'صلاحية القسم',
    updated: 'وقت إنشاء العرض',
    sourceUpdated: 'وقت المصدر',
    empty: 'لا توجد كميات مطلوبة لهذا اليوم.',
    portion: 'الحجم',
    packing: 'تجهيز',
    unroutedWarning: 'يوجد عناصر غير موجّهة لقسم. يجب مراجعة التوجيه قبل الإنتاج.',
    signIn: 'تسجيل دخول المطبخ',
    signInHint: 'كل مستخدم يرى فقط الأقسام المخصّصة له.',
    loginHeroTitle: 'أقسامك. شاشة واحدة مركّزة.',
    loginHeroText: 'سجّل الدخول بحسابك لعرض الوجبات والكميات المطلوبة من الأقسام المخصّصة لك فقط.',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    signingIn: 'جاري الدخول…',
    loginFailed: 'تعذر تسجيل الدخول. راجع البيانات وحاول مرة أخرى.',
    loginLimited: 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.',
    unavailable: 'مصدر الإنتاج غير متاح الآن. لم يتم عرض أرقام قديمة أو تقديرية.',
    invalidSource: 'بيانات مصدر الإنتاج غير صالحة. تم إيقاف العرض بدل استخدام أرقام غير مؤكدة.',
    network: 'تعذر الاتصال بالخادم.',
    configError: 'إعدادات الشاشة غير متاحة.',
  },
  en: {
    appName: 'Kitchen Production Display',
    appSubtitle: 'Required quantities for this user’s assigned sections only',
    checkSession: 'Checking session…',
    date: 'Delivery date',
    kitchen: 'Kitchen',
    refresh: 'Refresh now',
    refreshing: 'Refreshing…',
    logout: 'Sign out',
    assignedQuantity: 'Required quantity',
    sections: 'Assigned sections',
    signedInAs: 'Signed in as',
    assignment: 'Section access',
    updated: 'Display generated',
    sourceUpdated: 'Source time',
    empty: 'No production quantities are required for this date.',
    portion: 'Portion',
    packing: 'Packing',
    unroutedWarning: 'Some items have no section route. Review routing before production.',
    signIn: 'Kitchen sign in',
    signInHint: 'Each user sees only their assigned sections.',
    loginHeroTitle: 'Your sections. One focused screen.',
    loginHeroText: 'Sign in with your assigned account to see only the meals and quantities required from your sections.',
    username: 'Username',
    password: 'Password',
    signingIn: 'Signing in…',
    loginFailed: 'Sign in failed. Check the credentials and try again.',
    loginLimited: 'Too many attempts. Wait briefly, then try again.',
    unavailable: 'The production source is unavailable. No stale or estimated totals are shown.',
    invalidSource: 'The production source response is invalid. Display stopped instead of using uncertain totals.',
    network: 'Could not reach the server.',
    configError: 'Display configuration is unavailable.',
  },
} as const;

export function App(): React.JSX.Element {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [auth, setAuth] = useState<AuthState>('checking');
  const copy = COPY[language];
  const handleUnauthorized = useCallback(() => setAuth('signed_out'), []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    let active = true;
    request('/api/auth/me')
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
        <div className="loginShell">
          <section className="loginHero" aria-label={copy.appName}>
            <div className="heroBrand"><span aria-hidden="true">N</span> Nutrezee</div>
            <h1>{copy.loginHeroTitle}</h1>
            <p>{copy.loginHeroText}</p>
            <div className="heroFlow" aria-hidden="true">
              <span>USER</span><i>→</i><span>SECTION</span><i>→</i><span>TOTALS</span>
            </div>
          </section>
          <Login language={language} onSuccess={() => setAuth('signed_in')} />
        </div>
      </main>
    );
  }
  return (
    <Board
      language={language}
      languageButton={languageButton}
      onUnauthorized={handleUnauthorized}
    />
  );
}

function Login({ language, onSuccess }: { language: Language; onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[language];

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setPassword('');
      onSuccess();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 429 ? copy.loginLimited : copy.loginFailed);
      setBusy(false);
    }
  }

  return (
    <form className="loginCard" onSubmit={(event) => void submit(event)}>
      <div className="brandMark" aria-hidden="true">N</div>
      <h1>{copy.signIn}</h1>
      <p>{copy.signInHint}</p>
      <label><span>{copy.username}</span><input autoComplete="username" maxLength={80} required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <label><span>{copy.password}</span><input type="password" autoComplete="current-password" maxLength={256} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error ? <div className="errorBanner" role="alert">{error}</div> : null}
      <button className="primaryButton" type="submit" disabled={busy || !username || !password}>
        {busy ? copy.signingIn : copy.signIn}
      </button>
    </form>
  );
}

function Board({
  language,
  languageButton,
  onUnauthorized,
}: {
  language: Language;
  languageButton: React.ReactNode;
  onUnauthorized: () => void;
}) {
  const [date, setDate] = useState(kuwaitToday);
  const [config, setConfig] = useState<KdsDisplayConfig | null>(null);
  const [kitchen, setKitchen] = useState('');
  const [data, setData] = useState<KdsSectionTotals | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[language];
  const languageRef = useRef(language);
  const requestId = useRef(0);
  const selectionRef = useRef('');
  languageRef.current = language;
  selectionRef.current = `${date}\u0000${kitchen}`;

  useEffect(() => {
    let active = true;
    request<KdsDisplayConfig>('/api/display-config')
      .then((next) => {
        if (!active) return;
        setConfig(next);
        setKitchen((current) => current || next.kitchens[0] || '');
      })
      .catch((caught) => {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 401) onUnauthorized();
        else setError(COPY[languageRef.current].configError);
      });
    return () => { active = false; };
  }, [onUnauthorized]);

  const load = useCallback(async () => {
    if (!date || !kitchen) return;
    const selection = `${date}\u0000${kitchen}`;
    const currentRequest = ++requestId.current;
    setBusy(true);
    setError(null);
    try {
      const result = await request<KdsSectionTotals>(
        `/api/section-totals?date=${encodeURIComponent(date)}&kitchen=${encodeURIComponent(kitchen)}`,
      );
      if (currentRequest !== requestId.current || selection !== selectionRef.current) return;
      setData(result);
    } catch (caught) {
      if (currentRequest !== requestId.current || selection !== selectionRef.current) return;
      setData(null);
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      setError(errorMessage(caught, languageRef.current));
    } finally {
      if (currentRequest === requestId.current && selection === selectionRef.current) setBusy(false);
    }
  }, [date, kitchen, onUnauthorized]);

  useEffect(() => { if (kitchen) void load(); }, [kitchen, load]);
  useEffect(() => {
    if (date && kitchen) return;
    requestId.current += 1;
    setBusy(false);
    setData(null);
  }, [date, kitchen]);
  useEffect(() => () => { requestId.current += 1; }, []);
  useEffect(() => {
    if (!config || !kitchen) return undefined;
    const timer = window.setInterval(() => void load(), config.refresh_seconds * 1000);
    return () => window.clearInterval(timer);
  }, [config, kitchen, load]);

  async function logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
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
          {config ? (
            <div className="userAccess">
              <span>{copy.signedInAs}</span>
              <strong>{config.username}</strong>
              <small>{config.assigned_sections.join(' · ')}</small>
            </div>
          ) : null}
          {languageButton}
          <button className="ghostButton" type="button" onClick={() => void logout()}>{copy.logout}</button>
        </div>
      </header>

      <section className="controlBar" aria-label={copy.appName}>
        <label><span>{copy.date}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        {(config?.kitchens.length ?? 0) > 1 ? (
          <label>
            <span>{copy.kitchen}</span>
            <select value={kitchen} disabled={!config} onChange={(event) => setKitchen(event.target.value)}>
              {(config?.kitchens ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ) : <div className="controlValue"><span>{copy.kitchen}</span><strong>{kitchen || '—'}</strong></div>}
        {config ? (
          <div className="controlValue assignmentValue">
            <span>{copy.assignment}</span>
            <strong>{config.assigned_sections.join(' · ')}</strong>
          </div>
        ) : null}
        <button className="refreshButton" type="button" onClick={() => void load()} disabled={busy || !date || !kitchen}>
          {busy ? copy.refreshing : copy.refresh}
        </button>
        {data ? (
          <div className="timestamps">
            <p>{copy.updated}<strong>{formatTime(data.generated_at, language)}</strong></p>
            <p>{copy.sourceUpdated}<strong>{formatTime(data.source_server_time, language)}</strong></p>
          </div>
        ) : null}
      </section>

      {error ? <div className="errorBanner wide" role="alert">{error}</div> : null}
      {hasUnrouted ? <div className="warningBanner" role="alert">⚠ {copy.unroutedWarning}</div> : null}

      {data ? (
        <>
          <section className="summaryStrip" aria-label={copy.sections}>
            <Metric label={copy.assignedQuantity} value={data.summary.assigned_quantity_total} language={language} />
            <Metric label={copy.sections} value={config?.assigned_sections.length ?? 0} language={language} />
          </section>
          {data.sections.length === 0 ? <div className="emptyState">{copy.empty}</div> : (
            <section className={`sectionGrid${data.sections.length === 1 ? ' single' : ''}`}>
              {data.sections.map((section) => (
                <article className={`sectionCard${section.unrouted ? ' unrouted' : ''}`} key={`${section.section_id ?? 'none'}-${section.code}`}>
                  <header>
                    <div>
                      <p className="sectionCode">{section.code}</p>
                      <h2>{localizedName(section, language)}</h2>
                    </div>
                    <div className="sectionTotal">{formatQuantity(section.total_qty, language)}</div>
                  </header>
                  {section.is_packing ? <span className="packingBadge">{copy.packing}</span> : null}
                  <div className="mealList">
                    {section.meals.map((meal) => (
                      <div className="mealRow" key={`${meal.meal_id}-${meal.portion_size ?? ''}`}>
                        <div className="mealName">
                          <strong>{localizedName(meal, language) || meal.meal_id}</strong>
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

function localizedName(value: { name_ar: string | null; name_en: string | null; code?: string }, language: Language): string {
  return language === 'ar'
    ? value.name_ar ?? value.name_en ?? value.code ?? ''
    : value.name_en ?? value.name_ar ?? value.code ?? '';
}

function Metric({ label, value, language }: { label: string; value: number; language: Language }) {
  return <div className="metric"><span>{label}</span><strong>{formatQuantity(value, language)}</strong></div>;
}

function formatTime(value: string, language: Language): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-KW' : 'en-KW', {
    timeZone: 'Asia/Kuwait',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function errorMessage(error: unknown, language: Language): string {
  const copy = COPY[language];
  if (!(error instanceof ApiError)) return copy.network;
  if (error.code === 'kds_source_response_invalid') return copy.invalidSource;
  return copy.unavailable;
}
