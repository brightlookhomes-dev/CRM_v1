-- Stages may overlap: start = (previous stage end + 1 day) + start_offset_days. 0 = right after, negative = overlap, positive = gap.
alter table project_stages add column start_offset_days int not null default 0 check (start_offset_days between -1500 and 1500);
