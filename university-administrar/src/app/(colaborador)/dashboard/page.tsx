import Link from "next/link";
import { getCurrentProfile } from "@/lib/dal";
import { listPublishedTrainings, getMyTrainingProgress } from "@/lib/queries/trainings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TrainingCard } from "@/components/domain/training-card";

export default async function DashboardPage() {
  const [profile, trainings, progressMap] = await Promise.all([
    getCurrentProfile(),
    listPublishedTrainings(),
    getMyTrainingProgress(),
  ]);

  const inProgress = trainings.filter((t) => {
    const p = progressMap.get(t.id);
    return p && !p.is_complete;
  });
  const completed = trainings.filter((t) => progressMap.get(t.id)?.is_complete);
  const mandatoryPending = trainings.filter(
    (t) => t.is_mandatory && !progressMap.get(t.id)?.is_complete
  );

  const overallPercent =
    trainings.length === 0 ? 0 : Math.round((completed.length / trainings.length) * 100);

  const firstName = profile.full_name.split(" ")[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {firstName}</h1>
        <p className="text-muted-foreground">
          Aqui está o resumo do seu desenvolvimento no University Administrar.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Disponíveis" value={trainings.length} />
        <StatCard label="Em andamento" value={inProgress.length} />
        <StatCard label="Concluídos" value={completed.length} />
        <StatCard label="Obrigatórios pendentes" value={mandatoryPending.length} highlight />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Progresso geral</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={overallPercent} />
          <p className="text-sm text-muted-foreground">
            {completed.length} de {trainings.length} treinamentos concluídos ({overallPercent}%)
          </p>
        </CardContent>
      </Card>

      {mandatoryPending.length > 0 ? (
        <Section title="O que você precisa fazer">
          <TrainingGrid trainings={mandatoryPending} progressMap={progressMap} />
        </Section>
      ) : null}

      {inProgress.length > 0 ? (
        <Section title="Em andamento">
          <TrainingGrid trainings={inProgress} progressMap={progressMap} />
        </Section>
      ) : null}

      <Section title="Todos os treinamentos" action={<Link href="/treinamentos" className="text-sm text-primary hover:underline">Ver todos</Link>}>
        <TrainingGrid trainings={trainings.slice(0, 6)} progressMap={progressMap} />
      </Section>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className={`text-3xl font-semibold ${highlight && value > 0 ? "text-destructive" : ""}`}>
          {value}
        </p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function TrainingGrid({
  trainings,
  progressMap,
}: {
  trainings: Awaited<ReturnType<typeof listPublishedTrainings>>;
  progressMap: Awaited<ReturnType<typeof getMyTrainingProgress>>;
}) {
  if (trainings.length === 0) {
    return <p className="text-sm text-muted-foreground">Nada por aqui ainda.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {trainings.map((t) => (
        <TrainingCard key={t.id} training={t} progress={progressMap.get(t.id)} />
      ))}
    </div>
  );
}
