export * from "./lookups";
export * from "./users";
export * from "./gyms";
export * from "./memberships";
export * from "./attendance";
export * from "./scheduling";
export * from "./workouts";
export * from "./diet";
export * from "./analytics";
export * from "./communications";
export * from "./support";
export * from "./reviews";
export * from "./files";
export * from "./audit";
export * from "./security";
export * from "./ai";
export * from "./inbody";

import * as usersSchema from "./users";
import * as gymsSchema from "./gyms";
import * as membershipsSchema from "./memberships";
import * as attendanceSchema from "./attendance";
import * as schedulingSchema from "./scheduling";
import * as workoutsSchema from "./workouts";
import * as dietSchema from "./diet";
import * as analyticsSchema from "./analytics";
import * as communicationsSchema from "./communications";
import * as supportSchema from "./support";
import * as reviewsSchema from "./reviews";
import * as filesSchema from "./files";
import * as auditSchema from "./audit";
import * as securitySchema from "./security";
import * as aiSchema from "./ai";
import * as inbodySchema from "./inbody";

export const schema = {
  ...usersSchema,
  ...gymsSchema,
  ...membershipsSchema,
  ...attendanceSchema,
  ...schedulingSchema,
  ...workoutsSchema,
  ...dietSchema,
  ...analyticsSchema,
  ...communicationsSchema,
  ...supportSchema,
  ...reviewsSchema,
  ...filesSchema,
  ...auditSchema,
  ...securitySchema,
  ...aiSchema,
  ...inbodySchema,
};
