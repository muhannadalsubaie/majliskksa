import type { TableRoom } from './table-room';
import type { UserHub } from './user-hub';

export interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT: string;
  /** بصمات SHA-256 (مفصولة بفواصل) لإيميلات المطوّرين أصحاب العملات اللا محدودة */
  UNLIMITED_EMAIL_SHA256?: string;
  TABLES: DurableObjectNamespace<TableRoom>;
  HUBS: DurableObjectNamespace<UserHub>;
  /** للتطوير المحلي فقط (ملف .dev.vars): يسمح بتوكنات وهمية ويتجاوز العملات. لا يُضبط في الإنتاج أبداً. */
  DEV_AUTH?: string;
}
