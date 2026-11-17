import { z } from 'zod';

import Base from './base.js';
import { Prisma } from '#prisma/client.js';

const UserAttributesSchema = z.object({
  firstName: z
    .string()
    .min(2, 'First name must be between 2 and 30 characters long')
    .max(30, 'First name must be between 2 and 30 characters long'),
  lastName: z
    .string()
    .min(2, 'Last name must be between 2 and 30 characters long')
    .max(30, 'Last name must be between 2 and 30 characters long'),
  email: z.string().email('Please enter a valid email address.'),
});

const UserRegisterSchema = UserAttributesSchema.extend({
  inviteId: z.string().uuid().optional(),
});

const UserResponseSchema = UserAttributesSchema.extend({
  id: z.string().uuid(),
  picture: z.string().nullable(),
  pictureUrl: z.string().nullable(),
  isAdmin: z.boolean(),
  emailVerified: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  banned: z.boolean(),
});

const UserUpdateSchema = UserAttributesSchema.pick({ firstName: true, lastName: true }).extend({
  picture: z.string().nullable(),
}).partial().strict();

export class User extends Base {
  static RegisterSchema = UserRegisterSchema;
  static ResponseSchema = UserResponseSchema;
  static UpdateSchema = UserUpdateSchema;

  constructor (data) {
    super(Prisma.UserScalarFieldEnum, data);
  }

  get pictureUrl () {
    return this.getAssetUrl('picture');
  }

  get isAdmin () {
    return this.role?.split(',').includes('admin') ?? false;
  }

  get isActive () {
    return this.emailVerified && !this.banned;
  }

  toJSON () {
    return UserResponseSchema.parse(this);
  }
}

export default User;
