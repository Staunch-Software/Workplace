-- ENUMS
CREATE TYPE public.defectpriority AS ENUM ('NORMAL', 'HIGH', 'MEDIUM', 'CRITICAL', 'LOW');
CREATE TYPE public.defectsource AS ENUM ('Office - Technical', 'Office - Operation', 'Internal Audit', 'External Audit', 'Third Party - RS', 'Third Party - PnI', 'Third Party - Charterer', 'Third Party - Other', 'Owner''s Inspection', 'Vessel');
CREATE TYPE public.defectstatus AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED', 'PENDING_CLOSURE');
CREATE TYPE public.feedeventtype AS ENUM ('DEFECT_OPENED', 'DEFECT_CLOSED', 'PRIORITY_CHANGED', 'IMAGE_UPLOADED', 'PIC_MADE_MANDATORY', 'PIC_MADE_OPTIONAL', 'PR_ADDED', 'MENTION');
CREATE TYPE public.notificationtype AS ENUM ('MENTION', 'ALERT', 'SYSTEM');
CREATE TYPE public.taskstatus AS ENUM ('PENDING', 'COMPLETED');

-- TABLES
CREATE TABLE public.vessels (
    imo character varying(7) PRIMARY KEY,
    name character varying NOT NULL,
    vessel_type character varying,
    email character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1,
    origin character varying(20) DEFAULT 'VESSEL'
);

CREATE TABLE public.users (
    id uuid PRIMARY KEY,
    email character varying UNIQUE NOT NULL,
    password_hash character varying NOT NULL,
    full_name character varying NOT NULL,
    job_title character varying,
    role character varying NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    preferences jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.user_vessel_link (
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    vessel_imo character varying(7) REFERENCES public.vessels(imo) ON DELETE CASCADE,
    PRIMARY KEY (user_id, vessel_imo)
);

CREATE TABLE public.defects (
    id uuid PRIMARY KEY,
    vessel_imo character varying REFERENCES public.vessels(imo),
    reported_by_id uuid REFERENCES public.users(id),
    title character varying NOT NULL,
    equipment_name character varying NOT NULL,
    description text NOT NULL,
    defect_source public.defectsource NOT NULL,
    priority public.defectpriority NOT NULL,
    status public.defectstatus NOT NULL,
    responsibility character varying,
    pr_status character varying DEFAULT 'Not Set',
    before_image_required boolean DEFAULT false,
    after_image_required boolean DEFAULT false,
    before_image_path character varying,
    after_image_path character varying,
    date_identified timestamp with time zone,
    target_close_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone,
    closed_by_id uuid REFERENCES public.users(id),
    closure_remarks text,
    closure_image_before character varying,
    closure_image_after character varying,
    json_backup_path character varying,
    is_deleted boolean DEFAULT false,
    is_owner boolean DEFAULT false,
    version integer DEFAULT 1,
    origin character varying(20) DEFAULT 'VESSEL'
);

CREATE TABLE public.threads (
    id uuid PRIMARY KEY,
    defect_id uuid REFERENCES public.defects(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.users(id),
    author_role character varying NOT NULL,
    body text NOT NULL,
    is_system_message boolean DEFAULT false,
    tagged_user_ids character varying[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_internal boolean DEFAULT false,
    version integer DEFAULT 1,
    origin character varying(20) DEFAULT 'VESSEL'
);

CREATE TABLE public.attachments (
    id uuid PRIMARY KEY,
    thread_id uuid REFERENCES public.threads(id) ON DELETE CASCADE,
    file_name character varying NOT NULL,
    file_size integer,
    content_type character varying,
    blob_path character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1,
    origin character varying(20) DEFAULT 'VESSEL'
);

CREATE TABLE public.defect_images (
    id uuid PRIMARY KEY,
    defect_id uuid REFERENCES public.defects(id) ON DELETE CASCADE,
    image_type character varying NOT NULL,
    file_name character varying NOT NULL,
    file_size integer,
    blob_path character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1,
    origin character varying(20) DEFAULT 'VESSEL'
);

CREATE TABLE public.pr_entries (
    id uuid PRIMARY KEY,
    defect_id uuid REFERENCES public.defects(id) ON DELETE CASCADE,
    pr_number character varying NOT NULL,
    pr_description character varying,
    is_deleted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by_id uuid REFERENCES public.users(id),
    version integer DEFAULT 1,
    origin character varying(20) DEFAULT 'VESSEL'
);

CREATE TABLE public.notifications (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES public.users(id),
    type public.notificationtype,
    title character varying NOT NULL,
    message character varying NOT NULL,
    link character varying,
    is_read boolean DEFAULT false,
    is_seen boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    meta jsonb DEFAULT '{}'::jsonb,
    version integer DEFAULT 1,
    origin character varying(20) DEFAULT 'VESSEL'
);

CREATE TABLE public.sync_queue (
    id uuid PRIMARY KEY,
    entity_type character varying(50) NOT NULL,
    entity_id uuid NOT NULL,
    operation character varying(20) NOT NULL,
    payload jsonb NOT NULL,
    version integer NOT NULL,
    origin character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'PENDING',
    retry_count integer DEFAULT 0,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone,
    next_retry_at timestamp with time zone
);

CREATE TABLE public.sync_state (
    id serial PRIMARY KEY,
    vessel_imo character varying(7) UNIQUE NOT NULL,
    last_push_at timestamp with time zone,
    last_pull_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sync_conflicts (
    id uuid PRIMARY KEY,
    entity_type character varying(50) NOT NULL,
    entity_id uuid NOT NULL,
    version integer NOT NULL,
    incoming_data jsonb NOT NULL,
    existing_data jsonb NOT NULL,
    detected_at timestamp with time zone DEFAULT now(),
    resolved boolean DEFAULT false
);

CREATE TABLE public.tasks (
    id uuid PRIMARY KEY,
    description character varying NOT NULL,
    status public.taskstatus DEFAULT 'PENDING',
    defect_id uuid REFERENCES public.defects(id),
    created_by_id uuid REFERENCES public.users(id),
    assigned_to_id uuid REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1,
    origin character varying(20) DEFAULT 'VESSEL'
);

CREATE TABLE public.live_feed (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES public.users(id),
    vessel_imo character varying REFERENCES public.vessels(imo),
    vessel_name character varying,
    defect_id uuid REFERENCES public.defects(id) ON DELETE SET NULL,
    event_type public.feedeventtype NOT NULL,
    title character varying NOT NULL,
    message character varying NOT NULL,
    link character varying,
    is_read boolean DEFAULT false,
    is_seen boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    meta jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.live_feed_read (
    id uuid PRIMARY KEY,
    feed_id uuid REFERENCES public.live_feed(id),
    user_id uuid REFERENCES public.users(id),
    is_read boolean DEFAULT false,
    read_at timestamp without time zone,
    UNIQUE(feed_id, user_id)
);