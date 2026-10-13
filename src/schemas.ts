import { z, ZodError } from 'zod'

export const User = z.object({
  id: z.string().uuid(),
  email: z.string().email({ message: 'Invalid email' }),
  name: z.string().min(1, { message: 'Required' }),
  age: z.number().int().nonnegative().optional(),
  website: z.string().url().nullable(),
  tags: z.array(z.string()).nonempty(),
  role: z.enum(['admin', 'user']),
  meta: z.record(z.string()),
})
export type User = z.infer<typeof User>

export const Settings = z
  .object({
    theme: z.string().default('light'),
    notifications: z.boolean(),
  })
  .strict()

export const Loose = z.object({ a: z.string() }).passthrough()

export const Signup = z
  .object({ password: z.string(), confirm: z.string() })
  .superRefine((val, ctx) => {
    if (val.password !== val.confirm) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Passwords must match', path: ['confirm'] })
    }
  })

export const Extended = User.merge(z.object({ createdAt: z.date() }))

export const Port = z.string().transform((s) => parseInt(s, 10)).pipe(z.number().max(65535))

export const Status = z.nativeEnum({ Active: 'active', Disabled: 'disabled' } as const)

export function parseUser(input: unknown): User | string {
  const result = User.safeParse(input)
  if (!result.success) {
    return result.error.flatten().formErrors.join(', ') || result.error.errors.map((e) => e.message).join('; ')
  }
  return result.data
}

export function describe(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
  }
  return String(err)
}

export const errorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.invalid_type) return { message: 'Wrong type' }
  return { message: ctx.defaultError }
}
z.setErrorMap(errorMap)
