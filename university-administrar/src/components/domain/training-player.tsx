"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, CirclePlay, PlayCircle } from "lucide-react";
import { updateVideoProgress } from "@/app/actions/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Video = {
  id: string;
  title: string;
  description: string | null;
  duration_seconds: number;
  video_url: string;
  order: number;
};

type VideoProgress = {
  video_id: string;
  percent_watched: number;
  last_position_seconds: number;
  completed_at: string | null;
};

const PROGRESS_SAVE_INTERVAL_MS = 5000;
const COMPLETION_THRESHOLD_PERCENT = 90;

export function TrainingPlayer({
  trainingId,
  videos,
  initialProgress,
  hasQuiz,
  quizHref,
}: {
  trainingId: string;
  videos: Video[];
  initialProgress: Record<string, VideoProgress>;
  hasQuiz: boolean;
  quizHref: string;
}) {
  const [progress, setProgress] = useState(initialProgress);
  const [activeVideoId, setActiveVideoId] = useState(() => {
    const firstUnfinished = videos.find((v) => !progress[v.id]?.completed_at);
    return (firstUnfinished ?? videos[0])?.id;
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedAtRef = useRef(0);
  const [, startTransition] = useTransition();

  const activeVideo = videos.find((v) => v.id === activeVideoId) ?? videos[0];
  const allCompleted = videos.length > 0 && videos.every((v) => progress[v.id]?.completed_at);

  const resumePosition = activeVideo ? progress[activeVideo.id]?.last_position_seconds ?? 0 : 0;

  // Aplica a retomada em onLoadedMetadata (não em useEffect no mount): o
  // navegador costuma ignorar currentTime definido antes de ter os metadados
  // do vídeo carregados, então setar direto no mount é pouco confiável.
  function handleLoadedMetadata() {
    const el = videoRef.current;
    if (!el || !activeVideo) return;
    if (resumePosition > 1 && resumePosition < activeVideo.duration_seconds - 2) {
      el.currentTime = resumePosition;
    }
  }

  function persist(video: Video, currentTime: number, ended: boolean) {
    const duration = video.duration_seconds || videoRef.current?.duration || currentTime;
    const percent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
    const finalPercent = ended ? 100 : percent;

    setProgress((prev) => ({
      ...prev,
      [video.id]: {
        video_id: video.id,
        percent_watched: Math.max(finalPercent, prev[video.id]?.percent_watched ?? 0),
        last_position_seconds: currentTime,
        completed_at:
          finalPercent >= COMPLETION_THRESHOLD_PERCENT
            ? new Date().toISOString()
            : (prev[video.id]?.completed_at ?? null),
      },
    }));

    startTransition(() => {
      updateVideoProgress({
        videoId: video.id,
        trainingId,
        watchedSeconds: Math.round(currentTime),
        lastPositionSeconds: Math.round(currentTime),
        percentWatched: finalPercent,
        durationSeconds: Math.round(duration),
      });
    });
  }

  function handleTimeUpdate() {
    const el = videoRef.current;
    if (!el || !activeVideo) return;
    const now = Date.now();
    if (now - lastSavedAtRef.current < PROGRESS_SAVE_INTERVAL_MS) return;
    lastSavedAtRef.current = now;
    persist(activeVideo, el.currentTime, false);
  }

  function handleEnded() {
    if (!activeVideo) return;
    persist(activeVideo, activeVideo.duration_seconds || videoRef.current?.duration || 0, true);

    const currentIndex = videos.findIndex((v) => v.id === activeVideo.id);
    const next = videos[currentIndex + 1];
    if (next) setActiveVideoId(next.id);
  }

  function handlePause() {
    const el = videoRef.current;
    if (!el || !activeVideo) return;
    persist(activeVideo, el.currentTime, false);
  }

  if (!activeVideo) {
    return <p className="text-sm text-muted-foreground">Este treinamento ainda não tem vídeos.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <video
          key={activeVideo.id}
          ref={videoRef}
          src={activeVideo.video_url}
          controls
          className="aspect-video w-full rounded-lg bg-black"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onPause={handlePause}
        />
        <div>
          <h2 className="font-medium">{activeVideo.title}</h2>
          {activeVideo.description ? (
            <p className="text-sm text-muted-foreground">{activeVideo.description}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-3 pt-6">
            {videos.map((video) => {
              const vp = progress[video.id];
              const isActive = video.id === activeVideoId;
              const isCompleted = !!vp?.completed_at;
              return (
                <button
                  key={video.id}
                  onClick={() => setActiveVideoId(video.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md p-2 text-left text-sm transition-colors hover:bg-muted",
                    isActive && "bg-muted"
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="size-4 shrink-0 text-primary" />
                  ) : isActive ? (
                    <CirclePlay className="size-4 shrink-0 text-primary" />
                  ) : (
                    <PlayCircle className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate">{video.title}</span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {hasQuiz ? (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <p className="text-sm font-medium">Quiz final</p>
              <Progress value={allCompleted ? 100 : 0} />
              {allCompleted ? (
                <Button asChild className="w-full">
                  <Link href={quizHref}>Fazer o quiz</Link>
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Assista a todos os vídeos para liberar o quiz.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
