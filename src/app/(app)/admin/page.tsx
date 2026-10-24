import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AdminConsole from "@/components/AdminConsole";

// Page-level convenience only (non-admins see a 404 page). The /api/admin/*
// routes enforce the real rule on every call.
export default async function AdminPage() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();
  return <AdminConsole />;
}