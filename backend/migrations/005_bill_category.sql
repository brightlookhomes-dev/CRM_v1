-- Expense category for vendor bills (cement, bricks, ...). Used by the project ledger.
alter table vendor_bills add column category text;
