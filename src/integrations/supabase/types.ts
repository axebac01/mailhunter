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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      companies: {
        Row: {
          country: string | null
          created_at: string
          created_by_job_id: string | null
          domain: string | null
          domain_status: string
          id: string
          industry: string | null
          name: string
          notes: string | null
          source_url: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          created_by_job_id?: string | null
          domain?: string | null
          domain_status?: string
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          source_url?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          created_by_job_id?: string | null
          domain?: string | null
          domain_status?: string
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          source_url?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      contact_people: {
        Row: {
          company_id: string
          crawl_job_id: string | null
          created_at: string
          department: string | null
          found_at: string
          full_name: string
          id: string
          import_id: string | null
          import_row_id: string | null
          role_title: string | null
          source_url: string
        }
        Insert: {
          company_id: string
          crawl_job_id?: string | null
          created_at?: string
          department?: string | null
          found_at?: string
          full_name: string
          id?: string
          import_id?: string | null
          import_row_id?: string | null
          role_title?: string | null
          source_url: string
        }
        Update: {
          company_id?: string
          crawl_job_id?: string | null
          created_at?: string
          department?: string | null
          found_at?: string
          full_name?: string
          id?: string
          import_id?: string | null
          import_row_id?: string | null
          role_title?: string | null
          source_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_people_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_people_crawl_job_id_fkey"
            columns: ["crawl_job_id"]
            isOneToOne: false
            referencedRelation: "crawl_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_people_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_people_import_row_id_fkey"
            columns: ["import_row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_id: string
          contact_type: Database["public"]["Enums"]["contact_type"]
          crawl_job_id: string | null
          created_at: string
          found_at: string
          id: string
          import_id: string | null
          import_row_id: string | null
          is_publicly_listed: boolean
          source_url: string
          value: string
        }
        Insert: {
          company_id: string
          contact_type: Database["public"]["Enums"]["contact_type"]
          crawl_job_id?: string | null
          created_at?: string
          found_at?: string
          id?: string
          import_id?: string | null
          import_row_id?: string | null
          is_publicly_listed?: boolean
          source_url: string
          value: string
        }
        Update: {
          company_id?: string
          contact_type?: Database["public"]["Enums"]["contact_type"]
          crawl_job_id?: string | null
          created_at?: string
          found_at?: string
          id?: string
          import_id?: string | null
          import_row_id?: string | null
          is_publicly_listed?: boolean
          source_url?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_crawl_job_id_fkey"
            columns: ["crawl_job_id"]
            isOneToOne: false
            referencedRelation: "crawl_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_import_row_id_fkey"
            columns: ["import_row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      crawl_jobs: {
        Row: {
          allowed_days: Database["public"]["Enums"]["weekday"][]
          allowed_end_time: string
          allowed_start_time: string
          companies_found: number
          contacts_found: number
          country: string | null
          created_at: string
          deduplicate: boolean
          id: string
          include_contact_forms: boolean
          include_contact_person_names: boolean
          include_contact_person_roles: boolean
          include_departments: boolean
          include_generic_emails: boolean
          include_person_emails: boolean
          include_phones: boolean
          industry: string | null
          last_run_at: string | null
          max_companies: number
          name: string
          notes: string | null
          pages_crawled: number
          people_found: number
          progress: number
          source_type: Database["public"]["Enums"]["source_type"]
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          allowed_days?: Database["public"]["Enums"]["weekday"][]
          allowed_end_time?: string
          allowed_start_time?: string
          companies_found?: number
          contacts_found?: number
          country?: string | null
          created_at?: string
          deduplicate?: boolean
          id?: string
          include_contact_forms?: boolean
          include_contact_person_names?: boolean
          include_contact_person_roles?: boolean
          include_departments?: boolean
          include_generic_emails?: boolean
          include_person_emails?: boolean
          include_phones?: boolean
          industry?: string | null
          last_run_at?: string | null
          max_companies?: number
          name: string
          notes?: string | null
          pages_crawled?: number
          people_found?: number
          progress?: number
          source_type?: Database["public"]["Enums"]["source_type"]
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          allowed_days?: Database["public"]["Enums"]["weekday"][]
          allowed_end_time?: string
          allowed_start_time?: string
          companies_found?: number
          contacts_found?: number
          country?: string | null
          created_at?: string
          deduplicate?: boolean
          id?: string
          include_contact_forms?: boolean
          include_contact_person_names?: boolean
          include_contact_person_roles?: boolean
          include_departments?: boolean
          include_generic_emails?: boolean
          include_person_emails?: boolean
          include_phones?: boolean
          industry?: string | null
          last_run_at?: string | null
          max_companies?: number
          name?: string
          notes?: string | null
          pages_crawled?: number
          people_found?: number
          progress?: number
          source_type?: Database["public"]["Enums"]["source_type"]
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: []
      }
      crawl_logs: {
        Row: {
          crawl_job_id: string
          created_at: string
          id: string
          level: Database["public"]["Enums"]["crawl_log_level"]
          message: string
          meta_json: Json | null
        }
        Insert: {
          crawl_job_id: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["crawl_log_level"]
          message: string
          meta_json?: Json | null
        }
        Update: {
          crawl_job_id?: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["crawl_log_level"]
          message?: string
          meta_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "crawl_logs_crawl_job_id_fkey"
            columns: ["crawl_job_id"]
            isOneToOne: false
            referencedRelation: "crawl_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_blocklist: {
        Row: {
          company_id: string | null
          created_at: string
          host: string
          id: string
          reason: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          host: string
          id?: string
          reason?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          host?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      exports: {
        Row: {
          created_at: string
          export_type: Database["public"]["Enums"]["export_type"]
          file_format: Database["public"]["Enums"]["file_format"]
          file_name: string
          id: string
          row_count: number
        }
        Insert: {
          created_at?: string
          export_type: Database["public"]["Enums"]["export_type"]
          file_format: Database["public"]["Enums"]["file_format"]
          file_name: string
          id?: string
          row_count?: number
        }
        Update: {
          created_at?: string
          export_type?: Database["public"]["Enums"]["export_type"]
          file_format?: Database["public"]["Enums"]["file_format"]
          file_name?: string
          id?: string
          row_count?: number
        }
        Relationships: []
      }
      import_rows: {
        Row: {
          company_name: string
          country: string | null
          created_at: string
          error_message: string | null
          id: string
          import_id: string
          industry: string | null
          matched_company_id: string | null
          matched_domain: string | null
          notes: string | null
          status: Database["public"]["Enums"]["import_status"]
          updated_at: string
          website: string | null
        }
        Insert: {
          company_name: string
          country?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          import_id: string
          industry?: string | null
          matched_company_id?: string | null
          matched_domain?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["import_status"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          company_name?: string
          country?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          import_id?: string
          industry?: string | null
          matched_company_id?: string | null
          matched_domain?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["import_status"]
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_matched_company_id_fkey"
            columns: ["matched_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          contacts_found: number
          crawl_job_id: string | null
          created_at: string
          failed_rows: number
          file_name: string
          file_type: string
          id: string
          matched_rows: number
          people_found: number
          processed_rows: number
          status: Database["public"]["Enums"]["import_status"]
          total_rows: number
          updated_at: string
        }
        Insert: {
          contacts_found?: number
          crawl_job_id?: string | null
          created_at?: string
          failed_rows?: number
          file_name: string
          file_type: string
          id?: string
          matched_rows?: number
          people_found?: number
          processed_rows?: number
          status?: Database["public"]["Enums"]["import_status"]
          total_rows?: number
          updated_at?: string
        }
        Update: {
          contacts_found?: number
          crawl_job_id?: string | null
          created_at?: string
          failed_rows?: number
          file_name?: string
          file_type?: string
          id?: string
          matched_rows?: number
          people_found?: number
          processed_rows?: number
          status?: Database["public"]["Enums"]["import_status"]
          total_rows?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "imports_crawl_job_id_fkey"
            columns: ["crawl_job_id"]
            isOneToOne: false
            referencedRelation: "crawl_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      source_pages: {
        Row: {
          company_id: string
          crawl_job_id: string | null
          crawled_at: string
          extracted_summary: string | null
          id: string
          page_type: Database["public"]["Enums"]["page_type"]
          status_code: number | null
          url: string
        }
        Insert: {
          company_id: string
          crawl_job_id?: string | null
          crawled_at?: string
          extracted_summary?: string | null
          id?: string
          page_type?: Database["public"]["Enums"]["page_type"]
          status_code?: number | null
          url: string
        }
        Update: {
          company_id?: string
          crawl_job_id?: string | null
          crawled_at?: string
          extracted_summary?: string | null
          id?: string
          page_type?: Database["public"]["Enums"]["page_type"]
          status_code?: number | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_pages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_pages_crawl_job_id_fkey"
            columns: ["crawl_job_id"]
            isOneToOne: false
            referencedRelation: "crawl_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clear_all_data: { Args: never; Returns: undefined }
    }
    Enums: {
      contact_type: "generic_email" | "phone" | "contact_form" | "person_email"
      crawl_log_level: "info" | "warn" | "error" | "success"
      export_type: "contacts" | "people" | "job_results" | "import_results"
      file_format: "csv" | "xlsx"
      import_status:
        | "pending"
        | "matched"
        | "partial_match"
        | "not_found"
        | "duplicate"
        | "failed"
        | "processing"
        | "completed"
      job_status:
        | "draft"
        | "scheduled"
        | "running"
        | "paused"
        | "completed"
        | "failed"
        | "stopped"
      page_type: "homepage" | "contact" | "about" | "team" | "people" | "other"
      source_type: "industry_country" | "uploaded" | "manual"
      weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"
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

export const Constants = {
  public: {
    Enums: {
      contact_type: ["generic_email", "phone", "contact_form", "person_email"],
      crawl_log_level: ["info", "warn", "error", "success"],
      export_type: ["contacts", "people", "job_results", "import_results"],
      file_format: ["csv", "xlsx"],
      import_status: [
        "pending",
        "matched",
        "partial_match",
        "not_found",
        "duplicate",
        "failed",
        "processing",
        "completed",
      ],
      job_status: [
        "draft",
        "scheduled",
        "running",
        "paused",
        "completed",
        "failed",
        "stopped",
      ],
      page_type: ["homepage", "contact", "about", "team", "people", "other"],
      source_type: ["industry_country", "uploaded", "manual"],
      weekday: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
  },
} as const
