/** Cihazlar (uzaktan CLI köprüsü) tipleri; sunucu yanıtlarının sade yansıması. */
export interface LinkDevice {
  id: string;
  name: string;
  platform: string;
  version: string;
  capabilities?: string[];
  online: boolean;
  sessions: number;
}
export interface LinkSession {
  deviceId: string;
  deviceName: string;
  id: string;
  title: string;
  directory: string;
  status: 'idle' | 'busy' | 'waiting';
  updatedAt: string;
  online: boolean;
}
export interface LinkPart {
  type: string;
  text?: string;
  tool?: string;
  status?: string;
  title?: string;
  input?: string;
  output?: string;
  files?: string[];
  filename?: string;
}
export interface LinkMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: LinkPart[];
}
export interface LinkPending {
  kind: 'permission' | 'question';
  requestId: string;
  permission?: string;
  patterns?: string[];
  questions?: string;
}
export interface LinkCommand {
  id: string;
  kind: string;
  status: 'pending' | 'sent' | 'done' | 'failed' | 'expired';
  error: string | null;
}
export interface LinkDetail {
  session: LinkSession;
  messages: LinkMessage[];
  pending: LinkPending[];
  commands: LinkCommand[];
}
