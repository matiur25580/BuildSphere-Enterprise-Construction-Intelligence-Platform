import { useEffect, useState, type FormEvent } from "react";
import { CommercialWorkspace } from "./CommercialWorkspace.js";
import { FieldWorkspace } from "./FieldWorkspace.js";
import { DeliveryWorkspace } from "./DeliveryWorkspace.js";
import { IntelligenceWorkspace } from "./IntelligenceWorkspace.js";
import { CollaborationWorkspace } from "./CollaborationWorkspace.js";
import { OrganizationWorkspace } from "./OrganizationWorkspace.js";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api/v1";
type Session = {
  accessToken: string;
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; role: string };
};
type ApiResult<T> = { success: boolean; data?: T; message?: string };
type Project = {
  _id: string; code: string; name: string; clientName: string; location: string;
  status: "planning" | "active" | "on_hold" | "completed" | "cancelled";
  startDate: string; targetEndDate: string; budget: number; currency: string;
  workItemCount: number; completedWorkItems: number;
};

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);
  const [commercialProject, setCommercialProject] = useState<Project | null>(null);
  const [fieldProject, setFieldProject] = useState<Project | null>(null);
  const [deliveryProject, setDeliveryProject] = useState<Project | null>(null);
  const [intelligenceProject, setIntelligenceProject] = useState<Project | null>(null);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [projectForm, setProjectForm] = useState({
    code: "", name: "", clientName: "", location: "",
    startDate: new Date().toISOString().slice(0, 10),
    targetEndDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
    budget: "0", currency: "USD",
  });

  const loadProjects = async (token: string) => {
    setProjectsLoading(true);
    try {
      const result = await apiRequest<Project[]>("/projects", { method: "GET" }, token);
      setProjects(result.data ?? []);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Unable to load projects");
    } finally {
      setProjectsLoading(false);
    }
  };

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

  useEffect(() => {
    if (accessToken) void loadProjects(accessToken);
    else setProjects([]);
  }, [accessToken]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const path = mode === "register" ? "/auth/register" : "/auth/login";
      const body = mode === "register" ? { name, email, password, organizationName } : { email, password };
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

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken) return;
    setProjectBusy(true);
    setProjectError("");
    try {
      await apiRequest<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({ ...projectForm, budget: Number(projectForm.budget) }),
      }, accessToken);
      setShowCreate(false);
      setProjectForm({ code: "", name: "", clientName: "", location: "", startDate: new Date().toISOString().slice(0, 10), targetEndDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10), budget: "0", currency: "USD" });
      await loadProjects(accessToken);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Unable to create project");
    } finally {
      setProjectBusy(false);
    }
  };

  const signOut = async () => {
    try { await apiRequest("/auth/logout", { method: "POST" }, accessToken ?? undefined); }
    finally { setAccessToken(null); setSession(null); setPassword(""); }
  };

  if (initializing) return <main className="auth-shell"><div className="auth-card loading">Restoring secure session…</div></main>;

  if (session) {
    const activeCount = projects.filter((project) => project.status === "active").length;
    const totalBudget = projects.reduce((sum, project) => sum + project.budget, 0);
    return (
      <main className="app-shell">
        <header className="app-header">
          <a className="brand" href="/"><span className="brand-symbol">B</span>BuildSphere</a>
          <div className="header-actions"><span className="org-name">{session.organization?.name}</span><button className="ghost-button" onClick={() => void signOut()}>Sign out</button></div>
        </header>
        <section className="dashboard">
          <div className="dashboard-heading">
            <div><p className="eyebrow">PROJECT DELIVERY / OVERVIEW</p><h1>Good to see you, {session.name.split(" ")[0]}.</h1><p className="muted">Your organization's project portfolio at a glance.</p></div>
            <div className="dashboard-actions">{["owner", "admin"].includes(session.organization?.role ?? "") && <button className="ghost-button" onClick={() => setOrganizationOpen(true)}>Organization members</button>}<button className="ghost-button" onClick={() => setCollaborationOpen(true)}>Team inbox & activity</button><button className="primary-button" onClick={() => { setProjectError(""); setShowCreate((value) => !value); }}>＋ New project</button></div>
          </div>
          <div className="metric-grid">
            <article className="metric-card"><span>PORTFOLIO</span><strong>{projects.length}</strong><small>Projects in workspace</small></article>
            <article className="metric-card"><span>ACTIVE DELIVERY</span><strong>{activeCount}</strong><small>Projects currently active</small></article>
            <article className="metric-card"><span>COMMITTED BUDGET</span><strong>{new Intl.NumberFormat(undefined, { style: "currency", currency: projects[0]?.currency ?? "USD", maximumFractionDigits: 0 }).format(totalBudget)}</strong><small>Combined project budgets</small></article>
          </div>
          {showCreate && <section className="create-panel">
            <div className="panel-heading"><div><p className="eyebrow">PORTFOLIO SETUP</p><h2>Create a project</h2></div><button className="ghost-button" type="button" onClick={() => setShowCreate(false)}>Close</button></div>
            <form className="project-form" onSubmit={(event) => void createProject(event)}>
              <label>Project code<input required minLength={2} maxLength={24} value={projectForm.code} onChange={(e) => setProjectForm({ ...projectForm, code: e.target.value.toUpperCase() })} placeholder="e.g. BS-001" /></label>
              <label>Project name<input required minLength={2} value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} placeholder="Riverside Commercial Tower" /></label>
              <label>Client<input value={projectForm.clientName} onChange={(e) => setProjectForm({ ...projectForm, clientName: e.target.value })} placeholder="Client organization" /></label>
              <label>Location<input value={projectForm.location} onChange={(e) => setProjectForm({ ...projectForm, location: e.target.value })} placeholder="City, country" /></label>
              <label>Start date<input type="date" required value={projectForm.startDate} onChange={(e) => setProjectForm({ ...projectForm, startDate: e.target.value })} /></label>
              <label>Target completion<input type="date" required value={projectForm.targetEndDate} onChange={(e) => setProjectForm({ ...projectForm, targetEndDate: e.target.value })} /></label>
              <label>Budget<input type="number" min="0" step="0.01" value={projectForm.budget} onChange={(e) => setProjectForm({ ...projectForm, budget: e.target.value })} /></label>
              <label>Currency<input required minLength={3} maxLength={3} value={projectForm.currency} onChange={(e) => setProjectForm({ ...projectForm, currency: e.target.value.toUpperCase() })} /></label>
              {projectError && <p className="form-error project-form-error" role="alert">{projectError}</p>}
              <button className="submit-button project-submit" disabled={projectBusy}>{projectBusy ? "Creating…" : "Create project"}</button>
            </form>
          </section>}
          <div className="section-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>Project portfolio</h2></div><span className="count-label">{projects.length} TOTAL</span></div>
          {projectError && !showCreate && <p className="form-error" role="alert">{projectError}</p>}
          {projectsLoading ? <div className="empty-state">Loading portfolio…</div> : projects.length === 0 ? <div className="empty-state"><span className="empty-icon">▦</span><h3>Your portfolio starts here</h3><p>Create your first project to begin organizing scope, milestones, and delivery progress.</p><button className="primary-button" onClick={() => setShowCreate(true)}>Create your first project</button></div> :
            <div className="project-grid">{projects.map((project) => {
              const progress = project.workItemCount ? Math.round(project.completedWorkItems / project.workItemCount * 100) : 0;
              return <article className="project-card" key={project._id}>
                <div className="project-card-top"><span className="project-code">{project.code}</span><span className={`status-pill status-${project.status}`}>{project.status.replace("_", " ")}</span></div>
                <h3>{project.name}</h3><p className="project-client">{project.clientName || "Client not assigned"}{project.location ? ` · ${project.location}` : ""}</p>
                <div className="project-dates"><span>START <b>{new Date(project.startDate).toLocaleDateString()}</b></span><span>TARGET <b>{new Date(project.targetEndDate).toLocaleDateString()}</b></span></div>
                <div className="progress-caption"><span>Work item completion</span><b>{progress}%</b></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                <div className="project-card-footer"><span>{project.completedWorkItems}/{project.workItemCount} work items complete</span><b>{new Intl.NumberFormat(undefined, { style: "currency", currency: project.currency, maximumFractionDigits: 0 }).format(project.budget)}</b></div><button className="commercial-open" onClick={() => setCommercialProject(project)}>Manage commercial</button><button className="field-open" onClick={() => setFieldProject(project)}>Field operations</button><button className="delivery-open" onClick={() => setDeliveryProject(project)}>Quality & approvals</button><button className="intelligence-open" onClick={() => setIntelligenceProject(project)}>AI project intelligence</button>
              </article>;
            })}</div>}
          {commercialProject && accessToken && <CommercialWorkspace project={commercialProject} token={accessToken} onClose={() => setCommercialProject(null)} />}
          {fieldProject && accessToken && <FieldWorkspace project={fieldProject} token={accessToken} onClose={() => setFieldProject(null)} />}
          {deliveryProject && accessToken && <DeliveryWorkspace project={deliveryProject} token={accessToken} onClose={() => setDeliveryProject(null)} />}
          {intelligenceProject && accessToken && <IntelligenceWorkspace project={intelligenceProject} token={accessToken} onClose={() => setIntelligenceProject(null)} />}
          {collaborationOpen && accessToken && <CollaborationWorkspace projects={projects} token={accessToken} canManageMembers={["owner", "admin", "project_manager"].includes(session.organization?.role ?? "")} onClose={() => setCollaborationOpen(false)} />}
          {organizationOpen && accessToken && session.organization && <OrganizationWorkspace token={accessToken} role={session.organization.role} onClose={() => setOrganizationOpen(false)} />}
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-aside">
        <a className="brand" href="/"><span className="brand-symbol">B</span>BuildSphere</a>
        <div className="aside-copy"><p className="eyebrow">CONSTRUCTION INTELLIGENCE PLATFORM</p><h1>Every project.<br /><span>One clear picture.</span></h1><p>Bring teams, site operations, commercial control, and delivery intelligence together.</p></div>
        <span className="aside-foot">BUILT FOR COMPLEX PROJECT DELIVERY</span>
      </section>
      <section className="auth-main"><div className="auth-card">
        <p className="eyebrow">{mode === "login" ? "WELCOME BACK" : "GET STARTED"}</p><h2>{mode === "login" ? "Sign in to BuildSphere" : "Create your workspace"}</h2><p className="muted">{mode === "login" ? "Access your organization's project workspace." : "Set up your account and organization."}</p>
        <div className="auth-tabs"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>Sign in</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setMessage(""); }}>Create account</button></div>
        <form onSubmit={(event) => void submit(event)}>
          {mode === "register" && <><label htmlFor="name">Full name</label><input id="name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your full name" /><label htmlFor="organization">Organization name</label><input id="organization" required minLength={2} maxLength={120} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="e.g. Northstar Construction" /></>}
          <label htmlFor="email">Work email</label><input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
          <label htmlFor="password">Password</label><input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "At least 12 characters" : "Enter your password"} />
          {message && <p className="form-error" role="alert">{message}</p>}<button className="submit-button" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in securely" : "Create organization"}</button>
        </form><p className="fine-print">Protected with secure password hashing and rotating refresh sessions.</p>
      </div></section>
    </main>
  );
}

export default App;
