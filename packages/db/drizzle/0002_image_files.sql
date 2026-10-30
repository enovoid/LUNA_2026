CREATE TABLE "image_files" (
	"key" text PRIMARY KEY NOT NULL,
	"body" "bytea" NOT NULL,
	"content_type" text DEFAULT 'image/webp' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
