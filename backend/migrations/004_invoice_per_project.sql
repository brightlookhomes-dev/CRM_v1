-- Invoice numbers become BLH/<year>/<project code number>/<001...>, counted per project.
with numbered as (
  select cp.id,
         extract(year from cp.payment_date)::int as y,
         split_part(p.project_code, '-', 3) as tail,
         row_number() over (partition by cp.project_id order by cp.payment_date, cp.created_at, cp.id) as n
    from customer_payments cp join projects p on p.id = cp.project_id
   where cp.entry_type = 'PAYMENT'
)
update customer_payments cp
   set invoice_number = 'BLH/' || numbered.y || '/' || numbered.tail || '/' || lpad(numbered.n::text, 3, '0')
  from numbered where numbered.id = cp.id;

drop table invoice_counters;
