import { useCallback, useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api/v1";
type Project = { _id: string; name: string; code: string };
type Notification = { _id: string; summary: string; eventType: string; createdAt: string; readAt: string | null };
type Activity = { _id: string; summary: string; eventType: string; createdAt: string; actorId?: { name?: string } };

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options, credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
  const result = await response.json() as { success: boolean; data: T; message?: string };
  if (!response.ok) throw new Error(result.message ?? "Unable to load collaboration data");
  return result.data;
}

export function CollaborationWorkspace({ projects, token, onClose }: { projects: Project[]; token: string; onClose: () => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
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

  const loadActivity = useCallback(async () => {
    if (!selectedProject) { setActivity([]); return; }
    const result = await request<{ items: Activity[] }>(`/projects/${selectedProject}/collaboration/activity?limit=30&page=1`, token);
    setActivity(result.items);
  }, [selectedProject, token]);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { await Promise.all([loadInbox(), loadActivity()]); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load collaboration data"); }
    finally { setLoading(false); }
  }, [loadInbox, loadActivity]);

  useEffect(() => { void refresh(); }, [refresh]);

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
      <p className="fine-print">Notifications are delivered to active organization members. Live push updates are not enabled; refresh to retrieve new events.</p>
    </div>
  </section>;
}
