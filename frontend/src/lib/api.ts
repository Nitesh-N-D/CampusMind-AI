import { useAuthStore } from "./authStore";
import { toastError } from "./toastStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("cm_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Used when the response has no readable detail, e.g. an HTML error page
// from the hosting proxy while the server restarts.
function fallbackMessage(status: number): string {
  if (status === 413) return "That file is too large to upload.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status === 502 || status === 503 || status === 504)
    return "The CampusMind server is starting up or briefly unavailable. Please try again in a minute.";
  if (status >= 500) return "Something went wrong on our end. Please try again.";
  return "Something went wrong. Please try again.";
}

// fetch only rejects when no response arrived at all: server down, wrong
// API address, offline, or blocked by CORS.
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(
      "Can't reach the CampusMind server. Check your internet connection and try again.",
      0
    );
  }
}

async function handle<T>(res: Response, sentToken: boolean): Promise<T> {
  if (!res.ok) {
    let detail = fallbackMessage(res.status);
    let requestId: string | undefined;
    try {
      const body = await res.json();
      if (typeof body.detail === "string" && body.detail) detail = body.detail;
      if (typeof body.request_id === "string") requestId = body.request_id;
    } catch {
      // not JSON - keep the status-based message
    }
    // A signed-in request rejected as unauthenticated means the session is
    // over; sign out so the route guard sends the user to the login page.
    // (A 401 from the login form itself carries no token and is left alone.)
    if (res.status === 401 && sentToken && useAuthStore.getState().isAuthenticated) {
      useAuthStore.getState().logout();
      toastError(detail);
    }
    if (res.status >= 500 && requestId) detail += ` (Reference: ${requestId})`;
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const auth = authHeaders();
  const res = await send(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...auth } });
  return handle<T>(res, "Authorization" in auth);
}

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(API_BASE + path);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    });
  }
  return request<T>(url.toString());
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(API_BASE + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function del<T>(path: string): Promise<T> {
  return request<T>(API_BASE + path, { method: "DELETE" });
}

async function postForm<T>(path: string, form: FormData): Promise<T> {
  return request<T>(API_BASE + path, { method: "POST", body: form });
}

// Fetches a generated file with the user's token and saves it under the
// server-chosen filename.
async function download(path: string, params: [string, string][], fallbackName: string): Promise<void> {
  const url = new URL(API_BASE + path);
  params.forEach(([k, v]) => url.searchParams.append(k, v));
  const auth = authHeaders();
  const res = await send(url.toString(), { headers: auth });
  if (!res.ok) await handle<never>(res, "Authorization" in auth);
  const disposition = res.headers.get("Content-Disposition") || "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

// ---- Types mirrored from backend/app/schemas/schemas.py ----

export interface TokenResponse {
  access_token: string;
  token_type: string;
  role: "admin" | "student" | "faculty";
  college_id: number;
  college_name: string;
  full_name: string;
}

export interface DocumentOut {
  id: number;
  title: string;
  document_type: string;
  department: string | null;
  academic_year: string | null;
  semester: number | null;
  published_date: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  version: number;
  is_official: boolean;
  is_verified: boolean;
  trust_level: "very_high" | "high" | "medium" | "low";
  trust_score: number;
  status: "uploaded" | "processing" | "ready" | "failed" | "archived";
  is_demo_data: boolean;
  page_count: number;
  file_type: "pdf" | "word" | "excel" | "presentation" | "csv" | "text" | "image" | "unknown";
  processing_error?: string | null;
  created_at: string;
}

export interface Citation {
  document_id: number;
  document_title: string;
  page: number | null;
  section: string | null;
  trust_level: string | null;
  trust_score: number;
  department: string | null;
}

export interface ConflictInfo {
  id: number;
  topic: string;
  value_a: string;
  value_b: string;
  reasoning: string;
}

export interface ChatResponse {
  session_id: number;
  message_id: number;
  answer: string;
  citations: Citation[];
  confidence: number;
  has_conflict: boolean;
  conflicts: ConflictInfo[];
  retrieval_ms: number;
  llm_ms: number;
  abstained: boolean;
}

export interface ChatSessionOut {
  id: number;
  title: string;
  created_at: string;
}

export interface ChatMessageOut {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  confidence: number | null;
  has_conflict: boolean;
  created_at: string;
}

export interface KnowledgeHealth {
  health_score: number;
  documents_indexed: number;
  verified: number;
  outdated: number;
  conflicting: number;
  unprocessed: number;
  low_confidence_topics: number;
}

export interface ConflictRecord {
  id: number;
  topic: string;
  document_a_id: number;
  value_a: string;
  document_b_id: number;
  value_b: string;
  suggested_authoritative_id: number | null;
  reasoning: string;
  status: string;
  created_at: string;
}

export interface Analytics {
  total_questions_answered: number;
  unanswered_questions: number;
  low_confidence_responses: number;
  top_queries: { query: string; count: number }[];
  recent_uploads: { id: number; title: string; status: string; created_at: string }[];
}

export interface LoginEvent {
  id: number;
  user_id: number;
  full_name: string;
  email: string;
  role: "student" | "faculty";
  event_type: "login" | "register";
  created_at: string;
}

export interface LoginEventPage {
  items: LoginEvent[];
  total: number;
  page: number;
  page_size: number;
}

export interface WorkspaceSettings {
  college_name: string;
  official_domain: string;
  faculty_domain: string | null;
}

export interface Profile {
  id: number;
  email: string;
  full_name: string;
  nickname: string | null;
  role: string;
  department: string | null;
  year: number | null;
  semester: number | null;
  section: string | null;
  academic_batch: string | null;
  interests: string[];
  preferred_language: string;
}

export const api = {
  auth: {
    registerCollege: (data: {
      college_name: string;
      official_domain: string;
      admin_email: string;
      admin_full_name: string;
      admin_password: string;
    }) => post<TokenResponse>("/api/auth/register-college", data),
    registerStudent: (data: {
      email: string;
      full_name: string;
      password: string;
      role?: "student" | "faculty";
      department?: string;
      year?: number;
      semester?: number;
      section?: string;
    }) => post<TokenResponse>("/api/auth/register-student", data),
    login: (data: { email: string; password: string }) =>
      post<TokenResponse>("/api/auth/login", data),
  },
  documents: {
    list: (params?: { department?: string; document_type?: string }) =>
      get<DocumentOut[]>("/api/documents", params),
    upload: (form: FormData) => postForm<DocumentOut>("/api/documents/upload", form),
    remove: (id: number) => del<{ status: string }>(`/api/documents/${id}`),
    verify: (id: number) => post<DocumentOut>(`/api/documents/${id}/verify`),
  },
  chat: {
    send: (data: { message: string; session_id: number | null; language: string }) =>
      post<ChatResponse>("/api/chat/message", data),
    sessions: () => get<ChatSessionOut[]>("/api/chat/sessions"),
    messages: (sessionId: number) =>
      get<ChatMessageOut[]>(`/api/chat/sessions/${sessionId}/messages`),
    deleteSession: (sessionId: number) =>
      del<{ status: string }>(`/api/chat/sessions/${sessionId}`),
    feedback: (messageId: number, feedback: "up" | "down", note?: string) =>
      post(`/api/chat/messages/${messageId}/feedback`, { feedback, note }),
    exportHistory: (sessionIds: number[], format: "pdf" | "txt") =>
      download(
        "/api/chat/export",
        [
          ...sessionIds.map((id): [string, string] => ["session_id", String(id)]),
          ["format", format],
          // getTimezoneOffset() is minutes *behind* UTC; the API wants ahead.
          ["tz_offset", String(-new Date().getTimezoneOffset())],
        ],
        `campusmind-chat.${format}`
      ),
  },
  profile: {
    me: () => get<Profile>("/api/profile/me"),
    update: (data: Partial<Profile>) => put<Profile>("/api/profile/me", data),
    remove: () => del<{ status: string }>("/api/profile/me"),
  },
  admin: {
    knowledgeHealth: () => get<KnowledgeHealth>("/api/admin/knowledge-health"),
    conflicts: () => get<ConflictRecord[]>("/api/admin/conflicts"),
    resolveConflict: (id: number, authoritative_document_id: number, resolution_note?: string) =>
      post(`/api/admin/conflicts/${id}/resolve`, { authoritative_document_id, resolution_note }),
    analytics: () => get<Analytics>("/api/admin/analytics"),
    loginEvents: (params: { role?: string; start?: string; end?: string; page?: string; page_size?: string }) =>
      get<LoginEventPage>("/api/admin/login-events", params),
    exportUsers: (format: "csv" | "xlsx") =>
      download(
        "/api/admin/users/export",
        [
          ["format", format],
          ["tz_offset", String(-new Date().getTimezoneOffset())],
        ],
        `campusmind-accounts.${format}`
      ),
    settings: () => get<WorkspaceSettings>("/api/admin/settings"),
    setFacultyDomain: (faculty_domain: string | null) =>
      put<WorkspaceSettings>("/api/admin/settings/faculty-domain", { faculty_domain }),
  },
};

export { API_BASE };
