// Generated directly from the live BluePrep Supabase schema via
// `mcp__supabase-blueprep__generate_typescript_types`. Do not hand-edit —
// regenerate the same way after any schema migration instead.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_models_cache: {
        Row: {
          context_length: number | null
          label: string
          model_id: string
          pricing_completion: number | null
          pricing_prompt: number | null
          updated_at: string
        }
        Insert: {
          context_length?: number | null
          label: string
          model_id: string
          pricing_completion?: number | null
          pricing_prompt?: number | null
          updated_at?: string
        }
        Update: {
          context_length?: number | null
          label?: string
          model_id?: string
          pricing_completion?: number | null
          pricing_prompt?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_models_cache_meta: {
        Row: {
          id: boolean
          last_refreshed_at: string | null
        }
        Insert: {
          id?: boolean
          last_refreshed_at?: string | null
        }
        Update: {
          id?: boolean
          last_refreshed_at?: string | null
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          created_at: string
          feature: string
          id: string
          session_id: string | null
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          feature: string
          id?: string
          session_id?: string | null
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          feature?: string
          id?: string
          session_id?: string | null
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      choices: {
        Row: {
          content_markup: string
          explanation_markup: string | null
          id: string
          is_correct: boolean
          label: string
          question_id: string
          source_option_id: string | null
        }
        Insert: {
          content_markup: string
          explanation_markup?: string | null
          id?: string
          is_correct?: boolean
          label: string
          question_id: string
          source_option_id?: string | null
        }
        Update: {
          content_markup?: string
          explanation_markup?: string | null
          id?: string
          is_correct?: boolean
          label?: string
          question_id?: string
          source_option_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "choices_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      cues: {
        Row: {
          anchor_scope: string
          anchor_text: string
          choice_id: string | null
          cue_type: string
          end_offset: number | null
          explanation: string
          explanation_title: string | null
          guide_id: string | null
          id: string
          link_group: string | null
          occurrence: number
          question_id: string
          short_label: string | null
          start_offset: number | null
          trap_category: string | null
        }
        Insert: {
          anchor_scope: string
          anchor_text: string
          choice_id?: string | null
          cue_type: string
          end_offset?: number | null
          explanation: string
          explanation_title?: string | null
          guide_id?: string | null
          id?: string
          link_group?: string | null
          occurrence?: number
          question_id: string
          short_label?: string | null
          start_offset?: number | null
          trap_category?: string | null
        }
        Update: {
          anchor_scope?: string
          anchor_text?: string
          choice_id?: string | null
          cue_type?: string
          end_offset?: number | null
          explanation?: string
          explanation_title?: string | null
          guide_id?: string | null
          id?: string
          link_group?: string | null
          occurrence?: number
          question_id?: string
          short_label?: string | null
          start_offset?: number | null
          trap_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cues_choice_id_fkey"
            columns: ["choice_id"]
            isOneToOne: false
            referencedRelation: "choices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cues_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cues_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cues_trap_category_fkey"
            columns: ["trap_category"]
            isOneToOne: false
            referencedRelation: "trap_categories"
            referencedColumns: ["code"]
          },
        ]
      }
      feature_flags: {
        Row: {
          code: string
          description: string
          is_enabled: boolean
          updated_at: string
        }
        Insert: {
          code: string
          description: string
          is_enabled?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          description?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      guardian_links: {
        Row: {
          accepted_at: string | null
          guardian_user_id: string
          id: string
          invited_at: string
          permissions: string[]
          student_user_id: string
        }
        Insert: {
          accepted_at?: string | null
          guardian_user_id: string
          id?: string
          invited_at?: string
          permissions?: string[]
          student_user_id: string
        }
        Update: {
          accepted_at?: string | null
          guardian_user_id?: string
          id?: string
          invited_at?: string
          permissions?: string[]
          student_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_links_guardian_user_id_fkey"
            columns: ["guardian_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_links_student_user_id_fkey"
            columns: ["student_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      guides: {
        Row: {
          body_md: string
          external_url: string | null
          id: string
          skill_subtype: string | null
          title: string
          trap_category: string | null
        }
        Insert: {
          body_md: string
          external_url?: string | null
          id?: string
          skill_subtype?: string | null
          title: string
          trap_category?: string | null
        }
        Update: {
          body_md?: string
          external_url?: string | null
          id?: string
          skill_subtype?: string | null
          title?: string
          trap_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guides_trap_category_fkey"
            columns: ["trap_category"]
            isOneToOne: false
            referencedRelation: "trap_categories"
            referencedColumns: ["code"]
          },
        ]
      }
      plans: {
        Row: {
          ai_coaching_enabled: boolean
          code: string
          created_at: string
          max_linked_students: number
          monthly_question_limit: number | null
          name: string
          price_cents: number
        }
        Insert: {
          ai_coaching_enabled?: boolean
          code: string
          created_at?: string
          max_linked_students?: number
          monthly_question_limit?: number | null
          name: string
          price_cents: number
        }
        Update: {
          ai_coaching_enabled?: boolean
          code?: string
          created_at?: string
          max_linked_students?: number
          monthly_question_limit?: number | null
          name?: string
          price_cents?: number
        }
        Relationships: []
      }
      practice_sessions: {
        Row: {
          actual_count: number | null
          allotted_seconds: number | null
          completed_at: string | null
          created_at: string
          difficulty_filter: string[] | null
          domain_filter: string[] | null
          exclude_previously_correct: boolean
          feedback_mode: string
          id: string
          include_new_only: boolean
          include_retired: boolean
          mode: string
          overtime_seconds: number | null
          paused_at: string | null
          question_ids: string[]
          requested_count: number
          score_summary: Json | null
          size_preset: string | null
          started_at: string
          subject_filter: string | null
          timer_basis: string
          timer_mode: string
          total_paused_seconds: number
          user_id: string
        }
        Insert: {
          actual_count?: number | null
          allotted_seconds?: number | null
          completed_at?: string | null
          created_at?: string
          difficulty_filter?: string[] | null
          domain_filter?: string[] | null
          exclude_previously_correct?: boolean
          feedback_mode?: string
          id?: string
          include_new_only?: boolean
          include_retired: boolean
          mode: string
          overtime_seconds?: number | null
          paused_at?: string | null
          question_ids?: string[]
          requested_count: number
          score_summary?: Json | null
          size_preset?: string | null
          started_at?: string
          subject_filter?: string | null
          timer_basis: string
          timer_mode: string
          total_paused_seconds?: number
          user_id: string
        }
        Update: {
          actual_count?: number | null
          allotted_seconds?: number | null
          completed_at?: string | null
          created_at?: string
          difficulty_filter?: string[] | null
          domain_filter?: string[] | null
          exclude_previously_correct?: boolean
          feedback_mode?: string
          id?: string
          include_new_only?: boolean
          include_retired?: boolean
          mode?: string
          overtime_seconds?: number | null
          paused_at?: string | null
          question_ids?: string[]
          requested_count?: number
          score_summary?: Json | null
          size_preset?: string | null
          started_at?: string
          subject_filter?: string | null
          timer_basis?: string
          timer_mode?: string
          total_paused_seconds?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      question_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          entered_value: string | null
          highlights: Json
          id: string
          is_correct: boolean | null
          question_id: string
          selected_choice_id: string | null
          session_id: string | null
          started_at: string | null
          struck_choice_ids: string[]
          submitted_at: string | null
          time_taken_seconds: number | null
          user_id: string
        }
        Insert: {
          attempt_number: number
          created_at?: string
          entered_value?: string | null
          highlights?: Json
          id?: string
          is_correct?: boolean | null
          question_id: string
          selected_choice_id?: string | null
          session_id?: string | null
          started_at?: string | null
          struck_choice_ids?: string[]
          submitted_at?: string | null
          time_taken_seconds?: number | null
          user_id: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          entered_value?: string | null
          highlights?: Json
          id?: string
          is_correct?: boolean | null
          question_id?: string
          selected_choice_id?: string | null
          session_id?: string | null
          started_at?: string | null
          struck_choice_ids?: string[]
          submitted_at?: string | null
          time_taken_seconds?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_attempts_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_selected_choice_id_fkey"
            columns: ["selected_choice_id"]
            isOneToOne: false
            referencedRelation: "choices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      question_notes: {
        Row: {
          note: string
          question_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          note: string
          question_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          note?: string
          question_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_notes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      question_sources: {
        Row: {
          code: string
          created_at: string
          default_license_note: string | null
          id: string
          kind: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          default_license_note?: string | null
          id?: string
          kind: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          default_license_note?: string | null
          id?: string
          kind?: string
          name?: string
        }
        Relationships: []
      }
      questions: {
        Row: {
          accepted_answers: Json | null
          created_at: string
          difficulty: string
          domain: string
          domain_code: string
          id: string
          is_active: boolean
          response_type: string
          score_band: number | null
          skill: string | null
          skill_code: string | null
          source: string
          source_created_at: string | null
          source_external_id: string | null
          source_id: string
          source_metadata: Json | null
          source_rationale_markup: string | null
          source_secondary_id: string | null
          source_updated_at: string | null
          stem_markup: string
          stimulus_markup: string | null
          subject: string
          updated_at: string
        }
        Insert: {
          accepted_answers?: Json | null
          created_at?: string
          difficulty: string
          domain: string
          domain_code: string
          id?: string
          is_active?: boolean
          response_type: string
          score_band?: number | null
          skill?: string | null
          skill_code?: string | null
          source?: string
          source_created_at?: string | null
          source_external_id?: string | null
          source_id: string
          source_metadata?: Json | null
          source_rationale_markup?: string | null
          source_secondary_id?: string | null
          source_updated_at?: string | null
          stem_markup: string
          stimulus_markup?: string | null
          subject: string
          updated_at?: string
        }
        Update: {
          accepted_answers?: Json | null
          created_at?: string
          difficulty?: string
          domain?: string
          domain_code?: string
          id?: string
          is_active?: boolean
          response_type?: string
          score_band?: number | null
          skill?: string | null
          skill_code?: string | null
          source?: string
          source_created_at?: string | null
          source_external_id?: string | null
          source_id?: string
          source_metadata?: Json | null
          source_rationale_markup?: string | null
          source_secondary_id?: string | null
          source_updated_at?: string | null
          stem_markup?: string
          stimulus_markup?: string | null
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "question_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      session_modules: {
        Row: {
          completed_at: string | null
          correct_count: number | null
          id: string
          module_number: number
          question_ids: string[]
          session_id: string
          started_at: string | null
          subject: string
          tier: string | null
        }
        Insert: {
          completed_at?: string | null
          correct_count?: number | null
          id?: string
          module_number: number
          question_ids?: string[]
          session_id: string
          started_at?: string | null
          subject: string
          tier?: string | null
        }
        Update: {
          completed_at?: string | null
          correct_count?: number | null
          id?: string
          module_number?: number
          question_ids?: string[]
          session_id?: string
          started_at?: string | null
          subject?: string
          tier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_modules_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          current_period_end: string | null
          id: string
          plan_code: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          user_id: string
        }
        Insert: {
          current_period_end?: string | null
          id?: string
          plan_code: string
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          user_id: string
        }
        Update: {
          current_period_end?: string | null
          id?: string
          plan_code?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_difficulty_profiles: {
        Row: {
          easy_pct: number
          hard_pct: number
          medium_pct: number
          tier: string
        }
        Insert: {
          easy_pct: number
          hard_pct: number
          medium_pct: number
          tier: string
        }
        Update: {
          easy_pct?: number
          hard_pct?: number
          medium_pct?: number
          tier?: string
        }
        Relationships: []
      }
      trap_categories: {
        Row: {
          code: string
          description: string
          label: string
          subject: string
        }
        Insert: {
          code: string
          description: string
          label: string
          subject: string
        }
        Update: {
          code?: string
          description?: string
          label?: string
          subject?: string
        }
        Relationships: []
      }
      user_ai_settings: {
        Row: {
          connected_at: string | null
          key_last4: string | null
          model: string | null
          provider: string
          updated_at: string
          user_id: string
          vault_secret_id: string | null
        }
        Insert: {
          connected_at?: string | null
          key_last4?: string | null
          model?: string | null
          provider?: string
          updated_at?: string
          user_id: string
          vault_secret_id?: string | null
        }
        Update: {
          connected_at?: string | null
          key_last4?: string | null
          model?: string | null
          provider?: string
          updated_at?: string
          user_id?: string
          vault_secret_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_ai_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          explanation_verbosity: string
          feedback_mode_default: string
          font_size: string
          include_retired_default: boolean
          mistake_resurface_days: number
          show_ai_cues_default: boolean
          target_score: number | null
          test_date: string | null
          theme: string
          timer_mode_default: string
          updated_at: string
          user_id: string
        }
        Insert: {
          explanation_verbosity?: string
          feedback_mode_default?: string
          font_size?: string
          include_retired_default?: boolean
          mistake_resurface_days?: number
          show_ai_cues_default?: boolean
          target_score?: number | null
          test_date?: string | null
          theme?: string
          timer_mode_default?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          explanation_verbosity?: string
          feedback_mode_default?: string
          font_size?: string
          include_retired_default?: boolean
          mistake_resurface_days?: number
          show_ai_cues_default?: boolean
          target_score?: number | null
          test_date?: string | null
          theme?: string
          timer_mode_default?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      disconnect_ai_key: { Args: never; Returns: undefined }
      get_ai_key: { Args: never; Returns: string }
      save_ai_key: {
        Args: { p_api_key: string; p_model: string; p_provider: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
