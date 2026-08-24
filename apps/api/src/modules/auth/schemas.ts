import { z } from 'zod';

/**
 * Password rules follow NIST SP 800-63B: length beats composition, and the
 * meaningful check is against passwords that are already public. No forced
 * symbols, no maximum-that-is-actually-a-truncation.
 */
const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'letmein123', 'iloveyou', 'admin123', 'welcome123', 'passw0rd',
  'changeme', 'football', 'baseball', 'dragonfly', 'sunshine', 'princess',
  'qwerty123', 'monkey123', 'abc12345', 'trustno1', 'starwars', 'whatever',
]);

export const emailSchema = z
  .string()
  .trim()
  .min(3, 'Enter your email address.')
  .max(254, 'That email is too long.')
  .toLowerCase()
  .email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Keep it under 128 characters.')
  .refine((v) => v.trim().length === v.length || v.trim().length >= 10, 'Padding with spaces does not count.')
  .refine((v) => !COMMON.has(v.toLowerCase()), 'That password appears in every breach list — pick another.')
  .refine((v) => new Set(v).size > 3, 'Too repetitive — mix it up a little.');

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z
      .string()
      .trim()
      .min(1, 'Tell us what to call you.')
      .max(80, 'Keep it under 80 characters.'),
  })
  .refine((v) => !v.password.toLowerCase().includes(v.email.split('@')[0]!.toLowerCase()), {
    path: ['password'],
    message: 'Your password should not contain your email address.',
  });

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: never apply new-password rules to a login attempt,
  // it leaks the policy and locks out anyone who predates a rule change.
  password: z.string().min(1, 'Enter your password.').max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(200),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'That is the same password.',
  });

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  accent: z.enum(['ember', 'basalt', 'moss', 'lapis', 'clay', 'ash']).optional(),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Confirm with your password.').max(200),
  confirm: z.literal('delete my account', {
    errorMap: () => ({ message: 'Type "delete my account" to confirm.' }),
  }),
});
