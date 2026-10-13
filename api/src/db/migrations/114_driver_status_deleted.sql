-- Account deletion (Google Play requirement): a deleted driver keeps its row (rides, payments and
-- settlements reference it and must be retained) but loses all personal data and cannot sign in.
-- Riders already have user_status 'deleted'.
ALTER TYPE driver_status ADD VALUE IF NOT EXISTS 'deleted';
