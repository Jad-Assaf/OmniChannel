import { json, type ActionFunction } from "@remix-run/node";
import { db } from "~/utils/db.server";

export const action: ActionFunction = async ({ request }) => {
    const fd = await request.formData();
    const id = fd.get("conversationId")?.toString();
    if (!id) return json({ ok: false });

    await db.conversation.update({
        where: { id },
        data: { lastReadAt: new Date() },
    });

    return json({ ok: true });
};
