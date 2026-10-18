export type Effort = 'low' | 'medium' | 'high';

export interface PendingAttachment {
  name: string;
  mime: string;
  text: string;
  truncated: boolean;
}
