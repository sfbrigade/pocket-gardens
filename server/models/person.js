import { z } from "zod";

import Base from "./base.js";
import { Prisma } from "#prisma/client.js";

const PersonResponseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

class Person extends Base {
  static ResponseSchema = PersonResponseSchema;

  constructor(data) {
    super(Prisma.PersonScalarFieldEnum, data);
  }
}

export { Person };

export default Person;
