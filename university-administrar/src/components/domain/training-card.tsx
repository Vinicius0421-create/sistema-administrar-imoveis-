import Link from "next/link";
import { CheckCircle2, Clock, PlayCircle } from "lucide-react";
import type { Database } from "@/lib/types/database";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

type Training = Database["public"]["Tables"]["trainings"]["Row"];
type TrainingProgress = Database["public"]["Views"]["training_progress"]["Row"];

export function TrainingCard({
  training,
  progress,
}: {
  training: Training;
  progress?: TrainingProgress;
}) {
  const percent = progress?.percent_complete ?? 0;
  const isComplete = progress?.is_complete ?? false;

  return (
    <Card className="flex flex-col">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{training.title}</CardTitle>
          {training.is_mandatory ? <Badge variant="destructive">Obrigatório</Badge> : null}
        </div>
        {training.category ? (
          <Badge variant="secondary" className="w-fit">
            {training.category}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {training.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{training.description}</p>
        ) : null}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {training.estimated_minutes ? (
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" /> {training.estimated_minutes} min
            </span>
          ) : null}
        </div>
        <div className="space-y-1">
          <Progress value={percent} />
          <p className="text-xs text-muted-foreground">{percent}% concluído</p>
        </div>
      </CardContent>
      <CardFooter>
        <Link
          href={`/treinamentos/${training.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          {isComplete ? (
            <>
              <CheckCircle2 className="size-4" /> Concluído — revisar
            </>
          ) : progress ? (
            <>
              <PlayCircle className="size-4" /> Continuar
            </>
          ) : (
            <>
              <PlayCircle className="size-4" /> Iniciar
            </>
          )}
        </Link>
      </CardFooter>
    </Card>
  );
}
