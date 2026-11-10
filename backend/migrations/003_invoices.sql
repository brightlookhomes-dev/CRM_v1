-- Tax invoices: one per customer payment, numbered BLH/<year>/<001...> with a per-year counter.
create table invoice_counters (
  year int primary key,
  last_number int not null default 0
);

alter table customer_payments add column invoice_number text;
alter table customer_payments add column invoice_description text;
create unique index uq_invoice_number on customer_payments (invoice_number) where invoice_number is not null;

-- Back-fill invoices for payments recorded before this feature, oldest first within each year.
with numbered as (
  select id, extract(year from payment_date)::int as y,
         row_number() over (partition by extract(year from payment_date) order by payment_date, created_at, id) as n
    from customer_payments where entry_type = 'PAYMENT'
)
update customer_payments cp
   set invoice_number = 'BLH/' || numbered.y || '/' || lpad(numbered.n::text, 3, '0')
  from numbered where numbered.id = cp.id;

insert into invoice_counters (year, last_number)
select substring(invoice_number from 5 for 4)::int, count(*)::int
  from customer_payments where invoice_number is not null group by 1;
