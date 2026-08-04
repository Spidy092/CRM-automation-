--
-- PostgreSQL database dump
--

\restrict podaBTeldxDNT4I8AWqDTDj9dSZt4IzDG1O1cDFIroeszjS6ELSFxufdn9DEE3s

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: activity_type; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.activity_type AS ENUM (
    'call',
    'whatsapp',
    'email',
    'note',
    'status_change',
    'assignment_change'
);


ALTER TYPE public.activity_type OWNER TO crm;

--
-- Name: ai_inbox_item_status; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.ai_inbox_item_status AS ENUM (
    'pending',
    'actioned',
    'snoozed',
    'auto_resolved'
);


ALTER TYPE public.ai_inbox_item_status OWNER TO crm;

--
-- Name: ai_inbox_item_type; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.ai_inbox_item_type AS ENUM (
    'approve_response',
    'urgent_reply',
    'pricing_inquiry',
    'campaign_review',
    'lead_handoff',
    'objection_review'
);


ALTER TYPE public.ai_inbox_item_type OWNER TO crm;

--
-- Name: assignment_type; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.assignment_type AS ENUM (
    'round_robin',
    'manual',
    'override'
);


ALTER TYPE public.assignment_type OWNER TO crm;

--
-- Name: campaign_status; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.campaign_status AS ENUM (
    'draft',
    'active',
    'paused',
    'completed',
    'archived'
);


ALTER TYPE public.campaign_status OWNER TO crm;

--
-- Name: custom_field_type; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.custom_field_type AS ENUM (
    'text',
    'number',
    'date',
    'dropdown',
    'checkbox'
);


ALTER TYPE public.custom_field_type OWNER TO crm;

--
-- Name: lead_classification; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.lead_classification AS ENUM (
    'hot',
    'warm',
    'cold'
);


ALTER TYPE public.lead_classification OWNER TO crm;

--
-- Name: lead_status; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.lead_status AS ENUM (
    'active',
    'paused',
    'won',
    'lost',
    'opted_out'
);


ALTER TYPE public.lead_status OWNER TO crm;

--
-- Name: message_channel; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.message_channel AS ENUM (
    'whatsapp',
    'email',
    'sms',
    'phone_call'
);


ALTER TYPE public.message_channel OWNER TO crm;

--
-- Name: outreach_status; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.outreach_status AS ENUM (
    'queued',
    'sent',
    'delivered',
    'opened',
    'clicked',
    'replied',
    'failed',
    'bounced'
);


ALTER TYPE public.outreach_status OWNER TO crm;

--
-- Name: outreach_tone; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.outreach_tone AS ENUM (
    'formal',
    'professional',
    'conversational'
);


ALTER TYPE public.outreach_tone OWNER TO crm;

--
-- Name: scraper_log_status; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.scraper_log_status AS ENUM (
    'running',
    'completed',
    'failed',
    'partially_completed'
);


ALTER TYPE public.scraper_log_status OWNER TO crm;

--
-- Name: scraper_source_type; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.scraper_source_type AS ENUM (
    'google_places',
    'facebook',
    'youtube',
    'web_scrape'
);


ALTER TYPE public.scraper_source_type OWNER TO crm;

--
-- Name: task_status; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.task_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'cancelled'
);


ALTER TYPE public.task_status OWNER TO crm;

--
-- Name: task_type; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.task_type AS ENUM (
    'phone_call',
    'follow_up',
    'meeting_prep',
    'other'
);


ALTER TYPE public.task_type OWNER TO crm;

--
-- Name: template_approval_status; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.template_approval_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


ALTER TYPE public.template_approval_status OWNER TO crm;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'manager',
    'sales',
    'marketing',
    'viewer'
);


ALTER TYPE public.user_role OWNER TO crm;

--
-- Name: webhook_event_status; Type: TYPE; Schema: public; Owner: crm
--

CREATE TYPE public.webhook_event_status AS ENUM (
    'received',
    'processed',
    'failed'
);


ALTER TYPE public.webhook_event_status OWNER TO crm;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: crm
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$;


ALTER FUNCTION public.set_updated_at() OWNER TO crm;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activities; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    user_id uuid,
    type public.activity_type NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.activities OWNER TO crm;

--
-- Name: agent_actions; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.agent_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source character varying(50) NOT NULL,
    action_name character varying(100) NOT NULL,
    action_args jsonb DEFAULT '{}'::jsonb NOT NULL,
    risk_tier character varying(40) NOT NULL,
    status character varying(40) DEFAULT 'proposed'::character varying NOT NULL,
    requested_by uuid,
    requester_role character varying(30),
    requester_email character varying(255),
    requester_name character varying(255),
    approved_by uuid,
    lead_id uuid,
    campaign_id uuid,
    confidence integer,
    autonomy_level character varying(20),
    idempotency_key character varying(255) NOT NULL,
    result jsonb,
    error_message text,
    source_message text,
    expires_at timestamp with time zone,
    executed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_plan_id uuid,
    agent_plan_step_id uuid,
    CONSTRAINT agent_actions_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= 0) AND (confidence <= 100)))),
    CONSTRAINT agent_actions_risk_tier_check CHECK (((risk_tier)::text = ANY ((ARRAY['read'::character varying, 'low_risk_write'::character varying, 'customer_facing_write'::character varying, 'sensitive_write'::character varying, 'compliance_critical'::character varying, 'unsupported'::character varying])::text[]))),
    CONSTRAINT agent_actions_source_check CHECK (((source)::text = ANY ((ARRAY['chat'::character varying, 'event'::character varying, 'ai_reply'::character varying, 'ai_decision'::character varying, 'ai_campaign_brain'::character varying, 'expiry'::character varying, 'manual'::character varying])::text[]))),
    CONSTRAINT agent_actions_status_check CHECK (((status)::text = ANY ((ARRAY['proposed'::character varying, 'pending_approval'::character varying, 'approved'::character varying, 'rejected'::character varying, 'executing'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'expired'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE public.agent_actions OWNER TO crm;

--
-- Name: agent_plan_steps; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.agent_plan_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    step_index integer NOT NULL,
    action_name character varying(100) NOT NULL,
    action_args jsonb DEFAULT '{}'::jsonb NOT NULL,
    risk_tier character varying(40) NOT NULL,
    depends_on integer[] DEFAULT '{}'::integer[] NOT NULL,
    rationale text NOT NULL,
    status character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    agent_action_id uuid,
    result jsonb,
    error_message text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT agent_plan_steps_risk_tier_check CHECK (((risk_tier)::text = ANY ((ARRAY['read'::character varying, 'low_risk_write'::character varying, 'sensitive_write'::character varying, 'customer_facing_write'::character varying])::text[]))),
    CONSTRAINT agent_plan_steps_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'pending_approval'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'skipped'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT agent_plan_steps_step_index_check CHECK ((step_index >= 0))
);


ALTER TABLE public.agent_plan_steps OWNER TO crm;

--
-- Name: agent_plans; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.agent_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id text,
    goal text NOT NULL,
    status character varying(40) NOT NULL,
    autonomy_level character varying(20),
    confidence integer,
    source character varying(50) NOT NULL,
    requested_by uuid,
    source_message text,
    cost_cap_cents integer DEFAULT 50 NOT NULL,
    step_cap integer DEFAULT 8 NOT NULL,
    cost_used_cents integer DEFAULT 0 NOT NULL,
    deadline_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    CONSTRAINT agent_plans_status_check CHECK (((status)::text = ANY ((ARRAY['proposed'::character varying, 'approved'::character varying, 'running'::character varying, 'paused_for_approval'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'cancelled'::character varying, 'expired'::character varying])::text[])))
);


ALTER TABLE public.agent_plans OWNER TO crm;

--
-- Name: ai_decision_log; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.ai_decision_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid,
    campaign_id uuid,
    decision_type character varying(50) NOT NULL,
    input_context jsonb DEFAULT '{}'::jsonb NOT NULL,
    chain_of_thought text,
    decision character varying(100) NOT NULL,
    confidence integer,
    tokens_used integer,
    latency_ms integer,
    model_used character varying(100),
    autonomy_level character varying(20),
    human_approval_required boolean DEFAULT false NOT NULL,
    human_approved_by uuid,
    human_approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_decision_log_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= 0) AND (confidence <= 100)))),
    CONSTRAINT ai_decision_log_decision_type_check CHECK (((decision_type)::text = ANY ((ARRAY['research'::character varying, 'next_action'::character varying, 'reply_classify'::character varying, 'campaign_brief'::character varying, 'chat'::character varying, 'agent_action'::character varying])::text[])))
);


ALTER TABLE public.ai_decision_log OWNER TO crm;

--
-- Name: ai_inbox_items; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.ai_inbox_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assigned_to uuid NOT NULL,
    lead_id uuid,
    campaign_id uuid,
    item_type public.ai_inbox_item_type NOT NULL,
    title character varying(255) NOT NULL,
    summary text,
    urgency_score integer DEFAULT 50 NOT NULL,
    ai_draft_response text,
    ai_draft_confidence integer,
    expires_at timestamp with time zone,
    status public.ai_inbox_item_status DEFAULT 'pending'::public.ai_inbox_item_status NOT NULL,
    snoozed_until timestamp with time zone,
    actioned_by uuid,
    actioned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_action_id uuid,
    action_result jsonb,
    agent_plan_id uuid,
    agent_plan_step_id uuid,
    CONSTRAINT ai_inbox_items_draft_confidence_check CHECK (((ai_draft_confidence IS NULL) OR ((ai_draft_confidence >= 0) AND (ai_draft_confidence <= 100)))),
    CONSTRAINT ai_inbox_items_urgency_check CHECK (((urgency_score >= 0) AND (urgency_score <= 100)))
);


ALTER TABLE public.ai_inbox_items OWNER TO crm;

--
-- Name: ai_settings; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.ai_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    singleton_guard boolean DEFAULT true NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    base_url text,
    encrypted_api_key text,
    model character varying(255) DEFAULT 'gpt-4o'::character varying NOT NULL,
    max_tokens integer DEFAULT 500 NOT NULL,
    temperature numeric(3,2) DEFAULT 0.7 NOT NULL,
    system_prompt_override text,
    cache_ttl_seconds integer DEFAULT 604800 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_settings_max_tokens_cap_check CHECK ((max_tokens <= 500)),
    CONSTRAINT ai_settings_singleton_guard_check CHECK ((singleton_guard = true))
);


ALTER TABLE public.ai_settings OWNER TO crm;

--
-- Name: assignment_config; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.assignment_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    threshold_score integer DEFAULT 70 NOT NULL,
    eligible_roles public.user_role[] DEFAULT ARRAY['sales'::public.user_role] NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assignment_config_threshold_score_check CHECK (((threshold_score >= 0) AND (threshold_score <= 100)))
);


ALTER TABLE public.assignment_config OWNER TO crm;

--
-- Name: assignments; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    assigned_to uuid NOT NULL,
    assigned_by uuid,
    assignment_type public.assignment_type NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.assignments OWNER TO crm;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    entity_type character varying(100) NOT NULL,
    entity_id uuid,
    old_value jsonb,
    new_value jsonb,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO crm;

--
-- Name: booking_urls; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.booking_urls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    slug character varying(100) NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    location_type character varying(20) DEFAULT 'google_meet'::character varying NOT NULL,
    location_details text,
    buffer_before_min integer DEFAULT 0 NOT NULL,
    buffer_after_min integer DEFAULT 0 NOT NULL,
    max_advance_days integer DEFAULT 30 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.booking_urls OWNER TO crm;

--
-- Name: bookings; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_url_id uuid NOT NULL,
    user_id uuid NOT NULL,
    lead_id uuid,
    booker_name character varying(200) NOT NULL,
    booker_email character varying(200) NOT NULL,
    booker_phone character varying(30),
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'confirmed'::character varying NOT NULL,
    meeting_url text,
    notes text,
    google_event_id character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.bookings OWNER TO crm;

--
-- Name: campaign_ai_briefs; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.campaign_ai_briefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    total_leads_evaluated integer,
    eligible_leads integer,
    high_fit_leads integer,
    segment_summary text,
    recommended_offer_angle text,
    expected_objections jsonb DEFAULT '[]'::jsonb NOT NULL,
    risk_warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    recommended_sequence jsonb DEFAULT '[]'::jsonb NOT NULL,
    template_suggestions jsonb DEFAULT '[]'::jsonb NOT NULL,
    recommended_autonomy_level character varying(20),
    confidence_score integer,
    status character varying(20) DEFAULT '''draft'''::character varying NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_ai_briefs_autonomy_check CHECK (((recommended_autonomy_level IS NULL) OR ((recommended_autonomy_level)::text = ANY ((ARRAY['supervised'::character varying, 'guarded'::character varying, 'autopilot'::character varying])::text[])))),
    CONSTRAINT campaign_ai_briefs_confidence_check CHECK (((confidence_score IS NULL) OR ((confidence_score >= 0) AND (confidence_score <= 100)))),
    CONSTRAINT campaign_ai_briefs_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


ALTER TABLE public.campaign_ai_briefs OWNER TO crm;

--
-- Name: campaign_leads; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.campaign_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.campaign_leads OWNER TO crm;

--
-- Name: campaign_variants; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.campaign_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    variant_key character varying(10) NOT NULL,
    template_id uuid,
    split_pct integer DEFAULT 50 NOT NULL,
    is_winner boolean DEFAULT false NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_variants_split_pct_check CHECK (((split_pct >= 1) AND (split_pct <= 100)))
);


ALTER TABLE public.campaign_variants OWNER TO crm;

--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    status public.campaign_status DEFAULT 'draft'::public.campaign_status NOT NULL,
    tone public.outreach_tone DEFAULT 'professional'::public.outreach_tone NOT NULL,
    target_industries text[] DEFAULT '{}'::text[] NOT NULL,
    target_countries text[] DEFAULT '{}'::text[] NOT NULL,
    sequence_id uuid,
    pipeline_id uuid,
    created_by uuid NOT NULL,
    launched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    ai_personalization_enabled boolean DEFAULT false NOT NULL,
    autonomy_level character varying(20) DEFAULT 'guarded'::character varying NOT NULL,
    ai_min_confidence integer DEFAULT 70 NOT NULL,
    trigger_stage_id uuid,
    ab_test_enabled boolean DEFAULT false NOT NULL,
    ab_test_metric character varying(30) DEFAULT 'open_rate'::character varying NOT NULL,
    ab_test_min_samples integer DEFAULT 100 NOT NULL,
    ab_test_confidence numeric(4,2) DEFAULT 95 NOT NULL,
    ab_test_auto_promote boolean DEFAULT true NOT NULL,
    CONSTRAINT campaigns_ai_min_confidence_check CHECK (((ai_min_confidence >= 0) AND (ai_min_confidence <= 100))),
    CONSTRAINT campaigns_autonomy_level_check CHECK (((autonomy_level)::text = ANY ((ARRAY['supervised'::character varying, 'guarded'::character varying, 'autopilot'::character varying])::text[])))
);


ALTER TABLE public.campaigns OWNER TO crm;

--
-- Name: custom_field_definitions; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.custom_field_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(255) NOT NULL,
    field_key character varying(100) NOT NULL,
    field_type public.custom_field_type NOT NULL,
    options jsonb,
    is_required boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.custom_field_definitions OWNER TO crm;

--
-- Name: form_submissions; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.form_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    form_id uuid NOT NULL,
    lead_id uuid,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address character varying(45),
    user_agent text,
    referrer character varying(500),
    status character varying(20) DEFAULT 'submitted'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.form_submissions OWNER TO crm;

--
-- Name: forms; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(100) NOT NULL,
    description text,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    submit_action character varying(50) DEFAULT 'create_lead'::character varying NOT NULL,
    submit_message text DEFAULT 'Thank you for your submission!'::text NOT NULL,
    redirect_url character varying(500),
    is_active boolean DEFAULT true NOT NULL,
    theme jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.forms OWNER TO crm;

--
-- Name: integrations; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    display_name character varying(255) NOT NULL,
    is_enabled boolean DEFAULT false NOT NULL,
    encrypted_credentials text,
    last_tested_at timestamp with time zone,
    last_test_status character varying(50),
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.integrations OWNER TO crm;

--
-- Name: lead_ai_profiles; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.lead_ai_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    website_quality_score integer,
    pain_points jsonb DEFAULT '[]'::jsonb NOT NULL,
    offer_angle text,
    inferred_budget_range character varying(20),
    buying_intent character varying(20) DEFAULT '''unknown'''::character varying,
    reachability_score integer,
    buying_signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    objection_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    do_not_say jsonb DEFAULT '[]'::jsonb NOT NULL,
    preferred_channel character varying(20),
    preferred_time_of_day character varying(20),
    conversation_summary text,
    ai_notes text,
    next_best_action character varying(50),
    next_best_action_reason text,
    next_best_action_confidence integer,
    enrichment_status character varying(20) DEFAULT '''pending'''::character varying NOT NULL,
    last_enriched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lead_ai_profiles_buying_intent_check CHECK (((buying_intent)::text = ANY ((ARRAY['high'::character varying, 'medium'::character varying, 'low'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT lead_ai_profiles_confidence_check CHECK (((next_best_action_confidence IS NULL) OR ((next_best_action_confidence >= 0) AND (next_best_action_confidence <= 100)))),
    CONSTRAINT lead_ai_profiles_enrichment_status_check CHECK (((enrichment_status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'done'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT lead_ai_profiles_preferred_channel_check CHECK (((preferred_channel IS NULL) OR ((preferred_channel)::text = ANY ((ARRAY['whatsapp'::character varying, 'email'::character varying, 'sms'::character varying])::text[])))),
    CONSTRAINT lead_ai_profiles_reachability_check CHECK (((reachability_score IS NULL) OR ((reachability_score >= 0) AND (reachability_score <= 100)))),
    CONSTRAINT lead_ai_profiles_website_quality_check CHECK (((website_quality_score IS NULL) OR ((website_quality_score >= 0) AND (website_quality_score <= 100))))
);


ALTER TABLE public.lead_ai_profiles OWNER TO crm;

--
-- Name: lead_conversation_summaries; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.lead_conversation_summaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    summary text NOT NULL,
    last_interaction_at timestamp with time zone,
    last_intent_class character varying(50),
    interaction_count integer DEFAULT 0 NOT NULL,
    sentiment character varying(20),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lead_conv_summaries_sentiment_check CHECK (((sentiment IS NULL) OR ((sentiment)::text = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying])::text[]))))
);


ALTER TABLE public.lead_conversation_summaries OWNER TO crm;

--
-- Name: leads; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_name character varying(255) NOT NULL,
    contact_name character varying(255) NOT NULL,
    phone character varying(50) NOT NULL,
    email character varying(255) NOT NULL,
    website character varying(500),
    industry character varying(100) NOT NULL,
    location character varying(255) NOT NULL,
    country character varying(100),
    google_rating numeric(2,1),
    review_count integer,
    social_links jsonb,
    source_platform character varying(100) NOT NULL,
    lead_score integer DEFAULT 0 NOT NULL,
    classification public.lead_classification,
    status public.lead_status DEFAULT 'active'::public.lead_status NOT NULL,
    assigned_to uuid,
    pipeline_stage_id uuid,
    custom_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    first_contacted_at timestamp with time zone,
    deal_value numeric(12,2) DEFAULT NULL::numeric,
    CONSTRAINT leads_google_rating_check CHECK (((google_rating >= (0)::numeric) AND (google_rating <= (5)::numeric))),
    CONSTRAINT leads_lead_score_check CHECK (((lead_score >= 0) AND (lead_score <= 100))),
    CONSTRAINT leads_review_count_check CHECK ((review_count >= 0))
);


ALTER TABLE public.leads OWNER TO crm;

--
-- Name: outreach_logs; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.outreach_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    campaign_id uuid,
    channel public.message_channel NOT NULL,
    template_id uuid,
    step_number integer,
    status public.outreach_status DEFAULT 'queued'::public.outreach_status NOT NULL,
    external_msg_id character varying(255),
    message_body text,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    opened_at timestamp with time zone,
    replied_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    clicked_at timestamp with time zone,
    click_url text
);


ALTER TABLE public.outreach_logs OWNER TO crm;

--
-- Name: outreach_sequences; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.outreach_sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL
);


ALTER TABLE public.outreach_sequences OWNER TO crm;

--
-- Name: pgmigrations; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.pgmigrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    run_on timestamp without time zone NOT NULL
);


ALTER TABLE public.pgmigrations OWNER TO crm;

--
-- Name: pgmigrations_id_seq; Type: SEQUENCE; Schema: public; Owner: crm
--

CREATE SEQUENCE public.pgmigrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pgmigrations_id_seq OWNER TO crm;

--
-- Name: pgmigrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: crm
--

ALTER SEQUENCE public.pgmigrations_id_seq OWNED BY public.pgmigrations.id;


--
-- Name: pipeline_stages; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    "position" integer NOT NULL,
    is_terminal_won boolean DEFAULT false NOT NULL,
    is_terminal_lost boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.pipeline_stages OWNER TO crm;

--
-- Name: pipelines; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.pipelines OWNER TO crm;

--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.refresh_tokens OWNER TO crm;

--
-- Name: report_schedules; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.report_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    report_type character varying(100) NOT NULL,
    frequency character varying(50) NOT NULL,
    target_roles public.user_role[] DEFAULT '{}'::public.user_role[] NOT NULL,
    recipients text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT report_schedules_frequency_check CHECK (((frequency)::text = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying, 'monthly'::character varying])::text[])))
);


ALTER TABLE public.report_schedules OWNER TO crm;

--
-- Name: scoring_config; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.scoring_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hot_min_score integer DEFAULT 70 NOT NULL,
    warm_min_score integer DEFAULT 40 NOT NULL,
    assignment_threshold integer DEFAULT 70 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scoring_config_assignment_threshold_check CHECK (((assignment_threshold >= 0) AND (assignment_threshold <= 100))),
    CONSTRAINT scoring_config_hot_min_score_check CHECK (((hot_min_score >= 0) AND (hot_min_score <= 100))),
    CONSTRAINT scoring_config_warm_min_score_check CHECK (((warm_min_score >= 0) AND (warm_min_score <= 100)))
);


ALTER TABLE public.scoring_config OWNER TO crm;

--
-- Name: scoring_rules; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.scoring_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    factor character varying(100) NOT NULL,
    weight integer NOT NULL,
    condition jsonb NOT NULL,
    score_value integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scoring_rules_score_value_check CHECK (((score_value >= 0) AND (score_value <= 100))),
    CONSTRAINT scoring_rules_weight_check CHECK (((weight >= 0) AND (weight <= 100)))
);


ALTER TABLE public.scoring_rules OWNER TO crm;

--
-- Name: scraper_configs; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.scraper_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    source_type public.scraper_source_type NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    schedule_cron character varying(100),
    last_run_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.scraper_configs OWNER TO crm;

--
-- Name: scraper_logs; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.scraper_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    config_id uuid NOT NULL,
    status public.scraper_log_status DEFAULT 'running'::public.scraper_log_status NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    records_found integer DEFAULT 0 NOT NULL,
    records_imported integer DEFAULT 0 NOT NULL,
    records_failed integer DEFAULT 0 NOT NULL,
    error_message text,
    raw_response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.scraper_logs OWNER TO crm;

--
-- Name: tasks; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    campaign_id uuid,
    sequence_id uuid,
    step_number integer,
    assigned_to uuid,
    type public.task_type DEFAULT 'phone_call'::public.task_type NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    due_at timestamp with time zone,
    status public.task_status DEFAULT 'pending'::public.task_status NOT NULL,
    completed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tasks OWNER TO crm;

--
-- Name: template_variant_assignments; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.template_variant_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    variant_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.template_variant_assignments OWNER TO crm;

--
-- Name: template_variants; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.template_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    variant_key character varying(10) NOT NULL,
    subject character varying(200),
    body text NOT NULL,
    split_pct integer DEFAULT 50 NOT NULL,
    is_winner boolean DEFAULT false NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.template_variants OWNER TO crm;

--
-- Name: templates; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    channel public.message_channel NOT NULL,
    subject character varying(500),
    body text NOT NULL,
    variables text[] DEFAULT '{}'::text[] NOT NULL,
    approval_status public.template_approval_status DEFAULT 'pending'::public.template_approval_status NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL
);


ALTER TABLE public.templates OWNER TO crm;

--
-- Name: user_availability; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.user_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    start_time character varying(5) NOT NULL,
    end_time character varying(5) NOT NULL,
    slot_duration_min integer DEFAULT 30 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_availability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


ALTER TABLE public.user_availability OWNER TO crm;

--
-- Name: users; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role public.user_role DEFAULT 'sales'::public.user_role NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.users OWNER TO crm;

--
-- Name: variant_assignments; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.variant_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    variant_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.variant_assignments OWNER TO crm;

--
-- Name: variant_snapshots; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.variant_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    variant_id uuid NOT NULL,
    sent integer DEFAULT 0 NOT NULL,
    delivered integer DEFAULT 0 NOT NULL,
    opened integer DEFAULT 0 NOT NULL,
    clicked integer DEFAULT 0 NOT NULL,
    replied integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    open_rate numeric(5,2) DEFAULT 0 NOT NULL,
    click_rate numeric(5,2) DEFAULT 0 NOT NULL,
    reply_rate numeric(5,2) DEFAULT 0 NOT NULL,
    snapshot_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.variant_snapshots OWNER TO crm;

--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider character varying(50) NOT NULL,
    event_id character varying(255) NOT NULL,
    idempotency_key character varying(255),
    raw_payload jsonb NOT NULL,
    signature_header text,
    headers jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.webhook_event_status DEFAULT 'received'::public.webhook_event_status NOT NULL,
    lead_id uuid,
    error_message text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone
);


ALTER TABLE public.webhook_events OWNER TO crm;

--
-- Name: pgmigrations id; Type: DEFAULT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.pgmigrations ALTER COLUMN id SET DEFAULT nextval('public.pgmigrations_id_seq'::regclass);


--
-- Data for Name: activities; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.activities (id, lead_id, user_id, type, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: agent_actions; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.agent_actions (id, source, action_name, action_args, risk_tier, status, requested_by, requester_role, requester_email, requester_name, approved_by, lead_id, campaign_id, confidence, autonomy_level, idempotency_key, result, error_message, source_message, expires_at, executed_at, created_at, updated_at, agent_plan_id, agent_plan_step_id) FROM stdin;
\.


--
-- Data for Name: agent_plan_steps; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.agent_plan_steps (id, plan_id, step_index, action_name, action_args, risk_tier, depends_on, rationale, status, agent_action_id, result, error_message, started_at, completed_at) FROM stdin;
\.


--
-- Data for Name: agent_plans; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.agent_plans (id, conversation_id, goal, status, autonomy_level, confidence, source, requested_by, source_message, cost_cap_cents, step_cap, cost_used_cents, deadline_at, started_at, completed_at, expires_at, error_message, created_at, updated_at, idempotency_key) FROM stdin;
\.


--
-- Data for Name: ai_decision_log; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.ai_decision_log (id, lead_id, campaign_id, decision_type, input_context, chain_of_thought, decision, confidence, tokens_used, latency_ms, model_used, autonomy_level, human_approval_required, human_approved_by, human_approved_at, created_at) FROM stdin;
\.


--
-- Data for Name: ai_inbox_items; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.ai_inbox_items (id, assigned_to, lead_id, campaign_id, item_type, title, summary, urgency_score, ai_draft_response, ai_draft_confidence, expires_at, status, snoozed_until, actioned_by, actioned_at, created_at, updated_at, agent_action_id, action_result, agent_plan_id, agent_plan_step_id) FROM stdin;
\.


--
-- Data for Name: ai_settings; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.ai_settings (id, singleton_guard, enabled, base_url, encrypted_api_key, model, max_tokens, temperature, system_prompt_override, cache_ttl_seconds, updated_by, created_at, updated_at) FROM stdin;
82cda1f5-d973-442a-a9be-850daf1865e1	t	f	\N	\N	gpt-4o	500	0.70	\N	604800	\N	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
\.


--
-- Data for Name: assignment_config; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.assignment_config (id, is_enabled, threshold_score, eligible_roles, updated_by, updated_at) FROM stdin;
\.


--
-- Data for Name: assignments; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.assignments (id, lead_id, assigned_to, assigned_by, assignment_type, created_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, created_at) FROM stdin;
\.


--
-- Data for Name: booking_urls; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.booking_urls (id, user_id, slug, title, description, location_type, location_details, buffer_before_min, buffer_after_min, max_advance_days, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: bookings; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.bookings (id, booking_url_id, user_id, lead_id, booker_name, booker_email, booker_phone, starts_at, ends_at, status, meeting_url, notes, google_event_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: campaign_ai_briefs; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.campaign_ai_briefs (id, campaign_id, total_leads_evaluated, eligible_leads, high_fit_leads, segment_summary, recommended_offer_angle, expected_objections, risk_warnings, recommended_sequence, template_suggestions, recommended_autonomy_level, confidence_score, status, approved_by, approved_at, created_at) FROM stdin;
\.


--
-- Data for Name: campaign_leads; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.campaign_leads (id, campaign_id, lead_id, added_at) FROM stdin;
\.


--
-- Data for Name: campaign_variants; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.campaign_variants (id, campaign_id, name, variant_key, template_id, split_pct, is_winner, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: campaigns; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.campaigns (id, name, status, tone, target_industries, target_countries, sequence_id, pipeline_id, created_by, launched_at, created_at, updated_at, deleted_at, ai_personalization_enabled, autonomy_level, ai_min_confidence, trigger_stage_id, ab_test_enabled, ab_test_metric, ab_test_min_samples, ab_test_confidence, ab_test_auto_promote) FROM stdin;
\.


--
-- Data for Name: custom_field_definitions; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.custom_field_definitions (id, label, field_key, field_type, options, is_required, is_active, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: form_submissions; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.form_submissions (id, form_id, lead_id, data, ip_address, user_agent, referrer, status, created_at) FROM stdin;
\.


--
-- Data for Name: forms; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.forms (id, name, slug, description, fields, submit_action, submit_message, redirect_url, is_active, theme, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: integrations; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.integrations (id, name, display_name, is_enabled, encrypted_credentials, last_tested_at, last_test_status, updated_by, updated_at) FROM stdin;
e20ecc66-c95f-460b-8322-3d731ef097e4	whatsapp	WhatsApp Cloud API	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
c1a4c8b7-70ba-45a8-9dc7-0b2150e42aa5	twilio	Twilio SMS	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
cec4acdd-79f7-43d0-9663-5ad1bdb3f15c	sendgrid	SendGrid Email	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
d546da32-0c64-4fa3-8a8b-b0daceda06df	smtp	SMTP Server	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
4d0ae864-f2c5-4135-97ba-03c3eb4aca07	google_sheets	Google Sheets	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
ac252e35-0212-46ab-b9f6-60c806c4c64c	google_calendar	Google Calendar	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
fbd9e600-bc40-408b-8b4b-57c7ebc6388f	outlook	Microsoft Outlook	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
631beb6f-e94e-43a5-b7b7-ade1ac916905	slack	Slack	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
2876fea6-9409-4be1-9d06-5d184de87346	teams	Microsoft Teams	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
6cdd250d-554b-4e26-abe2-cfe042c190a6	crm	External CRM Platform	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
f197553f-62be-4596-a127-70615ca9623d	openwa	OpenWA WhatsApp	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
0b8f9369-0d21-46e8-85c1-c38c7c8b957a	hunter	Hunter.io	f	\N	\N	\N	\N	2026-07-06 12:45:16.287269+00
\.


--
-- Data for Name: lead_ai_profiles; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.lead_ai_profiles (id, lead_id, website_quality_score, pain_points, offer_angle, inferred_budget_range, buying_intent, reachability_score, buying_signals, objection_log, do_not_say, preferred_channel, preferred_time_of_day, conversation_summary, ai_notes, next_best_action, next_best_action_reason, next_best_action_confidence, enrichment_status, last_enriched_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: lead_conversation_summaries; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.lead_conversation_summaries (id, lead_id, summary, last_interaction_at, last_intent_class, interaction_count, sentiment, updated_at) FROM stdin;
\.


--
-- Data for Name: leads; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.leads (id, business_name, contact_name, phone, email, website, industry, location, country, google_rating, review_count, social_links, source_platform, lead_score, classification, status, assigned_to, pipeline_stage_id, custom_fields, tags, notes, created_at, updated_at, deleted_at, first_contacted_at, deal_value) FROM stdin;
\.


--
-- Data for Name: outreach_logs; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.outreach_logs (id, lead_id, campaign_id, channel, template_id, step_number, status, external_msg_id, message_body, sent_at, delivered_at, opened_at, replied_at, error_message, created_at, updated_at, clicked_at, click_url) FROM stdin;
\.


--
-- Data for Name: outreach_sequences; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.outreach_sequences (id, name, steps, created_by, created_at, updated_at, description, is_active) FROM stdin;
\.


--
-- Data for Name: pgmigrations; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.pgmigrations (id, name, run_on) FROM stdin;
1	1750000000000_initial-schema	2026-07-06 12:45:16.287269
2	1750000000001_seed-system-user	2026-07-06 12:45:16.287269
3	1750000000002_seed-default-pipeline	2026-07-06 12:45:16.287269
4	1750000000003_seed-scoring-config	2026-07-06 12:45:16.287269
5	1750000000004_seed-integrations	2026-07-06 12:45:16.287269
6	1750000000005_add-soft-delete-columns	2026-07-06 12:45:16.287269
7	1750000000006_add-assignments-table	2026-07-06 12:45:16.287269
8	1750000000007_rename-user-role-sales-rep-to-sales	2026-07-06 12:45:16.287269
9	1750000000008_webhook-events	2026-07-06 12:45:16.287269
10	1750000000009_fix-pipeline-exclude-gist	2026-07-06 12:45:16.287269
11	1750000000010_fix-assignment-eligible-roles-type	2026-07-06 12:45:16.287269
12	1750000000011_seed-admin-user	2026-07-06 12:45:16.287269
13	1750000000012_scraper-tables	2026-07-06 12:45:16.287269
14	1750000000013_add-users-soft-delete	2026-07-06 12:45:16.287269
15	1750000000014_ai-settings	2026-07-06 12:45:16.287269
16	1750000000015_campaigns-ai-toggle	2026-07-06 12:45:16.287269
17	1750000000016_ai-settings-token-cap	2026-07-06 12:45:16.287269
18	1750000000017_lead-ai-profiles	2026-07-06 12:45:16.287269
19	1750000000018_ai-decision-log	2026-07-06 12:45:16.287269
20	1750000000019_lead-conversation-summaries	2026-07-06 12:45:16.287269
21	1750000000020_campaign-ai-briefs	2026-07-06 12:45:16.287269
22	1750000000021_ai-inbox-items	2026-07-06 12:45:16.287269
23	1750000000022_campaign-autonomy-columns	2026-07-06 12:45:16.287269
24	1750000000025_seed-openwa	2026-07-06 12:45:16.287269
25	1750000000026_fix-campaign-autonomy-default	2026-07-06 12:45:16.287269
26	1750000000027_agent-actions	2026-07-06 12:45:16.287269
27	1750000000028_ai-decision-log-agent-types	2026-07-06 12:45:16.287269
28	1750000000029_seed-hunter-integration	2026-07-06 12:45:16.287269
29	1750000000030_agent-plans	2026-07-06 12:45:16.287269
30	1750000000031_outreach-provider-routing	2026-07-06 12:45:16.287269
31	1750000000032_campaign-trigger-stage	2026-07-06 12:45:16.287269
32	1750000000033_add-activities-and-lead-first-contacted	2026-07-06 12:45:16.287269
33	1750000000033_sequence-description-active	2026-07-06 12:45:16.287269
34	1750000000034_add-clicked-status-and-deal-value	2026-07-06 12:45:16.287269
35	1750000000035_tracking-forms-abtesting	2026-07-06 12:45:16.287269
36	1750000000036_template-abtesting-scheduling	2026-07-06 12:45:16.287269
37	1750000000037_template-attachments	2026-07-06 12:45:16.287269
\.


--
-- Data for Name: pipeline_stages; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.pipeline_stages (id, pipeline_id, name, "position", is_terminal_won, is_terminal_lost, created_at, updated_at) FROM stdin;
97aff345-c225-45f7-9a6e-6b62ae2e61b0	00000000-0000-0000-0000-000000000010	New Lead	1	f	f	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
d341d480-a512-4d39-bf04-40ede59db908	00000000-0000-0000-0000-000000000010	Contacted	2	f	f	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
c96ef275-1292-40f3-b38c-8de42b203571	00000000-0000-0000-0000-000000000010	Follow-Up Required	3	f	f	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
846b4812-ea79-4b37-ad63-e25e5652b87b	00000000-0000-0000-0000-000000000010	Interested	4	f	f	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
cef72835-a7e5-49d2-ae1f-e7f3f5b45f41	00000000-0000-0000-0000-000000000010	Meeting Scheduled	5	f	f	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
18dacf23-c688-4c7f-af66-2b909bfc3f82	00000000-0000-0000-0000-000000000010	Proposal Sent	6	f	f	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
174494b5-5d99-4606-95d6-fff39d4532bb	00000000-0000-0000-0000-000000000010	Negotiation	7	f	f	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
baa01cb7-08ff-427c-883e-6648dc363c94	00000000-0000-0000-0000-000000000010	Won	8	t	f	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
14da97f3-2724-4c0e-965b-fbf5383aee80	00000000-0000-0000-0000-000000000010	Lost	9	f	t	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
\.


--
-- Data for Name: pipelines; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.pipelines (id, name, is_default, created_by, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-000000000010	Default Sales Pipeline	t	00000000-0000-0000-0000-000000000001	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.refresh_tokens (id, user_id, token_hash, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: report_schedules; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.report_schedules (id, name, report_type, frequency, target_roles, recipients, is_active, last_run_at, next_run_at, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: scoring_config; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.scoring_config (id, hot_min_score, warm_min_score, assignment_threshold, updated_by, updated_at) FROM stdin;
29c46a76-350a-40b8-9962-3098ccb1b344	70	40	70	00000000-0000-0000-0000-000000000001	2026-07-06 12:45:16.287269+00
\.


--
-- Data for Name: scoring_rules; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.scoring_rules (id, factor, weight, condition, score_value, is_active, created_by, created_at, updated_at) FROM stdin;
5febc62a-a460-47e4-806b-68e4966430e7	industry_relevance	20	{"match": "target_industry"}	20	t	00000000-0000-0000-0000-000000000001	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
2a35f018-ab86-4094-8f94-d9d9b2396689	google_rating	15	{"gte": 4.0}	15	t	00000000-0000-0000-0000-000000000001	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
6bbcbf20-b08a-43b9-bf63-49a4c9f749c6	review_count	10	{"gte": 50}	10	t	00000000-0000-0000-0000-000000000001	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
4cac1562-5bbd-4659-af5f-56a57bd26f16	has_website	10	{"exists": "website"}	10	t	00000000-0000-0000-0000-000000000001	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
5570ae72-ce82-4eb6-a262-b3604006966e	social_presence	10	{"exists": "social_links"}	10	t	00000000-0000-0000-0000-000000000001	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
3379a8b8-25dc-45f8-b387-d6d15719f89b	source_reliability	15	{"source": ["google_business", "google_ads"]}	15	t	00000000-0000-0000-0000-000000000001	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
59849b44-241c-4d0d-afa4-adf661ff0b2f	previous_engagement	20	{"replied": true}	20	t	00000000-0000-0000-0000-000000000001	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00
\.


--
-- Data for Name: scraper_configs; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.scraper_configs (id, name, source_type, is_active, config, schedule_cron, last_run_at, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: scraper_logs; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.scraper_logs (id, config_id, status, started_at, completed_at, records_found, records_imported, records_failed, error_message, raw_response, created_at) FROM stdin;
\.


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.tasks (id, lead_id, campaign_id, sequence_id, step_number, assigned_to, type, title, description, due_at, status, completed_at, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: template_variant_assignments; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.template_variant_assignments (id, variant_id, lead_id, assigned_at) FROM stdin;
\.


--
-- Data for Name: template_variants; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.template_variants (id, template_id, name, variant_key, subject, body, split_pct, is_winner, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: templates; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.templates (id, name, channel, subject, body, variables, approval_status, approved_by, approved_at, rejection_reason, created_by, created_at, updated_at, attachments) FROM stdin;
\.


--
-- Data for Name: user_availability; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.user_availability (id, user_id, day_of_week, start_time, end_time, slot_duration_min, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.users (id, name, email, password_hash, role, is_available, is_active, created_at, updated_at, deleted_at) FROM stdin;
00000000-0000-0000-0000-000000000001	System	system@crm.internal	not-a-real-hash	admin	t	t	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00	\N
00000000-0000-0000-0000-000000000002	Admin	admin@crm.io	$2b$12$HHZjckHIz5RuEHGgzZ.DW.YbXE2Bvie8NJq8oiBG3V4sTwdAvSrUq	admin	t	t	2026-07-06 12:45:16.287269+00	2026-07-06 12:45:16.287269+00	\N
\.


--
-- Data for Name: variant_assignments; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.variant_assignments (id, variant_id, lead_id, assigned_at) FROM stdin;
\.


--
-- Data for Name: variant_snapshots; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.variant_snapshots (id, variant_id, sent, delivered, opened, clicked, replied, failed, open_rate, click_rate, reply_rate, snapshot_at) FROM stdin;
\.


--
-- Data for Name: webhook_events; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.webhook_events (id, provider, event_id, idempotency_key, raw_payload, signature_header, headers, status, lead_id, error_message, received_at, processed_at) FROM stdin;
\.


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: crm
--

SELECT pg_catalog.setval('public.pgmigrations_id_seq', 37, true);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: agent_actions agent_actions_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: agent_actions agent_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_pkey PRIMARY KEY (id);


--
-- Name: agent_plan_steps agent_plan_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_plan_steps
    ADD CONSTRAINT agent_plan_steps_pkey PRIMARY KEY (id);


--
-- Name: agent_plans agent_plans_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_plans
    ADD CONSTRAINT agent_plans_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: agent_plans agent_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_plans
    ADD CONSTRAINT agent_plans_pkey PRIMARY KEY (id);


--
-- Name: ai_decision_log ai_decision_log_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_decision_log
    ADD CONSTRAINT ai_decision_log_pkey PRIMARY KEY (id);


--
-- Name: ai_inbox_items ai_inbox_items_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_inbox_items
    ADD CONSTRAINT ai_inbox_items_pkey PRIMARY KEY (id);


--
-- Name: ai_settings ai_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_pkey PRIMARY KEY (id);


--
-- Name: ai_settings ai_settings_singleton_guard_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_singleton_guard_key UNIQUE (singleton_guard);


--
-- Name: assignment_config assignment_config_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.assignment_config
    ADD CONSTRAINT assignment_config_pkey PRIMARY KEY (id);


--
-- Name: assignments assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: booking_urls booking_urls_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.booking_urls
    ADD CONSTRAINT booking_urls_pkey PRIMARY KEY (id);


--
-- Name: booking_urls booking_urls_slug_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.booking_urls
    ADD CONSTRAINT booking_urls_slug_key UNIQUE (slug);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: campaign_ai_briefs campaign_ai_briefs_campaign_id_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaign_ai_briefs
    ADD CONSTRAINT campaign_ai_briefs_campaign_id_key UNIQUE (campaign_id);


--
-- Name: campaign_ai_briefs campaign_ai_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaign_ai_briefs
    ADD CONSTRAINT campaign_ai_briefs_pkey PRIMARY KEY (id);


--
-- Name: campaign_leads campaign_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaign_leads
    ADD CONSTRAINT campaign_leads_pkey PRIMARY KEY (id);


--
-- Name: campaign_variants campaign_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaign_variants
    ADD CONSTRAINT campaign_variants_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: custom_field_definitions custom_field_definitions_field_key_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.custom_field_definitions
    ADD CONSTRAINT custom_field_definitions_field_key_key UNIQUE (field_key);


--
-- Name: custom_field_definitions custom_field_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.custom_field_definitions
    ADD CONSTRAINT custom_field_definitions_pkey PRIMARY KEY (id);


--
-- Name: form_submissions form_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_pkey PRIMARY KEY (id);


--
-- Name: forms forms_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_pkey PRIMARY KEY (id);


--
-- Name: forms forms_slug_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_slug_key UNIQUE (slug);


--
-- Name: integrations integrations_name_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_name_key UNIQUE (name);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- Name: lead_ai_profiles lead_ai_profiles_lead_id_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.lead_ai_profiles
    ADD CONSTRAINT lead_ai_profiles_lead_id_key UNIQUE (lead_id);


--
-- Name: lead_ai_profiles lead_ai_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.lead_ai_profiles
    ADD CONSTRAINT lead_ai_profiles_pkey PRIMARY KEY (id);


--
-- Name: lead_conversation_summaries lead_conversation_summaries_lead_id_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.lead_conversation_summaries
    ADD CONSTRAINT lead_conversation_summaries_lead_id_key UNIQUE (lead_id);


--
-- Name: lead_conversation_summaries lead_conversation_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.lead_conversation_summaries
    ADD CONSTRAINT lead_conversation_summaries_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: pipeline_stages one_lost_per_pipeline; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT one_lost_per_pipeline EXCLUDE USING gist (pipeline_id WITH =) WHERE ((is_terminal_lost = true));


--
-- Name: pipeline_stages one_won_per_pipeline; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT one_won_per_pipeline EXCLUDE USING gist (pipeline_id WITH =) WHERE ((is_terminal_won = true));


--
-- Name: outreach_logs outreach_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.outreach_logs
    ADD CONSTRAINT outreach_logs_pkey PRIMARY KEY (id);


--
-- Name: outreach_sequences outreach_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.outreach_sequences
    ADD CONSTRAINT outreach_sequences_pkey PRIMARY KEY (id);


--
-- Name: pgmigrations pgmigrations_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.pgmigrations
    ADD CONSTRAINT pgmigrations_pkey PRIMARY KEY (id);


--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: pipelines pipelines_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: report_schedules report_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.report_schedules
    ADD CONSTRAINT report_schedules_pkey PRIMARY KEY (id);


--
-- Name: scoring_config scoring_config_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.scoring_config
    ADD CONSTRAINT scoring_config_pkey PRIMARY KEY (id);


--
-- Name: scoring_rules scoring_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.scoring_rules
    ADD CONSTRAINT scoring_rules_pkey PRIMARY KEY (id);


--
-- Name: scraper_configs scraper_configs_name_source_uk; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.scraper_configs
    ADD CONSTRAINT scraper_configs_name_source_uk UNIQUE (name, source_type);


--
-- Name: scraper_configs scraper_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.scraper_configs
    ADD CONSTRAINT scraper_configs_pkey PRIMARY KEY (id);


--
-- Name: scraper_logs scraper_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.scraper_logs
    ADD CONSTRAINT scraper_logs_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: template_variant_assignments template_variant_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.template_variant_assignments
    ADD CONSTRAINT template_variant_assignments_pkey PRIMARY KEY (id);


--
-- Name: template_variant_assignments template_variant_assignments_variant_id_lead_id_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.template_variant_assignments
    ADD CONSTRAINT template_variant_assignments_variant_id_lead_id_key UNIQUE (variant_id, lead_id);


--
-- Name: template_variants template_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.template_variants
    ADD CONSTRAINT template_variants_pkey PRIMARY KEY (id);


--
-- Name: template_variants template_variants_template_id_variant_key_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.template_variants
    ADD CONSTRAINT template_variants_template_id_variant_key_key UNIQUE (template_id, variant_key);


--
-- Name: templates templates_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);


--
-- Name: user_availability user_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.user_availability
    ADD CONSTRAINT user_availability_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: variant_assignments variant_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.variant_assignments
    ADD CONSTRAINT variant_assignments_pkey PRIMARY KEY (id);


--
-- Name: variant_snapshots variant_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.variant_snapshots
    ADD CONSTRAINT variant_snapshots_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_provider_event_uk; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_provider_event_uk UNIQUE (provider, event_id);


--
-- Name: agent_actions_action_name_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_actions_action_name_index ON public.agent_actions USING btree (action_name);


--
-- Name: agent_actions_agent_plan_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_actions_agent_plan_id_index ON public.agent_actions USING btree (agent_plan_id);


--
-- Name: agent_actions_agent_plan_step_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_actions_agent_plan_step_id_index ON public.agent_actions USING btree (agent_plan_step_id);


--
-- Name: agent_actions_campaign_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_actions_campaign_id_index ON public.agent_actions USING btree (campaign_id);


--
-- Name: agent_actions_created_at_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_actions_created_at_index ON public.agent_actions USING btree (created_at);


--
-- Name: agent_actions_lead_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_actions_lead_id_index ON public.agent_actions USING btree (lead_id);


--
-- Name: agent_actions_source_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_actions_source_index ON public.agent_actions USING btree (source);


--
-- Name: agent_actions_status_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_actions_status_index ON public.agent_actions USING btree (status);


--
-- Name: agent_plan_steps_plan_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_plan_steps_plan_id_index ON public.agent_plan_steps USING btree (plan_id);


--
-- Name: agent_plans_conversation_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_plans_conversation_id_index ON public.agent_plans USING btree (conversation_id);


--
-- Name: agent_plans_requested_by_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_plans_requested_by_index ON public.agent_plans USING btree (requested_by);


--
-- Name: agent_plans_status_created_at_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_plans_status_created_at_index ON public.agent_plans USING btree (status, created_at);


--
-- Name: agent_plans_status_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX agent_plans_status_index ON public.agent_plans USING btree (status);


--
-- Name: ai_decision_log_campaign_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_decision_log_campaign_id_index ON public.ai_decision_log USING btree (campaign_id);


--
-- Name: ai_decision_log_created_at_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_decision_log_created_at_index ON public.ai_decision_log USING btree (created_at);


--
-- Name: ai_decision_log_decision_type_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_decision_log_decision_type_index ON public.ai_decision_log USING btree (decision_type);


--
-- Name: ai_decision_log_lead_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_decision_log_lead_id_index ON public.ai_decision_log USING btree (lead_id);


--
-- Name: ai_inbox_items_agent_action_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_inbox_items_agent_action_id_index ON public.ai_inbox_items USING btree (agent_action_id);


--
-- Name: ai_inbox_items_agent_plan_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_inbox_items_agent_plan_id_index ON public.ai_inbox_items USING btree (agent_plan_id);


--
-- Name: ai_inbox_items_agent_plan_step_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_inbox_items_agent_plan_step_id_index ON public.ai_inbox_items USING btree (agent_plan_step_id);


--
-- Name: ai_inbox_items_assigned_to_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_inbox_items_assigned_to_index ON public.ai_inbox_items USING btree (assigned_to);


--
-- Name: ai_inbox_items_assigned_to_status_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_inbox_items_assigned_to_status_index ON public.ai_inbox_items USING btree (assigned_to, status);


--
-- Name: ai_inbox_items_expires_at_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_inbox_items_expires_at_index ON public.ai_inbox_items USING btree (expires_at);


--
-- Name: ai_inbox_items_status_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_inbox_items_status_index ON public.ai_inbox_items USING btree (status);


--
-- Name: ai_inbox_items_urgency_score_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX ai_inbox_items_urgency_score_index ON public.ai_inbox_items USING btree (urgency_score);


--
-- Name: campaign_ai_briefs_campaign_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX campaign_ai_briefs_campaign_id_index ON public.campaign_ai_briefs USING btree (campaign_id);


--
-- Name: campaign_ai_briefs_status_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX campaign_ai_briefs_status_index ON public.campaign_ai_briefs USING btree (status);


--
-- Name: campaign_variants_campaign_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX campaign_variants_campaign_id_index ON public.campaign_variants USING btree (campaign_id);


--
-- Name: campaign_variants_campaign_id_variant_key_unique_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX campaign_variants_campaign_id_variant_key_unique_index ON public.campaign_variants USING btree (campaign_id, variant_key);


--
-- Name: form_submissions_created_at_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX form_submissions_created_at_index ON public.form_submissions USING btree (created_at);


--
-- Name: form_submissions_form_id_created_at_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX form_submissions_form_id_created_at_index ON public.form_submissions USING btree (form_id, created_at);


--
-- Name: form_submissions_form_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX form_submissions_form_id_index ON public.form_submissions USING btree (form_id);


--
-- Name: form_submissions_lead_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX form_submissions_lead_id_index ON public.form_submissions USING btree (lead_id);


--
-- Name: forms_created_by_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX forms_created_by_index ON public.forms USING btree (created_by);


--
-- Name: forms_is_active_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX forms_is_active_index ON public.forms USING btree (is_active);


--
-- Name: forms_slug_unique_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX forms_slug_unique_index ON public.forms USING btree (slug);


--
-- Name: idx_activities_lead_created; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_activities_lead_created ON public.activities USING btree (lead_id, created_at);


--
-- Name: idx_activities_type; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_activities_type ON public.activities USING btree (type);


--
-- Name: idx_activities_user_created; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_activities_user_created ON public.activities USING btree (user_id, created_at) WHERE (user_id IS NOT NULL);


--
-- Name: idx_assignment_config_singleton; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX idx_assignment_config_singleton ON public.assignment_config USING btree ((true));


--
-- Name: idx_assignments_assigned_to; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_assignments_assigned_to ON public.assignments USING btree (assigned_to);


--
-- Name: idx_assignments_created_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_assignments_created_at ON public.assignments USING btree (created_at DESC);


--
-- Name: idx_assignments_lead_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_assignments_lead_id ON public.assignments USING btree (lead_id);


--
-- Name: idx_audit_logs_action; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_audit_logs_user_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: idx_booking_urls_user; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_booking_urls_user ON public.booking_urls USING btree (user_id);


--
-- Name: idx_bookings_lead; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_bookings_lead ON public.bookings USING btree (lead_id);


--
-- Name: idx_bookings_starts; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_bookings_starts ON public.bookings USING btree (starts_at);


--
-- Name: idx_bookings_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);


--
-- Name: idx_bookings_url; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_bookings_url ON public.bookings USING btree (booking_url_id);


--
-- Name: idx_bookings_user; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_bookings_user ON public.bookings USING btree (user_id);


--
-- Name: idx_campaign_leads_campaign_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_campaign_leads_campaign_id ON public.campaign_leads USING btree (campaign_id);


--
-- Name: idx_campaign_leads_lead_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_campaign_leads_lead_id ON public.campaign_leads USING btree (lead_id);


--
-- Name: idx_campaigns_created_by; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_campaigns_created_by ON public.campaigns USING btree (created_by);


--
-- Name: idx_campaigns_deleted_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_campaigns_deleted_at ON public.campaigns USING btree (deleted_at);


--
-- Name: idx_campaigns_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_campaigns_status ON public.campaigns USING btree (status);


--
-- Name: idx_campaigns_target_countries; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_campaigns_target_countries ON public.campaigns USING gin (target_countries);


--
-- Name: idx_campaigns_target_industries; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_campaigns_target_industries ON public.campaigns USING gin (target_industries);


--
-- Name: idx_campaigns_trigger_stage; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_campaigns_trigger_stage ON public.campaigns USING btree (trigger_stage_id) WHERE (trigger_stage_id IS NOT NULL);


--
-- Name: idx_leads_assigned_to; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_assigned_to ON public.leads USING btree (assigned_to);


--
-- Name: idx_leads_classification; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_classification ON public.leads USING btree (classification);


--
-- Name: idx_leads_country; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_country ON public.leads USING btree (country);


--
-- Name: idx_leads_created_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_created_at ON public.leads USING btree (created_at DESC);


--
-- Name: idx_leads_custom_fields; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_custom_fields ON public.leads USING gin (custom_fields);


--
-- Name: idx_leads_dedup_email; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX idx_leads_dedup_email ON public.leads USING btree (lower((email)::text), source_platform) WHERE (deleted_at IS NULL);


--
-- Name: idx_leads_dedup_phone; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX idx_leads_dedup_phone ON public.leads USING btree (phone, source_platform) WHERE (deleted_at IS NULL);


--
-- Name: idx_leads_deleted_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_deleted_at ON public.leads USING btree (deleted_at);


--
-- Name: idx_leads_email; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_email ON public.leads USING btree (email);


--
-- Name: idx_leads_industry; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_industry ON public.leads USING btree (industry);


--
-- Name: idx_leads_phone; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_phone ON public.leads USING btree (phone);


--
-- Name: idx_leads_pipeline_stage; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_pipeline_stage ON public.leads USING btree (pipeline_stage_id);


--
-- Name: idx_leads_source_platform; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_source_platform ON public.leads USING btree (source_platform);


--
-- Name: idx_leads_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_status ON public.leads USING btree (status);


--
-- Name: idx_leads_tags; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_tags ON public.leads USING gin (tags);


--
-- Name: idx_outreach_logs_campaign_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_outreach_logs_campaign_id ON public.outreach_logs USING btree (campaign_id);


--
-- Name: idx_outreach_logs_channel; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_outreach_logs_channel ON public.outreach_logs USING btree (channel);


--
-- Name: idx_outreach_logs_external_msg_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_outreach_logs_external_msg_id ON public.outreach_logs USING btree (external_msg_id) WHERE (external_msg_id IS NOT NULL);


--
-- Name: idx_outreach_logs_lead_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_outreach_logs_lead_id ON public.outreach_logs USING btree (lead_id);


--
-- Name: idx_outreach_logs_sent_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_outreach_logs_sent_at ON public.outreach_logs USING btree (sent_at DESC);


--
-- Name: idx_outreach_logs_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_outreach_logs_status ON public.outreach_logs USING btree (status);


--
-- Name: idx_pipeline_stages_pipeline_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_pipeline_stages_pipeline_id ON public.pipeline_stages USING btree (pipeline_id);


--
-- Name: idx_pipelines_default; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX idx_pipelines_default ON public.pipelines USING btree (is_default) WHERE (is_default = true);


--
-- Name: idx_refresh_tokens_expires_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_refresh_tokens_expires_at ON public.refresh_tokens USING btree (expires_at);


--
-- Name: idx_refresh_tokens_user_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_refresh_tokens_user_id ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_report_schedules_next_run; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_report_schedules_next_run ON public.report_schedules USING btree (next_run_at) WHERE (is_active = true);


--
-- Name: idx_scoring_config_singleton; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX idx_scoring_config_singleton ON public.scoring_config USING btree ((true));


--
-- Name: idx_scoring_rules_is_active; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_scoring_rules_is_active ON public.scoring_rules USING btree (is_active);


--
-- Name: idx_scraper_configs_active; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_scraper_configs_active ON public.scraper_configs USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_scraper_configs_config_gin; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_scraper_configs_config_gin ON public.scraper_configs USING gin (config);


--
-- Name: idx_scraper_configs_source_type; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_scraper_configs_source_type ON public.scraper_configs USING btree (source_type);


--
-- Name: idx_scraper_logs_config_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_scraper_logs_config_id ON public.scraper_logs USING btree (config_id);


--
-- Name: idx_scraper_logs_created_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_scraper_logs_created_at ON public.scraper_logs USING btree (created_at DESC);


--
-- Name: idx_scraper_logs_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_scraper_logs_status ON public.scraper_logs USING btree (status);


--
-- Name: idx_tasks_assigned_to; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_tasks_assigned_to ON public.tasks USING btree (assigned_to) WHERE (status = ANY (ARRAY['pending'::public.task_status, 'in_progress'::public.task_status]));


--
-- Name: idx_tasks_due_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_tasks_due_at ON public.tasks USING btree (due_at) WHERE (status = ANY (ARRAY['pending'::public.task_status, 'in_progress'::public.task_status]));


--
-- Name: idx_tasks_lead_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_tasks_lead_id ON public.tasks USING btree (lead_id);


--
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- Name: idx_template_variant_assignments_lead; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_template_variant_assignments_lead ON public.template_variant_assignments USING btree (lead_id);


--
-- Name: idx_template_variant_assignments_variant; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_template_variant_assignments_variant ON public.template_variant_assignments USING btree (variant_id);


--
-- Name: idx_template_variants_template_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_template_variants_template_id ON public.template_variants USING btree (template_id);


--
-- Name: idx_templates_approval_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_templates_approval_status ON public.templates USING btree (approval_status);


--
-- Name: idx_templates_channel; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_templates_channel ON public.templates USING btree (channel);


--
-- Name: idx_templates_created_by; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_templates_created_by ON public.templates USING btree (created_by);


--
-- Name: idx_user_availability_unique_slot; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX idx_user_availability_unique_slot ON public.user_availability USING btree (user_id, day_of_week, start_time);


--
-- Name: idx_user_availability_user; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_user_availability_user ON public.user_availability USING btree (user_id);


--
-- Name: idx_users_deleted_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_users_deleted_at ON public.users USING btree (deleted_at);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_is_available; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_users_is_available ON public.users USING btree (is_available) WHERE (is_active = true);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_webhook_events_idempotency_key; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX idx_webhook_events_idempotency_key ON public.webhook_events USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_webhook_events_lead_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_webhook_events_lead_id ON public.webhook_events USING btree (lead_id);


--
-- Name: idx_webhook_events_received_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_webhook_events_received_at ON public.webhook_events USING btree (received_at DESC);


--
-- Name: idx_webhook_events_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_webhook_events_status ON public.webhook_events USING btree (status);


--
-- Name: lead_ai_profiles_buying_intent_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX lead_ai_profiles_buying_intent_index ON public.lead_ai_profiles USING btree (buying_intent);


--
-- Name: lead_ai_profiles_enrichment_status_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX lead_ai_profiles_enrichment_status_index ON public.lead_ai_profiles USING btree (enrichment_status);


--
-- Name: lead_ai_profiles_lead_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX lead_ai_profiles_lead_id_index ON public.lead_ai_profiles USING btree (lead_id);


--
-- Name: lead_ai_profiles_next_best_action_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX lead_ai_profiles_next_best_action_index ON public.lead_ai_profiles USING btree (next_best_action);


--
-- Name: lead_conversation_summaries_lead_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX lead_conversation_summaries_lead_id_index ON public.lead_conversation_summaries USING btree (lead_id);


--
-- Name: variant_assignments_lead_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX variant_assignments_lead_id_index ON public.variant_assignments USING btree (lead_id);


--
-- Name: variant_assignments_variant_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX variant_assignments_variant_id_index ON public.variant_assignments USING btree (variant_id);


--
-- Name: variant_assignments_variant_id_lead_id_unique_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX variant_assignments_variant_id_lead_id_unique_index ON public.variant_assignments USING btree (variant_id, lead_id);


--
-- Name: variant_snapshots_variant_id_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX variant_snapshots_variant_id_index ON public.variant_snapshots USING btree (variant_id);


--
-- Name: variant_snapshots_variant_id_snapshot_at_index; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX variant_snapshots_variant_id_snapshot_at_index ON public.variant_snapshots USING btree (variant_id, snapshot_at);


--
-- Name: assignment_config trg_assignment_config_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_assignment_config_updated_at BEFORE UPDATE ON public.assignment_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: campaigns trg_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: custom_field_definitions trg_custom_field_definitions_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_custom_field_definitions_updated_at BEFORE UPDATE ON public.custom_field_definitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: leads trg_leads_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: outreach_logs trg_outreach_logs_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_outreach_logs_updated_at BEFORE UPDATE ON public.outreach_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: outreach_sequences trg_outreach_sequences_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_outreach_sequences_updated_at BEFORE UPDATE ON public.outreach_sequences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pipeline_stages trg_pipeline_stages_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_pipeline_stages_updated_at BEFORE UPDATE ON public.pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pipelines trg_pipelines_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_pipelines_updated_at BEFORE UPDATE ON public.pipelines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: report_schedules trg_report_schedules_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_report_schedules_updated_at BEFORE UPDATE ON public.report_schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: scoring_rules trg_scoring_rules_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_scoring_rules_updated_at BEFORE UPDATE ON public.scoring_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tasks trg_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: templates trg_templates_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_templates_updated_at BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: crm
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: activities activities_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: activities activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: agent_actions agent_actions_agent_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_agent_plan_id_fkey FOREIGN KEY (agent_plan_id) REFERENCES public.agent_plans(id) ON DELETE SET NULL;


--
-- Name: agent_actions agent_actions_agent_plan_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_agent_plan_step_id_fkey FOREIGN KEY (agent_plan_step_id) REFERENCES public.agent_plan_steps(id) ON DELETE SET NULL;


--
-- Name: agent_actions agent_actions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: agent_actions agent_actions_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: agent_actions agent_actions_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: agent_actions agent_actions_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: agent_plan_steps agent_plan_steps_agent_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_plan_steps
    ADD CONSTRAINT agent_plan_steps_agent_action_id_fkey FOREIGN KEY (agent_action_id) REFERENCES public.agent_actions(id) ON DELETE SET NULL;


--
-- Name: agent_plan_steps agent_plan_steps_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_plan_steps
    ADD CONSTRAINT agent_plan_steps_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.agent_plans(id) ON DELETE CASCADE;


--
-- Name: agent_plans agent_plans_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.agent_plans
    ADD CONSTRAINT agent_plans_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_decision_log ai_decision_log_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_decision_log
    ADD CONSTRAINT ai_decision_log_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: ai_decision_log ai_decision_log_human_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_decision_log
    ADD CONSTRAINT ai_decision_log_human_approved_by_fkey FOREIGN KEY (human_approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_decision_log ai_decision_log_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_decision_log
    ADD CONSTRAINT ai_decision_log_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: ai_inbox_items ai_inbox_items_actioned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_inbox_items
    ADD CONSTRAINT ai_inbox_items_actioned_by_fkey FOREIGN KEY (actioned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_inbox_items ai_inbox_items_agent_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_inbox_items
    ADD CONSTRAINT ai_inbox_items_agent_action_id_fkey FOREIGN KEY (agent_action_id) REFERENCES public.agent_actions(id) ON DELETE SET NULL;


--
-- Name: ai_inbox_items ai_inbox_items_agent_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_inbox_items
    ADD CONSTRAINT ai_inbox_items_agent_plan_id_fkey FOREIGN KEY (agent_plan_id) REFERENCES public.agent_plans(id) ON DELETE SET NULL;


--
-- Name: ai_inbox_items ai_inbox_items_agent_plan_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_inbox_items
    ADD CONSTRAINT ai_inbox_items_agent_plan_step_id_fkey FOREIGN KEY (agent_plan_step_id) REFERENCES public.agent_plan_steps(id) ON DELETE SET NULL;


--
-- Name: ai_inbox_items ai_inbox_items_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_inbox_items
    ADD CONSTRAINT ai_inbox_items_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_inbox_items ai_inbox_items_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_inbox_items
    ADD CONSTRAINT ai_inbox_items_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: ai_inbox_items ai_inbox_items_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_inbox_items
    ADD CONSTRAINT ai_inbox_items_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: ai_settings ai_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: assignment_config assignment_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.assignment_config
    ADD CONSTRAINT assignment_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: assignments assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: assignments assignments_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: assignments assignments_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: booking_urls booking_urls_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.booking_urls
    ADD CONSTRAINT booking_urls_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_booking_url_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_booking_url_id_fkey FOREIGN KEY (booking_url_id) REFERENCES public.booking_urls(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: campaign_ai_briefs campaign_ai_briefs_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaign_ai_briefs
    ADD CONSTRAINT campaign_ai_briefs_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: campaign_ai_briefs campaign_ai_briefs_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaign_ai_briefs
    ADD CONSTRAINT campaign_ai_briefs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_leads campaign_leads_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaign_leads
    ADD CONSTRAINT campaign_leads_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_leads campaign_leads_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaign_leads
    ADD CONSTRAINT campaign_leads_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: campaign_variants campaign_variants_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaign_variants
    ADD CONSTRAINT campaign_variants_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_variants campaign_variants_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaign_variants
    ADD CONSTRAINT campaign_variants_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE SET NULL;


--
-- Name: campaigns campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: campaigns campaigns_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE SET NULL;


--
-- Name: campaigns campaigns_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.outreach_sequences(id) ON DELETE SET NULL;


--
-- Name: campaigns campaigns_trigger_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_trigger_stage_id_fkey FOREIGN KEY (trigger_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;


--
-- Name: custom_field_definitions custom_field_definitions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.custom_field_definitions
    ADD CONSTRAINT custom_field_definitions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: form_submissions form_submissions_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id) ON DELETE CASCADE;


--
-- Name: form_submissions form_submissions_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: forms forms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: integrations integrations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: lead_ai_profiles lead_ai_profiles_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.lead_ai_profiles
    ADD CONSTRAINT lead_ai_profiles_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_conversation_summaries lead_conversation_summaries_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.lead_conversation_summaries
    ADD CONSTRAINT lead_conversation_summaries_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: leads leads_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leads leads_pipeline_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pipeline_stage_id_fkey FOREIGN KEY (pipeline_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;


--
-- Name: outreach_logs outreach_logs_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.outreach_logs
    ADD CONSTRAINT outreach_logs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: outreach_logs outreach_logs_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.outreach_logs
    ADD CONSTRAINT outreach_logs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: outreach_logs outreach_logs_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.outreach_logs
    ADD CONSTRAINT outreach_logs_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE SET NULL;


--
-- Name: outreach_sequences outreach_sequences_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.outreach_sequences
    ADD CONSTRAINT outreach_sequences_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pipeline_stages pipeline_stages_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;


--
-- Name: pipelines pipelines_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: report_schedules report_schedules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.report_schedules
    ADD CONSTRAINT report_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: scoring_config scoring_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.scoring_config
    ADD CONSTRAINT scoring_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: scoring_rules scoring_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.scoring_rules
    ADD CONSTRAINT scoring_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: scraper_configs scraper_configs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.scraper_configs
    ADD CONSTRAINT scraper_configs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: scraper_logs scraper_logs_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.scraper_logs
    ADD CONSTRAINT scraper_logs_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.scraper_configs(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.outreach_sequences(id) ON DELETE SET NULL;


--
-- Name: template_variant_assignments template_variant_assignments_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.template_variant_assignments
    ADD CONSTRAINT template_variant_assignments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: template_variant_assignments template_variant_assignments_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.template_variant_assignments
    ADD CONSTRAINT template_variant_assignments_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.template_variants(id) ON DELETE CASCADE;


--
-- Name: template_variants template_variants_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.template_variants
    ADD CONSTRAINT template_variants_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE CASCADE;


--
-- Name: templates templates_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: templates templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: user_availability user_availability_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.user_availability
    ADD CONSTRAINT user_availability_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: variant_assignments variant_assignments_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.variant_assignments
    ADD CONSTRAINT variant_assignments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: variant_assignments variant_assignments_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.variant_assignments
    ADD CONSTRAINT variant_assignments_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.campaign_variants(id) ON DELETE CASCADE;


--
-- Name: variant_snapshots variant_snapshots_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.variant_snapshots
    ADD CONSTRAINT variant_snapshots_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.campaign_variants(id) ON DELETE CASCADE;


--
-- Name: webhook_events webhook_events_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict podaBTeldxDNT4I8AWqDTDj9dSZt4IzDG1O1cDFIroeszjS6ELSFxufdn9DEE3s

