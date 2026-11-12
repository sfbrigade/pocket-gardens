import { z } from 'zod';

import Base from './base.js';
import { Prisma } from '#prisma/client.js';

const PersonResponseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

const AssignedPlotSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  streetAddress: z.string().nullable(),
  status: z.string().nullable(),
});

const PersonDetailResponseSchema = PersonResponseSchema.extend({
  homeZipCode: z.string().nullable(),
  assignedPlots: z.array(AssignedPlotSchema),
});

class Person extends Base {
  static ResponseSchema = PersonResponseSchema;
  static DetailResponseSchema = PersonDetailResponseSchema;

  constructor (data) {
    super(Prisma.PersonScalarFieldEnum, data);
  }
}

export { Person };

export default Person;
