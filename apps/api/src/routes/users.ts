import type { FastifyPluginAsync } from "fastify";

function directoryLabel(user: { email: string; displayName: string | null }) {
  return (user.displayName?.trim() || user.email).toLocaleLowerCase("ru");
}

// Справочник коллег для выбора адресата (песочница, отчёт). Без ролей и служебных полей.
export const userDirectoryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    const meId = req.auth?.id;
    if (!meId) {
      const err: any = new Error("UNAUTHORIZED");
      err.statusCode = 401;
      throw err;
    }

    const users = await app.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true, displayName: true }
    });
    users.sort((a, b) => directoryLabel(a).localeCompare(directoryLabel(b), "ru"));
    return { ok: true as const, users };
  });
};
