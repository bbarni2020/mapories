import "dotenv/config";

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import {
  Prisma,
  PrismaClient,
  Role,
  SubscriptionTier,
} from "@prisma/client";
import argon2 from "argon2";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import { OAuth2Client } from "google-auth-library";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(32),
  APP_DATA_KEY: z.string().length(64),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_ALLOWED_HD: z.string().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

const env = envSchema.parse(process.env);
const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const prisma = new PrismaClient();
const appDataKey = Buffer.from(env.APP_DATA_KEY, "hex");

if (appDataKey.length !== 32) {
  throw new Error("APP_DATA_KEY must decode to 32 bytes");
}

const app = Fastify({ logger: true, trustProxy: true });
const googleClient = env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(env.GOOGLE_CLIENT_ID)
  : null;

await app.register(sensible);
await app.register(cookie, {
  hook: "onRequest",
});
await app.register(cors, {
  origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  credentials: true,
});
await app.register(jwt, {
  secret: env.JWT_SECRET,
});
await app.register(rateLimit, {
  global: true,
  max: 250,
  timeWindow: "1 minute",
});
await app.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

const ACCESS_COOKIE = "mapories_at";
const REFRESH_COOKIE = "mapories_rt";
const CSRF_COOKIE = "mapories_csrf";
const cookieSecure = env.COOKIE_SECURE ?? false;

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const addOneMonth = (input: Date): Date => {
  const next = new Date(input);
  next.setMonth(next.getMonth() + 1);
  return next;
};

const getTokenHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const encryptString = (value: string): Buffer => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", appDataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
};

const decryptString = (payload: Buffer): string => {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", appDataKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};

const lookupHash = (value: string): string =>
  createHmac("sha256", appDataKey).update(value).digest("hex");

const checksum = (value: Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const AUTO_JOURNAL_PREFIX = "auto:";

const normalizeJournalName = (value: string): string => value.trim().replace(/\s+/g, " ");

const asBoundedJournalName = (value: string): string => {
  if (value.length <= 120) {
    return value;
  }

  return `${value.slice(0, 117)}...`;
};

const isAutoJournalName = (value: string): boolean => value.startsWith(AUTO_JOURNAL_PREFIX);

const buildParticipantsJournalName = async (journalId: string): Promise<string> => {
  const members = await prisma.journalMember.findMany({
    where: { journalId },
    select: {
      joinedAt: true,
      user: {
        select: {
          nameEncrypted: true,
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  const names = members
    .map((member) => decryptString(member.user.nameEncrypted).trim())
    .filter((name) => name.length > 0)
    .slice(0, 6);
  const fallback = `${AUTO_JOURNAL_PREFIX}Journal`;

  if (!names.length) {
    return fallback;
  }

  return asBoundedJournalName(`${AUTO_JOURNAL_PREFIX}${names.join(" & ")}`);
};

const asDisplayJournalName = (value: string): string =>
  isAutoJournalName(value) ? value.slice(AUTO_JOURNAL_PREFIX.length) : value;

const getAuth = (request: FastifyRequest): { userId: string; role: Role } => {
  const payload = request.user as { sub: string; role: Role };
  return { userId: payload.sub, role: payload.role };
};

const ensureAuth = async (request: FastifyRequest): Promise<void> => {
  await request.jwtVerify();
};

const ensureRole =
  (allowed: Role[]) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await ensureAuth(request);
    const { role } = getAuth(request);
    if (!allowed.includes(role)) {
      return reply.forbidden("Insufficient role");
    }
  };

const ensureJournalMember = async (
  journalId: string,
  userId: string,
): Promise<boolean> => {
  const member = await prisma.journalMember.findUnique({
    where: {
      journalId_userId: {
        journalId,
        userId,
      },
    },
    select: { userId: true },
  });

  return Boolean(member);
};

const ensureMeetingMember = async (
  meetingId: string,
  userId: string,
): Promise<{ allowed: boolean; meetingJournalId?: string }> => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { journalId: true },
  });

  if (!meeting) {
    return { allowed: false };
  }

  const allowed = await ensureJournalMember(meeting.journalId, userId);
  return { allowed, meetingJournalId: meeting.journalId };
};

const writeAuditLog = async (
  userId: string,
  action: string,
  metadata?: Record<string, unknown>,
) => {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });
};

const signAccessToken = async (reply: FastifyReply, userId: string, role: Role): Promise<string> =>
  reply.jwtSign(
    { sub: userId, role },
    {
      expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`,
    },
  );

const setCookieAuth = (reply: FastifyReply, accessToken: string, refreshToken: string, csrfToken: string) => {
  reply.setCookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: env.ACCESS_TOKEN_TTL_MINUTES * 60,
  });

  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  });

  reply.setCookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  });
};

const clearCookieAuth = (reply: FastifyReply) => {
  reply.clearCookie(ACCESS_COOKIE, { path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
  reply.clearCookie(CSRF_COOKIE, { path: "/" });
};

const issueSessionTokens = async (
  reply: FastifyReply,
  params: {
    userId: string;
    role: Role;
    userAgent?: string;
    ipAddress?: string;
    deviceLabel?: string;
    mobileMode?: boolean;
  },
): Promise<{ accessToken: string; refreshToken?: string; csrfToken?: string }> => {
  const accessToken = await signAccessToken(reply, params.userId, params.role);
  const refreshToken = randomBytes(48).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");

  await prisma.refreshTokenSession.create({
    data: {
      userId: params.userId,
      tokenHash: getTokenHash(refreshToken),
      csrfTokenHash: getTokenHash(csrfToken),
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      deviceLabel: params.deviceLabel,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  setCookieAuth(reply, accessToken, refreshToken, csrfToken);

  if (params.mobileMode) {
    return { accessToken, refreshToken, csrfToken };
  }

  return { accessToken };
};

const rotateSession = async (
  reply: FastifyReply,
  currentRefreshToken: string,
  nextPayload: { userAgent?: string; ipAddress?: string; deviceLabel?: string; mobileMode?: boolean },
): Promise<{ accessToken: string; refreshToken?: string; csrfToken?: string; role: Role }> => {
  const tokenHash = getTokenHash(currentRefreshToken);
  const current = await prisma.refreshTokenSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          role: true,
        },
      },
    },
  });

  if (!current || current.revokedAt || current.expiresAt <= new Date()) {
    throw app.httpErrors.unauthorized("Refresh token is invalid or expired");
  }

  const nextRefreshToken = randomBytes(48).toString("base64url");
  const nextCsrfToken = randomBytes(24).toString("base64url");

  const nextSession = await prisma.refreshTokenSession.create({
    data: {
      userId: current.userId,
      tokenHash: getTokenHash(nextRefreshToken),
      csrfTokenHash: getTokenHash(nextCsrfToken),
      userAgent: nextPayload.userAgent,
      ipAddress: nextPayload.ipAddress,
      deviceLabel: nextPayload.deviceLabel,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.refreshTokenSession.update({
    where: { id: current.id },
    data: {
      revokedAt: new Date(),
      replacedById: nextSession.id,
    },
  });

  const accessToken = await signAccessToken(reply, current.user.id, current.user.role);
  setCookieAuth(reply, accessToken, nextRefreshToken, nextCsrfToken);

  if (nextPayload.mobileMode) {
    return {
      accessToken,
      refreshToken: nextRefreshToken,
      csrfToken: nextCsrfToken,
      role: current.user.role,
    };
  }

  return { accessToken, role: current.user.role };
};

const parseClient = (request: FastifyRequest) => ({
  userAgent: request.headers["user-agent"] as string | undefined,
  ipAddress: request.ip,
});

const ensureCsrfForCookieFlow = (request: FastifyRequest) => {
  const cookieToken = request.cookies[CSRF_COOKIE];
  const headerToken = request.headers["x-csrf-token"];
  const normalizedHeader = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  if (!cookieToken || !normalizedHeader || cookieToken !== normalizedHeader) {
    throw app.httpErrors.forbidden("CSRF validation failed");
  }
};

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(80),
  password: z.string().min(12).max(128),
  mobileMode: z.boolean().optional().default(false),
  deviceLabel: z.string().min(1).max(120).optional(),
});

app.post(
  "/auth/register",
  {
    config: {
      rateLimit: { max: 20, timeWindow: "1 minute" },
    },
  },
  async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const normalizedEmail = normalizeEmail(body.email);
    const emailHash = lookupHash(normalizedEmail);

    const exists = await prisma.user.findUnique({
      where: { emailHash },
      select: { id: true },
    });

    if (exists) {
      return reply.conflict("Account already exists");
    }

    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        emailHash,
        emailEncrypted: encryptString(normalizedEmail),
        nameEncrypted: encryptString(body.name.trim()),
        passwordHash,
        subscriptions: {
          create: {
            tier: SubscriptionTier.FREE,
            priceCents: 0,
            isComplimentary: true,
            grantReason: "Initial free tier",
          },
        },
      },
    });

    await writeAuditLog(user.id, "auth.register");

    const client = parseClient(request);
    const tokenSet = await issueSessionTokens(reply, {
      userId: user.id,
      role: user.role,
      ...client,
      deviceLabel: body.deviceLabel,
      mobileMode: body.mobileMode,
    });

    return {
      token: tokenSet.accessToken,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      csrfToken: tokenSet.csrfToken,
      role: user.role,
    };
  },
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mobileMode: z.boolean().optional().default(false),
  deviceLabel: z.string().min(1).max(120).optional(),
});

app.post(
  "/auth/login",
  {
    config: {
      rateLimit: { max: 35, timeWindow: "1 minute" },
    },
  },
  async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const emailHash = lookupHash(normalizeEmail(body.email));

    const user = await prisma.user.findUnique({
      where: { emailHash },
    });

    if (!user?.passwordHash) {
      return reply.unauthorized("Invalid credentials");
    }

    const valid = await argon2.verify(user.passwordHash, body.password);
    if (!valid) {
      return reply.unauthorized("Invalid credentials");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    await writeAuditLog(user.id, "auth.login.password");

    const client = parseClient(request);
    const tokenSet = await issueSessionTokens(reply, {
      userId: user.id,
      role: user.role,
      ...client,
      deviceLabel: body.deviceLabel,
      mobileMode: body.mobileMode,
    });

    return {
      token: tokenSet.accessToken,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      csrfToken: tokenSet.csrfToken,
      role: user.role,
    };
  },
);

const googleSchema = z.object({
  idToken: z.string().min(1),
  mobileMode: z.boolean().optional().default(false),
  deviceLabel: z.string().min(1).max(120).optional(),
});

app.post(
  "/auth/google",
  {
    config: {
      rateLimit: { max: 40, timeWindow: "1 minute" },
    },
  },
  async (request, reply) => {
    if (!googleClient || !env.GOOGLE_CLIENT_ID) {
      return reply.badRequest("Google sign-in is not configured");
    }

    const body = googleSchema.parse(request.body);
    const ticket = await googleClient.verifyIdToken({
      idToken: body.idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email) {
      return reply.unauthorized("Invalid Google token");
    }

    if (env.GOOGLE_ALLOWED_HD && payload.hd !== env.GOOGLE_ALLOWED_HD) {
      return reply.forbidden("Hosted domain is not allowed");
    }

    const normalizedEmail = normalizeEmail(payload.email);
    const emailHash = lookupHash(normalizedEmail);
    const googleSubHash = lookupHash(payload.sub);
    const displayName = payload.name ?? normalizedEmail.split("@")[0];

    let user = await prisma.user.findFirst({
      where: {
        OR: [{ googleSubHash }, { emailHash }],
      },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          emailHash,
          emailEncrypted: encryptString(normalizedEmail),
          nameEncrypted: encryptString(displayName),
          googleSubHash,
          subscriptions: {
            create: {
              tier: SubscriptionTier.FREE,
              priceCents: 0,
              isComplimentary: true,
              grantReason: "Initial free tier",
            },
          },
        },
      });
    } else if (!user.googleSubHash) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleSubHash },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    await writeAuditLog(user.id, "auth.login.google");

    const client = parseClient(request);
    const tokenSet = await issueSessionTokens(reply, {
      userId: user.id,
      role: user.role,
      ...client,
      deviceLabel: body.deviceLabel,
      mobileMode: body.mobileMode,
    });

    return {
      token: tokenSet.accessToken,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      csrfToken: tokenSet.csrfToken,
      role: user.role,
    };
  },
);

const refreshSchema = z.object({
  refreshToken: z.string().min(20).optional(),
  mobileMode: z.boolean().optional().default(false),
  deviceLabel: z.string().min(1).max(120).optional(),
});

app.post(
  "/auth/refresh",
  {
    config: {
      rateLimit: { max: 80, timeWindow: "1 minute" },
    },
  },
  async (request, reply) => {
    const body = refreshSchema.parse(request.body ?? {});
    const refreshToken = body.refreshToken ?? request.cookies[REFRESH_COOKIE];

    if (!refreshToken) {
      return reply.unauthorized("Missing refresh token");
    }

    if (!body.mobileMode) {
      ensureCsrfForCookieFlow(request);
    }

    const client = parseClient(request);
    const rotated = await rotateSession(reply, refreshToken, {
      ...client,
      deviceLabel: body.deviceLabel,
      mobileMode: body.mobileMode,
    });

    return {
      token: rotated.accessToken,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      csrfToken: rotated.csrfToken,
      role: rotated.role,
    };
  },
);

const logoutSchema = z.object({
  refreshToken: z.string().min(20).optional(),
  mobileMode: z.boolean().optional().default(false),
});

app.post("/auth/logout", async (request, reply) => {
  const body = logoutSchema.parse(request.body ?? {});
  const refreshToken = body.refreshToken ?? request.cookies[REFRESH_COOKIE];

  if (!body.mobileMode) {
    ensureCsrfForCookieFlow(request);
  }

  if (refreshToken) {
    await prisma.refreshTokenSession.updateMany({
      where: {
        tokenHash: getTokenHash(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  clearCookieAuth(reply);
  return { loggedOut: true };
});

app.get("/auth/me", { preHandler: ensureAuth }, async (request) => {
  const { userId } = getAuth(request);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  return {
    id: user.id,
    role: user.role,
    email: decryptString(user.emailEncrypted),
    name: decryptString(user.nameEncrypted),
  };
});

const roleSchema = z.object({ role: z.nativeEnum(Role) });

app.patch(
  "/admin/users/:userId/role",
  { preHandler: ensureRole([Role.ADMIN]) },
  async (request) => {
    const params = z.object({ userId: z.string().cuid() }).parse(request.params);
    const body = roleSchema.parse(request.body);
    const auth = getAuth(request);

    const user = await prisma.user.update({
      where: { id: params.userId },
      data: { role: body.role },
      select: { id: true, role: true },
    });

    await writeAuditLog(auth.userId, "admin.role.update", {
      targetUserId: user.id,
      role: user.role,
    });

    return user;
  },
);

app.get("/admin/overview", { preHandler: ensureRole([Role.ADMIN]) }, async () => {
  const [users, journals, meetings, posts, plans] = await Promise.all([
    prisma.user.count(),
    prisma.journal.count(),
    prisma.meeting.count(),
    prisma.post.count(),
    prisma.subscriptionPlan.count(),
  ]);

  return { users, journals, meetings, posts, plans };
});

const adminUsersQuery = z.object({
  query: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
});

app.get("/admin/users", { preHandler: ensureRole([Role.ADMIN]) }, async (request) => {
  const q = adminUsersQuery.parse(request.query);
  const users = await prisma.user.findMany({
    take: q.limit,
    orderBy: { createdAt: "desc" },
    include: {
      subscriptions: {
        orderBy: { startsAt: "desc" },
        take: 1,
      },
    },
  });

  return users
    .filter((user) => {
      if (!q.query) {
        return true;
      }

      const name = decryptString(user.nameEncrypted).toLowerCase();
      const email = decryptString(user.emailEncrypted).toLowerCase();
      return name.includes(q.query.toLowerCase()) || email.includes(q.query.toLowerCase());
    })
    .map((user) => ({
      id: user.id,
      role: user.role,
      name: decryptString(user.nameEncrypted),
      email: decryptString(user.emailEncrypted),
      createdAt: user.createdAt,
      lastActiveAt: user.lastActiveAt,
      subscription: user.subscriptions[0] ?? null,
    }));
});

const planSchema = z.object({
  name: z.string().min(2).max(120),
  tier: z.nativeEnum(SubscriptionTier),
  priceCents: z.coerce.number().int().min(0),
  monthlyUploadLimitBytes: z.coerce.number().int().min(1024 * 1024),
  isActive: z.boolean().default(true),
});

app.get("/admin/subscription-plans", { preHandler: ensureRole([Role.ADMIN]) }, async () =>
  prisma.subscriptionPlan.findMany({
    orderBy: { createdAt: "asc" },
  }),
);

app.post(
  "/admin/subscription-plans",
  { preHandler: ensureRole([Role.ADMIN]) },
  async (request, reply) => {
    const body = planSchema.parse(request.body);
    const auth = getAuth(request);

    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: body.name,
        tier: body.tier,
        priceCents: body.priceCents,
        monthlyUploadLimitBytes: BigInt(body.monthlyUploadLimitBytes),
        isActive: body.isActive,
      },
    });

    await writeAuditLog(auth.userId, "admin.plan.create", { planId: plan.id });
    return reply.code(201).send(plan);
  },
);

const planPatchSchema = planSchema.partial();

app.patch(
  "/admin/subscription-plans/:planId",
  { preHandler: ensureRole([Role.ADMIN]) },
  async (request) => {
    const auth = getAuth(request);
    const params = z.object({ planId: z.string().cuid() }).parse(request.params);
    const body = planPatchSchema.parse(request.body);

    const plan = await prisma.subscriptionPlan.update({
      where: { id: params.planId },
      data: {
        name: body.name,
        tier: body.tier,
        priceCents: body.priceCents,
        monthlyUploadLimitBytes:
          body.monthlyUploadLimitBytes !== undefined
            ? BigInt(body.monthlyUploadLimitBytes)
            : undefined,
        isActive: body.isActive,
      },
    });

    await writeAuditLog(auth.userId, "admin.plan.update", { planId: plan.id });
    return plan;
  },
);

const grantSchema = z.object({
  planId: z.string().cuid().optional(),
  customTier: z.nativeEnum(SubscriptionTier).optional(),
  customPriceCents: z.coerce.number().int().min(0).optional(),
  monthlyUploadLimitBytes: z.coerce.number().int().min(1024 * 1024).optional(),
  daysValid: z.coerce.number().int().min(1).max(3650).default(30),
  isComplimentary: z.boolean().default(true),
  reason: z.string().min(2).max(200),
});

app.post(
  "/admin/users/:userId/grant-package",
  { preHandler: ensureRole([Role.ADMIN]) },
  async (request, reply) => {
    const auth = getAuth(request);
    const params = z.object({ userId: z.string().cuid() }).parse(request.params);
    const body = grantSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true } });
    if (!user) {
      return reply.notFound("User not found");
    }

    let tier = body.customTier ?? SubscriptionTier.PRO;
    let priceCents = body.customPriceCents ?? 0;
    let monthlyUploadLimitBytes = body.monthlyUploadLimitBytes ?? 5 * 1024 * 1024 * 1024;

    if (body.planId) {
      const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId } });
      if (!plan) {
        return reply.badRequest("Plan does not exist");
      }
      tier = plan.tier;
      priceCents = body.customPriceCents ?? plan.priceCents;
      monthlyUploadLimitBytes =
        body.monthlyUploadLimitBytes ?? Number(plan.monthlyUploadLimitBytes);
    }

    await prisma.userSubscription.create({
      data: {
        userId: params.userId,
        planId: body.planId,
        tier,
        priceCents,
        isComplimentary: body.isComplimentary,
        grantedByAdminId: auth.userId,
        grantReason: body.reason,
        monthlyUploadLimitBytes: BigInt(monthlyUploadLimitBytes),
        usedUploadBytes: BigInt(0),
        startsAt: new Date(),
        endsAt: new Date(Date.now() + body.daysValid * 24 * 60 * 60 * 1000),
      },
    });

    await writeAuditLog(auth.userId, "admin.grant.package", {
      targetUserId: params.userId,
      planId: body.planId,
      reason: body.reason,
    });

    return { granted: true };
  },
);

const createJournalSchema = z.object({
  name: z.string().max(120).optional(),
});

app.post("/journals", { preHandler: ensureAuth }, async (request) => {
  const auth = getAuth(request);
  const body = createJournalSchema.parse(request.body);
  const customName = body.name ? normalizeJournalName(body.name) : "";
  const initialName = customName.length >= 2 ? customName : `${AUTO_JOURNAL_PREFIX}user1`;

  const journal = await prisma.journal.create({
    data: {
      name: initialName,
      createdById: auth.userId,
      members: {
        create: {
          userId: auth.userId,
        },
      },
    },
  });

  if (customName.length < 2) {
    const generatedName = await buildParticipantsJournalName(journal.id);
    const renamed = await prisma.journal.update({
      where: { id: journal.id },
      data: { name: generatedName },
    });

    await writeAuditLog(auth.userId, "journal.create", { journalId: journal.id });
    return renamed;
  }

  await writeAuditLog(auth.userId, "journal.create", { journalId: journal.id });
  return journal;
});

const renameJournalSchema = z.object({
  name: z.string().min(2).max(120),
});

app.patch("/journals/:journalId", { preHandler: ensureAuth }, async (request, reply) => {
  const auth = getAuth(request);
  const params = z.object({ journalId: z.string().cuid() }).parse(request.params);
  const body = renameJournalSchema.parse(request.body);

  const isMember = await ensureJournalMember(params.journalId, auth.userId);
  if (!isMember) {
    return reply.forbidden("Not a member of this journal");
  }

  const journal = await prisma.journal.update({
    where: { id: params.journalId },
    data: { name: normalizeJournalName(body.name) },
    select: {
      id: true,
      name: true,
      createdAt: true,
    },
  });

  await writeAuditLog(auth.userId, "journal.rename", {
    journalId: journal.id,
  });

  return journal;
});

app.get("/journals", { preHandler: ensureAuth }, async (request) => {
  const auth = getAuth(request);

  return prisma.journalMember.findMany({
    where: { userId: auth.userId },
    select: {
      journal: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: {
            select: {
              members: true,
            },
          },
        },
      },
    },
  }).then((rows) =>
    rows.map((row) => ({
      journal: {
        ...row.journal,
        name: asDisplayJournalName(row.journal.name),
      },
    })),
  );
});

app.get("/journals/:journalId/members", { preHandler: ensureAuth }, async (request, reply) => {
  const auth = getAuth(request);
  const params = z.object({ journalId: z.string().cuid() }).parse(request.params);

  const isMember = await ensureJournalMember(params.journalId, auth.userId);
  if (!isMember) {
    return reply.forbidden("Not a member of this journal");
  }

  return prisma.journalMember.findMany({
    where: { journalId: params.journalId },
    select: {
      userId: true,
    },
    orderBy: { joinedAt: "asc" },
  });
});

app.post("/journals/:journalId/invites", { preHandler: ensureAuth }, async (request, reply) => {
  const auth = getAuth(request);
  const params = z.object({ journalId: z.string().cuid() }).parse(request.params);

  const isMember = await ensureJournalMember(params.journalId, auth.userId);
  if (!isMember) {
    return reply.forbidden("Not a member of this journal");
  }

  const code = randomBytes(18).toString("base64url");
  const invite = await prisma.journalInvite.create({
    data: {
      journalId: params.journalId,
      createdById: auth.userId,
      code,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    select: {
      code: true,
      expiresAt: true,
    },
  });

  return invite;
});

const joinJournalSchema = z.object({
  code: z.string().min(12),
});

app.post("/journals/join", { preHandler: ensureAuth }, async (request, reply) => {
  const auth = getAuth(request);
  const body = joinJournalSchema.parse(request.body);

  const invite = await prisma.journalInvite.findUnique({
    where: { code: body.code },
    select: { journalId: true, expiresAt: true },
  });

  if (!invite || invite.expiresAt < new Date()) {
    return reply.badRequest("Invite code is invalid or expired");
  }

  const alreadyMember = await prisma.journalMember.findUnique({
    where: {
      journalId_userId: {
        journalId: invite.journalId,
        userId: auth.userId,
      },
    },
    select: { userId: true },
  });

  await prisma.journalMember.upsert({
    where: {
      journalId_userId: {
        journalId: invite.journalId,
        userId: auth.userId,
      },
    },
    update: {},
    create: {
      journalId: invite.journalId,
      userId: auth.userId,
    },
  });

  if (!alreadyMember) {
    const latestEnvelope = await prisma.journalKeyEnvelope.findFirst({
      where: { journalId: invite.journalId },
      orderBy: [{ keyVersion: "desc" }, { createdAt: "desc" }],
      select: {
        keyVersion: true,
        encryptedKey: true,
        algorithm: true,
        senderUserId: true,
      },
    });

    if (latestEnvelope) {
      await prisma.journalKeyEnvelope.upsert({
        where: {
          journalId_keyVersion_recipientUserId: {
            journalId: invite.journalId,
            keyVersion: latestEnvelope.keyVersion,
            recipientUserId: auth.userId,
          },
        },
        update: {
          encryptedKey: latestEnvelope.encryptedKey,
          algorithm: latestEnvelope.algorithm,
          senderUserId: latestEnvelope.senderUserId,
        },
        create: {
          journalId: invite.journalId,
          keyVersion: latestEnvelope.keyVersion,
          recipientUserId: auth.userId,
          senderUserId: latestEnvelope.senderUserId,
          encryptedKey: latestEnvelope.encryptedKey,
          algorithm: latestEnvelope.algorithm,
        },
      });
    }
  }

  const joinedJournal = await prisma.journal.findUnique({
    where: { id: invite.journalId },
    select: { name: true },
  });

  if (joinedJournal && isAutoJournalName(joinedJournal.name)) {
    const generatedName = await buildParticipantsJournalName(invite.journalId);
    await prisma.journal.update({
      where: { id: invite.journalId },
      data: { name: generatedName },
    });
  }

  await writeAuditLog(auth.userId, "journal.join", { journalId: invite.journalId });
  return { joined: true, journalId: invite.journalId };
});

const createMeetingSchema = z.object({
  title: z.string().min(2).max(160),
  meetingAt: z.coerce.date(),
  locationName: z.string().min(2).max(200),
  photoDataUrl: z.string().max(1_200_000).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

app.post("/journals/:journalId/meetings", { preHandler: ensureAuth }, async (request, reply) => {
  const auth = getAuth(request);
  const params = z.object({ journalId: z.string().cuid() }).parse(request.params);
  const body = createMeetingSchema.parse(request.body);

  const isMember = await ensureJournalMember(params.journalId, auth.userId);
  if (!isMember) {
    return reply.forbidden("Not a member of this journal");
  }

  const meeting = await prisma.meeting.create({
    data: {
      journalId: params.journalId,
      title: body.title,
      meetingAt: body.meetingAt,
      locationName: body.locationName,
      photoDataUrl: body.photoDataUrl,
      latitude: body.latitude,
      longitude: body.longitude,
      createdById: auth.userId,
    },
  });

  await writeAuditLog(auth.userId, "meeting.create", { meetingId: meeting.id });
  return meeting;
});

app.get("/journals/:journalId/markers", { preHandler: ensureAuth }, async (request, reply) => {
  const auth = getAuth(request);
  const params = z.object({ journalId: z.string().cuid() }).parse(request.params);

  const isMember = await ensureJournalMember(params.journalId, auth.userId);
  if (!isMember) {
    return reply.forbidden("Not a member of this journal");
  }

  const meetings = await prisma.meeting.findMany({
    where: { journalId: params.journalId },
    select: {
      id: true,
      meetingAt: true,
      locationName: true,
      photoDataUrl: true,
      latitude: true,
      longitude: true,
    },
    orderBy: { meetingAt: "desc" },
  });

  return meetings.map((meeting) => ({
    ...meeting,
    latitude: Number(meeting.latitude),
    longitude: Number(meeting.longitude),
  }));
});

const deviceKeySchema = z.object({
  keyVersion: z.coerce.number().int().min(1),
  publicKey: z.string().min(20),
  algorithm: z.string().default("X25519"),
});

app.post("/e2ee/device-keys", { preHandler: ensureAuth }, async (request) => {
  const auth = getAuth(request);
  const body = deviceKeySchema.parse(request.body);

  const result = await prisma.userDeviceKey.upsert({
    where: {
      userId_keyVersion: {
        userId: auth.userId,
        keyVersion: body.keyVersion,
      },
    },
    update: {
      publicKey: body.publicKey,
      algorithm: body.algorithm,
      revokedAt: null,
    },
    create: {
      userId: auth.userId,
      keyVersion: body.keyVersion,
      publicKey: body.publicKey,
      algorithm: body.algorithm,
    },
  });

  await writeAuditLog(auth.userId, "e2ee.device_key.upsert", { keyVersion: body.keyVersion });
  return result;
});

const createJournalKeySchema = z.object({
  keyVersion: z.coerce.number().int().min(1),
  envelopes: z
    .array(
      z.object({
        recipientUserId: z.string().cuid(),
        encryptedKeyBase64: z.string().min(20),
      }),
    )
    .min(1),
});

app.post(
  "/e2ee/journals/:journalId/keys",
  { preHandler: ensureAuth },
  async (request, reply) => {
    const auth = getAuth(request);
    const params = z.object({ journalId: z.string().cuid() }).parse(request.params);
    const body = createJournalKeySchema.parse(request.body);

    const isMember = await ensureJournalMember(params.journalId, auth.userId);
    if (!isMember) {
      return reply.forbidden("Not a member of this journal");
    }

    const members = await prisma.journalMember.findMany({
      where: { journalId: params.journalId },
      select: { userId: true },
    });
    const memberSet = new Set(members.map((item) => item.userId));

    for (const envelope of body.envelopes) {
      if (!memberSet.has(envelope.recipientUserId)) {
        return reply.badRequest("All recipients must be journal members");
      }
    }

    await prisma.$transaction(
      body.envelopes.map((envelope) =>
        prisma.journalKeyEnvelope.upsert({
          where: {
            journalId_keyVersion_recipientUserId: {
              journalId: params.journalId,
              keyVersion: body.keyVersion,
              recipientUserId: envelope.recipientUserId,
            },
          },
          update: {
            encryptedKey: Buffer.from(envelope.encryptedKeyBase64, "base64"),
            senderUserId: auth.userId,
          },
          create: {
            journalId: params.journalId,
            keyVersion: body.keyVersion,
            recipientUserId: envelope.recipientUserId,
            senderUserId: auth.userId,
            encryptedKey: Buffer.from(envelope.encryptedKeyBase64, "base64"),
          },
        }),
      ),
    );

    await writeAuditLog(auth.userId, "e2ee.journal_key.rotate", {
      journalId: params.journalId,
      keyVersion: body.keyVersion,
    });

    return { stored: body.envelopes.length };
  },
);

app.get(
  "/e2ee/journals/:journalId/keys",
  { preHandler: ensureAuth },
  async (request, reply) => {
    const auth = getAuth(request);
    const params = z.object({ journalId: z.string().cuid() }).parse(request.params);

    const isMember = await ensureJournalMember(params.journalId, auth.userId);
    if (!isMember) {
      return reply.forbidden("Not a member of this journal");
    }

    const envelopes = await prisma.journalKeyEnvelope.findMany({
      where: {
        journalId: params.journalId,
        recipientUserId: auth.userId,
      },
      orderBy: [{ keyVersion: "desc" }, { createdAt: "desc" }],
      select: {
        keyVersion: true,
        algorithm: true,
        senderUserId: true,
        encryptedKey: true,
        createdAt: true,
      },
    });

    return envelopes.map((item) => ({
      keyVersion: item.keyVersion,
      algorithm: item.algorithm,
      senderUserId: item.senderUserId,
      encryptedKeyBase64: item.encryptedKey.toString("base64"),
      createdAt: item.createdAt,
    }));
  },
);

const createPostSchema = z.object({
  ciphertextBase64: z.string().min(8),
  ivBase64: z.string().min(8),
  algorithm: z.string().default("AES-256-GCM"),
  media: z
    .array(
      z.object({
        mimeType: z.string().min(3).max(100),
        dataBase64: z.string().min(8),
        nonceBase64: z.string().min(8),
      }),
    )
    .max(20)
    .default([]),
});

app.post("/meetings/:meetingId/posts", { preHandler: ensureAuth }, async (request, reply) => {
  const auth = getAuth(request);
  const params = z.object({ meetingId: z.string().cuid() }).parse(request.params);
  const body = createPostSchema.parse(request.body);

  const access = await ensureMeetingMember(params.meetingId, auth.userId);
  if (!access.allowed) {
    return reply.forbidden("Not allowed to post in this meeting");
  }

  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: params.meetingId },
    select: { meetingAt: true },
  });

  const activeSub = await prisma.userSubscription.findFirst({
    where: {
      userId: auth.userId,
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    },
    orderBy: { startsAt: "desc" },
  });

  if (!activeSub) {
    return reply.paymentRequired("No active subscription");
  }

  const mediaPayload = body.media.map((item) => {
    const blob = Buffer.from(item.dataBase64, "base64");
    const nonce = Buffer.from(item.nonceBase64, "base64");

    return {
      mimeType: item.mimeType,
      blob,
      nonce,
      sizeBytes: blob.byteLength,
      checksum: checksum(blob),
    };
  });

  const newBytes = mediaPayload.reduce((sum, item) => sum + item.sizeBytes, 0);
  const used = Number(activeSub.usedUploadBytes);
  const limit = Number(activeSub.monthlyUploadLimitBytes);

  if (used + newBytes > limit) {
    return reply.paymentRequired("Upload limit reached for current plan");
  }

  const post = await prisma.post.create({
    data: {
      meetingId: params.meetingId,
      authorId: auth.userId,
      ciphertext: Buffer.from(body.ciphertextBase64, "base64"),
      iv: Buffer.from(body.ivBase64, "base64"),
      algorithm: body.algorithm,
      visibleAfter: addOneMonth(meeting.meetingAt),
      media: {
        create: mediaPayload.map((item) => ({
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          checksum: item.checksum,
          blobEncrypted: item.blob,
          nonce: item.nonce,
        })),
      },
    },
    include: {
      media: {
        select: {
          id: true,
          mimeType: true,
          sizeBytes: true,
          nonce: true,
          createdAt: true,
        },
      },
    },
  });

  await prisma.userSubscription.update({
    where: { id: activeSub.id },
    data: {
      usedUploadBytes: BigInt(used + newBytes),
    },
  });

  await writeAuditLog(auth.userId, "post.create", {
    postId: post.id,
    meetingId: params.meetingId,
  });

  return post;
});

app.get("/meetings/:meetingId/posts", { preHandler: ensureAuth }, async (request, reply) => {
  const auth = getAuth(request);
  const params = z.object({ meetingId: z.string().cuid() }).parse(request.params);

  const access = await ensureMeetingMember(params.meetingId, auth.userId);
  if (!access.allowed) {
    return reply.forbidden("Not allowed to read this meeting");
  }

  const now = new Date();
  const posts = await prisma.post.findMany({
    where: {
      meetingId: params.meetingId,
      OR: [{ authorId: auth.userId }, { visibleAfter: { lte: now } }],
    },
    select: {
      id: true,
      authorId: true,
      algorithm: true,
      iv: true,
      ciphertext: true,
      visibleAfter: true,
      createdAt: true,
      media: {
        select: {
          id: true,
          mimeType: true,
          sizeBytes: true,
          nonce: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return posts.map((post) => {
    const { ciphertext, iv, ...rest } = post;
    return {
      ...rest,
      media: post.media.map((item) => ({
        id: item.id,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
        nonceBase64: item.nonce.toString("base64"),
      })),
      ciphertextBase64: ciphertext.toString("base64"),
      ivBase64: iv.toString("base64"),
    };
  });
});

app.get("/media/:mediaId", { preHandler: ensureAuth }, async (request, reply) => {
  const auth = getAuth(request);
  const params = z.object({ mediaId: z.string().cuid() }).parse(request.params);

  const media = await prisma.mediaAsset.findUnique({
    where: { id: params.mediaId },
    include: {
      post: {
        select: {
          authorId: true,
          visibleAfter: true,
          meeting: {
            select: {
              id: true,
              journalId: true,
            },
          },
        },
      },
    },
  });

  if (!media) {
    return reply.notFound("Media not found");
  }

  const isMember = await ensureJournalMember(media.post.meeting.journalId, auth.userId);
  if (!isMember) {
    return reply.forbidden("Not allowed to read this media");
  }

  const unlocked = media.post.authorId === auth.userId || media.post.visibleAfter <= new Date();
  if (!unlocked) {
    return reply.forbidden("Media is still locked until anniversary");
  }

  reply.header("content-type", media.mimeType);
  reply.header("cache-control", "private, no-store");
  return reply.send(media.blobEncrypted);
});

app.get("/mobile/config", async () => ({
  apiVersion: "v1",
  supports: {
    bearerAuth: true,
    cookieAuth: true,
    refreshTokenRotation: true,
    e2eeKeyExchange: true,
  },
}));

app.get("/health", async () => ({ ok: true }));

const start = async () => {
  try {
    await app.listen({
      port: env.API_PORT,
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
