"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ErrorCode, fail, ok, type ActionResponse } from "@/lib/action-response";
import { ResponseService } from "@/services/response.service";

const SetFlagInput = z.object({
  id: z.string().min(1),
  brandSlug: z.string().min(1),
  flagged: z.boolean(),
});

export async function setResponseFlag(input: {
  id: string;
  brandSlug: string;
  flagged: boolean;
}): Promise<ActionResponse<{ id: string; flagged: boolean }>> {
  const parsed = SetFlagInput.safeParse(input);

  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_FAILED, parsed.error.issues[0].message);
  }

  try {
    const row = await ResponseService.setFlagged(parsed.data.id, parsed.data.flagged);
    if (!row) {
      return fail(ErrorCode.NOT_FOUND, "That feedback is no longer available.");
    }

    revalidatePath(`/brands/${parsed.data.brandSlug}`);
    return ok(row);
  } catch (error) {
    console.error("[setResponseFlag] failed", error);
    return fail(ErrorCode.UNKNOWN, "Could not update the flag. Please try again.");
  }
}
