import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { listAllTrainingsForAdmin } from "@/lib/queries/admin-trainings";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const statusVariant = {
  publicado: "default",
  rascunho: "secondary",
  arquivado: "outline",
} as const;

export default async function AdminTrainingsPage() {
  await requireRole("admin");
  const trainings = await listAllTrainingsForAdmin();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Treinamentos</h1>
          <p className="text-muted-foreground">Crie e gerencie os treinamentos da plataforma.</p>
        </div>
        <Button asChild>
          <Link href="/admin/treinamentos/novo">Novo treinamento</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {trainings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum treinamento cadastrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vídeos</TableHead>
                  <TableHead>Quiz</TableHead>
                  <TableHead>Obrigatório</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trainings.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link href={`/admin/treinamentos/${t.id}`} className="font-medium hover:underline">
                        {t.title}
                      </Link>
                    </TableCell>
                    <TableCell>{t.category ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[t.status]}>{t.status}</Badge>
                    </TableCell>
                    <TableCell>{t.videoCount}</TableCell>
                    <TableCell>{t.hasQuiz ? "Sim" : "Não"}</TableCell>
                    <TableCell>{t.is_mandatory ? "Sim" : "Não"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
