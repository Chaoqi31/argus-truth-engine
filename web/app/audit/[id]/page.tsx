// Convenience redirect: many users (and our own API responses) treat
// /audit/<job_id> as the canonical audit URL. The real audit page lives at
// /audit?id=<job_id> (the design predates this dynamic route). Rather than
// 404-ing, forward to the canonical URL preserving the id.
import { redirect } from "next/navigation";

export default async function AuditByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/audit?id=${encodeURIComponent(id)}`);
}
