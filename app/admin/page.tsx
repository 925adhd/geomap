import { redirect } from "next/navigation";
import AdminClient from "./admin-client";

// Admin dashboard is dev-only. Kara runs `npm run dev` locally with
// .env.local pointing at the production Supabase project; production
// deploys never need /admin to be reachable. Redirecting to / in
// production removes the dashboard from the public site entirely so
// no JS bundle, no localStorage token, no /?adminToken=… setup link
// ever ships to a real visitor's browser.
export default function AdminPage() {
  if (process.env.NODE_ENV === "production") {
    redirect("/");
  }
  return <AdminClient />;
}
