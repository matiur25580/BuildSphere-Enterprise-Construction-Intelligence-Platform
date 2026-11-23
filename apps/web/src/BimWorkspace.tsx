import { useEffect, useState, type FormEvent } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api/v1";
type Project = { _id: string; code: string; name: string };
type DocumentVersion = { version: number; fileName: string; fileAssetId?: string | null };
type ControlledDocument = { _id: string; documentNo: string; title: string; currentVersion: number; versions: DocumentVersion[] };
type BimModel = { _id: string; modelName: string; discipline: string; revision: string; ifcSchema: string; modelVersion: number; checksum: string; documentId: { documentNo: string; title: string } | string };
type BimIssue = { _id: string; reference: string; title: string; description: string; issueType: string; priority: string; status: string; ifcGlobalId: string; location: string; modelVersion: number; modelId: { modelName: string; discipline: string } | string; dueDate?: string | null; history: { status: string; comment: string; actedAt: string }[]; viewpoint?: { selectedComponents?: string[] } | null };
async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof Blob)) headers.set("Content-Type", "application/json");
  headers.set("Authorization", "Bearer " + token);
  const response = await fetch(API_URL + path, { ...options, headers, credentials: "include" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Request failed");
  return result.data as T;
}

export function BimWorkspace({ project, token }: { project: Project; token: string }) {
  const base = "/projects/" + project._id + "/bim";
  const [models, setModels] = useState<BimModel[]>([]);
  const [issues, setIssues] = useState<BimIssue[]>([]);
  const [documents, setDocuments] = useState<ControlledDocument[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modelForm, setModelForm] = useState({ documentId: "", modelName: "", discipline: "architecture", revision: "A", ifcSchema: "IFC4", description: "" });
  const [issueForm, setIssueForm] = useState({ modelId: "", reference: "", title: "", description: "", issueType: "clash", priority: "high", ifcGlobalId: "", location: "", viewpoint: "" });
  const refresh = async () => {
    setLoading(true);
    try {
      const [m, i, d] = await Promise.all([
        request<BimModel[]>(base + "/models", token),
        request<BimIssue[]>(base + "/issues", token),
        request<ControlledDocument[]>("/projects/" + project._id + "/delivery/documents", token),
      ]);
      setModels(m); setIssues(i); setDocuments(d);
      if (!issueForm.modelId && m[0]) setIssueForm((current) => ({ ...current, modelId: m[0]._id }));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load BIM coordination"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [project._id, token]);
  const modelDocuments = documents.filter((document) => document.versions.some((version) => version.version === document.currentVersion && Boolean(version.fileAssetId) && version.fileName.toLowerCase().endsWith(".ifc")));
  const registerModel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await request(base + "/models", token, { method: "POST", body: JSON.stringify(modelForm) });
      setModelForm({ ...modelForm, documentId: "", modelName: "", revision: "A", description: "" });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to register IFC model"); }
    finally { setSaving(false); }
  };
  const createIssue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      let viewpoint: unknown = null;
      if (issueForm.viewpoint.trim()) viewpoint = JSON.parse(issueForm.viewpoint);
      await request(base + "/issues", token, { method: "POST", body: JSON.stringify({ ...issueForm, ifcGlobalId: issueForm.ifcGlobalId || undefined, viewpoint }) });
      setIssueForm({ ...issueForm, reference: "", title: "", description: "", ifcGlobalId: "", location: "", viewpoint: "" });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create coordination issue"); }
    finally { setSaving(false); }
  };
  const transition = async (issue: BimIssue, status: string) => {
    try { await request(base + "/issues/" + issue._id + "/status", token, { method: "PATCH", body: JSON.stringify({ status, comment: "Updated from BIM coordination workspace" }) }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to update coordination issue"); }
  };
  const modelName = (issue: BimIssue) => typeof issue.modelId === "string" ? "Model " + issue.modelId.slice(-6) : issue.modelId.modelName;
  const canTransition = (issue: BimIssue) => issue.status === "open" ? "in_progress" : issue.status === "in_progress" ? "resolved" : issue.status === "resolved" ? "closed" : issue.status === "closed" ? "reopened" : issue.status === "reopened" ? "in_progress" : "";
  return <section className="bim-workspace">
    <div className="bim-intro"><div><p className="eyebrow">OPEN BIM · CDE COORDINATION</p><h3>Model coordination hub</h3><p>Register controlled IFC revisions, link issues to model elements, and preserve coordination context as structured viewpoints.</p></div><div className="bim-counts"><strong>{models.length}</strong><span>registered models</span><strong>{issues.filter((issue) => !["closed", "resolved"].includes(issue.status)).length}</strong><span>active issues</span></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p className="muted">Loading BIM coordination records…</p> : <>
      <div className="bim-forms">
        <form className="delivery-form" onSubmit={(event) => void registerModel(event)}>
          <h3>Register controlled IFC model</h3>
          <label>Controlled IFC document<select required value={modelForm.documentId} onChange={(event) => setModelForm({ ...modelForm, documentId: event.target.value })}><option value="">Choose a scanned IFC document</option>{modelDocuments.map((document) => <option key={document._id} value={document._id}>{document.documentNo} · {document.title} · v{document.currentVersion}</option>)}</select></label>
          <label>Model name<input required value={modelForm.modelName} onChange={(event) => setModelForm({ ...modelForm, modelName: event.target.value })} placeholder="Tower A — structural model"/></label>
          <div className="delivery-form-grid"><label>Discipline<select value={modelForm.discipline} onChange={(event) => setModelForm({ ...modelForm, discipline: event.target.value })}>{["architecture","structure","mechanical","electrical","plumbing","civil","landscape","federated","other"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Revision<input required value={modelForm.revision} onChange={(event) => setModelForm({ ...modelForm, revision: event.target.value })}/></label><label>IFC schema<select value={modelForm.ifcSchema} onChange={(event) => setModelForm({ ...modelForm, ifcSchema: event.target.value })}><option>IFC2X3</option><option>IFC4</option><option>IFC4X3</option><option>unknown</option></select></label></div>
          <label>Description<input value={modelForm.description} onChange={(event) => setModelForm({ ...modelForm, description: event.target.value })} placeholder="Scope, zone or federation context"/></label>
          <button className="submit-button" disabled={saving || !modelDocuments.length}>{saving ? "Saving…" : "Register model revision"}</button>
          {!modelDocuments.length && <small className="muted">First register a controlled document and upload a malware-scanned .ifc file in the Documents tab.</small>}
        </form>
        <form className="delivery-form" onSubmit={(event) => void createIssue(event)}>
          <h3>Create model coordination issue</h3>
          <label>Model<select required value={issueForm.modelId} onChange={(event) => setIssueForm({ ...issueForm, modelId: event.target.value })}><option value="">Choose a model</option>{models.map((model) => <option key={model._id} value={model._id}>{model.modelName} · {model.discipline} · v{model.modelVersion}</option>)}</select></label>
          <div className="delivery-form-grid"><label>Issue reference<input required value={issueForm.reference} onChange={(event) => setIssueForm({ ...issueForm, reference: event.target.value })} placeholder="BCF-001"/></label><label>Type<select value={issueForm.issueType} onChange={(event) => setIssueForm({ ...issueForm, issueType: event.target.value })}><option value="clash">Clash</option><option value="design_query">Design query</option><option value="site_condition">Site condition</option><option value="constructability">Constructability</option><option value="coordination">Coordination</option></select></label><label>Priority<select value={issueForm.priority} onChange={(event) => setIssueForm({ ...issueForm, priority: event.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label></div>
          <label>Title<input required value={issueForm.title} onChange={(event) => setIssueForm({ ...issueForm, title: event.target.value })}/></label>
          <label>Description<textarea required minLength={10} value={issueForm.description} onChange={(event) => setIssueForm({ ...issueForm, description: event.target.value })}/></label>
          <div className="delivery-form-grid"><label>IFC GlobalId (optional)<input value={issueForm.ifcGlobalId} onChange={(event) => setIssueForm({ ...issueForm, ifcGlobalId: event.target.value })} placeholder="22-character IFC GUID"/></label><label>Level / zone<input value={issueForm.location} onChange={(event) => setIssueForm({ ...issueForm, location: event.target.value })} placeholder="Level 04 · Grid C5"/></label></div>
          <label>BCF-style viewpoint JSON (optional)<textarea className="bim-viewpoint-input" value={issueForm.viewpoint} onChange={(event) => setIssueForm({ ...issueForm, viewpoint: event.target.value })} placeholder='{"camera":{"position":{"x":0,"y":0,"z":10},"direction":{"x":0,"y":0,"z":-1},"up":{"x":0,"y":1,"z":0}},"selectedComponents":[],"hiddenComponents":[]}'/></label>
          <button className="submit-button" disabled={saving || !models.length}>{saving ? "Saving…" : "Create coordination issue"}</button>
          <small className="muted">Viewpoints are stored as structured camera and IFC component references; this is not a 3D viewer or full BCF file exchange.</small>
        </form>
      </div>
      <h3 className="delivery-subheading">Registered model revisions</h3>
      <div className="bim-model-list">{models.map((model) => <article key={model._id}><div><b>{model.modelName}</b><span>{model.discipline} · {model.ifcSchema} · Rev {model.revision} · v{model.modelVersion}</span><small>SHA-256 · {model.checksum}</small></div><span className="bim-revision">Controlled revision</span></article>)}{!models.length && <p className="muted">No IFC models registered. Add a scanned IFC file through Document Control to get started.</p>}</div>
      <h3 className="delivery-subheading">Coordination issue register</h3>
      <div className="bim-issue-list">{issues.map((issue) => { const next = canTransition(issue); return <article key={issue._id}><div className="bim-issue-heading"><b>{issue.reference} · {issue.title}</b><span className={"bim-priority " + issue.priority}>{issue.priority}</span></div><p>{issue.description}</p><div className="bim-issue-meta"><span>{modelName(issue)} · model v{issue.modelVersion}</span><span>{issue.issueType.replaceAll("_"," ")} · {issue.status}</span>{issue.ifcGlobalId && <code>IFC GlobalId: {issue.ifcGlobalId}</code>}{issue.location && <span>{issue.location}</span>}</div>{issue.viewpoint && <small className="muted">Structured viewpoint captured · {issue.viewpoint.selectedComponents?.length ?? 0} selected component(s)</small>}<div className="bim-issue-actions">{issue.history.slice(-2).map((entry,index) => <small key={index}>{entry.status} · {new Date(entry.actedAt).toLocaleString()}</small>)}{next && <button type="button" className="record-action" onClick={() => void transition(issue,next)}>{next.replaceAll("_"," ")}</button>}</div></article>; })}{!issues.length && <p className="muted">No coordination issues yet.</p>}</div>
    </>}
  </section>;
}
