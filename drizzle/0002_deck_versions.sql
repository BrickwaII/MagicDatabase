CREATE TABLE "deck_versions" (
	"group_id" text NOT NULL,
	"id" text NOT NULL,
	"deck_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"started_on" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"list_url" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_versions_group_id_id_pk" PRIMARY KEY("group_id","id"),
	CONSTRAINT "deck_versions_deck_no_unique" UNIQUE("group_id","deck_id","version_no"),
	CONSTRAINT "deck_versions_deck_date_unique" UNIQUE("group_id","deck_id","started_on"),
	CONSTRAINT "deck_versions_no_check" CHECK ("deck_versions"."version_no" >= 2)
);
--> statement-breakpoint
ALTER TABLE "deck_versions" ADD CONSTRAINT "deck_versions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_versions" ADD CONSTRAINT "deck_versions_group_id_deck_id_decks_group_id_id_fk" FOREIGN KEY ("group_id","deck_id") REFERENCES "public"."decks"("group_id","id") ON DELETE cascade ON UPDATE cascade;