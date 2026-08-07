import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getTrainingForAdmin } from "@/lib/queries/admin-trainings";
import { updateTraining } from "@/app/actions/admin-trainings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrainingForm } from "@/components/domain/training-form";
import { VideoManager } from "@/components/domain/video-manager";
import { QuizManager } from "@/components/domain/quiz-manager";
import { TrainingStatusActions } from "@/components/domain/training-status-actions";

export default async function EditTrainingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id } = await params;

  const result = await getTrainingForAdmin(id);
  if (!result) notFound();
  const { training, videos, quiz, questions } = result;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{training.title}</h1>
            <Badge>{training.status}</Badge>
          </div>
          <p className="text-muted-foreground">Gerencie informações, vídeos e quiz.</p>
        </div>
        <TrainingStatusActions trainingId={training.id} status={training.status} />
      </div>

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Informações</TabsTrigger>
          <TabsTrigger value="videos">Vídeos ({videos.length})</TabsTrigger>
          <TabsTrigger value="quiz">Quiz</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">Informações</CardTitle>
            </CardHeader>
            <CardContent>
              <TrainingForm
                defaultValues={training}
                action={updateTraining.bind(null, training.id)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="videos">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">Vídeos</CardTitle>
            </CardHeader>
            <CardContent>
              <VideoManager trainingId={training.id} videos={videos} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quiz">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">Quiz</CardTitle>
            </CardHeader>
            <CardContent>
              <QuizManager
                trainingId={training.id}
                quizId={quiz?.id ?? null}
                passingScore={training.passing_score}
                questions={questions}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
