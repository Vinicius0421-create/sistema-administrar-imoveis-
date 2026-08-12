import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

type TrainingProgressRow = Database["public"]["Views"]["training_progress"]["Row"];

export async function listPublishedTrainings() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trainings")
    .select("*")
    .eq("status", "publicado")
    .order("order", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getTrainingById(trainingId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trainings")
    .select("*")
    .eq("id", trainingId)
    .single();

  if (error) throw error;
  return data;
}

export async function listTrainingVideos(trainingId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_videos")
    .select("*")
    .eq("training_id", trainingId)
    .eq("status", "ativo")
    .order("order", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getQuizByTrainingId(trainingId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quizzes")
    .select("*")
    .eq("training_id", trainingId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// Progresso do usuário autenticado (RLS restringe automaticamente às próprias
// linhas). Retorna um mapa training_id -> progresso para facilitar o dashboard.
export async function getMyTrainingProgress() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Map<string, TrainingProgressRow>();

  const { data, error } = await supabase
    .from("training_progress")
    .select("*")
    .eq("user_id", user.id);

  if (error) throw error;

  return new Map(data.map((row) => [row.training_id, row]));
}

export async function getMyVideoProgress(trainingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Map();

  const videos = await listTrainingVideos(trainingId);
  if (videos.length === 0) return new Map();

  const { data, error } = await supabase
    .from("video_progress")
    .select("*")
    .eq("user_id", user.id)
    .in(
      "video_id",
      videos.map((v) => v.id)
    );

  if (error) throw error;
  return new Map(data.map((row) => [row.video_id, row]));
}
