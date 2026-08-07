// Tipos manuais espelhando supabase/migrations/*.sql. Em produção, prefira
// gerar isto com `supabase gen types typescript` — mantido manual aqui porque
// não há CLI/projeto Supabase provisionado neste ambiente de desenvolvimento.
//
// Relationships fica vazio propositalmente: não usamos embeds aninhados
// (select("foo(bar)")) do PostgREST em nenhuma query da aplicação — cada
// junção é feita explicitamente em TypeScript (ver lib/queries/*.ts) para
// manter os tipos simples e previsíveis sem depender de codegen.

export type UserRole = "colaborador" | "gestor" | "admin";
export type UserStatus = "ativo" | "desativado";
export type TrainingStatus = "rascunho" | "publicado" | "arquivado";
export type ItemStatus = "ativo" | "inativo";

type NoRelationships = { Relationships: [] };

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          role: UserRole;
          department: string | null;
          status: UserStatus;
          manager_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          full_name: string;
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
      } & NoRelationships;
      trainings: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          cover_url: string | null;
          category: string | null;
          status: TrainingStatus;
          order: number;
          passing_score: number;
          estimated_minutes: number | null;
          is_mandatory: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trainings"]["Row"]> & {
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["trainings"]["Row"]>;
      } & NoRelationships;
      training_videos: {
        Row: {
          id: string;
          training_id: string;
          title: string;
          description: string | null;
          order: number;
          duration_seconds: number;
          video_url: string;
          status: ItemStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["training_videos"]["Row"]> & {
          training_id: string;
          title: string;
          video_url: string;
        };
        Update: Partial<Database["public"]["Tables"]["training_videos"]["Row"]>;
      } & NoRelationships;
      video_progress: {
        Row: {
          id: string;
          user_id: string;
          video_id: string;
          watched_seconds: number;
          last_position_seconds: number;
          percent_watched: number;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["video_progress"]["Row"]> & {
          user_id: string;
          video_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["video_progress"]["Row"]>;
      } & NoRelationships;
      quizzes: {
        Row: {
          id: string;
          training_id: string;
          title: string;
          passing_score: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["quizzes"]["Row"]> & {
          training_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["quizzes"]["Row"]>;
      } & NoRelationships;
      quiz_questions: {
        Row: {
          id: string;
          quiz_id: string;
          question: string;
          order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["quiz_questions"]["Row"]> & {
          quiz_id: string;
          question: string;
        };
        Update: Partial<Database["public"]["Tables"]["quiz_questions"]["Row"]>;
      } & NoRelationships;
      quiz_options: {
        Row: {
          id: string;
          question_id: string;
          option_text: string;
          is_correct: boolean;
          order: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["quiz_options"]["Row"]> & {
          question_id: string;
          option_text: string;
        };
        Update: Partial<Database["public"]["Tables"]["quiz_options"]["Row"]>;
      } & NoRelationships;
      quiz_attempts: {
        Row: {
          id: string;
          user_id: string;
          quiz_id: string;
          attempt_number: number;
          score: number;
          percent: number;
          passed: boolean;
          started_at: string;
          finished_at: string | null;
          duration_seconds: number | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["quiz_attempts"]["Row"]> & {
          user_id: string;
          quiz_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["quiz_attempts"]["Row"]>;
      } & NoRelationships;
      quiz_attempt_answers: {
        Row: {
          id: string;
          attempt_id: string;
          question_id: string;
          selected_option_id: string | null;
          is_correct: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["quiz_attempt_answers"]["Row"]> & {
          attempt_id: string;
          question_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["quiz_attempt_answers"]["Row"]>;
      } & NoRelationships;
      activity_log: {
        Row: {
          id: string;
          user_id: string;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["activity_log"]["Row"]> & {
          user_id: string;
          action: string;
        };
        Update: Partial<Database["public"]["Tables"]["activity_log"]["Row"]>;
      } & NoRelationships;
    };
    Views: {
      training_progress: {
        Row: {
          training_id: string;
          training_title: string;
          is_mandatory: boolean;
          passing_score: number;
          user_id: string;
          total_videos: number;
          completed_videos: number;
          has_quiz: boolean;
          quiz_passed: boolean;
          quiz_best_percent: number | null;
          quiz_attempts_count: number;
          percent_complete: number | null;
          is_complete: boolean;
          last_activity_at: string | null;
        };
      } & NoRelationships;
    };
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      user_status: UserStatus;
      training_status: TrainingStatus;
      item_status: ItemStatus;
    };
  };
}
