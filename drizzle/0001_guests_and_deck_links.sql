ALTER TABLE "decks" ADD COLUMN "list_url" text;--> statement-breakpoint
ALTER TABLE "game_seats" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "game_seats" ADD COLUMN "guest_deck" text;--> statement-breakpoint
ALTER TABLE "game_seats" ADD COLUMN "guest_added_by" text;--> statement-breakpoint
ALTER TABLE "game_seats" ADD CONSTRAINT "game_seats_guest_added_by_fk" FOREIGN KEY ("group_id","guest_added_by") REFERENCES "public"."players"("group_id","id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "game_seats" ADD CONSTRAINT "game_seats_guest_fields_check" CHECK ("game_seats"."player_id" is null or ("game_seats"."guest_name" is null and "game_seats"."guest_deck" is null and "game_seats"."guest_added_by" is null));