import { useCallback, useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api/v1";
type Project = { _id: string; name: string; code: string };
type Notification = { _id: string; summary: string; eventType: string; createdAt: string; readAt: string | null };
type Activity = { _id: string; summary: string; eventType: string; createdAt: string; actorId?: { name?: string } };
type ProjectMember = { _id: string; role: string; status: string; userId: { _id: string; name: string; email: string } };
type EligibleMember = { _id: string; name: string; email: string };

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options, credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
  const result = await response.json() as { success: boolean; data: T; message?: string };
  if (!response.ok) throw new Error(result.message ?? "Unable to load collaboration data");
  return result.data;
}

export function CollaborationWorkspace({ projects, token, canManageMembers, onClose }: { projects: Project[]; token: string; canManageMembers: boolean; onClose: () => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [eligible, setEligible] = useState<EligibleMember[]>([]);
  const [newMemberId, setNewMemberId] = useState("");
  const [memberRole, setMemberRole] = useState("contributor");
  const [unread, setUnread] = useState(0);
  const [selectedProject, setSelectedProject] = useState(projects[0]?._id ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadInbox = useCallback(async () => {
    const [inbox, count] = await Promise.all([
      request<{ items: Notification[] }>("/notifications?limit=30&page=1", token),
      request<{ unread: number }>("/notifications/unread-count", token),
    ]);
    setNotifications(inbox.items);
    setUnread(count.unread);
  }, [token]);

  const loadMembers = useCallback(async () => {
    if (!selectedProject) { setMembers([]); setEligible([]); return; }
    const [current, candidates] = await Promise.all([
      request<ProjectMember[]>(`/projects/${selectedProject}/members`, token),
      canManageMembers ? request<EligibleMember[]>(`/projects/${selectedProject}/members/eligible`, token) : Promise.resolve([]),
    ]);
    setMembers(current);
    setEligible(candidates);
  }, [selectedProject, token, canManageMembers]);

  const loadActivity = useCallback(async () => {
    if (!selectedProject) { setActivity([]); return; }
    const result = await request<{ items: Activity[] }>(`/projects/${selectedProject}/collaboration/activity?limit=30&page=1`, token);
    setActivity(result.items);
  }, [selectedProject, token]);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { await Promise.all([loadInbox(), loadActivity(), loadMembers()]); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load collaboration data"); }
    finally { setLoading(false); }
  }, [loadInbox, loadActivity, loadMembers]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addMember = async () => {
    if (!selectedProject || !newMemberId) return;
    try {
      await request(`/projects/${selectedProject}/members`, token, { method: "POST", body: JSON.stringify({ userId: newMemberId, role: memberRole }) });
      setNewMemberId("");
      await loadMembers();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to add project member"); }
  };

  const markRead = async (id: string) => {
    try {
      await request("/notifications/read", token, { method: "PATCH", body: JSON.stringify({ notificationIds: [id] }) });
      await loadInbox();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to mark notification read"); }
  };

  return <section className="collab-overlay">
    <div className="collab-panel">
      <header className="collab-header">
        <div><p className="eyebrow">TEAM COLLABORATION</p><h2>Activity & notifications</h2><p className="muted">Project updates and your personal inbox.</p></div>
        <button className="ghost-button" onClick={onClose}>Close</button>
      </header>
      <div className="collab-summary"><strong>{unread}</strong><span>unread notifications</span><button className="ghost-button" onClick={() => void refresh()}>Refresh</button></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="muted">Loading collaboration feed…</p> : <div className="collab-columns">
        <section className="collab-list"><div className="panel-heading"><h3>Inbox</h3><span className="count-label">{notifications.length} recent</span></div>
          {notifications.length === 0 ? <p className="muted">You're all caught up.</p> : notifications.map(item => <article className={`collab-item ${item.readAt ? "" : "unread"}`} key={item._id}>
            <div><strong>{item.summary}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div>
            {!item.readAt && <button className="ghost-button" onClick={() => void markRead(item._id)}>Mark read</button>}
          </article>)}
        </section>
        <section className="collab-list"><div className="panel-heading"><h3>Project activity</h3>
          <select aria-label="Select project activity" value={selectedProject} onChange={e => setSelectedProject(e.target.value)}>
            {projects.map(p => <option value={p._id} key={p._id}>{p.code} · {p.name}</option>)}
          </select>
        </div>
          {activity.length === 0 ? <p className="muted">No recorded activity for this project yet.</p> : activity.map(item => <article className="activity-item" key={item._id}>
            <span className="activity-dot" /><div><strong>{item.summary}</strong><small>{item.actorId?.name ?? "Team member"} · {new Date(item.createdAt).toLocaleString()}</small></div>
          </article>)}
        </section>
      </div>}
      <section className="collab-list collab-members">
        <div className="panel-heading"><h3>Project team</h3><span className="count-label">{members.length} members</span></div>
        {members.length === 0 ? <p className="muted">No project members yet. Add a teammate to enable assignment notifications.</p> : members.map(member => <article className="collab-item" key={member._id}><div><strong>{member.userId.name}</strong><small>{member.userId.email} · {member.role.replace("_", " ")} · {member.status}</small></div></article>)}
        {canManageMembers && <div className="member-add-form">
          <select aria-label="Choose organization member" value={newMemberId} onChange={e => setNewMemberId(e.target.value)}>
            <option value="">Choose a teammate…</option>{eligible.map(user => <option value={user._id} key={user._id}>{user.name} · {user.email}</option>)}
          </select>
          <select aria-label="Project role" value={memberRole} onChange={e => setMemberRole(e.target.value)}><option value="contributor">Contributor</option><option value="project_manager">Project manager</option><option value="viewer">Viewer</option></select>
          <button className="primary-button" disabled={!newMemberId} onClick={() => void addMember()}>Add to project</button>
        </div>}
      </section>
      <p className="fine-print">Assignment and activity notifications are delivered through the persisted outbox to active project members. Real-time push is not enabled; refresh to retrieve updates.</p>
    </div>
  </section>;
}
