import { listPublishedTrainings, getMyTrainingProgress } from "@/lib/queries/trainings";
import { TrainingCard } from "@/components/domain/training-card";

export default async function TreinamentosPage() {
  const [trainings, progressMap] = await Promise.all([
    listPublishedTrainings(),
    getMyTrainingProgress(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Treinamentos</h1>
        <p className="text-muted-foreground">Todos os treinamentos disponíveis para você.</p>
      </div>

      {trainings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum treinamento publicado ainda.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trainings.map((t) => (
            <TrainingCard key={t.id} training={t} progress={progressMap.get(t.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
