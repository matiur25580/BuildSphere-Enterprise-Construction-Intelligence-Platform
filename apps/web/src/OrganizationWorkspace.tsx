import { useCallback, useEffect, useState, type FormEvent } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api/v1";
type OrganizationMember = {
  _id: string;
  role: "owner" | "admin" | "project_manager" | "member" | "viewer";
  status: "active" | "invited" | "suspended";
  userId: { _id: string; name: string; email: string; status: string; lastLoginAt?: string | null };
};
type MemberRole = OrganizationMember["role"];

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options, credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
  const result = await response.json() as { success: boolean; data: T; message?: string };
  if (!response.ok) throw new Error(result.message ?? "Unable to manage organization members");
  return result.data;
}

export function OrganizationWorkspace({ token, role, onClose }: { token: string; role: string; onClose: () => void }) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<MemberRole>("member");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isOwner = role === "owner";

  const load = useCallback(async () => {
    setLoading(true);
    try { setMembers(await request<OrganizationMember[]>("/organization/members", token)); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load members"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      await request<OrganizationMember>("/organization/members", token, { method: "POST", body: JSON.stringify({ email, role: newRole }) });
      setEmail(""); setNotice("Organization member added."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to add member"); }
    finally { setSaving(false); }
  };

  const updateMember = async (member: OrganizationMember) => {
    setSaving(true); setError(""); setNotice("");
    try {
      await request<OrganizationMember>(`/organization/members/${member._id}`, token, {
        method: "PATCH", body: JSON.stringify({ role: member.role, status: member.status }),
      });
      setNotice(`Updated access for ${member.userId.name}.`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update member"); }
    finally { setSaving(false); }
  };

  const changeMember = (id: string, patch: Partial<Pick<OrganizationMember, "role" | "status">>) =>
    setMembers((current) => current.map((member) => member._id === id ? { ...member, ...patch } : member));

  return (
    <div className="collab-overlay" role="presentation">
      <section className="collab-panel organization-panel" role="dialog" aria-modal="true" aria-labelledby="organization-title">
        <header className="collab-header"><div><p className="eyebrow">WORKSPACE ADMINISTRATION</p><h2 id="organization-title">Organization members</h2><p className="muted">Manage organization-level access for existing BuildSphere accounts.</p></div><button className="ghost-button" onClick={onClose}>Close</button></header>
        <div className="organization-notice"><strong>{members.filter((member) => member.status === "active").length}</strong><span>active memberships · {members.length} total</span></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="organization-success" role="status">{notice}</p>}
        <form className="organization-add-form" onSubmit={(event) => void addMember(event)}>
          <div><label htmlFor="member-email">Existing BuildSphere account email</label><input id="member-email" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="colleague@company.com" /></div>
          <div><label htmlFor="member-role">Organization role</label><select id="member-role" value={newRole} onChange={(event) => setNewRole(event.target.value as MemberRole)}>
            {isOwner && <><option value="owner">Owner</option><option value="admin">Administrator</option></>}
            <option value="project_manager">Project manager</option><option value="member">Member</option><option value="viewer">Viewer</option>
          </select></div>
          <button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add member"}</button>
        </form>
        <div className="organization-member-list">
          {loading ? <p className="muted">Loading organization members…</p> : members.map((member) => {
            const elevated = member.role === "owner" || member.role === "admin";
            const canEdit = isOwner || !elevated;
            return <article className="organization-member-row" key={member._id}>
              <div className="organization-member-identity"><strong>{member.userId.name}</strong><small>{member.userId.email}</small><small>Account: {member.userId.status} · Last login: {member.userId.lastLoginAt ? new Date(member.userId.lastLoginAt).toLocaleDateString() : "Never"}</small></div>
              <div className="organization-member-controls">
                <select aria-label={`Role for ${member.userId.email}`} disabled={!canEdit || saving} value={member.role} onChange={(event) => changeMember(member._id, { role: event.target.value as MemberRole })}>
                  {isOwner && <><option value="owner">Owner</option><option value="admin">Administrator</option></>}
                  <option value="project_manager">Project manager</option><option value="member">Member</option><option value="viewer">Viewer</option>
                </select>
                <select aria-label={`Status for ${member.userId.email}`} disabled={!canEdit || saving} value={member.status === "invited" ? "suspended" : member.status} onChange={(event) => changeMember(member._id, { status: event.target.value as "active" | "suspended" })}>
                  <option value="active">Active</option><option value="suspended">Suspended</option>
                </select>
                <button className="ghost-button" disabled={!canEdit || saving} onClick={() => void updateMember(member)}>Save</button>
              </div>
            </article>;
          })}
          {!loading && members.length === 0 && <p className="muted">No organization members yet.</p>}
        </div>
        <p className="fine-print">Only existing active BuildSphere accounts can be added. Invitations by email, account recovery and multi-organization switching are not part of this release. At least one active organization owner is always retained.</p>
      </section>
    </div>
  );
}
