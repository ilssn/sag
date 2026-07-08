export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export type SourceStatus = "active" | "paused" | "error";
export type SourceType = "document" | "web" | "message" | "audio";
export interface Source {
  id: string;
  name: string;
  description: string;
  source_type: SourceType;
  connector_kind: string;
  status: SourceStatus;
  document_count: number;
  chunk_count: number;
  event_count: number;
  created_at: string;
  updated_at: string;
}

export interface Connector {
  kind: string;
  title: string;
  description: string;
  supports_sync: boolean;
  config_fields: Array<Record<string, unknown>>;
}

export type DocumentStatus =
  | "pending"
  | "loading"
  | "extracting"
  | "ready"
  | "failed";

export interface Doc {
  id: string;
  source_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: DocumentStatus;
  chunk_count: number;
  event_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  n: number;
  chunk_id: string | null;
  heading: string;
  snippet: string;
  score: number;
  source_id: string | null;
  source_name?: string | null;
}

export type BindingTargetType = "source" | "mcp_server";

export interface Persona {
  system_prompt?: string;
  greeting?: string;
  tools?: string[];
}

export interface Agent {
  id: string;
  name: string;
  avatar: string;
  persona: Persona;
  created_at: string;
  updated_at: string;
}

export interface Binding {
  id: string;
  target_type: BindingTargetType;
  target_id: string;
  config: Record<string, unknown>;
}

export interface SourceMcpDescriptor {
  source_id: string;
  source_name: string;
  tools: string[];
  http: { transport: string; url: string; note: string };
  stdio: { command: string; args: string[]; env: Record<string, string>; note: string };
}

export interface Thread {
  id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Citation[];
  created_at: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  description: string;
  heat: number;
}

export interface Section {
  chunk_id: string | null;
  heading: string;
  content: string;
  score: number;
  rank: number;
  source_id: string | null;
  source_name?: string | null;
}

export interface SearchResponse {
  query: string;
  sections: Section[];
  stats: Record<string, unknown>;
}

export interface Capabilities {
  llm_configured: boolean;
  llm_model: string;
  embedding_model: string;
  vector_provider: string;
  language: string;
  search_strategy: string;
  max_upload_mb: number;
  allowed_upload_exts?: string[];
}
