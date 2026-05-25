import type { Http } from "@workspace/core/services/http";
import type { Options } from "ky";
import { z } from "zod";

const AUTH_PASSWORD_MIN_LENGTH = 8;
const AUTH_NAME_MIN_LENGTH = 3;

// #region ENTITY
export const authSessionSchema = z.object({
  createdAt: z.string().date(),
  expiresAt: z.string().date(),
  id: z.string(),
  ipAddress: z.string(),
  token: z.string(),
  updatedAt: z.string().date(),
  userAgent: z.string(),
  userId: z.string(),
});
export type AuthSessionSchema = z.infer<typeof authSessionSchema>;

export const authUserSchema = z.object({
  createdAt: z.string().date(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  id: z.string(),
  image: z.string().nullable(),
  name: z.string(),
  updatedAt: z.string().date(),
});
export type AuthUserSchema = z.infer<typeof authUserSchema>;
// #endregion ENTITY

// #region API SCHEMAS
export const authGetSessionResponseSchema = z
  .object({
    session: authSessionSchema,
    user: authUserSchema,
  })
  .nullable();
export type AuthGetSessionResponseSchema = z.infer<
  typeof authGetSessionResponseSchema
>;

export const authSignUpEmailRequestSchema = z.object({
  callbackURL: z.string().optional(),
  email: z.email(),
  name: z.string().min(AUTH_NAME_MIN_LENGTH),
  password: z.string().min(AUTH_PASSWORD_MIN_LENGTH),
});
export type AuthSignUpEmailRequestSchema = z.infer<
  typeof authSignUpEmailRequestSchema
>;

export const authSignUpEmailResponseSchema = z.object({
  token: z.string().nullable(),
});
export type AuthSignUpEmailResponseSchema = z.infer<
  typeof authSignUpEmailResponseSchema
>;

export const authSignInEmailRequestSchema = authSignUpEmailRequestSchema
  .omit({
    name: true,
  })
  .extend({
    rememberMe: z.boolean(),
  });
export type AuthSignInEmailRequestSchema = z.infer<
  typeof authSignInEmailRequestSchema
>;

export const authSignInEmailResponseSchema = z.object({
  redirect: z.boolean(),
  token: z.string(),
  url: z.string().nullable(),
});
export type AuthSignInEmailResponseSchema = z.infer<
  typeof authSignInEmailResponseSchema
>;

export const authSignOutResponseSchema = z.object({
  success: z.boolean(),
});
export type AuthSignOutResponseSchema = z.infer<
  typeof authSignOutResponseSchema
>;
// #endregion API SCHEMAS

export const authKeys = {
  all: () => ["auth"] as const,
  signInEmail: (params: AuthSignInEmailRequestSchema | undefined) =>
    [...authKeys.all(), "signInEmail", ...(params ? [params] : [])] as const,
  signOut: () => [...authKeys.all(), "signOut"] as const,
  signUpEmail: (params: AuthSignUpEmailRequestSchema | undefined) =>
    [...authKeys.all(), "signUpEmail", ...(params ? [params] : [])] as const,
};

export const authRepositories = (http: InstanceType<typeof Http>) =>
  ({
    /**
     * GET ${ENV.API_BASE_URL}/api/auth/get-session
     *
     * @access public
     * @throws HTTPError | TimeoutError | ZodError
     */
    getSession: async (options?: Options) => {
      const resp = await http.instance.get("api/auth/get-session", {
        ...options,
      });
      const json = await resp.json();
      const parsed = authGetSessionResponseSchema.parse(json);

      return { headers: resp.headers, json: parsed };
    },

    /**
     * POST ${ENV.API_BASE_URL}/api/auth/sign-in/email
     *
     * @access public
     * @throws HTTPError | TimeoutError | ZodError
     */
    signInEmail: async (
      options?: Options & { json: AuthSignInEmailRequestSchema }
    ) => {
      const resp = await http.instance.post("api/auth/sign-in/email", {
        ...options,
      });
      const json = await resp.json();
      const parsed = authSignInEmailResponseSchema.parse(json);

      return { headers: resp.headers, json: parsed };
    },

    /**
     * POST ${ENV.API_BASE_URL}/api/auth/sign-out
     *
     * @access public
     * @throws HTTPError | TimeoutError | ZodError
     */
    signOut: async (options?: Options) => {
      const resp = await http.instance.post("api/auth/sign-out", {
        ...options,
      });
      const json = await resp.json();
      const parsed = authSignOutResponseSchema.parse(json);

      return { headers: resp.headers, json: parsed };
    },

    /**
     * POST ${ENV.API_BASE_URL}/api/auth/sign-up/email
     *
     * @access public
     * @throws HTTPError | TimeoutError | ZodError
     */
    signUpEmail: async (
      options?: Options & { json: AuthSignUpEmailRequestSchema }
    ) => {
      const resp = await http.instance.post("api/auth/sign-up/email", {
        ...options,
      });
      const json = await resp.json();
      const parsed = authSignUpEmailResponseSchema.parse(json);

      return { headers: resp.headers, json: parsed };
    },
  }) as const;
