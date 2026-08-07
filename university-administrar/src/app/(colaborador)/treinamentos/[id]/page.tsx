import { notFound } from "next/navigation";
import {
  getTrainingById,
  listTrainingVideos,
  getQuizByTrainingId,
  getMyVideoProgress,
} from "@/lib/queries/trainings";
import { Badge } from "@/components/ui/badge";
import { TrainingPlayer } from "@/components/domain/training-player";

export default async function TrainingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const training = await getTrainingById(id).catch(() => null);
  if (!training || training.status !== "publicado") notFound();

  const [videos, quiz, progressMap] = await Promise.all([
    listTrainingVideos(id),
    getQuizByTrainingId(id),
    getMyVideoProgress(id),
  ]);

  const initialProgress = Object.fromEntries(
    videos.map((v) => {
      const p = progressMap.get(v.id);
      return [
        v.id,
        {
          video_id: v.id,
          percent_watched: p?.percent_watched ?? 0,
          last_position_seconds: p?.last_position_seconds ?? 0,
          completed_at: p?.completed_at ?? null,
        },
      ];
    })
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{training.title}</h1>
          {training.is_mandatory ? <Badge variant="destructive">Obrigatório</Badge> : null}
        </div>
        {training.description ? (
          <p className="text-muted-foreground">{training.description}</p>
        ) : null}
      </div>

      <TrainingPlayer
        trainingId={id}
        videos={videos}
        initialProgress={initialProgress}
        hasQuiz={!!quiz}
        quizHref={`/treinamentos/${id}/quiz`}
      />
    </div>
  );
}
