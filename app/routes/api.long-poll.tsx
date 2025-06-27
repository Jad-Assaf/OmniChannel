// app/routes/api/long-poll.tsx
import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Pool, Notification } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const loader: LoaderFunction = async ({ request }) => {
    const url = new URL(request.url);
    const since = Number(url.searchParams.get("since") ?? "0");
    const wait = url.searchParams.get("wait") === "true";

    const baseQuery = `
    SELECT *
      FROM messages
     WHERE extract(epoch from timestamp)::bigint > $1
     ORDER BY timestamp ASC
  `;

    if (!wait) {
        const result = await pool.query(baseQuery, [since]);
        return json({ messages: result.rows });
    }

    const client = await pool.connect();
    try {
        await client.query("LISTEN new_message");

        const payload = await new Promise<string | null>((resolve) => {
            const onNotification = (msg: Notification) => {
                clearTimeout(timeout);
                client.removeListener("notification", onNotification);
                // coalesce undefined → null
                resolve(msg.payload ?? null);
            };

            // timeout after 30s
            const timeout = setTimeout(() => {
                client.removeListener("notification", onNotification);
                resolve(null);
            }, 30_000);

            client.on("notification", onNotification);
        });

        if (!payload) {
            return json({ messages: [] });
        }

        // parse and return only the new message
        const msg = JSON.parse(payload);
        return json({ messages: [msg] });
    } finally {
        client.release();
    }
};
