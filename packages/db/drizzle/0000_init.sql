CREATE TABLE "awards" (
	"id" serial PRIMARY KEY NOT NULL,
	"notion_id" text NOT NULL,
	"notion_last_edited_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"year" text,
	"prize" text DEFAULT '' NOT NULL,
	"team" text DEFAULT '' NOT NULL,
	"member_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"date" date,
	"prize_money" integer,
	"image_key" text,
	"image_width" integer,
	"image_height" integer,
	CONSTRAINT "awards_notion_id_unique" UNIQUE("notion_id")
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"notion_id" text NOT NULL,
	"notion_last_edited_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question" text NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "faqs_notion_id_unique" UNIQUE("notion_id")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"notion_id" text NOT NULL,
	"notion_last_edited_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"luna_generation" text,
	"description" text DEFAULT '' NOT NULL,
	"position" text,
	"school_generation" text,
	"class_name" text,
	"image_key" text,
	"image_width" integer,
	"image_height" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "members_notion_id_unique" UNIQUE("notion_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"notion_id" text NOT NULL,
	"notion_last_edited_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"year" text,
	"description" text DEFAULT '' NOT NULL,
	"image_key" text,
	"image_width" integer,
	"image_height" integer,
	"award_names" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "projects_notion_id_unique" UNIQUE("notion_id")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"database" text PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_result" jsonb,
	"last_error" text
);
