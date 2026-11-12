"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/data";
import { regenerateShareToken, setPublicStats } from "@/lib/share";

async function run(fn: () => Promise<unknown>) {
  let error: string | undefined;
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }
  revalidatePath("/admin");
  redirect(error ? `/admin?error=${encodeURIComponent(error)}#share` : "/admin#share");
}

export async function setPublicStatsAction(formData: FormData) {
  const actor = await requireAdmin();
  await run(() => setPublicStats(formData.get("enabled") === "on", actor));
}

export async function regenerateShareLinkAction() {
  const actor = await requireAdmin();
  await run(() => regenerateShareToken(actor));
}
