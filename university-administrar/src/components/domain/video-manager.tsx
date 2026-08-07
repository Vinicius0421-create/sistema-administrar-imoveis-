"use client";

import { useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { addTrainingVideo, deleteTrainingVideo } from "@/app/actions/admin-trainings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

type Video = {
  id: string;
  title: string;
  video_url: string;
  duration_seconds: number;
  order: number;
};

export function VideoManager({ trainingId, videos }: { trainingId: string; videos: Video[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleAdd(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await addTrainingVideo(trainingId, formData);
      if (res?.error) {
        setError(res.error);
        return;
      }
      formRef.current?.reset();
    });
  }

  function handleDelete(videoId: string) {
    startTransition(async () => {
      await deleteTrainingVideo(trainingId, videoId);
    });
  }

  return (
    <div className="space-y-4">
      {videos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum vídeo cadastrado.</p>
      ) : (
        <ul className="space-y-2">
          {videos.map((v) => (
            <li key={v.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
              <div>
                <p className="font-medium">{v.title}</p>
                <p className="text-xs text-muted-foreground">
                  {Math.round(v.duration_seconds / 60)} min · ordem {v.order}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => handleDelete(v.id)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">Adicionar vídeo</p>
          <form ref={formRef} action={handleAdd} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="video-title">Título</Label>
              <Input id="video-title" name="title" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="video-description">Descrição</Label>
              <Input id="video-description" name="description" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="video-url">URL do vídeo</Label>
              <Input id="video-url" name="videoUrl" type="url" placeholder="https://…" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="video-duration">Duração (segundos)</Label>
                <Input id="video-duration" name="durationSeconds" type="number" min={0} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="video-order">Ordem</Label>
                <Input id="video-order" name="order" type="number" min={0} defaultValue={videos.length} />
              </div>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Adicionando…" : "Adicionar vídeo"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
