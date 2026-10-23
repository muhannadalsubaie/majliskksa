import type { TableRoom } from './table-room';

export interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT: string;
  TABLES: DurableObjectNamespace<TableRoom>;
  /** للتطوير المحلي فقط (ملف .dev.vars): يسمح بتوكنات وهمية ويتجاوز العملات. لا يُضبط في الإنتاج أبداً. */
  DEV_AUTH?: string;
}
