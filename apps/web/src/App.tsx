import { useEffect, useState, type FormEvent } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api/v1";
type Session = {
  accessToken: string;
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; role: string };
};
type ApiResult<T> = { success: boolean; data?: T; message?: string };

async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<ApiResult<T>> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, credentials: "include", headers });
  const result = (await response.json()) as ApiResult<T>;
  if (!response.ok) throw new Error(result.message ?? "Something went wrong");
  return result;
}

function App() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [session, setSession] = useState<(Session["user"] & { organization?: Session["organization"] }) | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      try {
        const refreshed = await apiRequest<{ accessToken: string }>("/auth/refresh", { method: "POST" });
        if (!refreshed.data?.accessToken) return;
        const current = await apiRequest<{ user: Session["user"]; organization: Session["organization"] }>(
          "/auth/me", { method: "GET" }, refreshed.data.accessToken,
        );
        if (active && current.data) {
          setAccessToken(refreshed.data.accessToken);
          setSession({ ...current.data.user, organization: current.data.organization });
        }
      } catch {
        // No refresh cookie means there is no active browser session.
      } finally {
        if (active) setInitializing(false);
      }
    };
    void restoreSession();
    return () => { active = false; };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const path = mode === "register" ? "/auth/register" : "/auth/login";
      const body = mode === "register"
        ? { name, email, password, organizationName }
        : { email, password };
      const result = await apiRequest<Session>(path, { method: "POST", body: JSON.stringify(body) });
      if (result.data) {
        setAccessToken(result.data.accessToken);
        setSession({ ...result.data.user, organization: result.data.organization });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to authenticate");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST" }, accessToken ?? undefined);
    } finally {
      setAccessToken(null);
      setSession(null);
      setPassword("");
    }
  };

  if (initializing) return <main className="auth-shell"><div className="auth-card loading">Restoring secure session…</div></main>;

  if (session) {
    return (
      <main className="app-shell">
        <header className="app-header">
          <a className="brand" href="/"><span className="brand-symbol">B</span>BuildSphere</a>
          <button className="ghost-button" onClick={() => void signOut()}>Sign out</button>
        </header>
        <section className="welcome-panel">
          <p className="eyebrow">SECURE WORKSPACE</p>
          <h1>Welcome, {session.name.split(" ")[0]}.</h1>
          <p className="muted">Your organization workspace is ready for the next stage of project delivery.</p>
          <div className="workspace-card">
            <span className="workspace-label">ACTIVE ORGANIZATION</span>
            <strong>{session.organization?.name ?? "Your organization"}</strong>
            <span className="role-pill">{session.organization?.role ?? "member"}</span>
          </div>
          <p className="fine-print">Authenticated session · Access token held in memory · Refresh token protected by HttpOnly cookie</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-aside">
        <a className="brand" href="/"><span className="brand-symbol">B</span>BuildSphere</a>
        <div className="aside-copy">
          <p className="eyebrow">CONSTRUCTION INTELLIGENCE PLATFORM</p>
          <h1>Every project.<br /><span>One clear picture.</span></h1>
          <p>Bring teams, site operations, commercial control, and delivery intelligence together.</p>
        </div>
        <span className="aside-foot">BUILT FOR COMPLEX PROJECT DELIVERY</span>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <p className="eyebrow">{mode === "login" ? "WELCOME BACK" : "GET STARTED"}</p>
          <h2>{mode === "login" ? "Sign in to BuildSphere" : "Create your workspace"}</h2>
          <p className="muted">{mode === "login" ? "Access your organization's project workspace." : "Set up your account and organization."}</p>
          <div className="auth-tabs">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>Sign in</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setMessage(""); }}>Create account</button>
          </div>
          <form onSubmit={(event) => void submit(event)}>
            {mode === "register" && <>
              <label htmlFor="name">Full name</label>
              <input id="name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your full name" />
              <label htmlFor="organization">Organization name</label>
              <input id="organization" required minLength={2} maxLength={120} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="e.g. Northstar Construction" />
            </>}
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "At least 12 characters" : "Enter your password"} />
            {message && <p className="form-error" role="alert">{message}</p>}
            <button className="submit-button" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in securely" : "Create organization"}</button>
          </form>
          <p className="fine-print">Protected with secure password hashing and rotating refresh sessions.</p>
        </div>
      </section>
    </main>
  );
}

export default App;
