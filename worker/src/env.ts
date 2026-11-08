import type { TableRoom } from './table-room';
import type { UserHub } from './user-hub';
import type { VoiceRoom } from './voice-room';

export interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT: string;
  /** اختياري: حساب خدمة Play Console للتحقق من مشتريات أندرويد (وإلا حساب Firebase) */
  PLAY_SERVICE_ACCOUNT?: string;
  /** بصمات SHA-256 (مفصولة بفواصل) لإيميلات المطوّرين أصحاب العملات اللا محدودة */
  UNLIMITED_EMAIL_SHA256?: string;
  TABLES: DurableObjectNamespace<TableRoom>;
  HUBS: DurableObjectNamespace<UserHub>;
  /** غرفة المحادثة الصوتية لكل طاولة (مستقلة عن غرفة اللعب) */
  VOICES: DurableObjectNamespace<VoiceRoom>;
  /** للتطوير المحلي فقط (ملف .dev.vars): يسمح بتوكنات وهمية ويتجاوز العملات. لا يُضبط في الإنتاج أبداً. */
  DEV_AUTH?: string;
  /** "1" = نقبل مكافأة الإعلانات التجريبية بلا SSV (أثناء التطوير بإعلانات Google التجريبية فقط) */
  ADS_TEST_REWARDS?: string;
  /** Cloudflare Realtime (المحادثة الصوتية): معرّف التطبيق (ليس سرياً) ومفتاحه (سر) */
  REALTIME_APP_ID?: string;
  REALTIME_APP_SECRET?: string;
  /** شراء العملات في الآيفون: مفتاح In-App Purchase من App Store Connect (أسرار) */
  APPSTORE_IAP_KEY?: string;
  APPSTORE_IAP_KEY_ID?: string;
  APPSTORE_IAP_ISSUER_ID?: string;
}
