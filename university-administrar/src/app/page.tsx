import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/dal";

export default async function RootPage() {
  const profile = await getCurrentProfile();
  redirect(profile.role === "colaborador" ? "/dashboard" : "/admin/dashboard");
}
