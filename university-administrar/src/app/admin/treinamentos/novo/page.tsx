import { requireRole } from "@/lib/dal";
import { TrainingForm } from "@/components/domain/training-form";
import { createTraining } from "@/app/actions/admin-trainings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function NewTrainingPage() {
  await requireRole("admin");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo treinamento</h1>
        <p className="text-muted-foreground">Comece pelas informações básicas.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Informações</CardTitle>
        </CardHeader>
        <CardContent>
          <TrainingForm action={createTraining} />
        </CardContent>
      </Card>
    </div>
  );
}
