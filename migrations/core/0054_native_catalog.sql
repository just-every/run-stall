-- Native catalog custody is independent of the legacy Shopify import's ownership.
CREATE TABLE st_catalog_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 fingerprint TEXT UNIQUE NOT NULL,
 namespace TEXT NOT NULL,
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
 plan_sha TEXT NOT NULL,
 job_json TEXT NOT NULL CHECK(json_valid(job_json)),
 report_json TEXT NOT NULL CHECK(json_valid(report_json)),
 created_at TEXT NOT NULL
);
