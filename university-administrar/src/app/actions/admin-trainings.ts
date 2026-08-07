"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { requireRole } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

// Todas as mutações aqui exigem role=admin via requireRole (redireciona quem
// não é admin) E são protegidas pelas policies "*_write" (0003_rls.sql), que
// só permitem INSERT/UPDATE/DELETE para is_admin() — defesa em profundidade.

const TrainingSchema = z.object({
  title: z.string().trim().min(3, "Título muito curto."),
  description: z.string().trim().optional(),
  category: z.string().trim().optional(),
  estimatedMinutes: z.coerce.number().int().min(0).optional(),
  passingScore: z.coerce.number().int().min(0).max(100),
  isMandatory: z.coerce.boolean().optional(),
});

export async function createTraining(formData: FormData) {
  const profile = await requireRole("admin");
  const parsed = TrainingSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    category: formData.get("category") || undefined,
    estimatedMinutes: formData.get("estimatedMinutes") || undefined,
    passingScore: formData.get("passingScore") || 70,
    isMandatory: formData.get("isMandatory") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trainings")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      category: parsed.data.category ?? null,
      estimated_minutes: parsed.data.estimatedMinutes ?? null,
      passing_score: parsed.data.passingScore,
      is_mandatory: parsed.data.isMandatory ?? false,
      created_by: profile.id,
      status: "rascunho",
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Erro ao criar treinamento." };

  revalidatePath("/admin/treinamentos");
  redirect(`/admin/treinamentos/${data.id}`);
}

export async function updateTraining(trainingId: string, formData: FormData) {
  await requireRole("admin");
  const parsed = TrainingSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    category: formData.get("category") || undefined,
    estimatedMinutes: formData.get("estimatedMinutes") || undefined,
    passingScore: formData.get("passingScore") || 70,
    isMandatory: formData.get("isMandatory") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("trainings")
    .update({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      category: parsed.data.category ?? null,
      estimated_minutes: parsed.data.estimatedMinutes ?? null,
      passing_score: parsed.data.passingScore,
      is_mandatory: parsed.data.isMandatory ?? false,
    })
    .eq("id", trainingId);

  if (error) return { error: error.message };
  revalidatePath(`/admin/treinamentos/${trainingId}`);
  revalidatePath("/admin/treinamentos");
  return { error: null };
}

export async function setTrainingStatus(
  trainingId: string,
  status: "rascunho" | "publicado" | "arquivado"
) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("trainings").update({ status }).eq("id", trainingId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/treinamentos/${trainingId}`);
  revalidatePath("/admin/treinamentos");
  return { error: null };
}

export async function deleteTraining(trainingId: string) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("trainings").delete().eq("id", trainingId);
  if (error) return { error: error.message };
  revalidatePath("/admin/treinamentos");
  redirect("/admin/treinamentos");
}

// --- Vídeos ---------------------------------------------------------------

const VideoSchema = z.object({
  title: z.string().trim().min(2, "Título muito curto."),
  description: z.string().trim().optional(),
  videoUrl: z.string().trim().url("URL inválida."),
  durationSeconds: z.coerce.number().int().min(0),
  order: z.coerce.number().int().min(0).default(0),
});

export async function addTrainingVideo(trainingId: string, formData: FormData) {
  await requireRole("admin");
  const parsed = VideoSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    videoUrl: formData.get("videoUrl"),
    durationSeconds: formData.get("durationSeconds") || 0,
    order: formData.get("order") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("training_videos").insert({
    training_id: trainingId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    video_url: parsed.data.videoUrl,
    duration_seconds: parsed.data.durationSeconds,
    order: parsed.data.order,
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/treinamentos/${trainingId}`);
  return { error: null };
}

export async function deleteTrainingVideo(trainingId: string, videoId: string) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("training_videos").delete().eq("id", videoId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/treinamentos/${trainingId}`);
  return { error: null };
}

// --- Quiz -------------------------------------------------------------

export async function ensureQuiz(trainingId: string, passingScore: number) {
  await requireRole("admin");
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("quizzes")
    .select("id")
    .eq("training_id", trainingId)
    .maybeSingle();
  if (existing) return { error: null, quizId: existing.id };

  const { data, error } = await supabase
    .from("quizzes")
    .insert({ training_id: trainingId, passing_score: passingScore })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Erro ao criar quiz." };

  revalidatePath(`/admin/treinamentos/${trainingId}`);
  return { error: null, quizId: data.id };
}

const QuestionSchema = z.object({
  question: z.string().trim().min(3, "Pergunta muito curta."),
  order: z.coerce.number().int().min(0).default(0),
  optionTexts: z.array(z.string().trim().min(1)).min(2, "Adicione ao menos 2 alternativas."),
  correctIndex: z.coerce.number().int().min(0),
});

export async function addQuizQuestion(trainingId: string, quizId: string, formData: FormData) {
  await requireRole("admin");

  const optionTexts = formData.getAll("optionText").map(String).filter((v) => v.trim() !== "");
  const parsed = QuestionSchema.safeParse({
    question: formData.get("question"),
    order: formData.get("order") || 0,
    optionTexts,
    correctIndex: formData.get("correctIndex") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: question, error: questionError } = await supabase
    .from("quiz_questions")
    .insert({ quiz_id: quizId, question: parsed.data.question, order: parsed.data.order })
    .select("id")
    .single();
  if (questionError || !question) {
    return { error: questionError?.message ?? "Erro ao criar pergunta." };
  }

  const { error: optionsError } = await supabase.from("quiz_options").insert(
    parsed.data.optionTexts.map((text, index) => ({
      question_id: question.id,
      option_text: text,
      is_correct: index === parsed.data.correctIndex,
      order: index,
    }))
  );
  if (optionsError) return { error: optionsError.message };

  revalidatePath(`/admin/treinamentos/${trainingId}`);
  return { error: null };
}

export async function deleteQuizQuestion(trainingId: string, questionId: string) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("quiz_questions").delete().eq("id", questionId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/treinamentos/${trainingId}`);
  return { error: null };
}
