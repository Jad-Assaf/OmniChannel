import { PrismaClient } from "@prisma/client";

/**
 * In Vercel serverless functions each cold start would normally spawn
 * a new PrismaClient → new Postgres connection. To keep the Aiven
 * free-tier (20 connections) healthy we cache a single client across
 * warm invocations.
 *
 * Pattern recommended by Vercel & Prisma docs.
 * :contentReference[oaicite:4]{index=4}
 */

let prisma: PrismaClient;

declare global {
    // eslint-disable-next-line no-var
    var __prisma: PrismaClient | undefined;
}

if (!global.__prisma) {
    global.__prisma = new PrismaClient({
        log: ["error"],
    });
}

prisma = global.__prisma;

export { prisma as db };
