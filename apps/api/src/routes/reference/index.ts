import type { FastifyPluginAsync } from "fastify";

import { operatorsRoutes } from "./operators.js";
import { aircraftTypesRoutes } from "./aircraft-types.js";
import { aircraftRoutes } from "./aircraft.js";
import { eventTypesRoutes } from "./event-types.js";
import { hangarsRoutes } from "./hangars.js";
import { layoutsRoutes } from "./layouts.js";
import { standsRoutes } from "./stands.js";
import { aircraftTypePaletteRoutes } from "./aircraft-type-palette.js";
import { skillsRoutes } from "./skills.js";
import { personsRoutes } from "./persons.js";
import { shiftsRoutes } from "./shifts.js";
import { materialsRoutes } from "./materials.js";
import { warehousesRoutes } from "./warehouses.js";

export const referenceRoutes: FastifyPluginAsync = async (app) => {
  await app.register(operatorsRoutes, { prefix: "/operators" });
  await app.register(aircraftTypesRoutes, { prefix: "/aircraft-types" });
  await app.register(aircraftRoutes, { prefix: "/aircraft" });
  await app.register(aircraftTypePaletteRoutes, { prefix: "/aircraft-type-palette" });
  await app.register(eventTypesRoutes, { prefix: "/event-types" });
  await app.register(hangarsRoutes, { prefix: "/hangars" });
  await app.register(layoutsRoutes, { prefix: "/layouts" });
  await app.register(standsRoutes, { prefix: "/stands" });
  await app.register(skillsRoutes, { prefix: "/skills" });
  await app.register(personsRoutes, { prefix: "/persons" });
  await app.register(shiftsRoutes, { prefix: "/shifts" });
  await app.register(materialsRoutes, { prefix: "/materials" });
  await app.register(warehousesRoutes, { prefix: "/warehouses" });
};

