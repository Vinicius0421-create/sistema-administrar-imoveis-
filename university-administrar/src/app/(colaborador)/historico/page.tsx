import { getMyActivityLog, getMyQuizAttemptsHistory } from "@/lib/queries/history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const actionLabel: Record<string, string> = {
  video_concluido: "Vídeo concluído",
  quiz_aprovado: "Quiz aprovado",
  quiz_reprovado: "Quiz reprovado",
};

export default async function HistoricoPage() {
  const [activity, attempts] = await Promise.all([
    getMyActivityLog(),
    getMyQuizAttemptsHistory(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Histórico</h1>
        <p className="text-muted-foreground">Suas atividades e tentativas de quiz.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Tentativas de quiz</CardTitle>
        </CardHeader>
        <CardContent>
          {attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma tentativa registrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Treinamento</TableHead>
                  <TableHead>Tentativa</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.trainingTitle}</TableCell>
                    <TableCell>#{a.attempt_number}</TableCell>
                    <TableCell>{a.percent}%</TableCell>
                    <TableCell>
                      <Badge variant={a.passed ? "default" : "destructive"}>
                        {a.passed ? "Aprovado" : "Reprovado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(a.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Linha do tempo</CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma atividade registrada.</p>
          ) : (
            <ul className="space-y-3">
              {activity.map((item) => (
                <li key={item.id} className="flex items-center justify-between text-sm">
                  <span>{actionLabel[item.action] ?? item.action}</span>
                  <span className="text-muted-foreground">
                    {new Date(item.created_at).toLocaleString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
