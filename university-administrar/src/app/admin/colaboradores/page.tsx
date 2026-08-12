import { requireRole } from "@/lib/dal";
import { getTeamProgressOverview } from "@/lib/queries/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProfileStatusToggle } from "@/components/domain/profile-status-toggle";

export default async function ColaboradoresPage() {
  const profile = await requireRole("admin", "gestor");
  const isAdmin = profile.role === "admin";
  const team = await getTeamProgressOverview(isAdmin ? undefined : profile.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Colaboradores</h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? "Gerencie o acesso e acompanhe o progresso de todos os colaboradores."
            : "Acompanhe o progresso dos colaboradores da sua equipe."}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Concluídos</TableHead>
                <TableHead>Pendências obrigatórias</TableHead>
                {isAdmin ? <TableHead className="text-right">Ações</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.full_name}</TableCell>
                  <TableCell>{t.department ?? "—"}</TableCell>
                  <TableCell className="capitalize">{t.role}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "ativo" ? "secondary" : "destructive"}>
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{t.trainingsCompleted}</TableCell>
                  <TableCell>
                    {t.pendingMandatory > 0 ? (
                      <Badge variant="destructive">{t.pendingMandatory}</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  {isAdmin ? (
                    <TableCell className="text-right">
                      {t.id !== profile.id ? (
                        <ProfileStatusToggle profileId={t.id} status={t.status} />
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
