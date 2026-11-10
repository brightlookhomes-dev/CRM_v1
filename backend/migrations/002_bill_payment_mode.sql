-- Payment mode chosen by the admin when approving a vendor bill (reference stored in payment_reference).
alter table vendor_bills add column payment_mode text
  check (payment_mode in ('CASH','UPI','CHEQUE','NET_BANKING','NEFT','RTGS','IMPS','OTHER'));
