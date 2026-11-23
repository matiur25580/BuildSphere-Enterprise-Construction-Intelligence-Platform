import { useEffect, useState, type FormEvent } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api/v1";
type Project = { _id: string; code: string; name: string; budget: number; currency: string };
type Summary = { projectBudget: number; allocatedBudget: number; costCodeCount: number; purchaseOrders: number; invoices: number; paymentClaims: number; paid: number; pending: number; remainingBudget: number };
type CostCode = { _id: string; code: string; name: string; budget: number; currency: string };
type RecordItem = { _id: string; type: string; reference: string; counterparty: string; amount: number; currency: string; status: string; issueDate: string };

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", "Bearer " + token);
  const response = await fetch(API_URL + path, { ...options, headers, credentials: "include" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Request failed");
  return result.data as T;
}

export function CommercialWorkspace({ project, token, onClose }: { project: Project; token: string; onClose: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [record, setRecord] = useState({ type: "purchase_order", reference: "", counterparty: "", amount: "", currency: project.currency || "USD", issueDate: new Date().toISOString().slice(0,10), dueDate: "", costCodeId: "" });
  const [code, setCode] = useState({ code: "", name: "", budget: "0", currency: project.currency || "USD" });

  const refresh = async () => {
    setLoading(true);
    try {
      const base = "/projects/" + project._id + "/commercial";
      const [s, c, r] = await Promise.all([
        request<Summary>(base + "/summary", token),
        request<CostCode[]>(base + "/cost-codes", token),
        request<RecordItem[]>(base + "/records", token),
      ]);
      setSummary(s); setCodes(c); setRecords(r); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load commercial data"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [project._id, token]);

  const submitRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await request("/projects/" + project._id + "/commercial/records", token, { method: "POST", body: JSON.stringify({ ...record, amount: Number(record.amount), dueDate: record.dueDate || null, costCodeId: record.costCodeId || null }) });
      setRecord({ ...record, reference: "", counterparty: "", amount: "", dueDate: "" });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save record"); }
  };
  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await request("/projects/" + project._id + "/commercial/cost-codes", token, { method: "POST", body: JSON.stringify({ ...code, budget: Number(code.budget) }) });
      setCode({ ...code, code: "", name: "", budget: "0" });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save cost code"); }
  };
  const money = (amount: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  const moveStatus = async (item: RecordItem, status: string) => {
    try {
      await request("/projects/" + project._id + "/commercial/records/" + item._id + "/status", token, { method: "PATCH", body: JSON.stringify({ status }) });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update status"); }
  };

  return <section className="commercial-panel">
    <div className="panel-heading"><div><p className="eyebrow">COMMERCIAL CONTROL / {project.code}</p><h2>{project.name} · Financials</h2></div><button className="ghost-button" onClick={onClose}>Close</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p className="muted">Loading commercial workspace…</p> : <>
      {summary && <div className="commercial-metrics">
        <article><span>PROJECT BUDGET</span><b>{money(summary.projectBudget, project.currency)}</b></article>
        <article><span>PO COMMITMENTS</span><b>{money(summary.purchaseOrders, project.currency)}</b></article>
        <article><span>PAID</span><b>{money(summary.paid, project.currency)}</b></article>
        <article><span>REMAINING AFTER POs</span><b>{money(summary.remainingBudget, project.currency)}</b></article>
      </div>}
      <div className="commercial-columns">
        <form className="commercial-form" onSubmit={(e) => void submitRecord(e)}>
          <h3>Record a commercial item</h3>
          <label>Record type<select value={record.type} onChange={(e) => setRecord({ ...record, type: e.target.value })}><option value="purchase_order">Purchase order</option><option value="invoice">Invoice</option><option value="payment_claim">Payment claim</option></select></label>
          <label>Reference<input required value={record.reference} onChange={(e) => setRecord({ ...record, reference: e.target.value })} placeholder="PO-2026-001" /></label>
          <label>Supplier / counterparty<input required value={record.counterparty} onChange={(e) => setRecord({ ...record, counterparty: e.target.value })} placeholder="Company name" /></label>
          <label>Amount<input required type="number" min="0.01" step="0.01" value={record.amount} onChange={(e) => setRecord({ ...record, amount: e.target.value })} /></label>
          <label>Cost code<select value={record.costCodeId} onChange={(e) => setRecord({ ...record, costCodeId: e.target.value })}><option value="">Unassigned</option>{codes.map((item) => <option key={item._id} value={item._id}>{item.code} · {item.name}</option>)}</select></label>
          <label>Issue date<input required type="date" value={record.issueDate} onChange={(e) => setRecord({ ...record, issueDate: e.target.value })} /></label>
          <label>Due date<input type="date" value={record.dueDate} onChange={(e) => setRecord({ ...record, dueDate: e.target.value })} /></label>
          <button className="submit-button">Save commercial item</button>
        </form>
        <form className="commercial-form" onSubmit={(e) => void submitCode(e)}>
          <h3>Add a cost code</h3>
          <label>Code<input required value={code.code} onChange={(e) => setCode({ ...code, code: e.target.value.toUpperCase() })} placeholder="03-100" /></label>
          <label>Name<input required value={code.name} onChange={(e) => setCode({ ...code, name: e.target.value })} placeholder="Concrete works" /></label>
          <label>Allocated budget<input required type="number" min="0" step="0.01" value={code.budget} onChange={(e) => setCode({ ...code, budget: e.target.value })} /></label>
          <button className="submit-button">Create cost code</button>
          <h3 className="subheading">Cost codes ({codes.length})</h3>
          {codes.map((item) => <div className="cost-code-row" key={item._id}><span><b>{item.code}</b> · {item.name}</span><strong>{money(item.budget, item.currency)}</strong></div>)}
        </form>
      </div>
      <h3 className="subheading">Commercial register ({records.length})</h3>
      <div className="records-list">{records.map((item) => <article className="record-row" key={item._id}><div><b>{item.reference}</b><span>{item.type.replace("_", " ")} · {item.counterparty}</span></div><div><strong>{money(item.amount, item.currency)}</strong><span className={"status-pill status-" + (item.status === "paid" ? "completed" : item.status === "rejected" ? "cancelled" : "planning")}>{item.status}</span>{item.status === "draft" && <button type="button" className="record-action" onClick={() => void moveStatus(item, "submitted")}>Submit</button>}{item.status === "submitted" && <><button type="button" className="record-action" onClick={() => void moveStatus(item, "approved")}>Approve</button><button type="button" className="record-action reject-action" onClick={() => void moveStatus(item, "rejected")}>Reject</button></>}{item.status === "approved" && <button type="button" className="record-action" onClick={() => void moveStatus(item, "paid")}>Mark paid</button>}</div></article>)}</div>
    </>}
  </section>;
}
