import { requireRole } from "@/lib/dal";
import { getAdminStats, getTeamProgressOverview } from "@/lib/queries/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function AdminDashboardPage() {
  const profile = await requireRole("admin", "gestor");
  const isAdmin = profile.role === "admin";

  const [stats, team] = await Promise.all([
    isAdmin ? getAdminStats() : null,
    getTeamProgressOverview(isAdmin ? undefined : profile.id),
  ]);

  const ranking = [...team]
    .filter((t) => t.role === "colaborador")
    .sort((a, b) => b.trainingsCompleted - a.trainingsCompleted)
    .slice(0, 5);

  const withPendencies = team.filter((t) => t.pendingMandatory > 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isAdmin ? "Dashboard administrativo" : "Minha equipe"}
        </h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? "Visão geral de treinamentos, colaboradores e desempenho."
            : "Progresso dos colaboradores sob sua gestão."}
        </p>
      </div>

      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Colaboradores" value={stats.totalColaboradores} />
          <Stat label="Colaboradores ativos" value={stats.colaboradoresAtivos} />
          <Stat label="Treinamentos publicados" value={stats.treinamentosPublicados} />
          <Stat label="Vídeos cadastrados" value={stats.totalVideos} />
          <Stat label="Vídeos assistidos" value={stats.videosAssistidos} />
          <Stat label="Vídeos concluídos" value={stats.videosConcluidos} />
          <Stat label="Taxa de conclusão" value={`${stats.completionRate}%`} />
          <Stat label="Taxa de aprovação em quiz" value={`${stats.approvalRate}%`} />
          <Stat label="Nota média em quiz" value={`${stats.averageScore}%`} />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Ranking — treinamentos concluídos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ranking.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
            ) : (
              <ul className="space-y-2">
                {ranking.map((r, i) => (
                  <li key={r.id} className="flex items-center justify-between text-sm">
                    <span>
                      {i + 1}. {r.full_name}
                    </span>
                    <span className="text-muted-foreground">
                      {r.trainingsCompleted} concluído(s)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Colaboradores com treinamentos obrigatórios pendentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {withPendencies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma pendência.</p>
            ) : (
              <ul className="space-y-2">
                {withPendencies.map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-sm">
                    <span>{r.full_name}</span>
                    <Badge variant="destructive">{r.pendingMandatory} pendente(s)</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {isAdmin ? "Todos os colaboradores" : "Sua equipe"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Treinamentos iniciados</TableHead>
                <TableHead>Concluídos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.full_name}</TableCell>
                  <TableCell>{t.department ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "ativo" ? "secondary" : "destructive"}>
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{t.trainingsStarted}</TableCell>
                  <TableCell>{t.trainingsCompleted}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
