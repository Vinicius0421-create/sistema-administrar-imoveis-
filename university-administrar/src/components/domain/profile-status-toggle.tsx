"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setProfileStatus } from "@/app/actions/admin-profiles";
import { Button } from "@/components/ui/button";
import type { UserStatus } from "@/lib/types/database";

export function ProfileStatusToggle({
  profileId,
  status,
}: {
  profileId: string;
  status: UserStatus;
}) {
  const [pending, startTransition] = useTransition();
  const nextStatus: UserStatus = status === "ativo" ? "desativado" : "ativo";

  function handleClick() {
    startTransition(async () => {
      const res = await setProfileStatus(profileId, nextStatus);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(nextStatus === "ativo" ? "Colaborador reativado." : "Colaborador desativado.");
    });
  }

  return (
    <Button
      size="sm"
      variant={status === "ativo" ? "destructive" : "outline"}
      disabled={pending}
      onClick={handleClick}
    >
      {status === "ativo" ? "Desativar" : "Reativar"}
    </Button>
  );
}
