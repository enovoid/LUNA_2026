import { sql } from 'drizzle-orm';
import { date, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

/** 모든 Notion 원본 테이블이 공유하는 열. 제약 이름이 테이블마다 달라지도록 호출 때마다 새로 만든다. */
const notionColumns = () => ({
  id: serial('id').primaryKey(),
  notionId: text('notion_id').notNull().unique(),
  notionLastEditedAt: timestamp('notion_last_edited_at', { withTimezone: true }).notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 이미지 열. image_key는 R2 키 접두어 `<table>/<sha256>`이며
 * 실제 파일은 `<image_key>-480.webp`, `-960.webp`, `-1600.webp`. 너비·높이는 원본 기준.
 */
const imageColumns = () => ({
  imageKey: text('image_key'),
  imageWidth: integer('image_width'),
  imageHeight: integer('image_height'),
});

export const members = pgTable('members', {
  ...notionColumns(),
  name: text('name').notNull(),
  lunaGeneration: text('luna_generation'),
  description: text('description').notNull().default(''),
  position: text('position'),
  schoolGeneration: text('school_generation'),
  className: text('class_name'),
  ...imageColumns(),
  sort: integer('sort').notNull().default(0),
});

export const awards = pgTable('awards', {
  ...notionColumns(),
  name: text('name').notNull(),
  year: text('year'),
  prize: text('prize').notNull().default(''),
  team: text('team').notNull().default(''),
  memberNames: text('member_names').array().notNull().default(sql`'{}'::text[]`),
  date: date('date', { mode: 'string' }),
  prizeMoney: integer('prize_money'),
  ...imageColumns(),
});

export const projects = pgTable('projects', {
  ...notionColumns(),
  name: text('name').notNull(),
  year: text('year'),
  description: text('description').notNull().default(''),
  ...imageColumns(),
  awardNames: text('award_names').array().notNull().default(sql`'{}'::text[]`),
});

export const faqs = pgTable('faqs', {
  ...notionColumns(),
  question: text('question').notNull(),
  answer: text('answer').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** Notion 데이터베이스(members/awards/projects/faq)별 마지막 동기화 상태. */
export const syncState = pgTable('sync_state', {
  database: text('database').primaryKey(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastResult: jsonb('last_result'),
  lastError: text('last_error'),
});

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type Award = typeof awards.$inferSelect;
export type NewAward = typeof awards.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Faq = typeof faqs.$inferSelect;
export type NewFaq = typeof faqs.$inferInsert;
export type SyncState = typeof syncState.$inferSelect;
