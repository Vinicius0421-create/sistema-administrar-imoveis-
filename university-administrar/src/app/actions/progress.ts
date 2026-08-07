"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Atualiza o progresso de um vídeo para o usuário autenticado. user_id nunca
// vem do client — é sempre resolvido a partir da sessão no servidor, então
// não há como um usuário gravar progresso em nome de outro (RLS também
// bloquearia isso mesmo se a checagem aqui fosse removida).
export async function updateVideoProgress(input: {
  videoId: string;
  trainingId: string;
  watchedSeconds: number;
  lastPositionSeconds: number;
  percentWatched: number;
  durationSeconds: number;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const percent = Math.max(0, Math.min(100, Math.round(input.percentWatched * 100) / 100));
  const watched = Math.max(0, Math.min(input.watchedSeconds, input.durationSeconds || input.watchedSeconds));
  const position = Math.max(0, Math.min(input.lastPositionSeconds, input.durationSeconds || input.lastPositionSeconds));

  const { data: existing } = await supabase
    .from("video_progress")
    .select("watched_seconds, percent_watched")
    .eq("user_id", user.id)
    .eq("video_id", input.videoId)
    .maybeSingle();

  const { error } = await supabase.from("video_progress").upsert(
    {
      user_id: user.id,
      video_id: input.videoId,
      watched_seconds: Math.max(watched, existing?.watched_seconds ?? 0),
      last_position_seconds: position,
      percent_watched: Math.max(percent, existing?.percent_watched ?? 0),
    },
    { onConflict: "user_id,video_id" }
  );

  if (error) return { error: error.message };

  revalidatePath(`/treinamentos/${input.trainingId}`);
  revalidatePath("/dashboard");
  return { error: null };
}
