ALTER TABLE public.invoices ADD COLUMN currency text CHECK(currency IS NULL OR currency IN ('USD','CAD'));
