-- Project URL becomes optional — a creator might want to list a project
-- before they have a funding page up yet (still building the pitch, or
-- funding elsewhere not via a link). The "Fund this project" button on
-- the detail page just won't render when this is empty.
alter table pitches alter column project_url drop not null;
