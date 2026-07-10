import type { Prisma, UserActivityAction } from "@prisma/client";

export async function logUserActivity(
  db: {
    userActivityLog: {
      create: (args: { data: any }) => Promise<unknown>;
    };
  },
  params: {
    userId?: string | null;
    actor: string;
    action: UserActivityAction;
    reason?: string | null;
    title?: string | null;
    sourceKind?: "prod" | "sandbox";
    sandboxId?: string | null;
    sandboxName?: string | null;
    changes?: Prisma.InputJsonValue;
  }
) {
  const sourceKind = params.sourceKind ?? (params.sandboxId ? "sandbox" : "prod");
  await db.userActivityLog.create({
    data: {
      userId: params.userId ?? null,
      actor: params.actor.slice(0, 80),
      action: params.action,
      reason: params.reason ?? null,
      title: params.title ?? null,
      sourceKind,
      sandboxId: params.sandboxId ?? null,
      sandboxName: params.sandboxName ?? null,
      changes: params.changes ?? undefined
    }
  });
}
