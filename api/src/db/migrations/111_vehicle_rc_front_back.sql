-- RC is now collected front + back. vehicle_rc rows become the front side (keeping their
-- review status); drivers who have no back on file are held out of going online and ride
-- broadcast by docIssueExistsSql until they upload it.
UPDATE driver_vehicle_documents SET doc_type = 'vehicle_rc_front' WHERE doc_type = 'vehicle_rc';
