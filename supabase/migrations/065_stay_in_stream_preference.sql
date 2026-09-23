-- Lets a signed-in viewer opt the header's logo link away from the zine
-- homepage ("/") and keep it pointed at the streaming home ("/stream")
-- instead, from a toggle on their account page. Defaults to false (logo
-- goes to the zine homepage) so existing accounts see no behavior change.
alter table user_profiles add column if not exists stay_in_stream boolean not null default false;
comment on column user_profiles.stay_in_stream is 'Private preference — when true, the header logo links to /stream instead of the zine homepage (/).';
